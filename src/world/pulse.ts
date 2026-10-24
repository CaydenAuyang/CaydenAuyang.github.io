// pulse.ts: the signal pulse and the pointer spotlight (NIGHT-SIGNAL.md 11b.1).
//
//   - Spotlight: windows near the pointer's point on the skyline brighten (up to 60%) and warm,
//     and fade over 800 ms after it moves on. The pointer's point is its screen position held
//     inside the skyline band below it: over the sky it drops to the tower tops under it, over
//     the water it rises to the waterline. A short trail of recent points (with their ages) goes
//     to the tower shader as screen positions, so the fade follows the pointer's path.
//   - Pulse: from the point under a tap, a thin ring spreads across the harbour and the windows
//     switch on in a wave by distance, then settle back. A tap on a tower starts the wave at the
//     tower; a tap on the sky starts it at the waterfront under that screen x; a tap on the water
//     starts it where the tap meets the water. Stars near the tap glint. At most 3 at once, 400 ms
//     apart. Everything is scaled to how wide the screen is at the pulse's distance, so the wave
//     crosses the screen at the same pace on a phone and a laptop.
//   - Motion off: no trail, ring or travelling wave. The spotlight switches on and off, and a pulse
//     lights the windows within its radius at once and switches them off 1.5 s later.
//
// The shaders share PULSE_GLSL (the wave at a world position) and read the uniforms below; this
// file keeps their values each frame.

import { Matrix4, PerspectiveCamera, Vector2, Vector3, Vector4, type IUniform } from 'three';
import type { Ndc } from './contract';
import type { CityLayout } from './city';

/** Spotlight trail length (the tower shader loops over this many points). */
export const SPOTS = 12;
/** Pulses at once. */
export const PULSES = 3;
const COOLDOWN_MS = 400;
/** Seconds a pulse lasts with motion (ring, wave and settle), and without (the switch-back). */
const LIFE = 3.0;
const LIFE_STILL = 1.5;
/** Spotlight fade after the pointer moves on (s), its radius (share of the viewport width). */
const SPOT_FADE = 0.8;
const SPOT_RADIUS = 0.1;
/** z of the waterfront, where sky taps land (the water starts at z = 0). */
const SHORE_Z = 4;

export interface PulseUniforms {
  /** Spotlight trail: device px from the bottom left, and strength 0..1. */
  uSpot: IUniform<Vector3[]>;
  /** Spotlight radius in device px. */
  uSpotR: IUniform<number>;
  /** 1 while any trail point is lit, so shaders can skip the loop. */
  uSpotOn: IUniform<number>;
  /** Per pulse: the wave's origin (world) and its age in seconds (-1: none; 0 while held with motion off). */
  uPulse: IUniform<Vector4[]>;
  /** Per pulse: the ring's center on screen (device px from the bottom left), the screen's width in meters at the pulse, and the ring's squash (height over width). */
  uPulseB: IUniform<Vector4[]>;
  /** Drawing buffer size in device px. */
  uPulseRes: IUniform<Vector2>;
  /** Per pulse: the tap in NDC (x, y), for the stars. */
  uPulseTap: IUniform<Vector4[]>;
  /** How many pulses are running, so shaders can skip the loop. */
  uPulseOn: IUniform<number>;
}

export function pulseUniforms(): PulseUniforms {
  return {
    uSpot: { value: Array.from({ length: SPOTS }, () => new Vector3()) },
    uSpotR: { value: 100 },
    uSpotOn: { value: 0 },
    uPulse: { value: Array.from({ length: PULSES }, () => new Vector4(0, 0, 0, -1)) },
    uPulseB: { value: Array.from({ length: PULSES }, () => new Vector4(0, 0, 1000, 0.2)) },
    uPulseRes: { value: new Vector2(1, 1) },
    uPulseTap: { value: Array.from({ length: PULSES }, () => new Vector4()) },
    uPulseOn: { value: 0 },
  };
}

/**
 * How strongly the running pulses light a window at world position p (0..1). With motion, a front
 * starts 3.5% of a screen wide (so the windows at the tap light on the first frame), runs out at
 * 0.4 of a screen per second and gets weaker with distance; windows it has passed settle back over
 * about a second. Needs uMotion, uPulse and uPulseB declared before it.
 */
export const PULSE_GLSL = /* glsl */ `
float nsPulseWave(vec3 p) {
  float w = 0.0;
  for (int i = 0; i < ${PULSES}; i++) {
    vec4 P = uPulse[i];
    if (P.w < 0.0) continue;
    float S = uPulseB[i].z;
    float d = distance(p, P.xyz);
    if (uMotion > 0.5) {
      float r = S * (0.035 + 0.4 * P.w);
      float passed = (r - d) / (0.4 * S);
      float on = smoothstep(-0.04, 0.0, passed);
      float settle = exp(-max(passed, 0.0) / 1.1);
      float front = exp(-pow((d - r) / (0.03 * S), 2.0));
      float reach = exp(-d / (0.75 * S));
      float end = 1.0 - smoothstep(${(LIFE - 0.6).toFixed(1)}, ${LIFE.toFixed(1)}, P.w);
      w = max(w, (0.65 * on * settle + 0.4 * front) * reach * end);
    } else {
      w = max(w, 1.0 - smoothstep(0.1 * S, 0.12 * S, d));
    }
  }
  return min(w, 1.0);
}
`;

interface Running {
  start: number;
  wave: Vector3;
  ring: [number, number];
  scale: number;
  /** The ring's height over its width on screen, so it reaches the bottom about when it reaches the sides. */
  squash: number;
  tap: Ndc;
}

export interface Interactions {
  setPointer(ndc: Ndc | null): void;
  pulse(ndc: Ndc): boolean;
  /** Write this frame's uniforms. now: ms (performance.now clock). */
  update(now: number): void;
}

export interface InteractionOptions {
  city: CityLayout;
  camera: PerspectiveCamera;
  uniforms: PulseUniforms;
  /** Drawing buffer size in device px. */
  buffer: () => { w: number; h: number };
  motion: () => boolean;
  /** Ask for a frame (the world draws on demand while motion is off). */
  requestRender: () => void;
}

export function createInteractions(o: InteractionOptions): Interactions {
  const { city, camera, uniforms: U } = o;

  // Every segment as a box: x0, x1, y0, y1, z0, z1.
  const boxes: number[] = [];
  for (const t of city.towers) for (const s of t.segs) boxes.push(s.x - s.w / 2, s.x + s.w / 2, s.y0, s.y0 + s.h, s.z - s.d / 2, s.z + s.d / 2);
  const B = new Float32Array(boxes);
  const nBoxes = B.length / 6;

  const v = new Vector3();
  const dir = new Vector3();
  const vp = new Matrix4();
  let e = vp.elements;
  const sync = () => {
    camera.updateMatrixWorld();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    e = vp.elements;
  };
  /** NDC of a world point; z > 1 when it is behind the camera. */
  const project = (x: number, y: number, z: number) => {
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 1e-6) return v.set(0, 0, 2);
    return v.set((e[0] * x + e[4] * y + e[8] * z + e[12]) / w, (e[1] * x + e[5] * y + e[9] * z + e[13]) / w, 0);
  };

  /** The ray through ndc, as a unit direction from the camera. */
  const ray = (ndc: Ndc, out: Vector3) => out.set(ndc.x, ndc.y, 0.5).unproject(camera).sub(camera.position).normalize();

  /** World x on the waterfront (y 0, z SHORE_Z) that sits at screen x ndcX, or null. */
  const waterfrontX = (ndcX: number): number | null => {
    const a = ray({ x: ndcX, y: -1 }, new Vector3());
    const b = ray({ x: ndcX, y: 1 }, new Vector3());
    const n = a.cross(b);
    if (Math.abs(n.x) < 1e-6) return null;
    const C = camera.position;
    return C.x + (n.y * C.y - n.z * (SHORE_Z - C.z)) / n.x;
  };

  /** Screen y (NDC) of the tower tops under screen x ndcX, and of the waterline there. */
  const band = (ndcX: number): { top: number; shore: number } | null => {
    const wx = waterfrontX(ndcX);
    if (wx === null) return null;
    const p = project(wx, 0, SHORE_Z);
    if (p.z > 1) return null;
    const shore = p.y;
    let top = shore;
    for (let i = 0; i < nBoxes; i++) {
      const k = i * 6;
      let x0 = Infinity;
      let x1 = -Infinity;
      let y = -Infinity;
      let behind = false;
      for (let c = 0; c < 4; c++) {
        const q = project(B[k + (c & 1)], B[k + 3], B[k + 4 + (c >> 1)]);
        if (q.z > 1) behind = true;
        x0 = Math.min(x0, q.x);
        x1 = Math.max(x1, q.x);
        y = Math.max(y, q.y);
      }
      if (!behind && ndcX >= x0 && ndcX <= x1 && y > top) top = y;
    }
    return { top, shore };
  };

  // ---- Spotlight ----
  let pointer: Ndc | null = null;
  let head: { x: number; y: number } | null = null; // device px, from the bottom left
  let headFor = { x: NaN, y: NaN, w: 0, h: 0, m: new Float32Array(16) };
  const trail: { x: number; y: number; t: number }[] = []; // newest first
  let lastPush = 0;

  const placeHead = () => {
    if (!pointer) return null;
    // Recompute only when the pointer or the camera moved.
    const m = camera.matrixWorld.elements;
    const { w, h } = o.buffer();
    let same = headFor.x === pointer.x && headFor.y === pointer.y && headFor.w === w && headFor.h === h;
    for (let i = 0; i < 16 && same; i++) same = headFor.m[i] === m[i];
    if (same && head) return head;
    headFor = { x: pointer.x, y: pointer.y, w, h, m: Float32Array.from(m) };
    const bd = band(pointer.x);
    let y = pointer.y;
    if (bd) {
      // Over the sky, the light sits just inside the tower tops; over the water, on the waterline.
      const inset = (0.25 * SPOT_RADIUS * w * 2) / h;
      y = Math.min(Math.max(y, bd.shore), Math.max(bd.top - inset, bd.shore));
    } else {
      y = -3; // no skyline in this column: out of sight
    }
    head = { x: ((pointer.x + 1) / 2) * w, y: ((y + 1) / 2) * h };
    return head;
  };

  // ---- Pulses ----
  const running: (Running | null)[] = Array.from({ length: PULSES }, () => null);
  let lastPulse = -Infinity;

  const scaleAt = (p: Vector3) => {
    const dist = p.distanceTo(camera.position);
    const halfH = Math.atan(Math.tan((camera.fov * Math.PI) / 360) * camera.aspect);
    return Math.max(50, 2 * dist * Math.tan(halfH));
  };

  /** Nearest tower hit along the ray, as a distance, or Infinity. */
  const hitCity = (d: Vector3) => {
    const C = camera.position;
    let best = Infinity;
    for (let i = 0; i < nBoxes; i++) {
      const k = i * 6;
      let t0 = 0;
      let t1 = best;
      let ok = true;
      for (let a = 0; a < 3 && ok; a++) {
        const o0 = a === 0 ? C.x : a === 1 ? C.y : C.z;
        const dd = a === 0 ? d.x : a === 1 ? d.y : d.z;
        const lo = B[k + a * 2];
        const hi = B[k + a * 2 + 1];
        if (Math.abs(dd) < 1e-9) {
          if (o0 < lo || o0 > hi) ok = false;
          continue;
        }
        let ta = (lo - o0) / dd;
        let tb = (hi - o0) / dd;
        if (ta > tb) [ta, tb] = [tb, ta];
        t0 = Math.max(t0, ta);
        t1 = Math.min(t1, tb);
        if (t0 > t1) ok = false;
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  };

  const activeCount = (now: number) => {
    const life = (o.motion() ? LIFE : LIFE_STILL) * 1000;
    let n = 0;
    for (let i = 0; i < PULSES; i++) {
      const r = running[i];
      if (r && now - r.start < life) n++;
      else running[i] = null;
    }
    return n;
  };

  return {
    setPointer(ndc) {
      const now = performance.now();
      if (!ndc) {
        if (head && o.motion()) trail.unshift({ x: head.x, y: head.y, t: now });
        pointer = null;
        head = null;
      } else {
        pointer = { x: ndc.x, y: ndc.y };
      }
      if (!o.motion()) o.requestRender();
    },

    pulse(ndc) {
      const now = performance.now();
      if (now - lastPulse < COOLDOWN_MS) return false;
      if (activeCount(now) >= PULSES) return false;
      sync();
      const C = camera.position;
      ray(ndc, dir);
      const tCity = hitCity(dir);
      const tWater = dir.y < 0 ? -C.y / dir.y : Infinity;
      const onWater = tWater < tCity && C.z + dir.z * tWater >= 0;
      let wave: Vector3;
      let ring: [number, number];
      if (onWater) {
        wave = new Vector3().copy(dir).multiplyScalar(tWater).add(C);
        wave.y = 0;
        ring = [wave.x, wave.z];
      } else {
        const wx = waterfrontX(ndc.x) ?? C.x;
        ring = [wx, SHORE_Z];
        wave = Number.isFinite(tCity) ? new Vector3().copy(dir).multiplyScalar(tCity).add(C) : new Vector3(wx, 0, SHORE_Z);
      }
      const slot = running.findIndex((r) => r === null);
      if (slot < 0) return false;
      const scale = scaleAt(wave);
      // The ring reaches the bottom of the screen about when it reaches the sides.
      const rp = project(ring[0], 0, ring[1]);
      const below = rp.z > 1 ? 0.3 : (rp.y + 1) / 2; // share of the screen height under the center
      const squash = Math.min(0.35, Math.max(0.1, ((below / camera.aspect) / 0.5) * 1.1));
      running[slot] = { start: now, wave, ring, scale, squash, tap: { x: ndc.x, y: ndc.y } };
      lastPulse = now;
      if (!o.motion()) {
        // Frozen world: draw the lit windows now, and again when they switch back.
        o.requestRender();
        window.setTimeout(() => o.requestRender(), LIFE_STILL * 1000 + 20);
      }
      return true;
    },

    update(now) {
      sync();
      const motion = o.motion();
      const { w } = o.buffer();
      U.uSpotR.value = SPOT_RADIUS * w;
      U.uPulseRes.value.set(w, o.buffer().h);

      // Spotlight: the head at full strength, the trail fading behind it.
      const h = placeHead();
      if (h && motion) {
        const last = trail[0];
        const moved = last ? Math.hypot(h.x - last.x, h.y - last.y) : Infinity;
        // Keep a point every third of a radius along the path, or every 100 ms.
        if (moved > U.uSpotR.value * 0.33 || (moved > 1 && now - lastPush > 100)) {
          trail.unshift({ x: h.x, y: h.y, t: now });
          lastPush = now;
        } else if (last) {
          // Still: the newest trail point stays under the head.
          last.t = now;
        }
      }
      while (trail.length > SPOTS - 1) trail.pop();
      const spots = U.uSpot.value;
      let any = 0;
      spots[0].set(h ? h.x : 0, h ? h.y : 0, h ? 1 : 0);
      if (h) any = 1;
      for (let i = 1; i < SPOTS; i++) {
        const p = motion ? trail[i - 1] : undefined;
        if (!p) {
          spots[i].set(0, 0, 0);
          continue;
        }
        const age = (now - p.t) / 1000;
        const s = 1 - smooth(age / SPOT_FADE);
        // Points near the end of the buffer fade by rank too, so dropping one never pops.
        const rank = 1 - (i - 1) / (SPOTS - 1);
        spots[i].set(p.x, p.y, Math.max(0, Math.min(s, rank)));
        if (spots[i].z > 0) any = 1;
      }
      // Drop trail points that have faded out.
      while (trail.length && (now - trail[trail.length - 1].t) / 1000 > SPOT_FADE) trail.pop();
      U.uSpotOn.value = any;

      // Pulses.
      const n = activeCount(now);
      for (let i = 0; i < PULSES; i++) {
        const r = running[i];
        const P = U.uPulse.value[i];
        if (!r) {
          P.w = -1;
          continue;
        }
        P.set(r.wave.x, r.wave.y, r.wave.z, motion ? Math.max(0, (now - r.start) / 1000) : 0);
        // the ring's center on screen, this frame
        const c = project(r.ring[0], 0, r.ring[1]);
        const bh = o.buffer().h;
        if (c.z > 1) U.uPulseB.value[i].set(-1e5, -1e5, r.scale, r.squash);
        else U.uPulseB.value[i].set(((c.x + 1) / 2) * w, ((c.y + 1) / 2) * bh, r.scale, r.squash);
        U.uPulseTap.value[i].set(r.tap.x, r.tap.y, 0, 0);
      }
      U.uPulseOn.value = n;
    },
  };
}

function smooth(x: number) {
  const t = x < 0 ? 0 : x > 1 ? 1 : x;
  return t * t * (3 - 2 * t);
}
