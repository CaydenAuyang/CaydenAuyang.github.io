// signal.ts: the particle system that moves between the city and the pictures (NIGHT-SIGNAL.md
// section 5). Owned by the Signal agent.
//
// One THREE.Points, one draw call. Every point has a base position in each of the six built targets
// (A city, B figure, C current, D archive, E two lights, S star field), built once on the CPU here and
// again only when the viewport changes shape. The vertex shader does everything per frame: each
// target's live motion (the current flows, the columns rise, the field drifts), and the morph
// between two targets with a per-point delay of up to 30%, a curved path and curl noise that
// peaks mid-flight. No per-frame loops over points on the CPU.
//
// Window dimming: the points sit on lit windows in A, taken from the lowest lift ranks first, so
// when they leave, setLift(maxRank, amount) dims exactly the windows they came from, in the same
// order they leave, and relights them as they land. Into the figure they leave in its scan order
// (the crown first), which the windows' ranks follow.
//
// The figure (target B, NIGHT-SIGNAL.md 5 B and 5.1) is built from Cayden's video:
// public/figure/figure-{hi|lo|phone}.bin (format in its .json; see site-handoff/figure-video).
// Each file has exactly as many points as its tier, so figure point i is particle i: no
// resampling, jitter or re-weighting, because the even lattice of horizontal rings is the look.
// The shader places, turns (setFigureTurn: the head fully, the shoulders at 0.85, the neck
// blended) and shades it (facing, and the video's brightness at 7 head angles), and assembles it
// as a scan from the crown down.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, GLSL3, Matrix3, Points, RawShaderMaterial, Vector2, Vector3 } from 'three';
import type { CameraPose, LitWindowSamples, Ndc, ScreenBox, Signal, SignalOptions, Target, World } from './contract';
import { ARCHIVE, FIGURE_ANCHOR, LIGHT_ANCHORS, usePhoneLayout } from './contract';
import fragmentShader from './shaders/signal.frag.glsl?raw';
import vertexShader from './shaders/signal.vert.glsl?raw';
import { createArc } from './arc';

/** The targets with their own positions on the geometry (S is the star field, 5 in the shader). */
type Built = 'A' | 'B' | 'C' | 'D' | 'E' | 'S';
const BUILT: Built[] = ['A', 'B', 'C', 'D', 'E', 'S'];
const ID: Record<Built, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, S: 5 };
/**
 * Any target name to one that is built: 'F' is the star field's old name (the timeline still uses
 * it until the v3 timeline lands), and the Wisers pictures (F1, F2, G) stay in the city (A) until
 * they are built.
 */
function built(t: Target | 'F'): Built {
  if (t === 'F' || t === 'S') return 'S';
  if (t === 'F1' || t === 'F2' || t === 'G') return 'A';
  return t;
}

/** Share of the lit windows the signal lifts: the lowest ranks. Raised only if the city is thin. */
const LIFT_RANK = 0.1;
/** If fewer windows than points / this come back, ask for more ranks (up to MAX_LIFT_RANK). */
const MAX_PER_WINDOW = 48;
const MAX_LIFT_RANK = 0.4;
/** How dark a lifted window goes. */
const LIFT_AMOUNT = 1;
/** A window dims once its points are this far into their flight (and relights this close to landing). */
const LIFT_LAG = 0.05;
/** Morph timing in the shader: up to 30% delay, then 70% travel. */
const DELAY = 0.3;

/** The figure's turn limits (contract and figure-video/README.md: 30 degrees of yaw, 5 of pitch). */
const MAX_YAW = (30 * Math.PI) / 180;
const MAX_PITCH = (5 * Math.PI) / 180;
/** Figure points sampled for figureBox (an even sample, so the box follows the outline). */
const BOX_SAMPLES = 1500;
/** The figure is never shorter than this on desktop (CSS px), or its rings moire. */
const FIGURE_MIN_PX = 350;
/** Point size in the figure, as a share of the spacing between its rings on screen (about 1.6 px on a 450 px tall hi figure). */
const FIGURE_DOT = 0.95;
/** The figure's brightness and white core against the preview renders (figure-video/preview), tuned by measurement. */
const FIGURE_GAIN = 1.25;
const FIGURE_CORE = 0.3;
/** Scan assembly: how much of a morph into or out of the figure its rings take to lock in, and the whisper of randomness. */
const SCAN = 0.35;
const SCAN_JITTER = 0.04;
/** Screen row (from the top) of the current's center in the question view: open water, below the reflections. */
const CURRENT_ROW = 0.8;
/** Archive highlight (11b.3): how long a column takes to light or dim (the shader doubles a lit column and dims the rest to 38%). */
const COL_EASE = 0.2;
/** Archive hit areas: at least this wide on screen (CSS px), and this much taller than a column. */
const COL_HIT_MIN = 24;
const COL_HIT_PAD = { top: 18, foot: 10 };
/** The arc between the two lights (11b.7): how far its middle rises (share of the view height), and its half width (CSS px). */
const ARC_RISE = 0.17;
const ARC_HALF_WIDTH = 6;
/**
 * The light a lifted window gives to the points that leave it, shared among them, so the light
 * that rises matches what the city loses (measured at Since May: carried / lost 0.8 to 1.6 while
 * the city is in view). Phone windows are smaller on screen next to the points, so less.
 */
const CARRY_WINDOW = { desktop: 1.6, phone: 0.5 };
/**
 * How the carried light is shared out (uCarryMix): the share of points that carry most of it, their
 * multiple, everyone else's, and how much larger carriers draw in flight. Phones have fewer, smaller
 * points and a smaller city on screen, so more of their points carry, brighter and larger, or the
 * spray would read as a few extra stars.
 */
const CARRY_MIX = { desktop: [0.25, 3.2, 0.27, 1], phone: [0.5, 8, 0.3, 1.45] };
/** Star field (S): the share of points that are clear lights, and of points lit at all (clear or faint). */
const FIELD_CLEAR = 0.025;
const FIELD_LIT = 0.12;
/** Share of archive points that drift loose instead of joining a column. */
const STRAYS = 0.04;
/** The archive columns: one per notebook, each count / largest count of the full height. */
const COLS = ARCHIVE.length;
const COL_SHARE = ARCHIVE.map((c) => c.count / Math.max(...ARCHIVE.map((d) => d.count)));
/** The columns' baseline above the tallest roof, and the screen row (from the top) the tallest reaches, in the experience view. */
const COL_FOOT = 0.03;
const COL_TOP_ROW = 0.1;

const COLORS = { warm: '#FFB65C', cool: '#CFE3FF' };


export interface SignalInfo {
  windows: number;
  liftRank: number;
  pointsPerWindow: number;
  figurePoints: number;
  phone: boolean;
  scale: number;
}

export interface SignalDebug extends Signal {
  readonly info: SignalInfo;
  /** Rebuild the view-dependent targets now (the lab uses it after switching camera poses). */
  rebuild(): void;
  readonly points: Points;
}

// ---- Figure data -------------------------------------------------------------------------------

interface FigureMeta {
  file: string;
  count: number;
  posScale: number;
  yChin: number;
  yNeckBase: number;
  torsoYawRatio: number;
}

interface FigureData {
  meta: FigureMeta;
  count: number;
  position: Float32Array; // 3 a point: figure height 1, y up from the crop line, yaw axis at x = z = 0, z toward the viewer
  normalXZ: Float32Array; // 2 a point: the horizontal surface normal
  viewA: Uint8Array; // 4 a point: the video's brightness at head yaw -30, -20, -10, 0
  viewB: Uint8Array; // 3 a point: at +10, +20, +30
  ringStep: number; // the spacing between rings, in figure heights
}

const FIGURE_FILES = { hi: 60000, lo: 30000, phone: 16000 } as const;
type FigureTier = keyof typeof FIGURE_FILES;

/**
 * Loads the video-built figure from a folder. The file is the one with exactly as many points as
 * the tier has particles (hi 60,000, lo 30,000, phone 16,000), falling back to the tier's name.
 * The old single-file path (anything ending in .bin or .json) means the default folder, /figure.
 */
async function loadFigure(url: string, count: number, tier: string): Promise<FigureData> {
  const base = /\.(bin|json)(\?|$)/.test(url) ? '/figure' : url.replace(/\/+$/, '');
  const byCount = (Object.keys(FIGURE_FILES) as FigureTier[]).find((k) => FIGURE_FILES[k] === count);
  const name: FigureTier = byCount ?? (tier === 'phone' ? 'phone' : tier === 'low' ? 'lo' : 'hi');
  const metaRes = await fetch(`${base}/figure-${name}.json`);
  if (!metaRes.ok) throw new Error(`signal: ${base}/figure-${name}.json answered ${metaRes.status}`);
  const meta: FigureMeta = await metaRes.json();
  const binRes = await fetch(`${base}/${meta.file}`);
  if (!binRes.ok) throw new Error(`signal: ${base}/${meta.file} answered ${binRes.status}`);
  const buf = await binRes.arrayBuffer();
  const n = meta.count;
  if (buf.byteLength !== 16 * n) throw new Error(`signal: ${meta.file} should be ${16 * n} bytes, not ${buf.byteLength}`);
  const p16 = new Int16Array(buf, 0, 3 * n);
  const position = new Float32Array(3 * n);
  for (let i = 0; i < 3 * n; i++) position[i] = p16[i] * meta.posScale;
  const n8 = new Int8Array(buf, 6 * n, 2 * n);
  const normalXZ = new Float32Array(2 * n);
  for (let i = 0; i < 2 * n; i++) normalXZ[i] = n8[i] / 127;
  // Ring spacing: the median step between the distinct heights of the rings.
  const heights = Array.from(new Set(Array.from(p16.filter((_, k) => k % 3 === 1)))).sort((a, b) => b - a);
  const steps = heights.slice(1).map((h, k) => (heights[k] - h) * meta.posScale).sort((a, b) => a - b);
  const ringStep = steps.length ? steps[steps.length >> 1] : 1 / 200;
  return { meta, count: n, position, normalXZ, viewA: new Uint8Array(buf, 8 * n, 4 * n), viewB: new Uint8Array(buf, 12 * n, 3 * n), ringStep };
}

// ---- Small helpers -----------------------------------------------------------------------------

function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function gaussFrom(rand: () => number) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
const smooth01 = (x: number) => x * x * (3 - 2 * x);

/** A camera pose as axes plus the numbers needed to go between screen fractions and world space. */
interface Frame {
  pos: Vector3;
  right: Vector3;
  up: Vector3;
  fwd: Vector3;
  tanHalf: number;
  aspect: number;
}

function frameOf(pose: CameraPose, aspect: number): Frame {
  return {
    pos: pose.position.clone(),
    right: new Vector3(1, 0, 0).applyQuaternion(pose.quaternion),
    up: new Vector3(0, 1, 0).applyQuaternion(pose.quaternion),
    fwd: new Vector3(0, 0, -1).applyQuaternion(pose.quaternion),
    tanHalf: Math.tan((pose.fov * Math.PI) / 360),
    aspect,
  };
}

/** World point at screen fraction (sx from the left, sy from the top) and view depth `depth`. */
function unproject(f: Frame, sx: number, sy: number, depth: number, out = new Vector3()) {
  const x = (2 * sx - 1) * f.aspect * f.tanHalf * depth;
  const y = (1 - 2 * sy) * f.tanHalf * depth;
  return out.copy(f.pos).addScaledVector(f.right, x).addScaledVector(f.up, y).addScaledVector(f.fwd, depth);
}

const _v = new Vector3();
function depthOf(f: Frame, p: Vector3) {
  return _v.subVectors(p, f.pos).dot(f.fwd);
}

function horizontal(v: Vector3) {
  const h = new Vector3(v.x, 0, v.z);
  return h.lengthSq() > 1e-8 ? h.normalize() : new Vector3(1, 0, 0);
}

// ---- The signal --------------------------------------------------------------------------------

export async function createSignal(opts: SignalOptions): Promise<SignalDebug> {
  const { world } = opts;
  let motion = opts.motion;
  const N = Math.max(1, Math.floor(world.tier.points));
  const lm = world.landmarks;

  // Windows first (sync), while the figure downloads.
  const figurePromise = loadFigure(opts.figureUrl, N, world.tier.tier);
  let liftRank = LIFT_RANK;
  let win: LitWindowSamples = world.sampleLitWindows(N, liftRank);
  while (win.count * MAX_PER_WINDOW < N && liftRank < MAX_LIFT_RANK) {
    liftRank = Math.min(MAX_LIFT_RANK, liftRank * 2);
    win = world.sampleLitWindows(N, liftRank);
  }
  const fig = await figurePromise;

  const rand = rng(20261023);
  const gauss = () => gaussFrom(rand);

  // Per point randoms: delay key, size, path, phase.
  const aRand = new Float32Array(N * 4);
  for (let i = 0; i < N * 4; i++) aRand[i] = rand();
  const stray = (i: number) => aRand[i * 4 + 3] < STRAYS;

  // ---- A: points onto windows, lowest ranks first, several points per window ----
  let M = win.count;
  let wPos = win.positions;
  let wRank = win.rank;
  let wAcross = win.across;
  let wWarm = win.warm;
  if (M === 0) {
    // No city to sample (should not happen): park the points invisibly at the Central cluster.
    M = 1;
    wPos = new Float32Array([lm.centralCluster.x, lm.centralCluster.y, lm.centralCluster.z]);
    wRank = new Float32Array([0]);
    wAcross = new Float32Array([0.5]);
    wWarm = new Float32Array([1]);
  }
  const byRank = Array.from({ length: M }, (_, j) => j).sort((a, b) => wRank[a] - wRank[b]);
  const used = Math.min(M, N);
  const winOf = new Uint32Array(N);
  for (let i = 0; i < N; i++) winOf[i] = byRank[Math.floor((i * used) / N)];
  let rMax = 0;
  for (let k = 0; k < used; k++) rMax = Math.max(rMax, wRank[byRank[k]]);

  // ---- The figure: particle i is figure point i (its points are ordered ring by ring from the
  // crown down). Windows are handed out in rank order, so the order the windows dim in follows the
  // scan (crown first); within each of 48 slices of a few rings, windows on the left feed the left
  // of the figure, so the light mostly rises instead of criss-crossing.
  const F = fig.count;
  const figX = (i: number) => (i < F ? fig.position[i * 3] : 0);
  {
    const SLICES = 48;
    for (let s = 0; s < SLICES; s++) {
      const a = Math.floor((s * N) / SLICES);
      const b = Math.floor(((s + 1) * N) / SLICES);
      const pts: number[] = [];
      const wins: number[] = [];
      for (let i = a; i < b; i++) {
        pts.push(i);
        wins.push(winOf[i]);
      }
      pts.sort((p, q) => figX(p) - figX(q) || p - q);
      wins.sort((p, q) => wAcross[p] - wAcross[q] || p - q);
      for (let k = 0; k < pts.length; k++) winOf[pts[k]] = wins[k];
    }
  }

  const aInfo = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const j = winOf[i];
    aInfo[i * 4] = wWarm[j] > 0.5 ? 1 : 0;
    aInfo[i * 4 + 1] = rMax > 0 ? clamp(wRank[j] / rMax, 0, 1) : aRand[i * 4];
  }

  // The figure's own attributes. Particles beyond the figure's count (only if a tier and its file
  // disagree) sit below the crop line, unlit.
  const aFigPos = new Float32Array(N * 3);
  const aFigN = new Float32Array(N * 2);
  const aFigViewA = new Uint8Array(N * 4);
  const aFigViewB = new Uint8Array(N * 3);
  for (let i = 0; i < N; i++) {
    if (i < F) {
      aFigPos.set(fig.position.subarray(i * 3, i * 3 + 3), i * 3);
      aFigN.set(fig.normalXZ.subarray(i * 2, i * 2 + 2), i * 2);
      aFigViewA.set(fig.viewA.subarray(i * 4, i * 4 + 4), i * 4);
      aFigViewB.set(fig.viewB.subarray(i * 3, i * 3 + 3), i * 3);
    } else {
      aFigPos[i * 3 + 1] = -10;
    }
  }

  // Window dimming that follows the scan: when each particle leaves for the figure (crown first)
  // and lands back from it (chest first), and its window's rank, sorted by time. The scan delays
  // match the shader's: SCAN * (1 - y) + SCAN_JITTER * aRand.x into the figure, SCAN * y + ... out.
  const travel = 1 - SCAN - SCAN_JITTER;
  const scanIn = { t: new Float32Array(N), rank: new Float32Array(N) };
  const scanOut = { t: new Float32Array(N), rank: new Float32Array(N) };
  {
    const inT: [number, number][] = [];
    const outT: [number, number][] = [];
    for (let i = 0; i < N; i++) {
      const y = i < F ? fig.position[i * 3 + 1] : 0;
      const r = wRank[winOf[i]];
      inT.push([SCAN * (1 - y) + SCAN_JITTER * aRand[i * 4] + travel * LIFT_LAG, r]);
      outT.push([SCAN * y + SCAN_JITTER * aRand[i * 4] + travel * (1 - LIFT_LAG), r]);
    }
    inT.sort((a, b) => a[0] - b[0]);
    outT.sort((a, b) => a[0] - b[0]);
    // In: the highest rank among the particles gone by time t (prefix maximum).
    let m = 0;
    inT.forEach(([t, r], k) => {
      m = Math.max(m, r);
      scanIn.t[k] = t;
      scanIn.rank[k] = m;
    });
    // Out: the highest rank among the particles not yet landed after time t (suffix maximum).
    m = 0;
    for (let k = N - 1; k >= 0; k--) {
      m = Math.max(m, outT[k][1]);
      scanOut.t[k] = outT[k][0];
      scanOut.rank[k] = m;
    }
  }
  // The first index whose time is above t.
  const after = (arr: Float32Array, t: number) => {
    let lo = 0;
    let hi = arr.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (arr[mid] <= t) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  };

  // Screen x each point ends up at in the field (follows where its window is), shared by F and E.
  const fieldX = new Float32Array(N);
  for (let i = 0; i < N; i++) fieldX[i] = clamp(wAcross[winOf[i]] + gauss() * 0.12, -0.08, 1.08);

  const T = BUILT.map(() => new Float32Array(N * 4));
  const attrs = T.map((arr) => new BufferAttribute(arr, 4));

  // Fixed randoms per target, so a rebuild on resize lands every point in the same place.
  const fixed = Array.from({ length: 6 }, () => {
    const r = new Float32Array(N * 4);
    for (let i = 0; i < r.length; i++) r[i] = rand();
    return r;
  });

  // Archive columns (D): which column each point joins (-1: a stray) and how far up it sits (0..1
  // of its column). Each column gets exactly its share of the points (largest remainder), picked
  // at random so a morph fills every column at once, and its points are stratified up its height
  // so even the shortest column (a dozen documents) reads as a solid stub, not a few specks.
  const colOf = new Int8Array(N).fill(-1);
  const colH = new Float32Array(N);
  {
    const members: number[] = [];
    for (let i = 0; i < N; i++) if (!stray(i)) members.push(i);
    members.sort((a, b) => fixed[3][a * 4] - fixed[3][b * 4] || a - b);
    const total = COL_SHARE.reduce((s, v) => s + v, 0);
    const exact = COL_SHARE.map((v) => (v / total) * members.length);
    const quota = exact.map(Math.floor);
    const left = members.length - quota.reduce((s, v) => s + v, 0);
    const byRemainder = quota.map((_, c) => c).sort((a, b) => exact[b] - quota[b] - (exact[a] - quota[a]));
    for (let j = 0; j < left; j++) quota[byRemainder[j]]++;
    let k = 0;
    for (let c = 0; c < COLS; c++) {
      const col = members.slice(k, k + quota[c]).sort((a, b) => fixed[3][a * 4 + 3] - fixed[3][b * 4 + 3] || a - b);
      k += quota[c];
      col.forEach((i, j) => {
        colOf[i] = c;
        colH[i] = (j + fixed[1][i * 4]) / col.length;
      });
    }
  }

  // The archive columns in the world (rebuilt with the targets): each one's foot and top, for
  // hit tests and labels.
  const colFeet = Array.from({ length: COLS }, () => new Vector3());
  const colTops = Array.from({ length: COLS }, () => new Vector3());
  // Highlight: each column's amount now and where it is heading, and the dim on the others.
  const colHi = { target: -1, amt: new Float32Array(COLS), dim: 0 };

  // Target B's frame in the world (rebuilt with the targets): the figure's base centre (the yaw
  // axis at the crop line) and its axes scaled to its height (x right, y up, z toward the hero
  // camera). The shader turns the figure in its own units and maps it out through this frame.
  const figFrame = { origin: new Vector3(), basis: new Matrix3(), height: 1 };
  const turn = { yaw: 0, pitch: 0 };
  // An even sample of the figure, for figureBox.
  const boxIdx = Array.from({ length: Math.min(BOX_SAMPLES, F) }, (_, j) => Math.floor((j * F) / Math.min(BOX_SAMPLES, F)));

  const uniforms = {
    uFrom: { value: 1 },
    uTo: { value: 1 },
    uT: { value: 1 },
    uMotion: { value: motion ? 1 : 0 },
    uTime: { value: 12 },
    uDelaySrc: { value: 0 },
    uDelayFlip: { value: 0 },
    uScale: { value: 1000 },
    uPixelRatio: { value: world.renderer.getPixelRatio() },
    uGain: { value: 1 },
    uWarm: { value: new Color(COLORS.warm) },
    uCool: { value: new Color(COLORS.cool) },
    uFlowEye: { value: new Vector3() },
    uFlowFwd: { value: new Vector3(0, 0, -1) },
    uFlowDir: { value: new Vector3(1, 0, 0) },
    uFlowLenK: { value: 1 },
    uFlowScreen: { value: new Vector2(1, 1) },
    uFlowAmp: { value: new Vector3(0.05, 0.02, 0.05) },
    uFlowSpeed: { value: 1 / 60 },
    uWaterY: { value: lm.waterY },
    uColBase: { value: 0 },
    uColHeight: { value: 1 },
    uRise: { value: 1 / 28 },
    uStray: { value: STRAYS },
    uLightR: { value: 100 },
    uFigOrigin: { value: figFrame.origin },
    uFigBasis: { value: figFrame.basis },
    uFigYaw: { value: 0 },
    uFigPitch: { value: 0 },
    uFigYChin: { value: fig.meta.yChin },
    uFigYNeckBase: { value: fig.meta.yNeckBase },
    uFigTorsoRatio: { value: fig.meta.torsoYawRatio },
    uFigDot: { value: 1.5 },
    uFigGain: { value: FIGURE_GAIN },
    uFigCore: { value: FIGURE_CORE },
    uScan: { value: 0 },
    uCarry: { value: (world.tier.tier === 'phone' ? CARRY_WINDOW.phone : CARRY_WINDOW.desktop) / Math.max(1, N / used) },
    uCarryMix: { value: (world.tier.tier === 'phone' ? CARRY_MIX.phone : CARRY_MIX.desktop).slice() },
    uColAmt: { value: new Float32Array(COLS) },
    uColDim: { value: 0 },
  };

  function setTurn(yaw: number, pitch: number) {
    turn.yaw = yaw;
    turn.pitch = pitch;
    uniforms.uFigYaw.value = yaw;
    uniforms.uFigPitch.value = pitch;
  }

  const info: SignalInfo = { windows: used, liftRank: rMax, pointsPerWindow: N / used, figurePoints: F, phone: false, scale: 1 };

  let infoAttr: BufferAttribute | null = null;

  function build() {
    const W = world.renderer.domElement.clientWidth || window.innerWidth;
    const H = world.renderer.domElement.clientHeight || window.innerHeight;
    const aspect = W / Math.max(1, H);
    const phone = usePhoneLayout(W, H);
    info.phone = phone;
    const keys = world.cameraKeys;
    const hero = frameOf(world.getCameraPose(keys.hero), aspect);
    const question = frameOf(world.getCameraPose(keys.question), aspect);
    const experience = frameOf(world.getCameraPose(keys.experience), aspect);
    const since = frameOf(world.getCameraPose(keys.since), aspect);
    const people = frameOf(world.getCameraPose(keys.people), aspect);
    const contact = frameOf(world.getCameraPose(keys.contact), aspect);
    const cluster = lm.centralCluster;

    // The scene's length scale: how far the hero camera looks to reach Central.
    const S = Math.max(depthOf(hero, cluster), 1);
    info.scale = S;
    uniforms.uScale.value = S;
    uniforms.uWaterY.value = lm.waterY;

    // ---- A: on the windows, nudged toward the camera so they never fight the facade.
    {
      const t = T[0];
      for (let i = 0; i < N; i++) {
        const j = winOf[i];
        _v.set(wPos[j * 3], wPos[j * 3 + 1], wPos[j * 3 + 2]);
        const d = new Vector3().subVectors(hero.pos, _v).normalize().multiplyScalar(S * 0.0004);
        t[i * 4] = _v.x + d.x;
        t[i * 4 + 1] = _v.y + d.y;
        t[i * 4 + 2] = _v.z + d.z;
        t[i * 4 + 3] = 0;
      }
    }

    // ---- B: the figure at FIGURE_ANCHOR through the hero pose, facing the camera, at its true
    // depth, never under FIGURE_MIN_PX tall on desktop. Only its frame is set here; the shader
    // places each point from its own attributes. tB holds the unturned positions (for reference).
    {
      const anchor = phone ? FIGURE_ANCHOR.phone : FIGURE_ANCHOR.desktop;
      const D = S;
      const heightPx = phone ? anchor.height * H : Math.max(anchor.height * H, FIGURE_MIN_PX);
      const center = unproject(hero, anchor.x, anchor.y, D);
      const height = (heightPx / H) * 2 * D * hero.tanHalf;
      const z = new Vector3().subVectors(hero.pos, center).normalize();
      const x = new Vector3().crossVectors(hero.up, z).normalize();
      const y = new Vector3().crossVectors(z, x);
      // The anchor is the figure's centre; its base (y = 0) sits half a height below.
      figFrame.origin.copy(center).addScaledVector(y, -0.5 * height);
      figFrame.basis.set(x.x * height, y.x * height, z.x * height, x.y * height, y.y * height, z.y * height, x.z * height, y.z * height, z.z * height);
      figFrame.height = height;
      uniforms.uFigDot.value = FIGURE_DOT * fig.ringStep * heightPx;
      const t = T[1];
      const o = figFrame.origin;
      for (let i = 0; i < N; i++) {
        const fx = aFigPos[i * 3];
        const fy = aFigPos[i * 3 + 1];
        const fz = aFigPos[i * 3 + 2];
        t[i * 4] = o.x + (x.x * fx + y.x * fy + z.x * fz) * height;
        t[i * 4 + 1] = o.y + (x.y * fx + y.y * fy + z.y * fz) * height;
        t[i * 4 + 2] = o.z + (x.z * fx + y.z * fy + z.z * fz) * height;
        t[i * 4 + 3] = i < F ? 1 : 0;
      }
    }

    // ---- C: a current low over the water across the lower part of the question view. Each point
    // sits where its screen row meets the water, so the band reads as lying on the harbour.
    {
      const q = question;
      uniforms.uFlowEye.value.copy(q.pos);
      uniforms.uFlowFwd.value.copy(q.fwd);
      uniforms.uFlowDir.value.copy(horizontal(q.right));
      // Lengths per unit of depth, so the band looks the same on any screen: it runs a little past
      // both edges, and meanders by a few percent of the view.
      const halfW = q.aspect * q.tanHalf;
      const halfH = q.tanHalf;
      uniforms.uFlowLenK.value = 2 * halfW * 1.35;
      uniforms.uFlowScreen.value.set(1 / halfW, 1 / halfH);
      uniforms.uFlowAmp.value.set(0.08 * halfW, 0.035 * halfH, 0.1 * halfH);
      const r = fixed[2];
      const t = T[2];
      const ray = new Vector3();
      for (let i = 0; i < N; i++) {
        // Six strands that meander together, plus a quarter of the points as a soft haze around them.
        const g = Math.sqrt(-2 * Math.log(Math.max(1e-6, r[i * 4 + 1]))) * Math.cos(2 * Math.PI * r[i * 4 + 2]);
        const strand = Math.floor(r[i * 4] * 8);
        const sy = clamp(strand < 6 ? CURRENT_ROW + (strand - 2.5) * 0.02 + g * 0.0045 : CURRENT_ROW + g * 0.035, 0.55, 0.98);
        unproject(q, 0.5, sy, 1, ray).sub(q.pos);
        let depth = S * 0.3;
        if (ray.y < -1e-5) depth = Math.min((lm.waterY - q.pos.y) / ray.y, S * 0.5);
        const p = unproject(q, 0.5, sy, depth, _v);
        const lift = depth * (0.004 + 0.006 * r[i * 4 + 2]);
        t[i * 4] = p.x;
        t[i * 4 + 1] = Math.max(p.y, lm.waterY) + lift;
        t[i * 4 + 2] = p.z;
        t[i * 4 + 3] = r[i * 4 + 3]; // phase along the flow
      }
    }

    // ---- D: twelve columns of light above the Central cluster, seen from the experience pose: an
    // honest bar chart of the archive. Column c (ARCHIVE order, left to right) is count / largest
    // count of the full height, its points are spread evenly up it, and every column has the same
    // density and brightness, so only the data tells them apart.
    {
      const s = experience;
      const Dd = Math.max(depthOf(s, cluster), S * 0.2);
      const viewH = 2 * s.tanHalf * Dd;
      const viewW = viewH * s.aspect;
      const rowW = (phone ? 0.78 : 0.4) * viewW;
      const spacing = rowW / (COLS - 1);
      // The columns stand on one baseline just above the tallest roof (centralCluster.y), so no
      // tower hides the foot of a column and every bar is seen at its full length.
      const base = cluster.y + viewH * COL_FOOT;
      const sxCluster = clamp(0.5 + (_v.subVectors(cluster, s.pos).dot(s.right) / (Dd * s.tanHalf * s.aspect)) * 0.5, 0.25, 0.75);
      const topY = unproject(s, sxCluster, COL_TOP_ROW, Dd).y;
      const height = Math.max(topY - base, viewH * 0.2);
      uniforms.uColBase.value = base;
      uniforms.uColHeight.value = height;
      const row = horizontal(s.right);
      const depth = horizontal(s.fwd);
      for (let c = 0; c < COLS; c++) {
        const ox = (c - (COLS - 1) / 2) * spacing;
        colFeet[c].set(cluster.x + row.x * ox, base, cluster.z + row.z * ox);
        colTops[c].set(cluster.x + row.x * ox, base + COL_SHARE[c] * height, cluster.z + row.z * ox);
      }
      const r = fixed[3];
      const t = T[3];
      for (let i = 0; i < N; i++) {
        const c = colOf[i];
        if (c < 0) {
          const ox = (r[i * 4] - 0.5) * rowW * 1.3;
          const oz = (r[i * 4 + 1] - 0.5) * spacing * 4;
          t[i * 4] = cluster.x + row.x * ox + depth.x * oz;
          t[i * 4 + 1] = base + (0.1 + 0.6 * r[i * 4 + 2]) * height;
          t[i * 4 + 2] = cluster.z + row.z * ox + depth.z * oz;
          t[i * 4 + 3] = 0.45 + 0.5 * r[i * 4 + 3];
          aInfo[i * 4 + 2] = 1;
          aInfo[i * 4 + 3] = 0;
          continue;
        }
        const a = r[i * 4 + 1] * Math.PI * 2;
        const rad = spacing * 0.085 * Math.sqrt(-2 * Math.log(Math.max(1e-6, r[i * 4 + 2])));
        const ox = (c - (COLS - 1) / 2) * spacing + Math.cos(a) * rad;
        const oz = Math.sin(a) * rad;
        t[i * 4] = cluster.x + row.x * ox + depth.x * oz;
        t[i * 4 + 1] = base + colH[i] * COL_SHARE[c] * height;
        t[i * 4 + 2] = cluster.z + row.z * ox + depth.z * oz;
        t[i * 4 + 3] = 0.9 * (0.4 + 0.35 * fixed[0][i * 4]);
        aInfo[i * 4 + 2] = COL_SHARE[c];
        aInfo[i * 4 + 3] = c + 1; // the column, 1 to 12 (0: a stray)
      }
    }

    // Depth of the sky pictures: the same distance as the figure.
    const skyDepth = (f: Frame) => Math.max(depthOf(f, cluster), S * 0.6);

    // ---- E: two lights at LIGHT_ANCHORS through the contact pose. Pomfret takes the points whose
    // field position is on the left, Hong Kong the right. 30% of the points are lit here: every
    // lit point of the field and some of its dark ones, which brighten as they gather; the rest
    // fade out, because thousands of points stacked on one spot add nothing a saturated core
    // doesn't show and cost a lot of blending.
    {
      const c = contact;
      const De = skyDepth(c);
      const viewH = 2 * c.tanHalf * De;
      const R = Math.min(0.075 * viewH, 0.12 * viewH * c.aspect);
      uniforms.uLightR.value = R;
      const pomfret = unproject(c, LIGHT_ANCHORS.pomfret.x, LIGHT_ANCHORS.pomfret.y, De);
      const hongKong = unproject(c, LIGHT_ANCHORS.hongKong.x, LIGHT_ANCHORS.hongKong.y, De);
      // The arc between them (11b.7): up and over through the sky, its middle a sixth of the view
      // higher, a few pixels wide, fading out inside each light.
      arc.place(pomfret, hongKong, c.up, ARC_RISE * viewH, (ARC_HALF_WIDTH * viewH) / Math.max(1, H), R * 0.6);
      const r = fixed[4];
      const t = T[4];
      for (let i = 0; i < N; i++) {
        const at = fieldX[i] < 0.5 ? pomfret : hongKong;
        const lit = fixed[5][i * 4 + 3] < 0.3;
        const core = r[i * 4] < 0.12;
        const u = r[i * 4 + 1];
        const rr = core ? R * 0.12 * Math.sqrt(u) : R * (0.1 + 0.9 * Math.pow(u, 1.6));
        // Direction on a sphere, flattened along the view.
        const zc = r[i * 4 + 2] * 2 - 1;
        const ph = r[i * 4 + 3] * Math.PI * 2;
        const sr = Math.sqrt(1 - zc * zc);
        const dx = sr * Math.cos(ph) * rr;
        const dy = sr * Math.sin(ph) * rr;
        const dz = zc * rr * 0.5;
        t[i * 4] = at.x + c.right.x * dx + c.up.x * dy + c.fwd.x * dz;
        t[i * 4 + 1] = at.y + c.right.y * dx + c.up.y * dy + c.fwd.y * dz;
        t[i * 4 + 2] = at.z + c.right.z * dx + c.up.z * dy + c.fwd.z * dz;
        t[i * 4 + 3] = !lit ? 0 : core ? 0.6 : 0.05 + 0.5 * Math.pow(1 - rr / R, 2.2);
      }
    }

    // ---- S: a sparse drifting field among the stars around the since and people poses: per view,
    // about 1.3% of all the points are clear lights (as bright as the sky's bright stars, never
    // the much brighter ones), 4.7% faint ones (like the faintest stars), and the rest are dark,
    // so the field reads as a few more lights among the stars rather than a speckle over them.
    {
      const r = fixed[5];
      const t = T[5];
      // When People holds Since May's view, the whole field is in that one view: half the share
      // lit keeps the same number of lights on screen, spread evenly from top to bottom.
      const oneView = since.fwd.dot(people.fwd) > 0.9995 && since.pos.distanceTo(people.pos) < S * 0.01;
      const clear = FIELD_CLEAR * (oneView ? 0.5 : 1);
      const lit = FIELD_LIT * (oneView ? 0.5 : 1);
      for (let i = 0; i < N; i++) {
        const f = r[i * 4] < 0.5 ? since : people;
        const De = skyDepth(f);
        const depth = De * (0.7 + 0.8 * r[i * 4 + 1]);
        const sy = oneView ? 0.03 + 0.9 * r[i * 4 + 2] : 0.03 + 0.8 * Math.pow(r[i * 4 + 2], 1.25);
        const p = unproject(f, fieldX[i], sy, depth, _v);
        t[i * 4] = p.x;
        t[i * 4 + 1] = p.y;
        t[i * 4 + 2] = p.z;
        const k = r[i * 4 + 3];
        t[i * 4 + 3] = k < clear ? 0.45 + 0.4 * (1 - k / clear) : k < lit ? 0.05 + 0.09 * ((lit - k) / (lit - clear)) : 0;
      }
    }

    for (const a of attrs) a.needsUpdate = true;
    if (infoAttr) infoAttr.needsUpdate = true;
  }

  const arc = createArc({ color: COLORS.warm, motion, requestRender: () => world.requestRender() });
  build();

  const geometry = new BufferGeometry();
  // All six built targets stay on the geometry so they upload once; position and aTo point at the
  // two the current morph uses.
  BUILT.forEach((k, i) => geometry.setAttribute(`t${k}`, attrs[i]));
  geometry.setAttribute('position', attrs[ID.B]);
  geometry.setAttribute('aTo', attrs[ID.B]);
  geometry.setAttribute('aRand', new BufferAttribute(aRand, 4));
  infoAttr = new BufferAttribute(aInfo, 4);
  geometry.setAttribute('aInfo', infoAttr);
  geometry.setAttribute('aFigPos', new BufferAttribute(aFigPos, 3));
  geometry.setAttribute('aFigN', new BufferAttribute(aFigN, 2));
  geometry.setAttribute('aFigViewA', new BufferAttribute(aFigViewA, 4, true));
  geometry.setAttribute('aFigViewB', new BufferAttribute(aFigViewB, 3, true));

  const material = new RawShaderMaterial({
    glslVersion: GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
    transparent: true,
    depthTest: true,
    depthWrite: false,
    blending: AdditiveBlending,
  });

  const points = new Points(geometry, material);
  points.frustumCulled = false;
  points.renderOrder = 10;
  points.name = 'signal';
  world.scene.add(points);
  // Compile the program now so the first frame that shows the signal doesn't stall.
  world.scene.add(arc.mesh);
  arc.mesh.visible = true;
  world.renderer.compile(world.scene, world.camera);
  arc.mesh.visible = false;

  // ---- Morph state ----
  let cur = { from: 'B' as Built, to: 'B' as Built, t: 1 };
  let lastLift = { maxRank: -1, amount: -1 };

  function lift(from: Built, to: Built, t: number) {
    let maxRank = 0;
    let amount = 0;
    const full = rMax + 1e-5;
    if (from === 'A' && to === 'A') {
      // all home
    } else if (from !== 'A' && to !== 'A') {
      maxRank = full;
      amount = LIFT_AMOUNT;
    } else if (!motion) {
      const away = from === 'A' ? t >= 0.5 : t < 0.5;
      if (away) {
        maxRank = full;
        amount = LIFT_AMOUNT;
      }
    } else if (from === 'A' && to === 'B') {
      // Into the figure: windows dim in the scan's order (the highest rank among the particles
      // already on their way).
      const k = after(scanIn.t, t);
      if (k > 0) {
        maxRank = k >= N ? full : scanIn.rank[k - 1];
        amount = LIFT_AMOUNT;
      }
    } else if (to === 'A' && from === 'B') {
      // Back from the figure, chest first: windows stay dim while any of their particles is out.
      const k = after(scanOut.t, t);
      if (k < N) {
        maxRank = scanOut.rank[k] + 1e-5;
        amount = LIFT_AMOUNT;
      }
    } else if (from === 'A') {
      // Leaving: a point with rank key k starts at t = 0.3k; its window dims once it is LIFT_LAG in.
      const k = (t - (1 - DELAY) * LIFT_LAG) / DELAY;
      if (k > 0) {
        maxRank = k >= 1 ? full : rMax * k;
        amount = LIFT_AMOUNT;
      }
    } else {
      // Returning: delays run in reverse rank order, so the windows still waiting are the lowest ranks.
      const k = 1 - (t - (1 - DELAY) * (1 - LIFT_LAG)) / DELAY;
      if (k > 0) {
        maxRank = k >= 1 ? full : rMax * k;
        amount = LIFT_AMOUNT;
      }
    }
    if (maxRank !== lastLift.maxRank || amount !== lastLift.amount) {
      world.setLift(maxRank, amount);
      lastLift = { maxRank, amount };
    }
  }

  function apply() {
    const { from, to, t } = cur;
    const u = uniforms;
    if (u.uFrom.value !== ID[from] || geometry.getAttribute('position') !== attrs[ID[from]]) geometry.setAttribute('position', attrs[ID[from]]);
    if (u.uTo.value !== ID[to] || geometry.getAttribute('aTo') !== attrs[ID[to]]) geometry.setAttribute('aTo', attrs[ID[to]]);
    u.uFrom.value = ID[from];
    u.uTo.value = ID[to];
    u.uT.value = t;
    // Into the figure the rings lock in from the crown down; out of it, chest first.
    u.uScan.value = to === 'B' && from !== 'B' ? 1 : from === 'B' && to !== 'B' ? -1 : 0;
    if (from === 'A' && to !== 'A') {
      u.uDelaySrc.value = 1;
      u.uDelayFlip.value = 0;
    } else if (to === 'A' && from !== 'A') {
      u.uDelaySrc.value = 1;
      u.uDelayFlip.value = 1;
    } else {
      u.uDelaySrc.value = 0;
      u.uDelayFlip.value = ID[from] > ID[to] ? 1 : 0;
    }
    const cut = !motion;
    const home = (from === 'A' && (to === 'A' || (cut ? t < 0.5 : t <= 0))) || (to === 'A' && (cut ? t >= 0.5 : t >= 1));
    points.visible = !home;
    lift(from, to, t);
    // The arc shows with the two lights: fully once they have gathered, fading as they leave.
    let lights = 0;
    if (from === 'E' && to === 'E') lights = 1;
    else if (to === 'E') lights = cut ? (t >= 0.5 ? 1 : 0) : smooth01(clamp((t - 0.6) / 0.4, 0, 1));
    else if (from === 'E') lights = cut ? (t < 0.5 ? 1 : 0) : 1 - smooth01(clamp(t / 0.4, 0, 1));
    arc.setPresence(points.visible ? lights : 0);
  }

  apply();

  // ---- Live motion clock (our own, so pausing motion never makes the flow jump) ----
  let last = performance.now();
  const unsubscribe = world.onFrame(() => {
    const now = performance.now();
    const dt = Math.min(0.1, Math.max(0, (now - last) / 1000));
    last = now;
    if (motion) uniforms.uTime.value += dt;
    uniforms.uPixelRatio.value = world.renderer.getPixelRatio();
    if (motion) {
      easeColumns(dt);
      arc.tick(dt);
    }
  });

  // ---- Rebuild the view-dependent targets when the viewport changes shape ----
  // The world solves its hero framing from the aspect on every resize, so any size change moves
  // the screen-anchored targets.
  let lastShape = `${window.innerWidth}x${window.innerHeight}`;
  let resizeTimer = 0;
  const onResize = () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      const shape = `${window.innerWidth}x${window.innerHeight}`;
      if (shape === lastShape) return;
      lastShape = shape;
      build();
      world.requestRender();
    }, 200);
  };
  window.addEventListener('resize', onResize);

  // ---- The figure on screen ----
  // Whether target B is what the points show: held, mostly arrived, or barely left.
  function figureShowing() {
    if (!points.visible) return false;
    const { from, to, t } = cur;
    const cut = !motion;
    if (from === 'B' && to === 'B') return true;
    if (to === 'B') return cut ? t >= 0.5 : t >= 0.6;
    if (from === 'B') return cut ? t < 0.5 : t <= 0.4;
    return false;
  }
  const _p = new Vector3();

  // ---- The archive as data (11b.3) ----
  // Whether the columns are what the points show: held, mostly arrived, or barely left.
  function columnsShowing() {
    if (!points.visible) return false;
    const { from, to, t } = cur;
    const cut = !motion;
    if (from === 'D' && to === 'D') return true;
    if (to === 'D') return cut ? t >= 0.5 : t >= 0.6;
    if (from === 'D') return cut ? t < 0.5 : t <= 0.4;
    return false;
  }
  // Each column's highlight moves toward 1 (lit) or 0 at a steady rate, and the dim on the rest
  // follows whether any column is lit.
  function easeColumns(dt: number) {
    const step = dt / COL_EASE;
    let changed = false;
    for (let c = 0; c < COLS; c++) {
      const goal = c === colHi.target ? 1 : 0;
      const a = colHi.amt[c];
      const next = goal > a ? Math.min(goal, a + step) : Math.max(goal, a - step);
      if (next !== a) {
        colHi.amt[c] = next;
        changed = true;
      }
    }
    const goalDim = colHi.target >= 0 ? 1 : 0;
    const dim = goalDim > colHi.dim ? Math.min(goalDim, colHi.dim + step) : Math.max(goalDim, colHi.dim - step);
    if (dim !== colHi.dim) {
      colHi.dim = dim;
      changed = true;
    }
    if (changed) {
      const u = uniforms.uColAmt.value;
      for (let c = 0; c < COLS; c++) u[c] = smooth01(colHi.amt[c]);
      uniforms.uColDim.value = smooth01(colHi.dim);
    }
  }
  // A world point on screen in CSS px (and whether it is in front of the camera).
  function toScreen(v: Vector3, out: { x: number; y: number; ok: boolean }) {
    _p.copy(v).project(world.camera);
    out.x = ((_p.x + 1) / 2) * window.innerWidth;
    out.y = ((1 - _p.y) / 2) * window.innerHeight;
    out.ok = _p.z < 1;
    return out;
  }
  const _foot = { x: 0, y: 0, ok: false };
  const _top = { x: 0, y: 0, ok: false };

  let disposed = false;
  return {
    count: N,
    info,
    points,
    rebuild() {
      build();
    },
    setFigureTurn(yaw: number, pitch: number) {
      if (disposed) return;
      const y = clamp(Number.isFinite(yaw) ? yaw : 0, -MAX_YAW, MAX_YAW);
      const p = clamp(Number.isFinite(pitch) ? pitch : 0, -MAX_PITCH, MAX_PITCH);
      if (y === turn.yaw && p === turn.pitch) return;
      // No requestRender here: interact.ts calls this from inside the world's frame callback, where
      // a render request would start a second frame loop. With motion off it redraws itself.
      setTurn(y, p);
    },
    figureBox(): ScreenBox | null {
      if (disposed || !figureShowing()) return null;
      const cam = world.camera;
      const e = figFrame.basis.elements; // column major
      const o = figFrame.origin;
      const { yChin, yNeckBase, torsoYawRatio } = fig.meta;
      const cp = Math.cos(turn.pitch);
      const sp = Math.sin(turn.pitch);
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const k of boxIdx) {
        // As the shader: the head turns fully, the shoulders at torsoYawRatio, the neck between.
        const fx = fig.position[k * 3];
        const fy = fig.position[k * 3 + 1];
        const fz = fig.position[k * 3 + 2];
        const ht = clamp((fy - yNeckBase) / (yChin - yNeckBase), 0, 1);
        const a = turn.yaw * (torsoYawRatio + (1 - torsoYawRatio) * smooth01(ht));
        const c = Math.cos(a);
        const s = Math.sin(a);
        const px = fx * c + fz * s;
        const pz0 = -fx * s + fz * c;
        const py = 0.5 + (fy - 0.5) * cp - pz0 * sp;
        const pz = (fy - 0.5) * sp + pz0 * cp;
        _p.set(o.x + e[0] * px + e[3] * py + e[6] * pz, o.y + e[1] * px + e[4] * py + e[7] * pz, o.z + e[2] * px + e[5] * py + e[8] * pz).project(cam);
        if (_p.z > 1) continue;
        x0 = Math.min(x0, (_p.x + 1) / 2);
        x1 = Math.max(x1, (_p.x + 1) / 2);
        y0 = Math.min(y0, (1 - _p.y) / 2);
        y1 = Math.max(y1, (1 - _p.y) / 2);
      }
      if (!(x1 > 0 && x0 < 1 && y1 > 0 && y0 < 1)) return null;
      return { x0, y0, x1, y1 };
    },
    columnAt(ndc: Ndc) {
      if (disposed || !columnsShowing()) return -1;
      world.camera.updateMatrixWorld();
      const W = window.innerWidth;
      const H = window.innerHeight;
      const x = ((ndc.x + 1) / 2) * W;
      const y = ((1 - ndc.y) / 2) * H;
      // Hit areas: a column's line on screen, widened to half the gap to its neighbours (at least
      // COL_HIT_MIN px wide in all), and a little taller, so even the shortest column is easy to hit.
      toScreen(colFeet[0], _foot);
      toScreen(colFeet[COLS - 1], _top);
      const gap = Math.abs(_top.x - _foot.x) / (COLS - 1);
      const half = Math.max(COL_HIT_MIN / 2, gap * 0.45);
      let best = -1;
      let bestD = Infinity;
      for (let c = 0; c < COLS; c++) {
        toScreen(colFeet[c], _foot);
        toScreen(colTops[c], _top);
        if (!_foot.ok || !_top.ok) continue;
        const y0 = Math.min(_top.y, _foot.y) - COL_HIT_PAD.top;
        const y1 = Math.max(_top.y, _foot.y) + COL_HIT_PAD.foot;
        if (y < y0 || y > y1) continue;
        // The column's x at this height (it leans a little in perspective).
        const f = Math.abs(_foot.y - _top.y) > 1e-3 ? clamp((y - _top.y) / (_foot.y - _top.y), 0, 1) : 0;
        const d = Math.abs(x - (_top.x + (_foot.x - _top.x) * f));
        if (d <= half && d < bestD) {
          bestD = d;
          best = c;
        }
      }
      return best;
    },
    setColumnHighlight(i: number) {
      if (disposed) return;
      const target = Number.isInteger(i) && i >= 0 && i < COLS ? i : -1;
      if (target === colHi.target) return;
      colHi.target = target;
      if (!motion) {
        // Motion off: an instant change, drawn at once (this is called from input handlers).
        easeColumns(COL_EASE);
        world.requestRender();
      }
    },
    columnTop(i: number) {
      if (disposed || !columnsShowing() || !(i >= 0 && i < COLS)) return null;
      world.camera.updateMatrixWorld();
      toScreen(colTops[i], _top);
      if (!_top.ok) return null;
      return { x: _top.x / window.innerWidth, y: _top.y / window.innerHeight };
    },
    sendArc() {
      if (disposed) return;
      arc.send();
    },
    setMorph(from: Target | 'F', to: Target | 'F', t: number) {
      if (disposed) return;
      cur = { from: built(from), to: built(to), t: clamp(Number.isFinite(t) ? t : 0, 0, 1) };
      apply();
    },
    setMotion(enabled: boolean) {
      motion = enabled;
      uniforms.uMotion.value = enabled ? 1 : 0;
      arc.setMotion(enabled);
      last = performance.now();
      lastLift = { maxRank: -1, amount: -1 };
      apply();
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      window.removeEventListener('resize', onResize);
      window.clearTimeout(resizeTimer);
      world.scene.remove(points);
      world.scene.remove(arc.mesh);
      arc.dispose();
      geometry.dispose();
      material.dispose();
      world.setLift(0, 0);
    },
  };
}
