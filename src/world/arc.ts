// arc.ts: the arc of light between the two lights (NIGHT-SIGNAL.md 11b.7, "Two cities, one arc").
// Owned by the Signal agent; signal.ts creates it and drives it.
//
// One thin ribbon through the sky from Pomfret's light up and over to Hong Kong's, drawn as one
// mesh (one draw call, and none while it is hidden). Light travels along it as pulses: a short
// bright head with a fading tail, about one every 6 s while the two lights show (taking turns
// from Pomfret to Hong Kong and back), plus one for every sendArc (at most three in flight).
// With motion off nothing travels: the arc is a faint still line, and sendArc lights it up for a
// moment as an instant change.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, GLSL3, Mesh, RawShaderMaterial, Vector3 } from 'three';
import fragmentShader from './shaders/arc.frag.glsl?raw';
import vertexShader from './shaders/arc.vert.glsl?raw';

/** Pulses in flight at once, at most (the shader has this many slots). */
export const ARC_PULSES = 3;
/** Seconds between the regular pulses, and how much that varies. */
const EVERY = 6;
const JITTER = 0.8;
/** Seconds a pulse takes from one light to the other. */
const TRAVEL = 2.6;
/** Seconds between two pulses at least (a send sooner than this after the last one is refused). */
const SPACING = 0.35;
/** Seconds the still line stays lit after sendArc with motion off. */
const FLASH = 1.5;
/** Segments along the ribbon. */
const SEGMENTS = 160;

export interface Arc {
  readonly mesh: Mesh;
  /**
   * Places the arc: from a to b (the two lights' centers, world space), rising toward up by rise
   * (world units at the middle), halfWidth world units across, fading out within fadeR of each end
   * (inside the lights). Rebuilt when the viewport changes shape.
   */
  place(a: Vector3, b: Vector3, up: Vector3, rise: number, halfWidth: number, fadeR: number): void;
  /** How much the two lights show, 0..1 (the arc fades with them, and only sends while they are full). */
  setPresence(p: number): void;
  setMotion(enabled: boolean): void;
  /** Advances the pulses and the regular schedule (motion on only). */
  tick(dt: number): void;
  /** Sends an extra pulse now (motion on) or lights the still line for a moment (motion off). Returns false if refused. */
  send(): boolean;
  dispose(): void;
}

export function createArc(opts: { color: string; motion: boolean; requestRender: () => void }): Arc {
  let motion = opts.motion;
  const geometry = new BufferGeometry();
  const V = (SEGMENTS + 1) * 2;
  const pos = new Float32Array(V * 3);
  const uv = new Float32Array(V * 2);
  for (let k = 0; k <= SEGMENTS; k++) {
    for (let side = 0; side < 2; side++) {
      const v = k * 2 + side;
      uv[v * 2] = k / SEGMENTS;
      uv[v * 2 + 1] = side ? 1 : -1;
    }
  }
  const idx: number[] = [];
  for (let k = 0; k < SEGMENTS; k++) {
    const a = k * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const posAttr = new BufferAttribute(pos, 3);
  geometry.setAttribute('position', posAttr);
  geometry.setAttribute('aUv', new BufferAttribute(uv, 2));
  geometry.setIndex(idx);

  const heads = new Float32Array(ARC_PULSES).fill(-10);
  // Each pulse's direction: 1 from Pomfret to Hong Kong, -1 back. They take turns.
  const dirs = new Float32Array(ARC_PULSES).fill(1);
  let nextDir = 1;
  const uniforms = {
    uHeads: { value: heads },
    uDirs: { value: dirs },
    uBase: { value: motion ? 0.07 : 0.22 },
    uFlash: { value: 0 },
    uPresence: { value: 0 },
    uFadeEnd: { value: 0.05 },
    uColor: { value: new Color(opts.color) },
  };
  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    blending: AdditiveBlending,
  });
  const mesh = new Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 9;
  mesh.visible = false;
  mesh.name = 'arc';

  // Pulses: progress 0..1 each, or < 0 when the slot is free.
  const progress = new Float32Array(ARC_PULSES).fill(-1);
  let presence = 0;
  let untilNext = 2.5;
  let flashTimer = 0;
  const _p = new Vector3();
  const _t = new Vector3();
  const _n = new Vector3();

  const ease = (x: number) => (x < 0.5 ? 2 * x * x : 1 - 2 * (1 - x) * (1 - x));
  const writeHeads = () => {
    for (let j = 0; j < ARC_PULSES; j++) heads[j] = progress[j] < 0 ? -10 : ease(progress[j]) * 1.12;
  };
  // A send that comes too soon after the last pulse waits for the spacing (one waits at most).
  let pending = false;
  const tooSoon = () => {
    for (let j = 0; j < ARC_PULSES; j++) if (progress[j] >= 0 && progress[j] < SPACING / TRAVEL) return true;
    return false;
  };
  const launch = () => {
    // Pulses launched together would draw as one: keep each new one a little behind the last.
    if (tooSoon()) return false;
    for (let j = 0; j < ARC_PULSES; j++) {
      if (progress[j] < 0) {
        progress[j] = 0;
        dirs[j] = nextDir;
        nextDir = -nextDir;
        writeHeads();
        return true;
      }
    }
    return false;
  };

  return {
    mesh,
    place(a, b, up, rise, halfWidth, fadeR) {
      // A quadratic curve through the sky: its middle rises by rise above the straight line.
      const c = new Vector3().addVectors(a, b).multiplyScalar(0.5).addScaledVector(up, rise * 2);
      const view = new Vector3().subVectors(b, a).cross(up).normalize(); // toward or away from the camera
      let length = 0;
      let prev: Vector3 | null = null;
      for (let k = 0; k <= SEGMENTS; k++) {
        const s = k / SEGMENTS;
        const u = 1 - s;
        _p.set(0, 0, 0).addScaledVector(a, u * u).addScaledVector(c, 2 * u * s).addScaledVector(b, s * s);
        _t.set(0, 0, 0).addScaledVector(a, -2 * u).addScaledVector(c, 2 * (u - s)).addScaledVector(b, 2 * s).normalize();
        // Across the ribbon: in the sky's plane, perpendicular to the curve.
        _n.crossVectors(_t, view).normalize();
        for (let side = 0; side < 2; side++) {
          const v = k * 2 + side;
          const w = side ? halfWidth : -halfWidth;
          pos[v * 3] = _p.x + _n.x * w;
          pos[v * 3 + 1] = _p.y + _n.y * w;
          pos[v * 3 + 2] = _p.z + _n.z * w;
        }
        if (prev) length += prev.distanceTo(_p);
        prev = (prev ?? new Vector3()).copy(_p);
      }
      posAttr.needsUpdate = true;
      geometry.computeBoundingSphere();
      uniforms.uFadeEnd.value = Math.min(0.2, fadeR / Math.max(1e-6, length));
    },
    setPresence(p) {
      presence = p;
      uniforms.uPresence.value = p;
      mesh.visible = p > 0.001;
      if (p <= 0.001) {
        // Gone: nothing left in flight when the lights come back.
        pending = false;
        progress.fill(-1);
        writeHeads();
      }
    },
    setMotion(enabled) {
      motion = enabled;
      pending = false;
      uniforms.uBase.value = enabled ? 0.07 : 0.22;
      progress.fill(-1);
      writeHeads();
      uniforms.uFlash.value = 0;
      window.clearTimeout(flashTimer);
    },
    tick(dt) {
      if (!motion) return;
      let moving = false;
      for (let j = 0; j < ARC_PULSES; j++) {
        if (progress[j] < 0) continue;
        progress[j] += dt / TRAVEL;
        if (progress[j] >= 1) progress[j] = -1;
        else moving = true;
      }
      if (pending && !tooSoon()) pending = !launch() && progress.some((q) => q < 0);
      if (presence >= 0.999) {
        untilNext -= dt;
        if (untilNext <= 0) {
          launch();
          untilNext = EVERY + (Math.random() * 2 - 1) * JITTER;
        }
      }
      if (moving || heads.some((h) => h > -10)) writeHeads();
    },
    send() {
      if (presence < 0.5) return false;
      if (motion) {
        if (launch()) return true;
        // Too soon after the last pulse: send it as soon as the spacing allows, if a slot is free.
        if (tooSoon() && progress.some((q) => q < 0)) {
          pending = true;
          return true;
        }
        return false;
      }
      // Motion off: the still line lights up, then settles, each an instant change.
      uniforms.uFlash.value = 1;
      opts.requestRender();
      window.clearTimeout(flashTimer);
      flashTimer = window.setTimeout(() => {
        uniforms.uFlash.value = 0;
        opts.requestRender();
      }, FLASH * 1000);
      return true;
    },
    dispose() {
      window.clearTimeout(flashTimer);
      geometry.dispose();
      material.dispose();
    },
  };
}
