// random.ts: seeded randomness and small noise helpers for building the world.
// Everything procedural goes through these, so the city is the same on every visit.

export type Rng = () => number;

/** mulberry32: a small fast seeded generator, uniform in [0, 1). */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const clamp = (x: number, a: number, b: number) => (x < a ? a : x > b ? b : x);
export const smoothstep = (a: number, b: number, x: number) => {
  const t = clamp((x - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const between = (r: Rng, a: number, b: number) => a + (b - a) * r();

/** Pick an index from weights. */
export function pick(r: Rng, weights: number[]): number {
  let sum = 0;
  for (const w of weights) sum += w;
  let x = r() * sum;
  for (let i = 0; i < weights.length; i++) {
    x -= weights[i];
    if (x <= 0) return i;
  }
  return weights.length - 1;
}

/** Integer hash to [0, 1), for value noise. */
function hash1(i: number, seed: number): number {
  let x = (Math.imul(i | 0, 0x27d4eb2d) ^ seed) >>> 0;
  x ^= x >>> 15;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return (x >>> 8) / 16777216;
}

/** Smooth 1D value noise in [0, 1). */
export function noise1(x: number, seed: number): number {
  const i = Math.floor(x);
  const f = x - i;
  const u = f * f * (3 - 2 * f);
  return lerp(hash1(i, seed), hash1(i + 1, seed), u);
}

/** 1D fractal noise in roughly [0, 1). */
export function fbm1(x: number, seed: number, octaves = 4): number {
  let sum = 0;
  let amp = 0.5;
  let norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise1(x, seed + o * 1013);
    norm += amp;
    x *= 2.03;
    amp *= 0.5;
  }
  return sum / norm;
}

/** A display (sRGB) color as three 0..1 numbers. The world's shaders work in display values. */
export function srgb(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}
