// peak.ts: the dark ridge of the Peak behind the towers, and every small light in the scene
// (homes and roads on the slopes, the promenade, aviation lights, the ferry) in one Points draw.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  Mesh,
  Points,
  ShaderMaterial,
  Vector3,
  type IUniform,
} from 'three';
import { PEAK_HALF, ridgeHeight, ridgeZ, type CityLayout } from './city';
import { PALETTE } from './palette';
import { mulberry32 } from './random';
import { aviationPoints, cityFog } from './skyline';
import peakVert from './shaders/peak.vert.glsl?raw';
import peakFrag from './shaders/peak.frag.glsl?raw';
import lightsVert from './shaders/lights.vert.glsl?raw';
import lightsFrag from './shaders/lights.frag.glsl?raw';

export interface PeakUniforms {
  uTime: IUniform<number>;
  uMotion: IUniform<number>;
  uSkyFade: IUniform<number>;
  uPixelRatio: IUniform<number>;
  uWake: IUniform<number>;
}


export function buildPeak(city: CityLayout, shared: PeakUniforms): Mesh {
  const N = 1400;
  const pos = new Float32Array((N + 1) * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i <= N; i++) {
    const x = city.centralX - PEAK_HALF + (2 * PEAK_HALF * i) / N;
    const z = ridgeZ(x, city);
    const y = ridgeHeight(x, city);
    pos.set([x, y, z, x, -30, z], i * 6);
    if (i < N) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setIndex(idx);
  const mesh = new Mesh(
    g,
    new ShaderMaterial({
      vertexShader: peakVert,
      fragmentShader: peakFrag,
      uniforms: {
        uSkyFade: shared.uSkyFade,
        uPeak: { value: new Vector3(...PALETTE.peak) },
        uGlow: { value: new Vector3(...PALETTE.glow) },
        uFog: { value: cityFog(city) },
      },
    }),
  );
  mesh.frustumCulled = false;
  mesh.name = 'peak';
  return mesh;
}

export interface LightsInfo {
  points: Points;
  aviation: { x: number; y: number; z: number }[];
}

export function buildLights(city: CityLayout, shared: PeakUniforms, density: number): LightsInfo {
  const r = mulberry32(city.seed ^ 0x9eac);
  const P: number[] = [];
  const C: number[] = [];
  const I: number[] = [];
  const across = (x: number) => Math.min(1, Math.max(0, (x - city.xMin) / city.width)) * 0.86 + 0.06;
  const warm = PALETTE.window;
  const cool = PALETTE.cool;
  const add = (x: number, y: number, z: number, col: number[], k: number, size: number, mode: number, phase: number, wake: number) => {
    P.push(x, y, z);
    C.push(col[0] * k, col[1] * k, col[2] * k);
    I.push(size, mode, phase, wake);
  };

  // Homes on the slopes: denser low down (the Mid-Levels), thinning toward the ridge.
  const span = city.width + 3000;
  const homes = Math.round(780 * density);
  for (let i = 0; i < homes; i++) {
    const x = city.xMin - 1500 + r() * span;
    const top = ridgeHeight(x, city);
    const y = 18 + Math.pow(r(), 1.9) * (top - 40);
    if (y > top - 12) continue;
    const z = ridgeZ(x, city) + 8;
    const col = r() < 0.82 ? warm : cool;
    add(x, y, z, col, 0.3 + 0.45 * r(), 1.3 + r() * 0.9, 0, 0, across(x));
  }
  // Roads: a few chains of lights winding along the slopes.
  const roads = Math.max(2, Math.round(5 * density));
  for (let k = 0; k < roads; k++) {
    const share = 0.25 + 0.55 * (k / roads) + r() * 0.06;
    const x0 = city.xMin - 800 + r() * span * 0.4;
    const len = span * (0.25 + r() * 0.35);
    const freq = 1 / (220 + r() * 260);
    const amp = 18 + r() * 34;
    for (let x = x0; x < x0 + len; x += 22 + r() * 18) {
      if (r() < 0.12) continue;
      const top = ridgeHeight(x, city);
      const y = top * share + amp * Math.sin(x * freq + k * 1.7);
      if (y > top - 14 || y < 10) continue;
      const z = ridgeZ(x, city) + 8;
      add(x, y, z, warm, 0.45 + 0.3 * r(), 1.4 + r() * 0.5, 0, 0, across(x));
    }
  }
  // The promenade along the shore: a dotted line of lamps.
  for (let x = city.xMin - 200; x < city.xMax + 200; x += 14 + r() * 10) {
    if (r() < 0.25) continue;
    const col = r() < 0.7 ? warm : cool;
    add(x, 3 + r() * 2, 6 + r() * 4, col, 0.35 + 0.35 * r(), 1.4 + r() * 0.8, 0, 0, across(x));
  }
  // Aviation lights on the 20 tallest towers.
  const aviation = aviationPoints(city, 20);
  for (const a of aviation) add(a.x, a.y, a.z, PALETTE.neon, 1.25, 6.5, 1, r(), 0.7);
  // The ferry: a row of warm cabin lights, a green starboard light, a white masthead light.
  const fz = 700 + r() * 300;
  for (let k = 0; k < 6; k++) add(-12 + k * 4.5, 4.5, fz, warm, 0.75, 2.0, 2, 0, 0);
  add(-15, 5.5, fz + 2, [0.25, 1.0, 0.55], 0.9, 2.6, 2, 0, 0);
  add(4, 13, fz, [1, 1, 1], 0.8, 2.0, 2, 0, 0);

  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(P), 3));
  g.setAttribute('aColor', new BufferAttribute(new Float32Array(C), 3));
  g.setAttribute('aInfo', new BufferAttribute(new Float32Array(I), 4));
  const points = new Points(
    g,
    new ShaderMaterial({
      vertexShader: lightsVert,
      fragmentShader: lightsFrag,
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uPixelRatio: shared.uPixelRatio,
        uWake: shared.uWake,
        uFerry: { value: new Vector3(city.xMin - 600, city.width + 1200, 90) },
        uGlow: { value: new Vector3(...PALETTE.glow) },
        uFog: { value: cityFog(city) },
      },
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  points.frustumCulled = false;
  points.name = 'lights';
  return { points, aviation };
}
