// spill.ts: video light spill (NIGHT-SIGNAL.md 11b.4). While a project video plays, the page sends
// its average color about 4 times a second; the world mixes it into the harbour reflections and
// into the windows nearest the video on screen, at up to 20% of their light times the strength.
// The tint keeps each window's brightness and moves its hue toward the footage (a bright clip
// lifts the windows a little, a dark one dims them a little), so the city answers the video
// without washing out. Each new color is eased in over about 250 ms and a cleared spill eases
// out; with motion off the change is immediate.

import { Vector3, Vector4, type IUniform } from 'three';
import type { Ndc, Rgb } from './contract';

/** Most of a window's light the spill can take over, at strength 1. */
const MAX_MIX = 0.2;
/** Easing time constant (s): about 95% of the way in 250 ms. */
const TAU = 0.085;

export interface SpillUniforms {
  /** The spill color (display values, 0..1) and how much of the light it takes (0..0.2). */
  uSpill: IUniform<Vector4>;
  /** The video's center on screen (device px from the bottom left) and the falloff radius (px). */
  uSpillAt: IUniform<Vector3>;
}

export function spillUniforms(): SpillUniforms {
  return { uSpill: { value: new Vector4(1, 1, 1, 0) }, uSpillAt: { value: new Vector3(0, 0, 1) } };
}

/**
 * The spill applied to some light. weight 0..1 is how near the fragment is (1 at the video's
 * center). Needs uSpill and uSpillAt declared before it.
 */
export const SPILL_GLSL = /* glsl */ `
vec3 nsSpill(vec3 light, float weight) {
  float a = uSpill.w * weight;
  if (a <= 0.0) return light;
  vec3 c = uSpill.rgb;
  float lc = dot(c, vec3(0.299, 0.587, 0.114));
  float ll = dot(light, vec3(0.299, 0.587, 0.114));
  // the footage's hue at this light's brightness, a little brighter or darker with the footage
  vec3 tint = c * (ll / max(lc, 0.04)) * (0.8 + 0.4 * clamp(lc / 0.5, 0.0, 1.0));
  return mix(light, min(tint, vec3(1.6)), a);
}
float nsSpillNear(vec2 frag) {
  float d = length(frag - uSpillAt.xy) / uSpillAt.z;
  return exp(-1.2 * d * d);
}
`;

export interface Spill {
  set(color: Rgb | null, strength: number, center?: Ndc): void;
  /** Ease toward the target and write the uniforms. dt in seconds; buffer size in device px. */
  update(dt: number, w: number, h: number): void;
}

export function createSpill(U: SpillUniforms, motion: () => boolean, requestRender: () => void): Spill {
  const cur = { r: 1, g: 1, b: 1, a: 0, x: 0, y: 0 };
  const target = { r: 1, g: 1, b: 1, a: 0, x: 0, y: 0 };
  let fresh = true; // no color yet: take the first one as it comes (only the amount eases in)
  let size = { w: 1, h: 1 };

  const write = () => {
    U.uSpill.value.set(cur.r, cur.g, cur.b, cur.a);
    U.uSpillAt.value.set(((cur.x + 1) / 2) * size.w, ((cur.y + 1) / 2) * size.h, 0.5 * Math.max(size.w, size.h));
  };

  return {
    set(color, strength, center) {
      const s = Math.min(1, Math.max(0, Number.isFinite(strength) ? strength : 0));
      if (!color) {
        target.a = 0;
      } else {
        [target.r, target.g, target.b] = color.map((v) => Math.min(1, Math.max(0, v))) as Rgb;
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
        const k = 1 - Math.exp(-Math.max(0, dt) / TAU);
        cur.r += (target.r - cur.r) * k;
        cur.g += (target.g - cur.g) * k;
        cur.b += (target.b - cur.b) * k;
        cur.a += (target.a - cur.a) * k;
        cur.x += (target.x - cur.x) * k;
        cur.y += (target.y - cur.y) * k;
        if (cur.a < 1e-4 && target.a === 0) cur.a = 0;
      } else {
        Object.assign(cur, target);
      }
      write();
    },
  };
}
