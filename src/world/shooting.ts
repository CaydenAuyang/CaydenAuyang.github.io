// shooting.ts: shooting stars (NIGHT-SIGNAL.md 11b.8). About one every 20 to 40 s, short (under a
// second) and faint, somewhere in the sky that's in view and clear of text; and one on demand from
// a tapped bright star. One thin tapered streak, drawn as a strip on the sky dome (so it stays put
// in the sky if the camera moves), one draw call while it runs and none otherwise. Off with motion
// off.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  Mesh,
  ShaderMaterial,
  Vector2,
  Vector3,
  type IUniform,
  type PerspectiveCamera,
} from 'three';
import type { Ndc } from './contract';
import type { Sky } from './sky';

const R = 8400; // just inside the stars (8500)
const SEGMENTS = 24;
/** A tap within this many CSS px of a bright star fires from it. */
const HIT_PX = 24;
/** Things on the page a streak shouldn't cross: text and the frames around it. */
const TEXTY = 'p, h1, h2, h3, h4, li, dt, dd, blockquote, figcaption, a, button, label, video, .glass, [data-no-world]';

const vert = /* glsl */ `
attribute float aAlong; // 0 at the tail, 1 at the head
attribute float aSide; // -1 or 1 across the streak
uniform vec3 uFrom;
uniform vec3 uTo;
uniform float uProg; // head position along the path, 0..1 + uLen
uniform float uLen; // trail length, as a share of the path
uniform float uWidth; // head width, device px
uniform vec2 uView; // drawing buffer, device px
varying float vAlong;
varying float vSide;

vec4 at(float s) {
  vec3 d = normalize(mix(uFrom, uTo, clamp(s, 0.0, 1.0)));
  return projectionMatrix * modelViewMatrix * vec4(d * ${R.toFixed(1)}, 1.0);
}

void main() {
  float s = uProg - (1.0 - aAlong) * uLen;
  vec4 c = at(s);
  vec4 c2 = at(s + 0.02);
  vec2 a = c.xy / c.w * uView;
  vec2 b = c2.xy / c2.w * uView;
  vec2 t = normalize(b - a + vec2(1e-5, 0.0));
  vec2 n = vec2(-t.y, t.x);
  float w = uWidth * (0.15 + 0.85 * aAlong);
  c.xy += n * aSide * w / uView * c.w;
  vAlong = aAlong;
  vSide = aSide;
  gl_Position = c;
}
`;

const frag = /* glsl */ `
uniform float uAlpha;
uniform vec3 uColor;
varying float vAlong;
varying float vSide;
void main() {
  float across = 1.0 - smoothstep(0.0, 1.0, abs(vSide));
  float along = pow(vAlong, 2.2);
  float head = smoothstep(0.9, 1.0, vAlong) * 0.8;
  gl_FragColor = vec4(uColor * (along + head) * across * uAlpha, 1.0);
}
`;

export interface ShootingUniforms {
  uTime: IUniform<number>;
  uPixelRatio: IUniform<number>;
}

export interface Shooting {
  mesh: Mesh;
  /** From the bright star near ndc (true), or, without ndc, a random one now (true). */
  fire(ndc?: Ndc): boolean;
  /** Each frame: schedules the next one, runs the current one. */
  update(now: number, view: { w: number; h: number }): void;
}

export function buildShooting(
  sky: Sky,
  camera: PerspectiveCamera,
  shared: ShootingUniforms,
  drift: { axis: Vector3; rate: number },
  motion: () => boolean,
): Shooting {
  const n = SEGMENTS + 1;
  const along = new Float32Array(n * 2);
  const side = new Float32Array(n * 2);
  const pos = new Float32Array(n * 2 * 3);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    along[i * 2] = along[i * 2 + 1] = i / SEGMENTS;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    if (i < SEGMENTS) {
      const k = i * 2;
      idx.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(pos, 3));
  g.setAttribute('aAlong', new BufferAttribute(along, 1));
  g.setAttribute('aSide', new BufferAttribute(side, 1));
  g.setIndex(idx);
  const U = {
    uFrom: { value: new Vector3(0, 0.5, -1).normalize() },
    uTo: { value: new Vector3(0.1, 0.45, -1).normalize() },
    uProg: { value: 0 },
    uLen: { value: 0.35 },
    uWidth: { value: 1.6 },
    uView: { value: new Vector2(1, 1) },
    uAlpha: { value: 0 },
    uColor: { value: new Vector3(0.92, 0.95, 1.0) },
  };
  const mat = new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: U,
    blending: AdditiveBlending,
    depthWrite: false,
    depthTest: false,
    transparent: true,
    side: DoubleSide, // the strip's winding depends on which way it runs on screen
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.renderOrder = -8;
  mesh.name = 'shooting-star';

  const starPos = sky.stars.geometry.getAttribute('position');
  const tmp = new Vector3();
  const tmp2 = new Vector3();

  /** A star's direction now, with the sky's drift. */
  const starDir = (i: number, out: Vector3) => {
    out.set(starPos.getX(i), starPos.getY(i), starPos.getZ(i)).normalize();
    const ang = shared.uTime.value * drift.rate;
    return out.applyAxisAngle(drift.axis, ang);
  };
  /** World direction under a screen point. */
  const dirAt = (x: number, y: number, out: Vector3) => out.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
  /** Screen point of a direction (NDC), or null behind the camera. */
  const ndcOf = (d: Vector3) => {
    tmp2.copy(d).multiplyScalar(R).add(camera.position).project(camera);
    return tmp2.z < 1 ? { x: tmp2.x, y: tmp2.y } : null;
  };
  const elevation = (d: Vector3) => Math.asin(Math.max(-1, Math.min(1, d.y)));

  const overText = (p: Ndc) => {
    if (typeof document === 'undefined') return false;
    const el = document.elementFromPoint(((p.x + 1) / 2) * window.innerWidth, ((1 - p.y) / 2) * window.innerHeight);
    return Boolean(el && el.closest?.(TEXTY));
  };

  let run: { start: number; dur: number } | null = null;
  let next = 0;
  let viewSize = { w: 1, h: 1 };

  const launch = (from: Ndc, to: Ndc, now: number) => {
    camera.updateMatrixWorld();
    dirAt(from.x, from.y, U.uFrom.value);
    dirAt(to.x, to.y, U.uTo.value);
    U.uLen.value = 0.3 + Math.random() * 0.15;
    run = { start: now, dur: 450 + Math.random() * 350 };
    U.uProg.value = 0;
    mesh.visible = true;
  };

  /** The end of a short streak from p: down and to either side, len of the screen height long. */
  const stepFrom = (p: Ndc, len: number): Ndc => {
    const ang = (-150 + Math.random() * 120) * (Math.PI / 180);
    return { x: p.x + (Math.cos(ang) * len * 2 * viewSize.h) / viewSize.w, y: p.y + Math.sin(ang) * len * 2 };
  };

  /** A random short path in the visible sky, mostly sideways and down, clear of text. */
  const pickPath = (strict: boolean) => {
    camera.updateMatrixWorld();
    let last: [Ndc, Ndc] | null = null;
    for (let k = 0; k < 12; k++) {
      const from = { x: -0.85 + Math.random() * 1.7, y: 0.2 + Math.random() * 0.72 };
      const to = stepFrom(from, 0.15 + Math.random() * 0.1);
      last = [from, to];
      if (Math.abs(to.x) > 0.95 || to.y < -0.1 || to.y > 0.98) continue;
      // in the sky: high enough to be above the skyline and the haze
      const e1 = elevation(dirAt(from.x, from.y, tmp));
      const e2 = elevation(dirAt(to.x, to.y, tmp));
      if (e1 < 0.2 || e2 < 0.17) continue;
      if (strict) {
        const mid = { x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 };
        if (overText(from) || overText(mid) || overText(to)) continue;
      }
      return last;
    }
    return strict ? null : last;
  };

  return {
    mesh,
    fire(ndc) {
      if (!motion()) return false;
      if (!ndc) {
        const path = pickPath(true) ?? pickPath(false);
        if (!path) return false;
        launch(path[0], path[1], performance.now());
        return true;
      }
      // the bright star nearest the tap, within HIT_PX
      camera.updateMatrixWorld();
      const px = (window.innerWidth || 1) / 2;
      const py = (window.innerHeight || 1) / 2;
      let best = -1;
      let bestD = HIT_PX;
      for (const i of sky.brightest) {
        const s = ndcOf(starDir(i, tmp));
        if (!s) continue;
        const d = Math.hypot((s.x - ndc.x) * px, (s.y - ndc.y) * py);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      if (best < 0) return false;
      const from = ndcOf(starDir(best, tmp))!;
      launch(from, stepFrom(from, 0.17 + Math.random() * 0.08), performance.now());
      return true;
    },
    update(now, v) {
      viewSize = v;
      U.uView.value.set(v.w, v.h);
      U.uWidth.value = 1.6 * shared.uPixelRatio.value;
      if (!motion()) {
        run = null;
        mesh.visible = false;
        next = 0;
        return;
      }
      if (!next) next = now + 20000 + Math.random() * 20000;
      if (!run && now >= next) {
        const path = pickPath(true);
        if (path) launch(path[0], path[1], now);
        // try again a little later if the sky in view was all text or skyline
        next = now + (path ? 20000 + Math.random() * 20000 : 3000);
      }
      if (run) {
        const k = (now - run.start) / run.dur;
        if (k >= 1) {
          run = null;
          mesh.visible = false;
          return;
        }
        // the head eases along; the streak fades in fast and out toward the end
        const e = 1 - Math.pow(1 - Math.max(0, k), 1.6);
        U.uProg.value = e * (1 + U.uLen.value);
        U.uAlpha.value = 0.55 * Math.min(1, k / 0.12) * (1 - Math.pow(Math.max(0, k), 3));
      }
    },
  };
}
