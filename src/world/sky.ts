// sky.ts: the gradient dome and the stars. Both live in a group that follows the camera, so the
// sky stays at infinity while the camera moves.

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type IUniform,
} from 'three';
import { PALETTE } from './palette';
import { mulberry32 } from './random';
import skyVert from './shaders/sky.vert.glsl?raw';
import skyFrag from './shaders/sky.frag.glsl?raw';
import starsVert from './shaders/stars.vert.glsl?raw';
import starsFrag from './shaders/stars.frag.glsl?raw';

export interface SkyUniforms {
  uTime: IUniform<number>;
  uMotion: IUniform<number>;
  uSkyFade: IUniform<number>;
  uPixelRatio: IUniform<number>;
}

const DOME_R = 9000;
const STAR_R = 8500;

export function buildSky(shared: SkyUniforms, starCount: number, seed: number, clouds: boolean): Group {
  const group = new Group();
  group.name = 'sky';

  const dome = new Mesh(
    new SphereGeometry(DOME_R, 64, 32),
    new ShaderMaterial({
      vertexShader: skyVert,
      fragmentShader: skyFrag,
      defines: clouds ? { CLOUDS: 1 } : {},
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uSkyFade: shared.uSkyFade,
        uNight: { value: new Vector3(...PALETTE.night) },
        uSky: { value: new Vector3(...PALETTE.sky) },
        uGlow: { value: new Vector3(...PALETTE.glow) },
      },
      side: BackSide,
      depthWrite: false,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // Stars over the part of the sky the camera ever faces (south, east and west, up to about 80
  // degrees), thinning toward the horizon.
  const r = mulberry32(seed ^ 0x5a17);
  const pos = new Float32Array(starCount * 3);
  const size = new Float32Array(starCount);
  const bright = new Float32Array(starCount);
  const phase = new Float32Array(starCount);
  const color = new Float32Array(starCount * 3);
  const cool = PALETTE.cool;
  const warm = [1.0, 0.89, 0.74];
  let n = 0;
  let guard = 0;
  // A faint band of extra small stars across the sky, tilted, like a washed-out Milky Way.
  const bandN = new Vector3(0.55, 0.42, 0.72).normalize();
  while (n < starCount && guard++ < starCount * 40) {
    const az = (r() * 2 - 1) * 1.5; // about +-85 degrees from south
    const sinE = r() * 0.985; // uniform in solid angle
    const e = Math.asin(sinE);
    // keep fewer near the horizon: the haze
    const keep = Math.pow(Math.min(1, e / 0.42), 0.9);
    if (r() > keep) continue;
    const ce = Math.cos(e);
    const x = Math.sin(az) * ce;
    const z = -Math.cos(az) * ce;
    const inBand = Math.exp(-Math.pow((x * bandN.x + sinE * bandN.y + z * bandN.z) / 0.16, 2));
    if (r() > 0.55 + 0.45 * inBand) continue;
    pos[n * 3] = x * STAR_R;
    pos[n * 3 + 1] = sinE * STAR_R;
    pos[n * 3 + 2] = z * STAR_R;
    const k = r();
    if (k < 0.03) {
      // a few bright ones
      size[n] = 4.0 + r() * 2.6;
      bright[n] = 1.0 + r() * 0.6;
    } else if (k < 0.2) {
      size[n] = 2.4 + r() * 1.2;
      bright[n] = 0.5 + r() * 0.4;
    } else {
      size[n] = 1.5 + 1.2 * Math.pow(r(), 2.0);
      bright[n] = 0.26 + 0.5 * Math.pow(r(), 1.8);
    }
    phase[n] = r();
    const c = r();
    const col = c < 0.12 ? warm : c < 0.35 ? [1, 1, 1] : cool;
    color.set(col, n * 3);
    n++;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos.subarray(0, n * 3), 3));
  g.setAttribute('aSize', new BufferAttribute(size.subarray(0, n), 1));
  g.setAttribute('aBright', new BufferAttribute(bright.subarray(0, n), 1));
  g.setAttribute('aPhase', new BufferAttribute(phase.subarray(0, n), 1));
  g.setAttribute('aColor', new BufferAttribute(color.subarray(0, n * 3), 3));
  const stars = new Points(
    g,
    new ShaderMaterial({
      vertexShader: starsVert,
      fragmentShader: starsFrag,
      uniforms: {
        uTime: shared.uTime,
        uMotion: shared.uMotion,
        uSkyFade: shared.uSkyFade,
        uPixelRatio: shared.uPixelRatio,
        // The celestial pole: north (behind the camera), 22 degrees up, Hong Kong's latitude.
        uAxis: { value: new Vector3(0, Math.sin(0.384), Math.cos(0.384)) },
      },
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  group.add(stars);
  return group;
}
