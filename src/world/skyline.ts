// skyline.ts: the towers as one instanced draw (one instance per segment), with the window
// rule in the fragment shader. Layout lives in city.ts, the rule in windows.ts.

import {
  BoxGeometry,
  InstancedBufferAttribute,
  InstancedBufferGeometry,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
} from 'three';
import type { CityLayout } from './city';
import { PALETTE } from './palette';
import { WINDOW_GLSL } from './windows';
import { PULSE_GLSL, PULSES, SPOTS, type PulseUniforms } from './pulse';
import towerVert from './shaders/tower.vert.glsl?raw';
import towerFrag from './shaders/tower.frag.glsl?raw';

export interface SkylineUniforms extends PulseUniforms {
  uTime: IUniform<number>;
  uMotion: IUniform<number>;
  uWake: IUniform<number>;
  uLift: IUniform<Vector2>;
  uHi: IUniform<Vector3>;
}

/** Fog settings shared by everything in the city (per meter behind shore, per meter far, start). */
export function cityFog(city: CityLayout): Vector3 {
  return new Vector3(1 / 640, 1 / 9000, city.width * 0.55);
}

export function buildSkyline(city: CityLayout, shared: SkylineUniforms, taps: 2 | 4): Mesh {
  const box = new BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  box.deleteAttribute('uv');

  const geo = new InstancedBufferGeometry();
  geo.index = box.index;
  geo.setAttribute('position', box.getAttribute('position'));
  geo.setAttribute('normal', box.getAttribute('normal'));

  let n = 0;
  for (const t of city.towers) n += t.segs.length;
  const aPos = new Float32Array(n * 3);
  const aSize = new Float32Array(n * 3);
  const aTower = new Float32Array(n * 4);
  const aGrid = new Float32Array(n * 4);
  const aSeg = new Float32Array(n * 4);
  let i = 0;
  for (const t of city.towers) {
    for (const s of t.segs) {
      aPos.set([s.x, s.y0, s.z], i * 3);
      aSize.set([s.w, s.h, s.d], i * 3);
      aTower.set([t.seed, s.L, t.glazing, t.group], i * 4);
      aGrid.set([s.colsF, s.colsS, t.floorH, s.floorOffset], i * 4);
      aSeg.set([s.kind, s.winFloors, s.seg, t.facade], i * 4);
      i++;
    }
  }
  geo.setAttribute('aPos', new InstancedBufferAttribute(aPos, 3));
  geo.setAttribute('aSize', new InstancedBufferAttribute(aSize, 3));
  geo.setAttribute('aTower', new InstancedBufferAttribute(aTower, 4));
  geo.setAttribute('aGrid', new InstancedBufferAttribute(aGrid, 4));
  geo.setAttribute('aSeg', new InstancedBufferAttribute(aSeg, 4));
  geo.instanceCount = n;
  box.dispose();

  const mat = new ShaderMaterial({
    vertexShader: towerVert,
    fragmentShader: towerFrag.replace('//#NS_WINDOWS', WINDOW_GLSL).replace('//#NS_PULSE', PULSE_GLSL),
    defines: { TAPS: taps, SPOTS, PULSES },
    uniforms: {
      ...shared,
      uCityX: { value: new Vector2(city.xMin, city.width) },
      uFog: { value: cityFog(city) },
      uGlow: { value: new Vector3(...PALETTE.glow) },
      uWarm: { value: new Vector3(...PALETTE.window) },
      uCool: { value: new Vector3(...PALETTE.cool) },
      uFacade: { value: new Vector3(...PALETTE.facade) },
    },
  });
  const mesh = new Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.name = 'skyline';
  return mesh;
}

/** The 20 tallest tips, for the red aviation lights. */
export function aviationPoints(city: CityLayout, count = 20): { x: number; y: number; z: number }[] {
  return [...city.towers]
    .sort((a, b) => b.tip - a.tip)
    .slice(0, count)
    .map((t) => ({ x: t.segs[t.segs.length - 1].x, y: t.tip + 1.5, z: t.z }));
}
