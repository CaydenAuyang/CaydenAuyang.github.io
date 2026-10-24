// The signal figure format ("CASG", version 1). Little endian throughout. Read by
// src/world/signal.ts; written by tools/figure/signal.mjs.
//
// Header, 40 bytes:
//   0   4 bytes  magic "CASG"
//   4   uint16   version (1)
//   6   uint16   header size in bytes (40)
//   8   uint32   point count N
//   12  float32  x3  bounds min (x, y, z)
//   24  float32  x3  bounds max (x, y, z)
//   36  uint32   reserved (0)
// Body, one 8-byte record per point (array of structs, so any prefix of the file is complete):
//   int16 x3  position. Value = center + q / 32767 * halfExtent per axis, where
//             center = (min + max) / 2 and halfExtent = (max - min) / 2.
//   uint8     weight 0..255: brightness and size (outline points are high, the face is low)
//   uint8     bits 0-1 group (0 body, 1 skin, 2 hair, 3 contour), bits 2-7 arrival order 0..63
//             (when the point lands as the figure gathers: outline early, strands from the part
//             to the tips, face last)
// Units: figure heights, origin at the center of the figure's bounding box, x to the viewer's
// right, y up, z toward the viewer.
// Order: the first N points are an even sample of the whole figure for every N; each group keeps
// its share in every prefix.

import { rng } from './math.mjs';

export const SIGNAL_MAGIC = 'CASG';
export const SIGNAL_HEADER = 40;
export const SIGNAL_STRIDE = 8;

// An order of point indices whose every prefix keeps each group's share: each group is shuffled,
// then the groups are interleaved by quota (largest remainder first). runs (optional) gives points
// that belong together (the dots of one hair strand) the same id; those stay together, so a short
// prefix holds fewer strands drawn whole instead of every strand drawn as scattered dots.
export function orderForPrefixes(group, seed = 1, runs = null) {
  const rand = rng(seed);
  const shuffle = (l) => {
    for (let i = l.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [l[i], l[j]] = [l[j], l[i]];
    }
    return l;
  };
  const lists = [[], [], [], []];
  if (runs) {
    const byRun = [new Map(), new Map(), new Map(), new Map()];
    for (let i = 0; i < group.length; i++) {
      const g = group[i] & 3;
      const key = runs[i] >= 0 ? runs[i] : -1 - i;
      if (!byRun[g].has(key)) byRun[g].set(key, []);
      byRun[g].get(key).push(i);
    }
    for (let g = 0; g < 4; g++) for (const run of shuffle([...byRun[g].values()])) lists[g].push(...run);
  } else {
    for (let i = 0; i < group.length; i++) lists[group[i] & 3].push(i);
    lists.forEach(shuffle);
  }
  const N = group.length;
  const taken = [0, 0, 0, 0];
  const out = new Array(N);
  for (let k = 0; k < N; k++) {
    let best = -1;
    let bestDebt = -Infinity;
    for (let g = 0; g < 4; g++) {
      if (taken[g] >= lists[g].length) continue;
      const debt = ((k + 1) * lists[g].length) / N - taken[g];
      if (debt > bestDebt) {
        bestDebt = debt;
        best = g;
      }
    }
    out[k] = lists[best][taken[best]++];
  }
  return out;
}

// pts: { x, y, z, weight (0..1), group (0..3), order (0..1) } arrays. order: index order to write.
export function encodeSignal(pts, order) {
  const N = order.length;
  const buf = Buffer.alloc(SIGNAL_HEADER + N * SIGNAL_STRIDE);
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  const axes = [pts.x, pts.y, pts.z];
  for (const i of order) {
    for (let d = 0; d < 3; d++) {
      min[d] = Math.min(min[d], axes[d][i]);
      max[d] = Math.max(max[d], axes[d][i]);
    }
  }
  buf.write(SIGNAL_MAGIC, 0, 'ascii');
  buf.writeUInt16LE(1, 4);
  buf.writeUInt16LE(SIGNAL_HEADER, 6);
  buf.writeUInt32LE(N, 8);
  for (let d = 0; d < 3; d++) {
    buf.writeFloatLE(min[d], 12 + d * 4);
    buf.writeFloatLE(max[d], 24 + d * 4);
  }
  const center = min.map((v, d) => (v + max[d]) / 2);
  const half = min.map((v, d) => Math.max(1e-9, (max[d] - v) / 2));
  for (let k = 0; k < N; k++) {
    const i = order[k];
    const o = SIGNAL_HEADER + k * SIGNAL_STRIDE;
    for (let d = 0; d < 3; d++) {
      const q = Math.round(((axes[d][i] - center[d]) / half[d]) * 32767);
      buf.writeInt16LE(Math.max(-32767, Math.min(32767, q)), o + d * 2);
    }
    buf[o + 6] = Math.max(0, Math.min(255, Math.round(pts.weight[i] * 255)));
    const ord = Math.max(0, Math.min(63, Math.round(pts.order[i] * 63)));
    buf[o + 7] = (pts.group[i] & 3) | (ord << 2);
  }
  return buf;
}

export function decodeSignal(buf, limit = Infinity) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== SIGNAL_MAGIC) throw new Error('not a CASG file');
  const header = dv.getUint16(6, true);
  const N = Math.min(dv.getUint32(8, true), limit, Math.floor((buf.byteLength - header) / SIGNAL_STRIDE));
  const min = [0, 1, 2].map((d) => dv.getFloat32(12 + d * 4, true));
  const max = [0, 1, 2].map((d) => dv.getFloat32(24 + d * 4, true));
  const center = min.map((v, d) => (v + max[d]) / 2);
  const half = min.map((v, d) => (max[d] - v) / 2);
  const pos = new Float32Array(N * 3);
  const weight = new Float32Array(N);
  const group = new Uint8Array(N);
  const order = new Float32Array(N);
  for (let k = 0; k < N; k++) {
    const o = header + k * SIGNAL_STRIDE;
    for (let d = 0; d < 3; d++) pos[k * 3 + d] = center[d] + (dv.getInt16(o + d * 2, true) / 32767) * half[d];
    weight[k] = buf[o + 6] / 255;
    group[k] = buf[o + 7] & 3;
    order[k] = (buf[o + 7] >> 2) / 63;
  }
  return { count: N, min, max, pos, weight, group, order };
}
