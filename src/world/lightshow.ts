// lightshow.ts: the searchlight beams. One draw call for all of them.
//
//   - The rooftop searchlight (NIGHT-SIGNAL.md 4.7): one beam from the roof of the tallest tower
//     in the Central cluster, a soft additive cone in cool (about 14% at the lamp, fading to nothing
//     along its length, a little wider far away) through fog that drifts slowly along it. It sweeps
//     a lazy figure-eight, one loop about every 14 s, tilting between 50 and 80 degrees up. It
//     comes on at the end of the hero intro and stays on wherever the sky is in view. Stars inside
//     it brighten a little (stars.vert reads the beam uniforms). With motion off it holds still.
//   - The harbour light show (11b.9 v3): while lightShow(true), four more beams from rooftops across
//     the island join it and the windows pulse in rhythm, the pulses running across the skyline,
//     with a soft glow along the bottom of the frame swelling on the beat (sky.frag), so it reads
//     from Contact, whose camera sees only sky: the city lighting up below. The show's beams sweep
//     through whatever sky is in view, each aiming at a point that moves through the frame. It
//     loops until lightShow(false), which fades it out over 1 s. With motion off the beams hold
//     still, nothing pulses, and every change is immediate.
//   - Text: a coarse mask of where the page's text sits (32 x 20 cells, refreshed about 5 times a
//     second) dims every beam behind text blocks, so a beam never washes text out.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Mesh,
  RedFormat,
  ShaderMaterial,
  UnsignedByteType,
  Vector2,
  Vector3,
  Vector4,
  type IUniform,
  type PerspectiveCamera,
} from 'three';
import type { CityLayout } from './city';

export const BEAMS = 5;
/** One beat of the window pulses, in seconds (100 bpm). */
const BEAT = 0.6;
/** The searchlight's loop (s), length (m) and how bright it is at the lamp. */
const LOOP = 14;
const SEARCH_LEN = 4500;
const SEARCH_I = 0.16;
/** The show's beams: how far ahead of the camera their aim points sit, how far past they run, how bright. */
const AIM_DIST = 4200;
const OVERSHOOT = 1.35;
const SHOW_I = 0.3;
/** Fades (s): the show in, the show out, the searchlight in after the intro. */
const SHOW_IN = 1.2;
const SHOW_OUT = 1;
const SEARCH_IN = 1.5;
/** Text mask size, and what a beam keeps behind text. */
const MASK_W = 32;
const MASK_H = 20;
const TEXT_KEEP = 0.55;
const TEXT_BLOCKS = 'h1, h2, h3, h4, p, li, dt, dd, blockquote, figcaption, a, button, label, input, .glass';

export interface ShowUniforms {
  /** x: window pulse strength (0 when off or with motion off), y: seconds into the show, z: seconds per beat, w: bottom glow strength. */
  uShow: IUniform<Vector4>;
}

/** The beams, for the stars (which brighten inside them). */
export interface BeamUniforms {
  /** Lamp positions (world). */
  uBeamBase: IUniform<Vector3[]>;
  /** Direction times length. */
  uBeamDir: IUniform<Vector3[]>;
  /** x: brightness (0: off), y: radius at the lamp (m), z: radius growth per meter, w: 0 fades from the lamp, 1 stays bright most of the way (the show). */
  uBeamK: IUniform<Vector4[]>;
}

export function showUniforms(): ShowUniforms & BeamUniforms {
  return {
    uShow: { value: new Vector4(0, 0, BEAT, 0) },
    uBeamBase: { value: Array.from({ length: BEAMS }, () => new Vector3()) },
    uBeamDir: { value: Array.from({ length: BEAMS }, () => new Vector3(0, 1, 0)) },
    uBeamK: { value: Array.from({ length: BEAMS }, () => new Vector4(0, 6, 0.045, 0)) },
  };
}

/**
 * The window pulse at a point across the skyline (0 left, 1 right), 0..1: sharp beats running left
 * to right, two per sweep of the city. Needs uShow declared before it.
 */
export const SHOW_GLSL = /* glsl */ `
float nsShowBeat(float across) {
  if (uShow.x <= 0.0) return 0.0;
  float ph = uShow.y / uShow.z - across * 2.0;
  float beat = pow(0.5 + 0.5 * cos(6.2831853 * ph), 6.0);
  return uShow.x * beat;
}
`;

const vert = /* glsl */ `
attribute float aBeam;
attribute float aAlong; // 0 at the lamp, 1 at the far end
attribute float aSide; // -1 or 1 across the beam
uniform vec3 uBeamBase[${BEAMS}];
uniform vec3 uBeamDir[${BEAMS}];
uniform vec4 uBeamK[${BEAMS}];
varying float vAlong;
varying float vSide;
varying float vI;
varying float vSeed;
varying float vLen;
varying float vFlat;
void main() {
  int i = int(aBeam + 0.5);
  vec3 dir = uBeamDir[i];
  float len = length(dir);
  vec3 p = uBeamBase[i] + dir * aAlong;
  dir /= max(len, 1e-3);
  // widen across the camera's view direction (one direction for the whole beam, so the strip
  // never twists and the cone stays straight)
  vec3 fwd = -vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]);
  vec3 side = cross(fwd, dir); // this order keeps the quads facing the camera (front faces)
  side = length(side) > 1e-3 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  // the quad is a little wider than the cone, so its soft edge never meets the quad's edge
  float r = uBeamK[i].y + aAlong * len * uBeamK[i].z;
  p += side * aSide * r * 2.6;
  vAlong = aAlong;
  vSide = aSide * 2.6;
  vFlat = uBeamK[i].w;
  vI = uBeamK[i].x;
  vSeed = aBeam;
  vLen = len;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const frag = /* glsl */ `
uniform vec3 uCool;
uniform float uTime;
uniform sampler2D uTextMask;
uniform vec2 uView;
varying float vAlong;
varying float vSide;
varying float vI;
varying float vSeed;
varying float vLen;
varying float vFlat;

float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  if (vI <= 0.0) discard;
  // across the cone: a soft round core (the cone seen side on) in a faint wide halo of light
  // scattered by the fog; x is in cone radii
  float x = vSide;
  float across = exp(-x * x * 2.2) + 0.15 * exp(-x * x * 0.45);
  // along: brightest at the lamp, thinning out as the fog swallows it; the show's beams stay
  // bright most of the way, so they read in a frame of sky far from their roofs
  float fade = pow(1.0 - vAlong, 1.05);
  float held = (1.0 - 0.45 * vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong));
  float along = mix(fade, held, vFlat) * smoothstep(0.0, 0.01, vAlong);
  // fog: slow drifting density along the beam (meters along it), so it never reads as a flat wedge
  float m = vAlong * vLen;
  float fog = 0.7 + 0.6 * vnoise(vec2(m * 0.004 - uTime * 0.12 + vSeed * 7.0, x * 0.25 + vSeed * 3.0));
  fog *= 0.85 + 0.3 * vnoise(vec2(m * 0.017 - uTime * 0.3, x * 0.6 + 5.0));
  // the lamp itself: a small bright glow where the beam leaves the roof
  float lamp = exp(-m / 18.0) * exp(-x * x * 6.0) * 2.5;
  float text = texture2D(uTextMask, gl_FragCoord.xy / uView).r;
  float I = vI * (along * across * fog + lamp) * (1.0 - (1.0 - ${TEXT_KEEP.toFixed(2)}) * text);
  gl_FragColor = vec4(uCool * I, 1.0);
}
`;

export interface Beams {
  mesh: Mesh;
  /** Whether the show is running or still fading out. */
  readonly showOn: boolean;
  setShow(on: boolean): void;
  /** Each frame. now in ms; wake is the intro's window wake (the searchlight starts when it is done). */
  update(now: number, dt: number, motion: boolean, wake: number): void;
}

export function buildBeams(
  city: CityLayout,
  U: ShowUniforms & BeamUniforms & { uTime: IUniform<number> },
  cool: [number, number, number],
  camera: PerspectiveCamera,
  view: () => { w: number; h: number },
  requestRender: () => void,
): Beams {
  // The searchlight: the tallest roof in the Central cluster. The show's lamps: the next tallest
  // roofs at least 5% of the city apart and away from it, left to right.
  const central = [...city.towers].filter((t) => Math.abs(t.x - city.central.x) < city.width * 0.08).sort((a, b) => b.roof - a.roof)[0] ?? city.towers[0];
  const others: typeof city.towers = [];
  for (const t of [...city.towers].sort((a, b) => b.roof - a.roof)) {
    if (others.length >= BEAMS - 1) break;
    if (t === central) continue;
    if ([central, ...others].every((p) => Math.abs(p.x - t.x) > city.width * 0.05)) others.push(t);
  }
  others.sort((a, b) => a.x - b.x);
  const lamps = [central, ...others];
  while (lamps.length < BEAMS) lamps.push(central);
  lamps.forEach((t, i) => U.uBeamBase.value[i].set(t.x, t.roof + 2, t.z));

  // Geometry: one quad per beam, subdivided along it so the fog and the fade are smooth.
  const SEG = 8;
  const per = (SEG + 1) * 2;
  const aBeam = new Float32Array(BEAMS * per);
  const aAlong = new Float32Array(BEAMS * per);
  const aSide = new Float32Array(BEAMS * per);
  const idx: number[] = [];
  for (let b = 0; b < BEAMS; b++) {
    for (let s = 0; s <= SEG; s++) {
      for (let k = 0; k < 2; k++) {
        const o = b * per + s * 2 + k;
        aBeam[o] = b;
        aAlong[o] = s / SEG;
        aSide[o] = k ? 1 : -1;
      }
      if (s < SEG) {
        const o = b * per + s * 2;
        idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
      }
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(BEAMS * per * 3), 3));
  g.setAttribute('aBeam', new BufferAttribute(aBeam, 1));
  g.setAttribute('aAlong', new BufferAttribute(aAlong, 1));
  g.setAttribute('aSide', new BufferAttribute(aSide, 1));
  g.setIndex(idx);

  const mask = new Uint8Array(MASK_W * MASK_H);
  const maskTex = new DataTexture(mask, MASK_W, MASK_H, RedFormat, UnsignedByteType);
  maskTex.minFilter = LinearFilter;
  maskTex.magFilter = LinearFilter;
  maskTex.needsUpdate = true;
  const viewU = new Vector2(1, 1);
  const mat = new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uBeamBase: U.uBeamBase,
      uBeamDir: U.uBeamDir,
      uBeamK: U.uBeamK,
      uTime: U.uTime,
      uCool: { value: new Vector3(...cool) },
      uTextMask: { value: maskTex },
      uView: { value: viewU },
    },
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
    side: DoubleSide, // looking almost along a beam can flip its winding
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'beams';

  // ---- Where the text is (cells of the viewport covered by text blocks) ----
  let maskAt = -1e9;
  const refreshMask = () => {
    mask.fill(0);
    if (typeof document !== 'undefined') {
      const vw = window.innerWidth || 1;
      const vh = window.innerHeight || 1;
      const els = document.querySelectorAll<HTMLElement>(TEXT_BLOCKS);
      const range = document.createRange();
      for (const el of Array.from(els)) {
        const box = el.getBoundingClientRect();
        if (box.width < 2 || box.height < 2 || box.bottom < 0 || box.top > vh || box.right < 0 || box.left > vw) continue;
        // the text itself, not its block (a paragraph's box spans the whole column)
        range.selectNodeContents(el);
        const r = range.getBoundingClientRect();
        if (r.width < 2 || r.height < 2) continue;
        // texture rows run from the bottom of the screen
        const x0 = Math.max(0, Math.floor((r.left / vw) * MASK_W));
        const x1 = Math.min(MASK_W - 1, Math.floor((r.right / vw) * MASK_W));
        const y0 = Math.max(0, Math.floor(((vh - r.bottom) / vh) * MASK_H));
        const y1 = Math.min(MASK_H - 1, Math.floor(((vh - r.top) / vh) * MASK_H));
        for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) mask[y * MASK_W + x] = 255;
      }
    }
    maskTex.needsUpdate = true;
  };

  // ---- State ----
  let show = false; // asked for
  let showEnv = 0; // 0..1, eased
  let searchEnv = 0;
  let showT = 0; // seconds of show time (runs while the show is visible)
  let tSearch = 0; // seconds of searchlight time (runs with motion)

  const tmp = new Vector3();
  const target = new Vector3();

  /** The searchlight's direction at time t (s): a lazy figure-eight, 50 to 80 degrees up. */
  const searchDir = (t: number, out: Vector3) => {
    const w = (2 * Math.PI) / LOOP;
    const az = 0.95 * Math.sin(w * t);
    const el = (65 + 15 * Math.sin(2 * w * t)) * (Math.PI / 180);
    // leaning mostly sideways as seen from the harbour, a little over the water
    return out.set(Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el) * 0.3).normalize();
  };
  /** A show beam's direction at time t: at a point that sweeps through the frame in its own lane. */
  const showDir = (b: number, t: number, out: Vector3) => {
    const lane = ((b - 1 + 0.5) / (BEAMS - 1)) * 2 - 1;
    const x = lane * 0.75 + 0.38 * Math.sin(t * 0.85 + b * 1.3);
    const y = 0.42 + 0.32 * Math.sin(t * 0.55 + b * 0.9);
    target.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(AIM_DIST).add(camera.position);
    const base = U.uBeamBase.value[b];
    if (target.y < base.y + 200) target.y = base.y + 200;
    return out.subVectors(target, base).multiplyScalar(OVERSHOOT);
  };

  return {
    mesh,
    get showOn() {
      return show || showEnv > 0;
    },
    setShow(on) {
      show = on;
      requestRender();
    },
    update(now, dt, motion, wake) {
      const d = Math.max(0, Math.min(0.1, dt));
      // envelopes: eased with motion, immediate without
      const searchTarget = wake >= 0.999 ? 1 : 0;
      if (motion) {
        searchEnv = Math.min(1, Math.max(0, searchEnv + (searchTarget ? d / SEARCH_IN : -d / SEARCH_IN)));
        showEnv = Math.min(1, Math.max(0, showEnv + (show ? d / SHOW_IN : -d / SHOW_OUT)));
        tSearch += d;
        if (showEnv > 0) showT += d;
        else showT = 0;
      } else {
        searchEnv = searchTarget;
        showEnv = show ? 1 : 0;
      }
      const sEase = searchEnv * searchEnv * (3 - 2 * searchEnv);
      const shEase = showEnv * showEnv * (3 - 2 * showEnv);

      // the searchlight (beam 0): brighter while the show runs
      const K = U.uBeamK.value;
      camera.updateMatrixWorld();
      searchDir(motion ? tSearch : LOOP * 0.1, tmp);
      U.uBeamDir.value[0].copy(tmp).multiplyScalar(SEARCH_LEN);
      K[0].set((SEARCH_I + (SHOW_I - SEARCH_I) * shEase) * Math.max(sEase, shEase), 6, 0.06 - 0.03 * shEase, shEase);
      // the show's beams
      for (let b = 1; b < BEAMS; b++) {
        if (shEase <= 0) {
          K[b].x = 0;
          continue;
        }
        showDir(b, motion ? showT : 1.5, U.uBeamDir.value[b]);
        K[b].set(SHOW_I * shEase, 5, 0.028, 1);
      }
      // the windows' pulse and the bottom glow
      U.uShow.value.set(motion ? shEase : 0, showT, BEAT, shEase);

      mesh.visible = K[0].x > 0 || shEase > 0;
      if (mesh.visible && now - maskAt > 200) {
        maskAt = now;
        refreshMask();
      }
      const { w, h } = view();
      viewU.set(w, h);
    },
  };
}
