// harbour.ts: the water. Reflections are thin vertical streaks under the lit towers. A light
// profile of the skyline drives them: every visible lit front window, projected onto the
// shoreline as seen from the hero camera, summed per column of about 2.5 m (row 0: light and
// color; row 1: how high that column's lights and roofs reach). The shader turns each column into
// a streak that runs toward the camera about 1.5 times its tower's height, breaks it with
// scrolling ripples, and leaves dark water between.

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


export function buildHarbour(
  city: CityLayout,
  wins: FrontWindow[],
  vis: Uint8Array,
  hero: Vector3,
  shared: HarbourUniforms,
): { mesh: Mesh; hiRange: Vector4 } {
  const PW = 2048;
  const zp = city.zFront;
  const x0 = city.xMin - 400;
  const xSpan = city.width + 800;
  const ySpan = city.maxTip * 1.05;
  const binX = xSpan / PW;
  const project = (x: number, y: number, z: number) => {
    const k = (hero.z - zp) / (hero.z - z);
    return [hero.x + (x - hero.x) * k, hero.y + (y - hero.y) * k];
  };

  // Row 0: each visible lit window adds its color to its column. Row 1: the highest light.
  const sum = new Float32Array(PW * 3);
  const count = new Float32Array(PW);
  const litTop = new Float32Array(PW);
  const roof = new Float32Array(PW);
  const warm = PALETTE.window;
  const cool = PALETTE.cool;
  for (let i = 0; i < wins.length; i++) {
    if (!vis[i]) continue;
    const w = wins[i];
    const [px, py] = project(w.x, w.y, w.z);
    const bx = Math.floor((px - x0) / binX);
    if (bx < 0 || bx >= PW) continue;
    const c = isWarm(w.wh, w.T) ? warm : cool;
    const b = brightness(w.wh);
    sum[bx * 3] += c[0] * b;
    sum[bx * 3 + 1] += c[1] * b;
    sum[bx * 3 + 2] += c[2] * b;
    count[bx] += b;
    litTop[bx] = Math.max(litTop[bx], py);
  }
  for (const t of city.towers) {
    for (const s of t.segs) {
      if (s.kind === SEG_SOLID) continue;
      const zf = s.z + s.d / 2;
      const [ax] = project(s.x - s.w / 2, 0, zf);
      const [bx, by] = project(s.x + s.w / 2, s.y0 + s.h, zf);
      const i0 = Math.max(0, Math.floor((ax - x0) / binX));
      const i1 = Math.min(PW - 1, Math.floor((bx - x0) / binX));
      for (let i = i0; i <= i1; i++) roof[i] = Math.max(roof[i], by);
    }
  }
  // Light saturates with the number of stacked lights: a tall bright tower gives a strong
  // streak, a dim low one a faint one.
  const light = new Float32Array(PW * 3);
  for (let i = 0; i < PW; i++) {
    if (count[i] <= 0) continue;
    const strength = Math.pow(1 - Math.exp(-count[i] / 16), 2);
    for (let c = 0; c < 3; c++) light[i * 3 + c] = (sum[i * 3 + c] / count[i]) * strength;
  }
  const soft = new Float32Array(PW * 3);
  for (let i = 0; i < PW; i++) {
    for (let c = 0; c < 3; c++) {
      const a = light[Math.max(0, i - 1) * 3 + c];
      const b = light[i * 3 + c];
      const d = light[Math.min(PW - 1, i + 1) * 3 + c];
      soft[i * 3 + c] = 0.25 * a + 0.5 * b + 0.25 * d;
    }
  }
  const data = new Uint8Array(PW * 2 * 4);
  for (let i = 0; i < PW; i++) {
    let top = 0;
    let rf = 0;
    for (let k = -2; k <= 2; k++) {
      const ii = Math.min(PW - 1, Math.max(0, i + k));
      top = Math.max(top, litTop[ii]);
      rf = Math.max(rf, roof[ii]);
    }
    data[i * 4] = Math.round(255 * Math.min(1, soft[i * 3]));
    data[i * 4 + 1] = Math.round(255 * Math.min(1, soft[i * 3 + 1]));
    data[i * 4 + 2] = Math.round(255 * Math.min(1, soft[i * 3 + 2]));
    data[i * 4 + 3] = 255;
    const o = (PW + i) * 4;
    data[o] = Math.round((255 * Math.min(top, ySpan)) / ySpan);
    data[o + 1] = Math.round((255 * Math.min(rf, ySpan)) / ySpan);
    data[o + 2] = 0;
    data[o + 3] = 255;
  }
  const tex = new DataTexture(data, PW, 2, RGBAFormat, UnsignedByteType);
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;

  const hiRange = new Vector4(0, 0, 0, 0);
  const plane = new PlaneGeometry(26000, 16000, 1, 1);
  plane.rotateX(-Math.PI / 2);
  const mesh = new Mesh(
    plane,
    new ShaderMaterial({
      vertexShader: waterVert,
      fragmentShader: waterFrag,
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uSkyFade: shared.uSkyFade,
        uWake: shared.uWake,
        uProfile: { value: tex },
        uProfRange: { value: new Vector4(x0, xSpan, ySpan, zp) },
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
  return { mesh, hiRange };
}

