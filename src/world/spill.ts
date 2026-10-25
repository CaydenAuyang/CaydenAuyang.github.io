// spill.ts: video light spill (NIGHT-SIGNAL.md 11b.4). While a project video plays, the page sends
// its average color about 4 times a second; the world mixes it into the windows nearest the video
// on screen and into the harbour reflections under it, at up to 20% of their light times the
// strength.
//
// The clips' average colors are close to grey, so mixed in as they are they barely show. The world
// keeps the footage's hue and raises its saturation to a usable floor; a clip too grey to have a
// hue stays neutral. The footage's brightness drives the windows too: brighter footage lifts them,
// darker dims them, and a change (a cut, a pan into light) gives an extra lift or dip that settles
// over about two seconds, so the city follows the footage over time. Every window keeps at least
// 80% of its own light, so nothing washes out. Each new sample eases in over about 250 ms and a
// cleared spill eases out; with motion off the change is immediate.

import { Vector4, type IUniform } from 'three';
import type { Ndc, Rgb } from './contract';

/** Most of a window's light the spill can take over, at strength 1. */
const MAX_MIX = 0.2;
/** Easing time constant (s): about 95% of the way in 250 ms. */
const TAU = 0.085;
/** How fast the footage's running brightness follows it (s). */
const AVG_TAU = 2;
/** Saturation floor for clips that have a hue. */
const SAT_FLOOR = 0.8;

export interface SpillUniforms {
  /** The spill color (saturation raised, full value, display 0..1) and how much of the light it takes (0..0.2). */
  uSpill: IUniform<Vector4>;
  /** The video's center on screen (device px from the bottom left), the falloff radius (px), and the brightness drive (about 0.15 to 1.85). */
  uSpillAt: IUniform<Vector4>;
}

export function spillUniforms(): SpillUniforms {
  return { uSpill: { value: new Vector4(1, 1, 1, 0) }, uSpillAt: { value: new Vector4(0, 0, 1, 1) } };
}

/**
 * The spill applied to some light. weight 0..1 is how near the fragment is (1 next to the video).
 * Needs uSpill and uSpillAt declared before it.
 */
export const SPILL_GLSL = /* glsl */ `
vec3 nsSpill(vec3 light, float weight) {
  float a = uSpill.w * weight;
  if (a <= 0.0) return light;
  vec3 c = uSpill.rgb;
  float lc = dot(c, vec3(0.299, 0.587, 0.114));
  float ll = dot(light, vec3(0.299, 0.587, 0.114));
  // the footage's hue at this light's brightness, times the footage's brightness drive
  vec3 tint = c * (ll / max(lc, 0.04)) * uSpillAt.w;
  return mix(light, min(tint, vec3(1.5)), a);
}
float nsSpillNear(vec2 frag) {
  // full strength out to just past the video's edges, then falling off over the rest of the radius
  float d = length(frag - uSpillAt.xy) / uSpillAt.z;
  return 1.0 - smoothstep(0.8, 1.6, d);
}
`;

/** Raise a color's saturation to the floor, keeping its hue; full value. Near-grey stays grey. */
export function boostChroma([r, g, b]: Rgb): Rgb {
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  if (mx <= 1e-4) return [1, 1, 1];
  const s = (mx - mn) / mx;
  // how much hue there is to trust: none below 3% saturation or a chroma of 0.012 (a near-black
  // clip's tint is noise), all of it from 10% and 0.04
  const ramp = (v: number, a: number, b: number) => Math.min(1, Math.max(0, (v - a) / (b - a)));
  const t = ramp(s, 0.03, 0.1) * ramp(mx - mn, 0.012, 0.04);
  const s2 = s + (Math.max(SAT_FLOOR, Math.min(1, s * 2)) - s) * t * t * (3 - 2 * t);
  // rebuild with value 1: each channel keeps its place between min and max
  const k = s > 1e-4 ? s2 / s : 0;
  const ch = (v: number) => 1 - (1 - v / mx) * k;
  return [ch(r), ch(g), ch(b)];
}

export interface Spill {
  set(color: Rgb | null, strength: number, center?: Ndc): void;
  /** Ease toward the target and write the uniforms. dt in seconds; buffer size in device px. */
  update(dt: number, w: number, h: number): void;
}

export function createSpill(U: SpillUniforms, motion: () => boolean, requestRender: () => void): Spill {
  const cur = { r: 1, g: 1, b: 1, a: 0, x: 0, y: 0, k: 1 };
  const target = { r: 1, g: 1, b: 1, a: 0, x: 0, y: 0, k: 1 };
  let fresh = true; // no color yet: take the first one as it comes (only the amount eases in)
  let size = { w: 1, h: 1 };
  let avg = -1; // the footage's running brightness
  let lastSample = 0;

  const write = () => {
    U.uSpill.value.set(cur.r, cur.g, cur.b, cur.a);
    U.uSpillAt.value.set(((cur.x + 1) / 2) * size.w, ((cur.y + 1) / 2) * size.h, 0.5 * Math.max(size.w, size.h), cur.k);
  };

  return {
    set(color, strength, center) {
      const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
      const now = performance.now();
      if (!color) {
        target.a = 0;
        target.k = 1;
        avg = -1;
      } else {
        const c = color.map((v) => Math.min(1, Math.max(0, Number.isFinite(v) ? v : 0))) as Rgb;
        [target.r, target.g, target.b] = boostChroma(c);
        // brightness: the level (brighter footage lifts, darker dims) plus the change against the
        // running brightness (a cut or a pan into light lifts, then settles)
        const lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2];
        if (avg < 0) avg = lum;
        else avg += (lum - avg) * (1 - Math.exp(-Math.max(0, now - lastSample) / 1000 / AVG_TAU));
        lastSample = now;
        const drive = Math.max(-1, Math.min(1, 1.0 * (lum - 0.3) + 6 * (lum - avg)));
        target.k = 1 + 0.85 * drive;
        target.a = MAX_MIX * s;
        if (center) {
          target.x = center.x;
          target.y = center.y;
        }
        if (fresh || cur.a <= 0.001) {
          // starting from nothing: the color and place jump, only the amount eases in
          cur.r = target.r;
          cur.g = target.g;
          cur.b = target.b;
          cur.x = target.x;
          cur.y = target.y;
          cur.k = target.k;
          fresh = false;
        }
      }
      if (!motion()) {
        Object.assign(cur, target);
        write();
        requestRender();
      }
    },
    update(dt, w, h) {
      size = { w, h };
      if (motion()) {
        const e = 1 - Math.exp(-Math.max(0, dt) / TAU);
        cur.r += (target.r - cur.r) * e;
        cur.g += (target.g - cur.g) * e;
        cur.b += (target.b - cur.b) * e;
        cur.a += (target.a - cur.a) * e;
        cur.x += (target.x - cur.x) * e;
        cur.y += (target.y - cur.y) * e;
        cur.k += (target.k - cur.k) * e;
        if (cur.a < 1e-4 && target.a === 0) cur.a = 0;
      } else {
        Object.assign(cur, target);
      }
      write();
    },
  };
}
