// signal.ts: the particle system that moves between the city and the pictures (NIGHT-SIGNAL.md
// section 5). Owned by the Signal agent.
//
// One THREE.Points, one draw call. Every point has a base position in each of the six targets
// (A city, B figure, C current, D archive, E two lights, F field), built once on the CPU here and
// again only when the viewport changes shape. The vertex shader does everything per frame: each
// target's live motion (the current flows, the columns rise, the field drifts), and the morph
// between two targets with a per-point delay of up to 30%, a curved path and curl noise that
// peaks mid-flight. No per-frame loops over points on the CPU.
//
// Window dimming: the points sit on lit windows in A, taken from the lowest lift ranks first, so
// when they leave, setLift(maxRank, amount) dims exactly the windows they came from, in the same
// order they leave, and relights them as they land. Points leave A in rank order and land in the
// figure in its arrival order (outline first, hair strands from the part to the tips, face last).
//
// The figure comes from public/world/figure-signal.bin ("CASG", tools/figure/lib/signal-format.mjs):
// 8 bytes a point, and the first N points are an even sample, so each tier reads only a prefix.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Color, GLSL3, Points, RawShaderMaterial, Vector2, Vector3 } from 'three';
import type { CameraPose, LitWindowSamples, Signal, SignalOptions, Target, World } from './contract';
import { FIGURE_ANCHOR, LIGHT_ANCHORS, PHONE_MAX_WIDTH } from './contract';
import fragmentShader from './shaders/signal.frag.glsl?raw';
import vertexShader from './shaders/signal.vert.glsl?raw';

const TARGETS: Target[] = ['A', 'B', 'C', 'D', 'E', 'F'];
const ID: Record<Target, number> = { A: 0, B: 1, C: 2, D: 3, E: 4, F: 5 };

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

/** Figure depth relative to its height (the bust is a relief; full depth reads as a turn off-axis). */
const FIGURE_DEPTH = 0.45;
/** Figure brightness per group: body, skin, hair, contour. */
const FIGURE_GAIN = [0.42, 0.95, 0.5, 0.55];
/** Screen row (from the top) of the current's center in the question view: open water, below the reflections. */
const CURRENT_ROW = 0.8;
/** Share of archive points that drift loose instead of joining a column. */
const STRAYS = 0.04;

const COLORS = { warm: '#FFB65C', cool: '#CFE3FF' };

const CASG_HEADER = 40;
const CASG_STRIDE = 8;

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

interface FigureData {
  count: number;
  pos: Float32Array; // figure heights, origin at the bounding box center
  weight: Float32Array;
  group: Uint8Array;
  order: Float32Array;
}

/** Reads the first `bytes` of a file and stops downloading there (phones need only a prefix). */
async function fetchPrefix(url: string, bytes: number): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`signal: ${url} answered ${res.status}`);
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (total < bytes) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    total += value.byteLength;
  }
  if (total >= bytes) reader.cancel().catch(() => {});
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.byteLength;
  }
  return out;
}

async function loadFigure(url: string, count: number): Promise<FigureData> {
  let fileUrl = url;
  if (/\.json(\?|$)/.test(url)) {
    const manifest = await (await fetch(url)).json();
    fileUrl = new URL(manifest.file, new URL(url, location.href)).href;
  }
  const buf = await fetchPrefix(fileUrl, CASG_HEADER + count * CASG_STRIDE);
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  if (String.fromCharCode(buf[0], buf[1], buf[2], buf[3]) !== 'CASG') throw new Error('signal: figure file is not CASG');
  const header = dv.getUint16(6, true);
  const n = Math.min(dv.getUint32(8, true), count, Math.floor((buf.byteLength - header) / CASG_STRIDE));
  const center = [0, 1, 2].map((d) => (dv.getFloat32(12 + d * 4, true) + dv.getFloat32(24 + d * 4, true)) / 2);
  const half = [0, 1, 2].map((d) => (dv.getFloat32(24 + d * 4, true) - dv.getFloat32(12 + d * 4, true)) / 2);
  const pos = new Float32Array(n * 3);
  const weight = new Float32Array(n);
  const group = new Uint8Array(n);
  const order = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const o = header + k * CASG_STRIDE;
    for (let d = 0; d < 3; d++) pos[k * 3 + d] = center[d] + (dv.getInt16(o + d * 2, true) / 32767) * half[d];
    weight[k] = buf[o + 6] / 255;
    group[k] = buf[o + 7] & 3;
    order[k] = (buf[o + 7] >> 2) / 63;
  }
  return { count: n, pos, weight, group, order };
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
  const figurePromise = loadFigure(opts.figureUrl, N);
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

  const aInfo = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    const j = winOf[i];
    aInfo[i * 4] = wWarm[j] > 0.5 ? 1 : 0;
    aInfo[i * 4 + 1] = rMax > 0 ? clamp(wRank[j] / rMax, 0, 1) : aRand[i * 4];
  }

  // ---- Pair points with figure points: leave in rank order, land in the figure's arrival order.
  // Within each of 24 timing slices, windows on the left feed the left of the figure, so the light
  // mostly rises instead of criss-crossing.
  const F = fig.count;
  const figOf = new Uint32Array(N);
  {
    const figByOrder = Array.from({ length: N }, (_, k) => k % F).sort((a, b) => fig.order[a] - fig.order[b] || a - b);
    const SLICES = 24;
    for (let s = 0; s < SLICES; s++) {
      const a = Math.floor((s * N) / SLICES);
      const b = Math.floor(((s + 1) * N) / SLICES);
      const pts: number[] = [];
      const figs: number[] = [];
      for (let i = a; i < b; i++) {
        pts.push(i);
        figs.push(figByOrder[i]);
      }
      pts.sort((p, q) => wAcross[winOf[p]] - wAcross[winOf[q]] || p - q);
      figs.sort((p, q) => fig.pos[p * 3] - fig.pos[q * 3] || p - q);
      for (let k = 0; k < pts.length; k++) figOf[pts[k]] = figs[k];
    }
  }
  // Points beyond the figure's count reuse its points; nudge them so they do not stack exactly.
  const figJitter = new Float32Array(N * 3);
  if (F < N) for (let i = 0; i < N * 3; i++) figJitter[i] = (rand() - 0.5) * 0.004;

  // Screen x each point ends up at in the field (follows where its window is), shared by F and E.
  const fieldX = new Float32Array(N);
  for (let i = 0; i < N; i++) fieldX[i] = clamp(wAcross[winOf[i]] + gauss() * 0.12, -0.08, 1.08);

  const T = TARGETS.map(() => new Float32Array(N * 4));
  const attrs = T.map((arr) => new BufferAttribute(arr, 4));

  // Fixed randoms per target, so a rebuild on resize lands every point in the same place.
  const fixed = Array.from({ length: 6 }, () => {
    const r = new Float32Array(N * 4);
    for (let i = 0; i < r.length; i++) r[i] = rand();
    return r;
  });

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
  };

  const info: SignalInfo = { windows: used, liftRank: rMax, pointsPerWindow: N / used, figurePoints: F, phone: false, scale: 1 };

  let infoAttr: BufferAttribute | null = null;

  function build() {
    const W = world.renderer.domElement.clientWidth || window.innerWidth;
    const H = world.renderer.domElement.clientHeight || window.innerHeight;
    const aspect = W / Math.max(1, H);
    const phone = window.innerWidth <= PHONE_MAX_WIDTH;
    info.phone = phone;
    const keys = world.cameraKeys;
    const hero = frameOf(world.getCameraPose(keys.hero), aspect);
    const question = frameOf(world.getCameraPose(keys.question), aspect);
    const summer = frameOf(world.getCameraPose(keys.summer), aspect);
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

    // ---- B: the figure at FIGURE_ANCHOR through the hero pose, facing the camera.
    {
      const anchor = phone ? FIGURE_ANCHOR.phone : FIGURE_ANCHOR.desktop;
      const D = S;
      const center = unproject(hero, anchor.x, anchor.y, D);
      const height = anchor.height * 2 * D * hero.tanHalf;
      const z = new Vector3().subVectors(hero.pos, center).normalize();
      const x = new Vector3().crossVectors(hero.up, z).normalize();
      const y = new Vector3().crossVectors(z, x);
      const t = T[1];
      for (let i = 0; i < N; i++) {
        const k = figOf[i];
        const fx = fig.pos[k * 3] + figJitter[i * 3];
        const fy = fig.pos[k * 3 + 1] + figJitter[i * 3 + 1];
        const fz = (fig.pos[k * 3 + 2] + figJitter[i * 3 + 2]) * FIGURE_DEPTH;
        t[i * 4] = center.x + (x.x * fx + y.x * fy + z.x * fz) * height;
        t[i * 4 + 1] = center.y + (x.y * fx + y.y * fy + z.y * fz) * height;
        t[i * 4 + 2] = center.z + (x.z * fx + y.z * fy + z.z * fz) * height;
        const g = fig.group[k];
        const wgt = fig.weight[k];
        t[i * 4 + 3] = FIGURE_GAIN[g] * (g === 0 ? 0.55 + 0.3 * wgt : 0.3 + 0.7 * wgt);
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

    // ---- D: twelve columns of light above the Central cluster, seen from the summer pose.
    {
      const s = summer;
      const Dd = Math.max(depthOf(s, cluster), S * 0.2);
      const viewH = 2 * s.tanHalf * Dd;
      const viewW = viewH * s.aspect;
      const rowW = (phone ? 0.78 : 0.4) * viewW;
      const spacing = rowW / 11;
      // The columns rise out of the cluster's roofs (centralCluster is its tallest roof; the
      // column bottoms fade in).
      const base = cluster.y - viewH * 0.06;
      const sxCluster = clamp(0.5 + (_v.subVectors(cluster, s.pos).dot(s.right) / (Dd * s.tanHalf * s.aspect)) * 0.5, 0.25, 0.75);
      const topY = unproject(s, sxCluster, 0.1, Dd).y;
      const height = Math.max(topY - base, viewH * 0.28);
      uniforms.uColBase.value = base;
      uniforms.uColHeight.value = height;
      const row = horizontal(s.right);
      const depth = horizontal(s.fwd);
      const r = fixed[3];
      const hash = (c: number) => Math.abs(Math.sin(c * 12.9898 + 4.1) * 43758.5453) % 1;
      const colGain = Array.from({ length: 12 }, (_, c) => 0.8 + 0.2 * hash(c));
      const colTop = Array.from({ length: 12 }, (_, c) => 0.72 + 0.28 * hash(c + 31));
      const t = T[3];
      for (let i = 0; i < N; i++) {
        if (stray(i)) {
          const ox = (r[i * 4] - 0.5) * rowW * 1.3;
          const oz = (r[i * 4 + 1] - 0.5) * spacing * 4;
          t[i * 4] = cluster.x + row.x * ox + depth.x * oz;
          t[i * 4 + 1] = base + (0.1 + 0.6 * r[i * 4 + 2]) * height;
          t[i * 4 + 2] = cluster.z + row.z * ox + depth.z * oz;
          t[i * 4 + 3] = 0.45 + 0.5 * r[i * 4 + 3];
          aInfo[i * 4 + 2] = 1;
          continue;
        }
        const c = Math.min(11, Math.floor(r[i * 4] * 12));
        const a = r[i * 4 + 1] * Math.PI * 2;
        const rad = spacing * 0.085 * Math.sqrt(-2 * Math.log(Math.max(1e-6, r[i * 4 + 2])));
        const ox = (c - 5.5) * spacing + Math.cos(a) * rad;
        const oz = Math.sin(a) * rad;
        t[i * 4] = cluster.x + row.x * ox + depth.x * oz;
        t[i * 4 + 1] = base + r[i * 4 + 3] * height;
        t[i * 4 + 2] = cluster.z + row.z * ox + depth.z * oz;
        t[i * 4 + 3] = colGain[c] * (0.4 + 0.35 * fixed[0][i * 4]);
        aInfo[i * 4 + 2] = colTop[c];
      }
    }

    // Depth of the sky pictures: the same distance as the figure.
    const skyDepth = (f: Frame) => Math.max(depthOf(f, cluster), S * 0.6);

    // ---- E: two lights at LIGHT_ANCHORS through the contact pose. Pomfret takes the points whose
    // field position is on the left, Hong Kong the right. Only the brighter part of the field (30%
    // of the points) stays lit here; the rest fade out as they gather, because thousands of points
    // stacked on one spot add nothing a saturated core doesn't show and cost a lot of blending.
    {
      const c = contact;
      const De = skyDepth(c);
      const viewH = 2 * c.tanHalf * De;
      const R = Math.min(0.075 * viewH, 0.12 * viewH * c.aspect);
      uniforms.uLightR.value = R;
      const pomfret = unproject(c, LIGHT_ANCHORS.pomfret.x, LIGHT_ANCHORS.pomfret.y, De);
      const hongKong = unproject(c, LIGHT_ANCHORS.hongKong.x, LIGHT_ANCHORS.hongKong.y, De);
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

    // ---- F: a sparse drifting field among the stars around the since and people poses. Most
    // points are near invisible here; about one in ten is a clear light.
    {
      const r = fixed[5];
      const t = T[5];
      for (let i = 0; i < N; i++) {
        const f = r[i * 4] < 0.5 ? since : people;
        const De = skyDepth(f);
        const depth = De * (0.7 + 0.8 * r[i * 4 + 1]);
        const sy = 0.03 + 0.8 * Math.pow(r[i * 4 + 2], 1.25);
        const p = unproject(f, fieldX[i], sy, depth, _v);
        t[i * 4] = p.x;
        t[i * 4 + 1] = p.y;
        t[i * 4 + 2] = p.z;
        const k = r[i * 4 + 3];
        t[i * 4 + 3] = k < 0.12 ? 1.0 + 12 * (0.12 - k) : k < 0.5 ? 0.22 + 1.2 * (k - 0.12) : 0;
      }
    }

    for (const a of attrs) a.needsUpdate = true;
    if (infoAttr) infoAttr.needsUpdate = true;
  }

  build();

  const geometry = new BufferGeometry();
  // All six targets stay on the geometry so they upload once; position and aTo point at the two
  // the current morph uses.
  TARGETS.forEach((k, i) => geometry.setAttribute(`t${k}`, attrs[i]));
  geometry.setAttribute('position', attrs[ID.B]);
  geometry.setAttribute('aTo', attrs[ID.B]);
  geometry.setAttribute('aRand', new BufferAttribute(aRand, 4));
  infoAttr = new BufferAttribute(aInfo, 4);
  geometry.setAttribute('aInfo', infoAttr);

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
  world.renderer.compile(world.scene, world.camera);

  // ---- Morph state ----
  let cur = { from: 'B' as Target, to: 'B' as Target, t: 1 };
  let lastLift = { maxRank: -1, amount: -1 };

  function lift(from: Target, to: Target, t: number) {
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

  let disposed = false;
  return {
    count: N,
    info,
    points,
    rebuild() {
      build();
    },
    setMorph(from: Target, to: Target, t: number) {
      if (disposed) return;
      cur = { from, to, t: clamp(Number.isFinite(t) ? t : 0, 0, 1) };
      apply();
    },
    setMotion(enabled: boolean) {
      motion = enabled;
      uniforms.uMotion.value = enabled ? 1 : 0;
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
      geometry.dispose();
      material.dispose();
      world.setLift(0, 0);
    },
  };
}
