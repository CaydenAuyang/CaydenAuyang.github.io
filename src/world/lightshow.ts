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
//   - Text: a coarse mask of where the page's text sits (64 x 40 cells, refreshed about 3 times a
//     second) dims every beam behind text blocks, so a beam never washes text out.

import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DoubleSide,
  LinearFilter,
  Matrix4,
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
import { GROUP_FLANK, type CityLayout } from './city';
import type { ScreenBox } from './contract';

export const BEAMS = 5;
const DEG = Math.PI / 180;
/** One beat of the window pulses, in seconds (100 bpm). */
const BEAT = 0.6;
/** The searchlight's loop (s), length (m) and how bright it is at the lamp. */
const LOOP = 14;
const SEARCH_LEN = 6000;
/** The searchlight's tilt band (degrees above the horizon), and lower bands it may drop to when
 * the camera looks away from Central and a beam in the spec's band can't reach the frame. The
 * lowest only with the lamp out of view (behind or beside the camera, the beam coming in low from
 * the frame edge): from a lamp in view a beam that flat doesn't read as a searchlight. */
const EL_BANDS = [65, 55, 45, 35, 27, 20, 14];
const EL_OFF_FRAME = 14;
const EL_SWING = 15;
/** The tilt swing for a band: the full 15 degrees, narrower for the lowest bands. */
const swingFor = (band: number) => Math.min(EL_SWING, band - 8);
/** With motion off the beam holds at the first of these points of its loop that reads (the first: near the centre of the sweep, leaning a little). */
const HOLD_PHASES = [0.04, 0.12, 0.2, 0.3, 0.45, 0.55, 0.7, 0.8, 0.9];
const HOLD_PHASE = HOLD_PHASES[0];
/** How many keep-out boxes the beams fade out inside, and their feather (share of the short side). */
export const KEEP_OUT = 4;
const FEATHER = 0.05;
/** The searchlight: brightness, and how much wider it gets per meter (half that while the show runs). */
const SEARCH_I = 0.16;
const SEARCH_GROW = 0.06;
/** The show's beams: how far ahead of the camera their aim points sit, how far past they run, how bright, how much wider per meter, and how they fade along their length (0: held bright, then faded out over the last 30%; a power fade under 1 kept them bright to the very end, so they ended in blunt round tips). */
const AIM_DIST = 4200;
const OVERSHOOT = 1.35;
const SHOW_I = 0.3;
const SHOW_GROW = 0.028;
const SHOW_FADE = 0;
/** Fades (s): the show in, the show out, the searchlight in after the intro. */
const SHOW_IN = 1.2;
const SHOW_OUT = 1;
const SEARCH_IN = 1.5;
/** Fades (s) of the searchlight where it starts or stops reading as a shaft (as the camera moves or a keep-out box comes and goes): in slowly, so it never pops in, out quickly. */
const READ_IN = 1.2;
const READ_OUT = 0.4;
/** How fast (s for its whole length) the searchlight draws back from a keep-out box it sweeps into or that appears across it, and runs out again after. */
const CUT_OUT = 0.25;
const CUT_IN = 0.6;
/**
 * How long (s) a keep-out box that appears across a lit beam takes to fade the beam out inside it.
 * A little longer than CUT_OUT, so the part past the box has drawn back before the part inside is
 * gone and never shows on its own. Cutting the beam in one frame instead dropped most of its light
 * at once, scrolling back into Wisers or on into Experience.
 */
const KEEP_IN = 0.3;
/** Text mask size, and what a beam keeps behind text. */
const MASK_W = 64;
const MASK_H = 40;
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
  /** x: brightness (0: off), y: radius at the lamp (m), z: radius growth per meter, w: how fast it fades along its length (the exponent of the fade; 1 is even; 0 holds it bright most of the way, then fades it out over its last 30%). */
  uBeamK: IUniform<Vector4[]>;
  /**
   * Per beam, as shares of its length: x where it comes into the frame (its brightness is
   * measured from there, so a beam whose lamp is off-frame enters from the frame edge at full
   * strength instead of as a faint far end), y where it ends (before a keep-out box it would
   * otherwise come out of, so no shaft ever floats free of its lamp).
   */
  uBeamSpan: IUniform<Vector2[]>;
  /** Keep-out boxes (viewport fractions x0, y0, x1, y1 from the top left), how many are set, and how far each has faded in (0..1). */
  uKeep: IUniform<Vector4[]>;
  uKeepN: IUniform<number>;
  uKeepW: IUniform<number[]>;
}

export function showUniforms(): ShowUniforms & BeamUniforms {
  return {
    uShow: { value: new Vector4(0, 0, BEAT, 0) },
    uBeamBase: { value: Array.from({ length: BEAMS }, () => new Vector3()) },
    uBeamDir: { value: Array.from({ length: BEAMS }, () => new Vector3(0, 1, 0)) },
    uBeamK: { value: Array.from({ length: BEAMS }, () => new Vector4(0, 6, 0.045, 1)) },
    uBeamSpan: { value: Array.from({ length: BEAMS }, () => new Vector2(0, 1)) },
    uKeep: { value: Array.from({ length: KEEP_OUT }, () => new Vector4()) },
    uKeepN: { value: 0 },
    uKeepW: { value: new Array<number>(KEEP_OUT).fill(1) },
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
uniform vec2 uBeamSpan[${BEAMS}];
varying float vAlong;
varying float vOff;
varying vec2 vRad;
varying float vI;
varying float vSeed;
varying float vLen;
varying vec2 vSpan;
varying float vFade;
void main() {
  int i = int(aBeam + 0.5);
  vec3 dir = uBeamDir[i];
  float len = length(dir);
  vec3 p = uBeamBase[i] + dir * aAlong;
  dir /= max(len, 1e-3);
  // widen square to the plane through the camera and the beam's axis: that is across the shaft on
  // screen wherever it is, and the same direction for the whole beam, so the strip never twists
  // and the cone stays straight. (Widening across the view direction instead turns the strip
  // edge-on, a hairline, when a beam far off the middle of the frame runs away from the camera,
  // as at the Work stops.)
  vec3 side = cross(uBeamBase[i] - cameraPosition, dir); // this order keeps the quads facing the camera (front faces)
  if (length(side) < 1e-3 * length(uBeamBase[i] - cameraPosition)) side = cross(-vec3(viewMatrix[0][2], viewMatrix[1][2], viewMatrix[2][2]), dir);
  side = length(side) > 1e-6 ? normalize(side) : vec3(1.0, 0.0, 0.0);
  // the quad is a little wider than the cone, so its soft edge never meets the quad's edge
  float r = uBeamK[i].y + aAlong * len * uBeamK[i].z;
  p += side * aSide * r * 2.6;
  vAlong = aAlong;
  // The offset across the beam in meters is exact anywhere on the strip (it is linear in world
  // space); the fragment divides it by the cone's radius there. Interpolating a ready-made
  // "share of the radius" instead bends along the triangle seams of the widening strip and makes
  // the shaft snake.
  vOff = aSide * r * 2.6;
  vRad = vec2(uBeamK[i].y, len * uBeamK[i].z);
  vSpan = uBeamSpan[i];
  vFade = uBeamK[i].w;
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
uniform vec4 uKeep[${KEEP_OUT}]; // boxes the beams stay out of (viewport fractions, x0, y0, x1, y1 from the top left)
uniform float uKeepN;
uniform float uKeepW[${KEEP_OUT}];
varying float vAlong;
varying float vOff;
varying vec2 vRad;
varying float vI;
varying float vSeed;
varying float vLen;
varying vec2 vSpan;
varying float vFade;

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
  float x = vOff / (vRad.x + vAlong * vRad.y);
  float across = exp(-x * x * 2.2) + 0.15 * exp(-x * x * 0.45);
  // along: brightest where the beam comes into view (the lamp, or the frame edge when the lamp is
  // off-frame), thinning out as the fog swallows it, and gone before a keep-out box it would come
  // out of (vSpan.y). It always reaches 0 at the far end, so no beam ends in a bright cap.
  float a = clamp((vAlong - vSpan.x) / max(1.0 - vSpan.x, 1e-3), 0.0, 1.0);
  // The show's beams (vFade 0) stay bright most of the way and fade out over their last 30%, so
  // they read in a frame of sky far from their roofs.
  float held = (1.0 - 0.45 * a) * (1.0 - smoothstep(0.7, 1.0, a));
  float along = (vFade > 0.0 ? pow(1.0 - a, vFade) : held) * smoothstep(0.0, 0.01, vAlong);
  if (vSpan.y < 1.0) along *= 1.0 - smoothstep(vSpan.y - 0.05, vSpan.y, vAlong);
  // fog: slow drifting density along the beam (meters along it, and time), the same across its
  // width, so the shaft stays straight and never reads as a flat wedge
  float m = vAlong * vLen;
  float fog = 0.7 + 0.6 * vnoise(vec2(m * 0.004 - uTime * 0.12 + vSeed * 7.0, vSeed * 3.0 + uTime * 0.05));
  fog *= 0.85 + 0.3 * vnoise(vec2(m * 0.017 - uTime * 0.3, 5.0 + vSeed));
  // the lamp itself: a small bright glow where the beam leaves the roof
  float lamp = exp(-m / 18.0) * exp(-x * x * 6.0) * 2.5;
  float text = texture2D(uTextMask, gl_FragCoord.xy / uView).r;
  // keep-out boxes (the figure, the Wisers pictures): the beam fades to nothing inside, feathered
  vec2 fr = vec2(gl_FragCoord.x / uView.x, 1.0 - gl_FragCoord.y / uView.y);
  vec2 fe = vec2(${FEATHER.toFixed(3)}) * min(uView.x, uView.y) / uView;
  float keep = 1.0;
  for (int i = 0; i < ${KEEP_OUT}; i++) {
    if (float(i) >= uKeepN) break;
    vec4 bx = uKeep[i];
    float inX = smoothstep(bx.x - fe.x, bx.x, fr.x) * (1.0 - smoothstep(bx.z, bx.z + fe.x, fr.x));
    float inY = smoothstep(bx.y - fe.y, bx.y, fr.y) * (1.0 - smoothstep(bx.w, bx.w + fe.y, fr.y));
    keep *= 1.0 - uKeepW[i] * inX * inY;
  }
  if (keep <= 0.0) discard;
  float I = vI * (along * across * fog + lamp) * (1.0 - (1.0 - ${TEXT_KEEP.toFixed(2)}) * text) * keep;
  gl_FragColor = vec4(uCool * I, 1.0);
}
`;

export interface Beams {
  mesh: Mesh;
  /** Whether the show is running or still fading out. */
  readonly showOn: boolean;
  setShow(on: boolean): void;
  /** Screen boxes (viewport fractions) the beams fade out inside, and the searchlight avoids. */
  setKeepOut(boxes: readonly ScreenBox[]): void;
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
    if (t === central || t.group === GROUP_FLANK) continue;
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
  const keep = U.uKeep.value;
  const keepN = U.uKeepN;
  const keepW = U.uKeepW.value;
  // last frame's boxes, to tell a box that moved (the figure, the columns as they draw) from a new one
  const prevKeep = Array.from({ length: KEEP_OUT }, () => new Vector4());
  const prevW = new Array<number>(KEEP_OUT).fill(1);
  let prevN = 0;
  const span = U.uBeamSpan.value;
  const mat = new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uBeamBase: U.uBeamBase,
      uBeamDir: U.uBeamDir,
      uBeamK: U.uBeamK,
      uBeamSpan: U.uBeamSpan,
      uTime: U.uTime,
      uCool: { value: new Vector3(...cool) },
      uTextMask: { value: maskTex },
      uView: { value: viewU },
      uKeep: U.uKeep,
      uKeepN: U.uKeepN,
      uKeepW: U.uKeepW,
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
  // after the sky and stars, before the signal (renderOrder 9 and 10), so the figure can hide the
  // haze behind it
  mesh.renderOrder = 5;

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
        // one cell wider all round: the mask is filtered, so the text itself sits in fully dimmed cells
        for (let y = Math.max(0, y0 - 1); y <= Math.min(MASK_H - 1, y1 + 1); y++)
          for (let x = Math.max(0, x0 - 1); x <= Math.min(MASK_W - 1, x1 + 1); x++) mask[y * MASK_W + x] = 255;
      }
    }
    maskTex.needsUpdate = true;
  };
  /** Whether a screen point (fractions from the top left) is on text. */
  const onText = (fx: number, fy: number) => {
    const cx = Math.min(MASK_W - 1, Math.max(0, Math.floor(fx * MASK_W)));
    const cy = Math.min(MASK_H - 1, Math.max(0, Math.floor((1 - fy) * MASK_H)));
    return mask[cy * MASK_W + cx] > 0;
  };

  // ---- State ----
  let show = false; // asked for
  let showEnv = 0; // 0..1, eased
  let searchEnv = 0;
  let readEnv = 0; // 0..1: whether the searchlight reads as a shaft from a lamp here (eased)
  let showT = 0; // seconds of show time (runs while the show is visible)
  let tSearch = 0; // seconds of searchlight time (runs with motion)
  let keepChanged = false;
  let fading = false; // whether a keep-out box is still fading in
  let lastMotion = true;
  let cutS = 1; // where the searchlight ends (share of its length), eased

  const tmp = new Vector3();
  const target = new Vector3();

  // ---- Reading a beam on screen ----
  // A beam reads as a searchlight only as a straight shaft that starts at its lamp, or at the edge
  // of the frame when the lamp is off-frame, or rises from behind nearer towers. A shaft that
  // would start at the edge of a keep-out box (its lamp inside the box) floats in mid-air, so it
  // doesn't count; nor does what comes out the far side of a box (the beam ends at the box).
  // Lengths on text count for less (the beam is dimmed there and hard to see).
  const NS = 16;
  const FS = Array.from({ length: NS }, (_, i) => Math.pow(i / (NS - 1), 1.3));
  const SKY_COLS = 24;
  const sky = new Float32Array(SKY_COLS); // highest tower top per screen column (NDC y)
  const vp = new Matrix4();
  let e = vp.elements;
  const px = new Float32Array(3);
  /** NDC of a world point into px (and its clip w into px[2]); false behind the camera. */
  const proj = (x: number, y: number, z: number) => {
    const w = e[3] * x + e[7] * y + e[11] * z + e[15];
    if (w <= 1e-3) return false;
    px[0] = (e[0] * x + e[4] * y + e[8] * z + e[12]) / w;
    px[1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) / w;
    px[2] = w;
    return true;
  };
  const syncView = () => {
    camera.updateMatrixWorld();
    vp.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    e = vp.elements;
  };
  const refreshSky = () => {
    sky.fill(-1);
    for (const t of city.towers) {
      for (let k = 0; k < 2; k++) {
        const z = t.z + (k ? -t.d / 2 : t.d / 2);
        if (!proj(t.x - t.w / 2, t.roof, z)) continue;
        const ax = px[0];
        const ay = px[1];
        if (!proj(t.x + t.w / 2, t.roof, z)) continue;
        const c0 = Math.max(0, Math.floor(((Math.min(ax, px[0]) + 1) / 2) * SKY_COLS));
        const c1 = Math.min(SKY_COLS - 1, Math.floor(((Math.max(ax, px[0]) + 1) / 2) * SKY_COLS));
        const y = Math.max(ay, px[1]);
        for (let c = c0; c <= c1; c++) if (y > sky[c]) sky[c] = y;
      }
    }
  };
  const BOX_M = 0.02;
  const inBox = (fx: number, fy: number, m: number) => {
    for (let b = 0; b < keepN.value; b++) {
      const k = keep[b];
      if (fx > k.x - m && fx < k.z + m && fy > k.y - m && fy < k.w + m) return true;
    }
    return false;
  };
  // Liang-Barsky: the part of a segment inside a box, as shares of it (lbIn to lbOut)
  let lbIn = 0;
  let lbOut = 1;
  const lbClip = (p: number, q: number) => {
    if (p === 0) {
      if (q < 0) lbIn = 2;
      return;
    }
    const r = q / p;
    if (p < 0) lbIn = Math.max(lbIn, r);
    else lbOut = Math.min(lbOut, r);
  };
  /**
   * Where a segment on screen (fractions from the top left) first comes within BOX_M of a
   * keep-out box inside the frame, as a share of the segment, or -1. The samples along a beam are
   * far apart, so a beam can clip a box's corner between two of them.
   */
  const segBox = (ax: number, ay: number, bx: number, by: number) => {
    let first = -1;
    for (let b = 0; b < keepN.value; b++) {
      const k = keep[b];
      const x0 = Math.max(0, k.x - BOX_M);
      const y0 = Math.max(0, k.y - BOX_M);
      const x1 = Math.min(1, k.z + BOX_M);
      const y1 = Math.min(1, k.w + BOX_M);
      if (x0 >= x1 || y0 >= y1) continue;
      lbIn = 0;
      lbOut = 1;
      lbClip(ax - bx, ax - x0);
      lbClip(bx - ax, x1 - ax);
      lbClip(ay - by, ay - y0);
      lbClip(by - ay, y1 - ay);
      if (lbIn <= lbOut && (first < 0 || lbIn < first)) first = lbIn;
    }
    return first;
  };
  const read = { q: 0, sky: 0, enter: 0, cut: 1, edge: 1, qFull: 0 };
  /**
   * How well a beam from base along dir (direction times length) reads on screen, into read:
   * q is its visible on-screen length (NDC units) above the towers, weighted by its brightness
   * there (measured from where it comes into view); sky is the part of that in open sky, clear of
   * text and the header; enter and cut are the shares of its length where it comes into view and
   * where it must end. q is 0 when the shaft would float (then cut is 0: none of it may show).
   * edge (0..1, also in q and sky; qFull is q without it) goes to 0 as the place it comes into the
   * frame rises under the header: through the top edge, from behind the camera, it reads only as a
   * faint smudge along the top, not as a shaft.
   */
  const evalBeam = (base: Vector3, dx: number, dy: number, dz: number) => {
    read.q = 0;
    read.sky = 0;
    read.enter = 0;
    read.cut = 1;
    read.edge = 1;
    read.qFull = 0;
    let started = -1;
    let prevIn = false;
    let prevBoxed = false;
    let prevFrame = false;
    let prevOk = false;
    let pxx = 0;
    let pyy = 0;
    let pw = 1;
    let pf = 0;
    for (let i = 0; i < NS; i++) {
      const f = FS[i];
      const ok = proj(base.x + dx * f, base.y + dy * f, base.z + dz * f);
      const x = px[0];
      const y = px[1];
      const w = px[2];
      const frame = ok && Math.abs(x) <= 1 && Math.abs(y) <= 1;
      const fx = (x + 1) / 2;
      const fy = (1 - y) / 2;
      const boxed = frame && inBox(fx, fy, BOX_M);
      const col = Math.min(SKY_COLS - 1, Math.max(0, Math.floor(fx * SKY_COLS)));
      const open = frame && !boxed && (i === 0 || y >= sky[col] + 0.01);
      // where the stretch since the last sample first meets a keep-out box
      const hit = i > 0 && ok && prevOk ? segBox((pxx + 1) / 2, (1 - pyy) / 2, fx, fy) : -1;
      if (started < 0) {
        if (frame && boxed && i === 0) {
          read.cut = 0; // the lamp is inside a box: it would float
          return read;
        }
        if (frame && !boxed) {
          // comes out of a box: floats
          if (i > 0 && ((prevFrame && prevBoxed) || hit >= 0)) {
            read.cut = 0;
            return read;
          }
          started = i;
          // from the frame edge (lamp off-frame) the brightness counts from here; from the lamp
          // or from behind nearer towers it counts from the lamp
          read.enter = i > 0 && !prevFrame ? FS[i - 1] : 0;
          if (i > 0 && !prevFrame) read.edge = entryEdge(base, dx, dy, dz, pf, f);
        }
      } else {
        if (hit >= 0 || boxed) {
          // ends where it meets the box (the screen share converted back to a share of length)
          const u = hit >= 0 ? (hit * pw) / (w * (1 - hit) + hit * pw) : 0;
          read.cut = Math.max(read.enter + 0.02, pf + u * (f - pf));
          break;
        }
        if (!frame) break; // leaves the frame
        if (open && prevIn) {
          const mid = (0.5 * (f + pf) - read.enter) / Math.max(1e-3, 1 - read.enter);
          const bright = Math.pow(1 - Math.min(1, Math.max(0, mid)), 1.05);
          // behind text (where the beam is dimmed) or in the band under the header along the top
          // it is hard to see, so those lengths count for less
          const l = Math.hypot(x - pxx, y - pyy) * bright;
          const clear = fy >= 0.1 && !onText(fx, fy);
          read.q += clear ? l : l * 0.35;
          if (clear) read.sky += l;
        }
      }
      prevIn = open;
      prevBoxed = boxed;
      prevFrame = frame;
      prevOk = ok;
      pxx = x;
      pyy = y;
      pw = w;
      pf = f;
    }
    read.qFull = read.q;
    read.q *= read.edge;
    read.sky *= read.edge;
    return read;
  };
  /**
   * For a beam that is out of the frame at share f0 of its length and in it at f1: 1 where it comes
   * in well below the top, falling to 0 as that rises to the top edge (and beyond: through it). By
   * bisection for the last point outside the frame before it comes in.
   */
  const entryEdge = (base: Vector3, dx: number, dy: number, dz: number, f0: number, f1: number) => {
    let lo = f0;
    let hi = f1;
    for (let k = 0; k < 10; k++) {
      const m = 0.5 * (lo + hi);
      const ok = proj(base.x + dx * m, base.y + dy * m, base.z + dz * m);
      if (ok && Math.abs(px[0]) <= 1 && Math.abs(px[1]) <= 1) hi = m;
      else lo = m;
    }
    if (!proj(base.x + dx * lo, base.y + dy * lo, base.z + dz * lo)) return 1;
    const t = Math.min(1, Math.max(0, (px[1] - 0.85) / 0.15));
    return 1 - t * t * (3 - 2 * t);
  };

  // ---- The searchlight's aim ----
  // The lamp stays on the Central roof, but the sweep turns to wherever the camera looks: a few
  // times a second the world tries directions around the lamp and finds the widest run of
  // azimuths whose beam reads (above) over the whole tilt band. The figure-eight is centred on
  // that run, and the centre eases as the camera moves. If no beam in the spec's band (50 to 80
  // degrees) can read, as at the stops that look away from Central from low down, the band drops
  // just far enough that one can. Where none reads at all, the searchlight fades out.
  const AZN = 48;
  const okRun = new Uint8Array(AZN);
  const okTop = new Uint8Array(AZN);
  const okBot = new Uint8Array(AZN);
  const skyMid = new Float32Array(AZN); // each azimuth's length in open sky at the band's middle tilt
  const cutMid = new Float32Array(AZN); // and how well it reads there where a keep-out box cuts it short (0 if none does)
  // centre azimuth, half-width of the sweep (radians), tilt centre and swing (degrees)
  const aim = { az: 0, A: 0.95, el: EL_BANDS[0], sw: EL_SWING, fresh: true };
  const want = { az: 0, A: 0.95, el: EL_BANDS[0], sw: EL_SWING };
  let aimAt = -1e9;
  let anyReads = true;
  const lastCam = new Float32Array(16);
  const lamp = U.uBeamBase.value[0];
  // for the test scripts: the sweep's current centre, width and band
  mesh.userData.aim = aim;
  mesh.userData.sweep = { loop: LOOP, len: SEARCH_LEN, swing: EL_SWING, holdPhase: HOLD_PHASE, swingFor };

  /** How well the beam at (az, el) reads; strict: a shaft that a keep-out box cuts short doesn't count at all. */
  const quality = (az: number, el: number, strict: boolean) => {
    const ce = Math.cos(el);
    const r = evalBeam(lamp, Math.sin(az) * ce * SEARCH_LEN, Math.sin(el) * SEARCH_LEN, -Math.cos(az) * ce * SEARCH_LEN);
    // a shaft that a keep-out box cuts short reads as a stub unless it is long, so it counts for less
    if (r.cut < 1) return strict ? 0 : r.q * 0.7;
    return r.q;
  };
  /** The bearing from the lamp to the camera (a beam leaning that way stands upright on screen). */
  const towardCamera = () => Math.atan2(camera.position.x - lamp.x, -(camera.position.z - lamp.z));
  // for the test scripts: how the beam at a bearing from the camera's (radians) and tilt (degrees) reads from here
  mesh.userData.probe = (daz: number, el: number, strict = false) => {
    syncView();
    refreshSky();
    const q = quality(towardCamera() + daz, el * DEG, strict);
    return { qual: q, ...read };
  };
  const Q_MIN = 0.15;
  const set = (az: number, A: number, el: number, sw: number) => {
    want.az = az;
    want.A = A;
    want.el = el;
    want.sw = sw;
  };
  /**
   * Where one end of the tilt keeps failing over the run, tilt over the half that reads. Within
   * the spec's bands the tilt never drops below its 50 degrees: a beam that reads at the band's
   * middle tilt and at its bottom reads at 50 too (on the phone at AI Simply, 50 to 55 instead of
   * 40 to 55).
   */
  const setTilt = (az: number, A: number, band: number, sw: number, from: number, len: number) => {
    let top = 0;
    let bot = 0;
    for (let k = 0; k < len; k++) {
      const i = (((from + k) % AZN) + AZN) % AZN;
      top += okTop[i];
      bot += okBot[i];
    }
    let lo = band - sw;
    let hi = Math.min(80, band + sw);
    if (top < len * 0.7 && bot >= top) hi = band;
    else if (bot < len * 0.7) lo = band;
    if (band >= 55) lo = Math.max(50, lo);
    set(az, A, (lo + hi) / 2, (hi - lo) / 2);
  };
  const findAim = () => {
    refreshSky();
    anyReads = findAimIn(true) || findAimIn(false);
  };
  /**
   * The aim over the bands, into want; false if no beam reads. Strict first: only shafts that no
   * keep-out box cuts short, so the sweep passes beside the figure (as on the phone hero, where
   * the lamp stands right under it) instead of running into it as a stub. It may still cross
   * behind the box on its way to open sky on the far side (below).
   */
  const findAimIn = (strict: boolean) => {
    const toCam = towardCamera();
    const lampInView = proj(lamp.x, lamp.y, lamp.z) && Math.abs(px[0]) <= 1 && Math.abs(px[1]) <= 1;
    for (const band of EL_BANDS) {
      if (band <= EL_OFF_FRAME && lampInView) break;
      const sw = swingFor(band);
      // within the spec's tilt (50 to 80 degrees) a somewhat shorter shaft is enough, so the beam
      // keeps to the spec wherever it can still read
      const qMin = band >= 55 ? Q_MIN * 0.7 : Q_MIN;
      // good azimuths: the beam reads at the band's middle tilt and at one of its ends at least
      let all = true;
      for (let i = 0; i < AZN; i++) {
        const az = toCam + (i / AZN) * 2 * Math.PI;
        const qm = quality(az, band * DEG, strict);
        skyMid[i] = read.sky;
        cutMid[i] = read.cut > 0 && read.cut < 1 ? read.q * 0.7 : 0;
        if (qm < qMin) {
          okRun[i] = 0;
          okTop[i] = 0;
          okBot[i] = 0;
          all = false;
          continue;
        }
        okTop[i] = quality(az, Math.min(80, band + sw) * DEG, strict) >= qMin ? 1 : 0;
        okBot[i] = quality(az, (band - sw) * DEG, strict) >= qMin ? 1 : 0;
        okRun[i] = okTop[i] || okBot[i] ? 1 : 0;
        if (!okRun[i] || !okTop[i] || !okBot[i]) all = false;
      }
      if (all) {
        set(toCam, 0.95, band, sw);
        return true;
      }
      // the longest run of good azimuths (around the circle); ties go to the one nearest the camera
      let best = -1;
      let bestLen = 0;
      for (let i = 0; i < AZN; i++) {
        if (!okRun[i] || okRun[(i + AZN - 1) % AZN]) continue;
        let len = 0;
        while (len < AZN && okRun[(i + len) % AZN]) len++;
        const mid = i + (len - 1) / 2;
        const dist = Math.min(mid, AZN - mid);
        if (len > bestLen || (len === bestLen && best >= 0 && dist < Math.min(best, AZN - best))) {
          bestLen = len;
          best = mid;
        }
      }
      if (bestLen === 0) {
        // every azimuth works at this band, with some ends of the tilt only: sweep toward the camera
        let any = false;
        for (let i = 0; i < AZN; i++) if (okRun[i]) any = true;
        if (!any) continue;
        setTilt(toCam, 0.95, band, sw, 0, AZN);
        return true;
      }
      // Beside a keep-out box, the sweep keeps to the longest stretch of the run with at least 60%
      // of its longest shaft in open sky, so where only the beams just beside the box reach open
      // sky (the phone hero, where the rest of the run hides behind the name) it stays there.
      // Elsewhere, or where no beam of the run gets much open sky, the whole run.
      const from = Math.round(best - (bestLen - 1) / 2);
      let peak = 0;
      for (let k = 0; k < bestLen; k++) peak = Math.max(peak, skyMid[(from + k) % AZN]);
      const floor = keepN.value > 0 && peak >= Q_MIN ? peak * 0.6 : 0;
      let sFrom = from;
      let sLen = 0;
      let cur = 0;
      for (let k = 0; k < bestLen; k++) {
        cur = skyMid[(from + k) % AZN] >= floor ? cur + 1 : 0;
        if (cur > sLen) {
          sLen = cur;
          sFrom = from + k - cur + 1;
        }
      }
      // The sweep may also cross behind the box to a stretch with open sky on its far side (the
      // phone hero, where the lamp stands right under the figure): across the box the beam is cut
      // short as it passes behind it, so it sweeps round the figure instead of nodding beside it.
      if (strict && floor > 0) {
        for (const step of [-1, 1]) {
          let k = step < 0 ? sFrom - 1 : sFrom + sLen;
          let gap = 0;
          while (gap < AZN / 4 && cutMid[(k + AZN * 2) % AZN] >= qMin) {
            gap++;
            k += step;
          }
          let far = 0;
          while (gap > 0 && far < AZN / 4 && okRun[(k + AZN * 2) % AZN] && skyMid[(k + AZN * 2) % AZN] >= floor) {
            far++;
            k += step;
          }
          if (far === 0) continue;
          if (step < 0) sFrom -= gap + far;
          sLen += gap + far;
          break;
        }
      }
      const mid = sFrom + (sLen - 1) / 2;
      setTilt(toCam + (mid / AZN) * 2 * Math.PI, Math.min(0.95, Math.max(0.05, 0.42 * (sLen / AZN) * 2 * Math.PI)), band, sw, sFrom, sLen);
      return true;
    }
    // no beam reads here (every one floats, hides behind text or the towers, or misses the frame)
    return false;
  };
  const camMoved = () => {
    const m = camera.matrixWorld.elements;
    let moved = false;
    for (let i = 0; i < 16; i++) {
      if (Math.abs(m[i] - lastCam[i]) > 1e-4) moved = true;
      lastCam[i] = m[i];
    }
    return moved;
  };
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

  /** The searchlight's direction at time t (s): a lazy figure-eight around the current aim. */
  const searchDir = (t: number, out: Vector3) => {
    const w = (2 * Math.PI) / LOOP;
    const az = aim.az + aim.A * Math.sin(w * t);
    const el = Math.min(80, aim.el + aim.sw * Math.sin(2 * w * t)) * DEG;
    const ce = Math.cos(el);
    return out.set(Math.sin(az) * ce, Math.sin(el), -Math.cos(az) * ce);
  };
  let holdPh = HOLD_PHASE;
  const holdQ = new Float32Array(HOLD_PHASES.length);
  const holdSky = new Float32Array(HOLD_PHASES.length);
  const pickHold = () => {
    for (const whole of [true, false]) {
      let bestQ = 0;
      let bestSky = 0;
      for (let k = 0; k < HOLD_PHASES.length; k++) {
        searchDir(LOOP * HOLD_PHASES[k], tmp);
        const r = evalBeam(lamp, tmp.x * SEARCH_LEN, tmp.y * SEARCH_LEN, tmp.z * SEARCH_LEN);
        const ok = r.q >= Q_MIN * 0.7 && (!whole || r.cut >= 1);
        holdQ[k] = ok ? r.q : 0;
        holdSky[k] = ok ? r.sky : 0;
        bestQ = Math.max(bestQ, holdQ[k]);
        bestSky = Math.max(bestSky, holdSky[k]);
      }
      if (bestQ <= 0) continue;
      // by the length in open sky; where no point gets much (the frame's sky is all behind text),
      // by how well it reads at all
      const v = bestSky >= Q_MIN ? holdSky : holdQ;
      const best = bestSky >= Q_MIN ? bestSky : bestQ;
      for (let k = 0; k < HOLD_PHASES.length; k++) if (holdQ[k] > 0 && v[k] >= best * 0.6) return HOLD_PHASES[k];
    }
    return HOLD_PHASE;
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
    setKeepOut(boxes) {
      const n = Math.min(KEEP_OUT, boxes.length);
      let changed = n !== keepN.value;
      for (let i = 0; i < prevN; i++) {
        prevKeep[i].copy(keep[i]);
        prevW[i] = keepW[i];
      }
      // A box that appears across the lit searchlight fades in (KEEP_IN); one that was here last
      // frame (most of it overlapping) keeps its fade.
      const lit = lastMotion && U.uBeamK.value[0].x > 0;
      for (let i = 0; i < n; i++) {
        const b = boxes[i];
        const k = keep[i];
        if (k.x !== b.x0 || k.y !== b.y0 || k.z !== b.x1 || k.w !== b.y1) changed = true;
        k.set(b.x0, b.y0, b.x1, b.y1);
        let w = lit ? 0 : 1;
        for (let j = 0; j < prevN; j++) {
          const q = prevKeep[j];
          const ix = Math.min(q.z, b.x1) - Math.max(q.x, b.x0);
          const iy = Math.min(q.w, b.y1) - Math.max(q.y, b.y0);
          const small = Math.min((q.z - q.x) * (q.w - q.y), (b.x1 - b.x0) * (b.y1 - b.y0));
          if (ix > 0 && iy > 0 && ix * iy > 0.5 * small) w = Math.max(w, prevW[j]);
        }
        keepW[i] = w;
        if (w < 1) fading = true;
      }
      prevN = n;
      keepN.value = n;
      if (changed) {
        keepChanged = true;
        requestRender();
      }
    },
    update(now, dt, motion, wake) {
      const d = Math.max(0, Math.min(0.1, dt));
      syncView();
      // with motion: a few times a second (the camera and the figure move all the time); without:
      // whenever the frozen camera or the boxes change
      const due = motion ? now - aimAt > 250 : camMoved() || keepChanged;
      const aimed = due || aim.fresh;
      if (aimed) {
        aimAt = now;
        keepChanged = false;
        const t0 = performance.now();
        // with motion the mask refreshes on its own a few times a second (below)
        if (!motion) refreshMask();
        findAim();
        mesh.userData.aimMs = performance.now() - t0; // for the test scripts
      }
      if (motion && !aim.fresh) {
        const k = 1 - Math.exp(-d / 0.7);
        aim.az += wrap(want.az - aim.az) * k;
        aim.A += (want.A - aim.A) * k;
        aim.el += (want.el - aim.el) * k;
        aim.sw += (want.sw - aim.sw) * k;
      } else {
        aim.az = want.az;
        aim.A = want.A;
        aim.el = want.el;
        aim.sw = want.sw;
        aim.fresh = false;
      }
      // with motion off the beam holds still at one point of its loop, picked whenever the aim
      // changes: of a few points around the loop, the first (nearest the centre of the sweep) that
      // reads with a shaft in open sky at least 60% as long as the best one, so a frozen view
      // (reduced motion, snapshot) shows a shaft where one can read. Shafts that a keep-out box
      // cuts short only if nothing else reads.
      if (!motion && aimed) holdPh = pickHold();
      const dir0 = U.uBeamDir.value[0];
      searchDir(motion ? tSearch : LOOP * holdPh, tmp);
      dir0.copy(tmp).multiplyScalar(SEARCH_LEN);
      evalBeam(lamp, dir0.x, dir0.y, dir0.z);
      // does the beam, where it points now, read as a shaft from a lamp? (with a little hysteresis)
      // Where it comes in under the header it dims with read.edge instead, so a sweep that rises
      // there for a moment fades smoothly rather than switching off and on.
      const reads = anyReads && read.qFull >= (readEnv > 0.5 ? Q_MIN * 0.5 : Q_MIN * 0.7);
      const edge = read.edge;
      // where it ends: drawn back quickly as it sweeps into a keep-out box, or as one appears across
      // it (a Wisers picture drawing in) while the box fades the beam out inside it, so nothing past
      // the box shows on its own; run out again more slowly once clear
      lastMotion = motion;
      if (!motion) cutS = read.cut;
      else if (read.cut < cutS) cutS = Math.max(read.cut, cutS - d / CUT_OUT);
      else cutS = Math.min(read.cut, cutS + d / CUT_IN);
      if (fading) {
        fading = false;
        for (let i = 0; i < keepN.value; i++) {
          keepW[i] = motion ? Math.min(1, keepW[i] + d / KEEP_IN) : 1;
          if (keepW[i] < 1) fading = true;
        }
        requestRender();
      }
      span[0].set(read.enter, cutS);
      mesh.userData.read = { q: read.q, enter: read.enter, cut: read.cut, edge, reads, anyReads };

      // envelopes: eased with motion, immediate without
      const searchTarget = wake >= 0.999 ? 1 : 0;
      if (motion) {
        searchEnv = Math.min(1, Math.max(0, searchEnv + (searchTarget ? d / SEARCH_IN : -d / SEARCH_IN)));
        showEnv = Math.min(1, Math.max(0, showEnv + (show ? d / SHOW_IN : -d / SHOW_OUT)));
        readEnv = Math.min(1, Math.max(0, readEnv + (reads ? d / READ_IN : -d / READ_OUT)));
        tSearch += d;
        if (showEnv > 0) showT += d;
        else showT = 0;
      } else {
        searchEnv = searchTarget;
        showEnv = show ? 1 : 0;
        readEnv = reads ? 1 : 0;
      }
      const sEase = searchEnv * searchEnv * (3 - 2 * searchEnv);
      const shEase = showEnv * showEnv * (3 - 2 * showEnv);
      const rEase = readEnv * readEnv * (3 - 2 * readEnv);

      // the searchlight (beam 0): brighter while the show runs
      const K = U.uBeamK.value;
      K[0].set((SEARCH_I + (SHOW_I - SEARCH_I) * shEase) * Math.max(sEase * rEase, shEase) * edge, 6, SEARCH_GROW * (1 - 0.5 * shEase), 1.05);
      // the show's beams: like the searchlight, brightest where they come into view (the bottom
      // edge) and fading all the way to nothing at their far ends
      for (let b = 1; b < BEAMS; b++) {
        if (shEase <= 0) {
          K[b].x = 0;
          continue;
        }
        const db = showDir(b, motion ? showT : 1.5, U.uBeamDir.value[b]);
        evalBeam(U.uBeamBase.value[b], db.x, db.y, db.z);
        span[b].set(read.enter, read.cut);
        K[b].set(SHOW_I * shEase, 5, SHOW_GROW, SHOW_FADE);
      }
      // the windows' pulse and the bottom glow
      U.uShow.value.set(motion ? shEase : 0, showT, BEAT, shEase);

      mesh.visible = K[0].x > 0 || shEase > 0;
      // the text mask also steers the aim, so it stays fresh while the beam is faded out
      if (now - maskAt > 300) {
        maskAt = now;
        refreshMask();
      }
      const { w, h } = view();
      viewU.set(w, h);
    },
  };
}
