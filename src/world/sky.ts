// sky.ts: the gradient dome and the stars. Both live in a group that follows the camera, so the
// sky stays at infinity while the camera moves.

import {
  AdditiveBlending,
  BackSide,
  BufferAttribute,
  BufferGeometry,
  Group,
  Mesh,
  type PerspectiveCamera,
  Points,
  ShaderMaterial,
  SphereGeometry,
  Vector3,
  type IUniform,
} from 'three';
import { PALETTE } from './palette';
import { mulberry32 } from './random';
import { PULSES, type PulseUniforms } from './pulse';
import { BEAMS, KEEP_OUT, type BeamUniforms, type ShowUniforms } from './lightshow';
import skyVert from './shaders/sky.vert.glsl?raw';
import skyFrag from './shaders/sky.frag.glsl?raw';
import starsVert from './shaders/stars.vert.glsl?raw';
import starsFrag from './shaders/stars.frag.glsl?raw';

export interface SkyUniforms extends PulseUniforms, ShowUniforms, BeamUniforms {
  uTime: IUniform<number>;
  uMotion: IUniform<number>;
  uSkyFade: IUniform<number>;
  uPixelRatio: IUniform<number>;
}

const DOME_R = 9000;
const STAR_R = 8500;
const DEG = Math.PI / 180;
/** Share of stars that flash now and then (NIGHT-SIGNAL.md 4.2: about 6%). */
const FLASH_SHARE = 0.06;
/** The drift: radians per second about the celestial pole. */
export const STAR_DRIFT = 0.0012;
/** The celestial pole: north (behind the camera), 22 degrees up, Hong Kong's latitude. */
export const STAR_AXIS = new Vector3(0, Math.sin(0.384), Math.cos(0.384));
const AXIS = STAR_AXIS;

export interface SkyOptions {
  stars: number;
  seed: number;
  clouds: boolean;
  /** Seconds between one star's flashes, [min, max]. Fewer stars in view need shorter gaps. */
  flashEvery: [number, number];
  /** Optional azimuth band [from, to, share] (radians, share 0..1) that gets extra stars. */
  core?: [number, number, number];
}

export interface Sky {
  group: Group;
  stars: Points;
  /** How many stars were placed. */
  count: number;
  /** Indices of the handful of much brighter stars. */
  brightest: number[];
}

export function buildSky(shared: SkyUniforms, opts: SkyOptions): Sky {
  const { stars: starCount, seed, clouds, flashEvery } = opts;
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
        uShow: shared.uShow,
        uPulseRes: shared.uPulseRes,
        uWarm: { value: new Vector3(...PALETTE.window) },
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

  // Stars over the part of the sky the camera ever faces (from about 96 degrees left of south,
  // where the och stop looks, to about 62 degrees right, up to about 67 degrees), thinning toward
  // the horizon. Phones see a narrow slice, so most of their stars go where the phone camera
  // looks (core), the rest spread wide for a phone held sideways.
  const r = mulberry32(seed ^ 0x5a17);
  const pos = new Float32Array(starCount * 3);
  const star = new Float32Array(starCount * 4);
  const flash = new Float32Array(starCount * 2);
  const color = new Float32Array(starCount * 3);
  const cool = PALETTE.cool;
  const warm = [1.0, 0.89, 0.74];
  const brightest: number[] = [];
  const AZ0 = -96 * DEG;
  const AZ1 = 62 * DEG;
  const core = opts.core ?? [0, 0, 0];
  let n = 0;
  let guard = 0;
  // A faint band of extra small stars across the sky, tilted, like a washed-out Milky Way.
  const bandN = new Vector3(0.55, 0.42, 0.72).normalize();
  while (n < starCount && guard++ < starCount * 40) {
    const az = r() < core[2] ? core[0] + (core[1] - core[0]) * r() : AZ0 + (AZ1 - AZ0) * r();
    const sinE = r() * 0.92; // uniform in solid angle
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
    // Size (px) and peak brightness: most stars small and faint, a few bright, and a handful
    // much brighter than the rest.
    let size: number;
    let bright: number;
    const k = r();
    if (k < 0.006) {
      size = 5.6 + r() * 2.0;
      bright = 1.5 + r() * 0.6;
      brightest.push(n);
    } else if (k < 0.036) {
      size = 3.4 + r() * 1.4;
      bright = 0.85 + r() * 0.45;
    } else if (k < 0.2) {
      size = 2.2 + r() * 1.0;
      bright = 0.45 + r() * 0.35;
    } else {
      size = 1.2 + 0.9 * Math.pow(r(), 2.0);
      bright = 0.26 + 0.42 * Math.pow(r(), 1.8);
    }
    // Twinkle: one cycle every 1.5 to 4 s, at its own phase.
    star.set([size, bright, 1 / (1.5 + 2.5 * r()), r()], n * 4);
    // About 6% flash now and then, each on its own schedule.
    if (r() < FLASH_SHARE) flash.set([flashEvery[0] + (flashEvery[1] - flashEvery[0]) * r(), r() * 64], n * 2);
    const c = r();
    const col = c < 0.12 ? warm : c < 0.35 ? [1, 1, 1] : cool;
    color.set(col, n * 3);
    n++;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos.subarray(0, n * 3), 3));
  g.setAttribute('aStar', new BufferAttribute(star.subarray(0, n * 4), 4));
  g.setAttribute('aFlash', new BufferAttribute(flash.subarray(0, n * 2), 2));
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
        uAxis: { value: AXIS.clone() },
        uDrift: { value: STAR_DRIFT },
        uPulse: shared.uPulse,
        uPulseTap: shared.uPulseTap,
        uPulseOn: shared.uPulseOn,
        uBeamBase: shared.uBeamBase,
        uBeamDir: shared.uBeamDir,
        uBeamK: shared.uBeamK,
        uKeep: shared.uKeep,
        uKeepN: shared.uKeepN,
        uKeepW: shared.uKeepW,
      },
      defines: { PULSES, BEAMS, KEEP_OUT },
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    }),
  );
  stars.renderOrder = -9;
  stars.frustumCulled = false;
  group.add(stars);
  return { group, stars, count: n, brightest };
}

const tmp = new Vector3();
/** How many stars sit inside the camera's view right now (above the haze), for the lab page. */
export function starsInView(sky: Sky, camera: PerspectiveCamera): number {
  const pos = sky.stars.geometry.getAttribute('position');
  let k = 0;
  for (let i = 0; i < sky.count; i++) {
    tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i));
    if (tmp.y / STAR_R < 0.05) continue;
    tmp.add(camera.position).project(camera);
    if (tmp.z < 1 && Math.abs(tmp.x) <= 1 && Math.abs(tmp.y) <= 1) k++;
  }
  return k;
}
