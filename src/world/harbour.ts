// harbour.ts: the water. Reflections are thin vertical streaks under the lit towers. A light
// profile of the skyline drives them: every lit front window visible from a camera pose,
// projected onto the shoreline plane as seen from that pose, summed per column of about 2.5 m
// (one row: light and color; a second row: how high that column's lights and roofs reach). The
// shader turns each column into a streak that runs toward the camera about 1.4 times its lights'
// height, breaks it with scrolling ripples, and leaves dark water between.
//
// One profile per camera stop (BAKE_SLOTS), so oblique stops reflect the right towers. The
// renderer bakes the hero first and the rest in idle time, and blends the two stops either side
// of the camera.

import {
  ClampToEdgeWrapping,
  DataTexture,
  LinearFilter,
  Mesh,
  PlaneGeometry,
  RGBAFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
} from 'three';
import { SEG_SOLID, type CityLayout } from './city';
import { PALETTE } from './palette';
import { cityFog } from './skyline';
import { brightness, isWarm, type FrontWindow } from './windows';
import waterVert from './shaders/water.vert.glsl?raw';
import waterFrag from './shaders/water.frag.glsl?raw';

export interface HarbourUniforms {
  uTime: IUniform<number>;
  uMotion: IUniform<number>;
  uSkyFade: IUniform<number>;
  uWake: IUniform<number>;
}

/** Profile slots: hero, question, experience, och, ais, club, more (since, people, contact reuse more). */
export const BAKE_SLOTS = 7;
const PW = 2048;

export interface WindowSet {
  wins: FrontWindow[];
  vis: Uint8Array;
  normal: [number, number];
}

export interface Harbour {
  mesh: Mesh;
  hiRange: Vector4;
  /**
   * Bake a slot from a camera position and sets of lit windows with what that camera can see of
   * each. normal is the face direction (x, z) of the set; each window counts in proportion to how
   * squarely it faces the camera, so faces seen edge-on add little.
   */
  bake(slot: number, cam: Vector3, sets: WindowSet[]): void;
  /** Copy one slot's profile into another (placeholder until the real bake runs). */
  copy(from: number, to: number): void;
  /** Per-slot profile statistics, for the lab page. */
  stats: { p50: number; p98: number; lift: number }[];
  /** Blend slots a and b by t for the current frame. */
  setBlend(a: number, b: number, t: number): void;
}

export function buildHarbour(city: CityLayout, shared: HarbourUniforms): Harbour {
  const zp = city.zFront;
  const x0 = city.xMin - 400;
  const xSpan = city.width + 800;
  const ySpan = city.maxTip * 1.05;
  const binX = xSpan / PW;
  const rows = BAKE_SLOTS * 2;
  const data = new Uint8Array(PW * rows * 4);
  const tex = new DataTexture(data, PW, rows, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;

  const warm = PALETTE.window;
  const cool = PALETTE.cool;

  // Heights: a wide max filter and then a gaussian, so streak length changes gradually from
  // column to column instead of jumping at tower edges.
  const smoothHeights = (src: Float32Array) => {
    const mx = new Float32Array(PW);
    for (let i = 0; i < PW; i++) {
      let m = 0;
      const mr = Math.round(15 / binX);
      for (let k = -mr; k <= mr; k++) m = Math.max(m, src[Math.min(PW - 1, Math.max(0, i + k))]);
      mx[i] = m;
    }
    const out = new Float32Array(PW);
    const R = Math.round(270 / binX);
    const sigma = 90 / binX;
    const ws: number[] = [];
    for (let k = -R; k <= R; k++) ws.push(Math.exp(-(k * k) / (2 * sigma * sigma)));
    for (let i = 0; i < PW; i++) {
      let sum = 0;
      let w = 0;
      for (let k = -R; k <= R; k++) {
        const ii = i + k;
        if (ii < 0 || ii >= PW) continue;
        sum += mx[ii] * ws[k + R];
        w += ws[k + R];
      }
      out[i] = sum / w;
    }
    return out;
  };

  const stats: { p50: number; p98: number; lift: number }[] = [];
  function bake(slot: number, cam: Vector3, sets: WindowSet[]) {
    const project = (x: number, y: number, z: number) => {
      const k = (cam.z - zp) / (cam.z - z);
      return [cam.x + (x - cam.x) * k, cam.y + (y - cam.y) * k];
    };
    // Light: each visible lit window adds its color to its column, and raises its lit top.
    const sum = new Float32Array(PW * 3);
    const count = new Float32Array(PW);
    const litTop = new Float32Array(PW);
    const roof = new Float32Array(PW);
    for (const set of sets) {
      const [nx, nz] = set.normal;
      for (let i = 0; i < set.wins.length; i++) {
        if (!set.vis[i]) continue;
        const w = set.wins[i];
        const dx = cam.x - w.x;
        const dz = cam.z - w.z;
        const facing = (nx * dx + nz * dz) / Math.hypot(dx, cam.y - w.y, dz);
        if (facing <= 0.05) continue;
        const [px, py] = project(w.x, w.y, w.z);
        const bx = Math.floor((px - x0) / binX);
        if (bx < 0 || bx >= PW) continue;
        const c = isWarm(w.wh, w.T) ? warm : cool;
        const b = brightness(w.wh) * Math.min(1, facing * 1.25);
        sum[bx * 3] += c[0] * b;
        sum[bx * 3 + 1] += c[1] * b;
        sum[bx * 3 + 2] += c[2] * b;
        count[bx] += b;
        litTop[bx] = Math.max(litTop[bx], py);
      }
    }
    for (const t of city.towers) {
      for (const s of t.segs) {
        if (s.kind === SEG_SOLID) continue;
        const zf = s.z + s.d / 2;
        const [ax] = project(s.x - s.w / 2, 0, zf);
        const [bx, by] = project(s.x + s.w / 2, s.y0 + s.h, zf);
        const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - x0) / binX));
        const i1 = Math.min(PW - 1, Math.floor((Math.max(ax, bx) - x0) / binX));
        for (let i = i0; i <= i1; i++) roof[i] = Math.max(roof[i], by);
      }
    }
    // Light grows with the number of stacked lights in a column (per 2.5 m of width, so tiers
    // with narrower columns get the same streaks). Then a stop whose brightest columns (98th
    // percentile) fall short of 0.85, such as one facing low-rise buildings close up, is lifted
    // so they reach it; a stop that already reaches it (the hero) is left as it is.
    const light = new Float32Array(PW * 3);
    const strength = new Float32Array(PW);
    for (let i = 0; i < PW; i++) {
      if (count[i] <= 0) continue;
      const perWidth = (count[i] * 2.5) / binX;
      strength[i] = Math.pow(1 - Math.exp(-perWidth / 14), 1.7);
    }
    const lit = Array.from(strength).filter((v) => v > 0).sort((a, b) => a - b);
    const p98 = lit.length ? lit[Math.min(lit.length - 1, Math.floor(lit.length * 0.98))] : 1;
    const p50 = lit.length ? lit[Math.floor(lit.length * 0.5)] : 1;
    const lift = Math.max(1, 0.85 / Math.max(p98, 0.05));
    stats[slot] = { p50: +p50.toFixed(3), p98: +p98.toFixed(3), lift: +lift.toFixed(2) };
    for (let i = 0; i < PW; i++) {
      if (count[i] <= 0) continue;
      const k = Math.min(1, strength[i] * lift);
      for (let c = 0; c < 3; c++) light[i * 3 + c] = (sum[i * 3 + c] / count[i]) * k;
    }
    const topS = smoothHeights(litTop);
    const roofS = smoothHeights(roof);
    const r0 = slot * 2 * PW * 4;
    const r1 = (slot * 2 + 1) * PW * 4;
    for (let i = 0; i < PW; i++) {
      for (let c = 0; c < 3; c++) {
        const a = light[Math.max(0, i - 1) * 3 + c];
        const b = light[i * 3 + c];
        const d = light[Math.min(PW - 1, i + 1) * 3 + c];
        data[r0 + i * 4 + c] = Math.round(255 * Math.min(1, 0.25 * a + 0.5 * b + 0.25 * d));
      }
      data[r0 + i * 4 + 3] = 255;
      data[r1 + i * 4] = Math.round((255 * Math.min(topS[i], ySpan)) / ySpan);
      data[r1 + i * 4 + 1] = Math.round((255 * Math.min(roofS[i], ySpan)) / ySpan);
      data[r1 + i * 4 + 2] = 0;
      data[r1 + i * 4 + 3] = 255;
    }
    tex.needsUpdate = true;
  }

  function copy(from: number, to: number) {
    const n = 2 * PW * 4;
    data.copyWithin(to * n, from * n, from * n + n);
    tex.needsUpdate = true;
  }

  const blend = new Vector3(0, 0, 0);
  const hiRange = new Vector4(0, 0, 0, 0);
  const plane = new PlaneGeometry(26000, 16000, 1, 1);
  plane.rotateX(-Math.PI / 2);
  const mesh = new Mesh(
    plane,
    new ShaderMaterial({
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      defines: { PROFILE_ROWS: rows.toFixed(1) },
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uSkyFade: shared.uSkyFade,
        uWake: shared.uWake,
        uProfile: { value: tex },
        uProfRange: { value: new Vector4(x0, xSpan, ySpan, zp) },
        uBake: { value: blend },
        // how bright a full-strength streak gets
        uProfGain: { value: 0.95 },
        uNight: { value: new Vector3(...PALETTE.night) },
        uSky: { value: new Vector3(...PALETTE.sky) },
        uGlow: { value: new Vector3(...PALETTE.glow) },
        uHiRange: { value: hiRange },
        uCityX: { value: new Vector2(city.xMin, city.width) },
        uFog: { value: cityFog(city) },
      },
    }),
  );
  // The plane spans the harbour toward the camera and the land under the city (z < 0).
  mesh.position.set(city.centralX, 0, 16000 / 2 - 3200);
  mesh.frustumCulled = false;
  mesh.name = 'harbour';
  return {
    mesh,
    hiRange,
    stats,
    bake,
    copy,
    setBlend(a: number, b: number, t: number) {
      blend.set(a, b, t);
    },
  };
}
