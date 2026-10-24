// windows.ts: the window rule, written once, shared by the skyline shader and the signal.
//
// A window cell is named by four integers: the tower's 24-bit seed, faceSeg (face + 8 * segment),
// the tower-wide floor index, and the column on that face. Everything about the window (lit or
// not, warm or cool, brightness, lift rank, rare flicker) comes from integer hashes of those, so
// the TypeScript below and the GLSL chunk WINDOW_GLSL give the same answer bit for bit.
// verifyWindowRule() renders the GLSL for 10,000 cells and compares them with this file.
//
// Faces: 0 front (+z, toward the camera), 1 right (+x), 2 back (-z), 3 left (-x).

import {
  Camera,
  Mesh,
  NearestFilter,
  PlaneGeometry,
  RGBAFormat,
  Scene,
  ShaderMaterial,
  UnsignedByteType,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three';
import type { CityLayout, Segment, Tower } from './city';
import { SEG_WINDOWS } from './city';
import { mulberry32 } from './random';

// ---- The rule (TypeScript) ------------------------------------------------------------------

/** lowbias32 integer hash. Matches nsHash in WINDOW_GLSL exactly (Math.imul wraps like uint). */
export function hashU32(x: number): number {
  x >>>= 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;
  return x >>> 0;
}

export function windowHash(seed: number, faceSeg: number, floor: number, col: number): number {
  return hashU32(seed ^ hashU32(faceSeg ^ hashU32(floor ^ hashU32(col ^ 0x9e3779b9))));
}

/**
 * The floor's lit threshold out of 256: 0 for a dark floor, 256 for a fully lit office floor.
 * In half the towers (odd seeds) floors share their class in pairs, so dark and lit bands are
 * two floors tall and read from across the harbour.
 */
export function floorThreshold(seed: number, floor: number, L: number): number {
  const fk = seed & 1 ? floor >>> 1 : floor;
  const fh = hashU32(seed ^ hashU32(fk ^ 0x51ed270b));
  const cls = fh >>> 24;
  if (cls < 46) return 0; // about 18% of floors fully dark
  if (cls >= 240) return 256; // about 6% fully lit
  const t = L + ((hashU32(fh ^ floor) >>> 16) & 63) - 32;
  return t < 0 ? 0 : t > 256 ? 256 : t;
}

export const isLit = (wh: number, T: number) => wh >>> 24 < T;
export const isWarm = (wh: number, T: number) => ((wh >>> 8) & 255) < (T >= 256 ? 90 : 205);
export const brightness = (wh: number) => 0.72 + (0.4 * ((wh >>> 16) & 255)) / 255;
/** Lift rank in [0, 1): a second hash. Exactly k / 2^24, so float32 and float64 agree. */
export const liftRank = (wh: number) => (hashU32(wh ^ 0x68e31da4) >>> 8) / 16777216;
/** About 1 in 2,000 windows flicker. */
export const flickers = (wh: number) => hashU32(wh ^ 0x2c1b3c6d) >>> 8 < 8389;

// ---- The rule (GLSL) ------------------------------------------------------------------------

export const WINDOW_GLSL = /* glsl */ `
uint nsHash(uint x) {
  x ^= x >> 16u; x *= 0x7feb352du; x ^= x >> 15u; x *= 0x846ca68bu; x ^= x >> 16u;
  return x;
}
uint nsWindowHash(uint seed, uint faceSeg, uint fl, uint col) {
  return nsHash(seed ^ nsHash(faceSeg ^ nsHash(fl ^ nsHash(col ^ 0x9e3779b9u))));
}
int nsFloorThreshold(uint seed, uint fl, int L) {
  uint fk = (seed & 1u) != 0u ? fl >> 1u : fl;
  uint fh = nsHash(seed ^ nsHash(fk ^ 0x51ed270bu));
  uint cls = fh >> 24u;
  if (cls < 46u) return 0;
  if (cls >= 240u) return 256;
  return clamp(L + int((nsHash(fh ^ fl) >> 16u) & 63u) - 32, 0, 256);
}
bool nsLit(uint wh, int T) { return int(wh >> 24u) < T; }
bool nsWarm(uint wh, int T) { return ((wh >> 8u) & 255u) < (T >= 256 ? 90u : 205u); }
float nsBright(uint wh) { return 0.72 + 0.4 * float((wh >> 16u) & 255u) / 255.0; }
float nsRank(uint wh) { return float(nsHash(wh ^ 0x68e31da4u) >> 8u) / 16777216.0; }
bool nsFlickers(uint wh) { return (nsHash(wh ^ 0x2c1b3c6du) >> 8u) < 8389u; }
`;

// ---- Glazing: where the glass sits inside each cell ------------------------------------------
// [side margin, bottom, top] as fractions of the cell. The shader has the same table.
export const GLAZING: [number, number, number][] = [
  [0.19, 0.22, 0.78], // 0 punched
  [0.03, 0.28, 0.76], // 1 ribbon
  [0.12, 0.12, 0.9], // 2 curtain wall
  [0.28, 0.18, 0.84], // 3 narrow
  [0.14, 0.2, 0.82], // 4 square
];

// ---- Walking the front faces ----------------------------------------------------------------

export interface FrontWindow {
  x: number;
  y: number;
  z: number;
  wh: number;
  T: number;
  tower: Tower;
  seg: Segment;
}

/** Every lit window on every front face (base rule, before lift, wake, flicker or highlight). */
export function litFrontWindows(city: CityLayout): FrontWindow[] {
  const out: FrontWindow[] = [];
  for (const t of city.towers) {
    const g = GLAZING[t.glazing];
    const yIn = (g[1] + g[2]) / 2;
    for (const s of t.segs) {
      if (s.kind !== SEG_WINDOWS) continue;
      const faceSeg = 0 + 8 * s.seg;
      const zf = s.z + s.d / 2 + 0.25;
      const x0 = s.x - s.w / 2;
      const cw = s.w / s.colsF;
      for (let f = 0; f < s.winFloors; f++) {
        const floor = s.floorOffset + f;
        const T = floorThreshold(t.seed, floor, s.L);
        if (T === 0) continue;
        const y = s.y0 + (f + yIn) * t.floorH;
        for (let c = 0; c < s.colsF; c++) {
          const wh = windowHash(t.seed, faceSeg, floor, c);
          if (!isLit(wh, T)) continue;
          out.push({ x: x0 + (c + 0.5) * cw, y, z: zf, wh, T, tower: t, seg: s });
        }
      }
    }
  }
  return out;
}

/**
 * Which windows a camera at (cx, cy, cz) can see, testing the ray to the camera against every
 * segment in front of the window. Uses an x-bucket grid so it stays fast (about 10 ms).
 */
export function visibleFrom(city: CityLayout, wins: FrontWindow[], cx: number, cy: number, cz: number): Uint8Array {
  const segs: { s: Segment; t: Tower }[] = [];
  for (const t of city.towers) for (const s of t.segs) segs.push({ s, t });
  const B = 40;
  const x0 = city.xMin - 400;
  const nb = Math.ceil((city.width + 800) / B);
  const buckets: number[][] = Array.from({ length: nb }, () => []);
  segs.forEach(({ s }, i) => {
    const a = Math.max(0, Math.floor((s.x - s.w / 2 - x0) / B));
    const b = Math.min(nb - 1, Math.floor((s.x + s.w / 2 - x0) / B));
    for (let k = a; k <= b; k++) buckets[k].push(i);
  });
  const vis = new Uint8Array(wins.length);
  const stamp = new Int32Array(segs.length).fill(-1);
  for (let wi = 0; wi < wins.length; wi++) {
    const w = wins[wi];
    const dx = cx - w.x;
    const dy = cy - w.y;
    const dz = cz - w.z;
    // The ray leaves the city at z = zFront; collect buckets along its x span until then.
    const tExit = Math.min(1, (city.zFront + 2 - w.z) / dz);
    const xa = w.x;
    const xb = w.x + dx * tExit;
    const ka = Math.max(0, Math.floor((Math.min(xa, xb) - x0) / B));
    const kb = Math.min(nb - 1, Math.floor((Math.max(xa, xb) - x0) / B));
    let hidden = false;
    for (let k = ka; k <= kb && !hidden; k++) {
      for (const si of buckets[k]) {
        if (stamp[si] === wi) continue;
        stamp[si] = wi;
        const s = segs[si].s;
        if (s === w.seg) continue;
        const bz0 = s.z - s.d / 2;
        const bz1 = s.z + s.d / 2;
        if (bz1 <= w.z) continue; // not in front
        // slab test on the ray w + t * (dx, dy, dz), t in (0, 1]
        let t0 = 1e-4;
        let t1 = 1;
        const slab = (o: number, d: number, lo: number, hi: number) => {
          if (Math.abs(d) < 1e-9) return o >= lo && o <= hi;
          let ta = (lo - o) / d;
          let tb = (hi - o) / d;
          if (ta > tb) [ta, tb] = [tb, ta];
          t0 = Math.max(t0, ta);
          t1 = Math.min(t1, tb);
          return t0 <= t1;
        };
        if (slab(w.x, dx, s.x - s.w / 2, s.x + s.w / 2) && slab(w.z, dz, bz0, bz1) && slab(w.y, dy, s.y0, s.y0 + s.h)) {
          hidden = true;
          break;
        }
      }
    }
    vis[wi] = hidden ? 0 : 1;
  }
  return vis;
}

export interface SampleResult {
  count: number;
  positions: Float32Array;
  rank: Float32Array;
  across: Float32Array;
  warm: Float32Array;
}

/**
 * Lit front-face windows with rank below maxRank, visible from the given camera, in a fixed
 * shuffled order, up to count.
 */
export function sampleWindows(
  city: CityLayout,
  wins: FrontWindow[],
  vis: Uint8Array,
  count: number,
  maxRank: number,
): SampleResult {
  const mr = Math.fround(maxRank);
  const idx: number[] = [];
  for (let i = 0; i < wins.length; i++) if (vis[i] && liftRank(wins[i].wh) < mr) idx.push(i);
  // Fixed shuffle so every visit and every call picks the same windows.
  const r = mulberry32(0x51c4a1 ^ city.seed);
  for (let i = idx.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    const tmp = idx[i];
    idx[i] = idx[j];
    idx[j] = tmp;
  }
  const n = Math.min(count, idx.length);
  const positions = new Float32Array(n * 3);
  const rank = new Float32Array(n);
  const across = new Float32Array(n);
  const warm = new Float32Array(n);
  for (let k = 0; k < n; k++) {
    const w = wins[idx[k]];
    positions[k * 3] = w.x;
    positions[k * 3 + 1] = w.y;
    positions[k * 3 + 2] = w.z;
    rank[k] = liftRank(w.wh);
    across[k] = (w.x - city.xMin) / city.width;
    warm[k] = isWarm(w.wh, w.T) ? 1 : 0;
  }
  return { count: n, positions, rank, across, warm };
}

// ---- Proof that the two rules agree ---------------------------------------------------------

/** Inputs for test cell i, computed the same way in TS and GLSL. */
function testInputs(i: number) {
  const a = hashU32(Math.imul(i, 2654435761 | 0));
  return {
    seed: a >>> 8,
    L: (a >>> 3) % 256,
    faceSeg: (a & 3) + 8 * ((a >>> 2) % 3),
    floor: (a >>> 11) % 140,
    col: (a >>> 19) % 31,
  };
}

/**
 * Render the GLSL rule for 10,000 cells into a 100 x 100 target, read it back, and compare every
 * cell with the TypeScript rule. Returns the number of mismatches (0 means they agree).
 */
export function verifyWindowRule(renderer: WebGLRenderer, n = 100): { cells: number; mismatches: number; litShare: number } {
  const rt = new WebGLRenderTarget(n, n, { type: UnsignedByteType, format: RGBAFormat, minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false });
  const mat = new ShaderMaterial({
    vertexShader: 'void main() { gl_Position = vec4(position.xy * 2.0, 0.0, 1.0); }',
    fragmentShader: `
      ${WINDOW_GLSL}
      void main() {
        uint i = uint(gl_FragCoord.y) * ${n}u + uint(gl_FragCoord.x);
        uint a = nsHash(i * 2654435761u);
        uint seed = a >> 8u;
        int L = int((a >> 3u) % 256u);
        uint faceSeg = (a & 3u) + 8u * ((a >> 2u) % 3u);
        uint fl = (a >> 11u) % 140u;
        uint col = (a >> 19u) % 31u;
        uint wh = nsWindowHash(seed, faceSeg, fl, col);
        int T = nsFloorThreshold(seed, fl, L);
        uint bits = (nsLit(wh, T) ? 1u : 0u) | (nsWarm(wh, T) ? 2u : 0u) | (nsFlickers(wh) ? 4u : 0u) | (T == 0 ? 8u : 0u) | (T == 256 ? 16u : 0u);
        uint rk = uint(nsRank(wh) * 16777216.0);
        gl_FragColor = vec4(float(bits), float((rk >> 16u) & 255u), float((rk >> 8u) & 255u), float(rk & 255u)) / 255.0;
      }`,
  });
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(1, 1), mat));
  const cam = new Camera();
  const prev = renderer.getRenderTarget();
  renderer.setRenderTarget(rt);
  renderer.render(scene, cam);
  const px = new Uint8Array(n * n * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, n, n, px);
  renderer.setRenderTarget(prev);
  let mismatches = 0;
  let lit = 0;
  for (let i = 0; i < n * n; i++) {
    const { seed, L, faceSeg, floor, col } = testInputs(i);
    const wh = windowHash(seed, faceSeg, floor, col);
    const T = floorThreshold(seed, floor, L);
    const bits = (isLit(wh, T) ? 1 : 0) | (isWarm(wh, T) ? 2 : 0) | (flickers(wh) ? 4 : 0) | (T === 0 ? 8 : 0) | (T === 256 ? 16 : 0);
    const rk = Math.round(liftRank(wh) * 16777216);
    if (bits & 1) lit++;
    const o = i * 4;
    if (px[o] !== bits || px[o + 1] !== ((rk >>> 16) & 255) || px[o + 2] !== ((rk >>> 8) & 255) || px[o + 3] !== (rk & 255)) mismatches++;
  }
  rt.dispose();
  mat.dispose();
  return { cells: n * n, mismatches, litShare: lit / (n * n) };
}
