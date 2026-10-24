// Small math helpers shared by the figure pipeline.

export const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const lerp = (a, b, t) => a + (b - a) * t;
export function smoothstep(a, b, v) {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

// Seeded random numbers so every build of the same input gives the same points.
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Monotone cubic interpolation through [x, y] control points (no overshoot).
export function pchip(points) {
  const pts = [...points].sort((a, b) => a[0] - b[0]);
  const n = pts.length;
  const x = pts.map((p) => p[0]);
  const y = pts.map((p) => p[1]);
  const h = [];
  const d = [];
  for (let i = 0; i < n - 1; i++) {
    h[i] = x[i + 1] - x[i];
    d[i] = (y[i + 1] - y[i]) / h[i];
  }
  const m = new Array(n).fill(0);
  m[0] = d[0];
  m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) m[i] = 0;
    else {
      const w1 = 2 * h[i] + h[i - 1];
      const w2 = h[i] + 2 * h[i - 1];
      m[i] = (w1 + w2) / (w1 / d[i - 1] + w2 / d[i]);
    }
  }
  return (t) => {
    if (t <= x[0]) return y[0];
    if (t >= x[n - 1]) return y[n - 1];
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (x[mid] > t) hi = mid;
      else lo = mid;
    }
    const hh = h[lo];
    const s = (t - x[lo]) / hh;
    const s2 = s * s;
    const s3 = s2 * s;
    return (
      (2 * s3 - 3 * s2 + 1) * y[lo] +
      (s3 - 2 * s2 + s) * hh * m[lo] +
      (-2 * s3 + 3 * s2) * y[lo + 1] +
      (s3 - s2) * hh * m[lo + 1]
    );
  };
}

// Gaussian blur of a 1D array. NaN entries are treated as missing.
export function smooth1D(arr, sigma) {
  const n = arr.length;
  const out = new Float64Array(n);
  if (sigma <= 0) {
    out.set(arr);
    return out;
  }
  const r = Math.ceil(sigma * 3);
  const k = [];
  for (let i = -r; i <= r; i++) k.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  for (let i = 0; i < n; i++) {
    let s = 0;
    let w = 0;
    for (let j = -r; j <= r; j++) {
      const idx = i + j;
      if (idx < 0 || idx >= n) continue;
      const v = arr[idx];
      if (Number.isNaN(v)) continue;
      s += v * k[j + r];
      w += k[j + r];
    }
    out[i] = w > 0 ? s / w : NaN;
  }
  return out;
}

export function erode1D(arr, r) {
  const n = arr.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (arr[j] < m) m = arr[j];
    out[i] = m;
  }
  return out;
}

export function dilate1D(arr, r) {
  const n = arr.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let m = -Infinity;
    for (let j = Math.max(0, i - r); j <= Math.min(n - 1, i + r); j++) if (arr[j] > m) m = arr[j];
    out[i] = m;
  }
  return out;
}

// Removes peaks narrower than 2r+1 samples (morphological opening).
export const open1D = (arr, r) => dilate1D(erode1D(arr, r), r);

// Bilinear lookup in a single-channel grid (Float32Array or Uint8Array), clamped at the edges.
export function bilinear(grid, w, h, x, y) {
  const fx = clamp(x, 0, w - 1);
  const fy = clamp(y, 0, h - 1);
  const x0 = Math.floor(fx);
  const y0 = Math.floor(fy);
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = fx - x0;
  const ty = fy - y0;
  const a = grid[y0 * w + x0];
  const b = grid[y0 * w + x1];
  const c = grid[y1 * w + x0];
  const d = grid[y1 * w + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

export function normalize3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];

// The yaw angles the figure is seen from on the site (pointer range is +/- 12 degrees).
export const VIEW_YAWS = [-12, -6, 0, 6, 12].map((d) => (d * Math.PI) / 180);

// How much a surface with normal n turns away from the viewer, averaged over the site's view range.
// 0 means it faces the viewer, 1 means it is seen edge on. This is the "1 - |n.v|" rim weight.
export function rimWeight(nx, ny, nz) {
  let s = 0;
  for (const a of VIEW_YAWS) {
    const vx = Math.sin(a);
    const vz = Math.cos(a);
    s += 1 - Math.abs(nx * vx + nz * vz);
  }
  return s / VIEW_YAWS.length;
}
