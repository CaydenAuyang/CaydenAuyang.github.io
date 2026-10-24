// The point file format ("CAFG", version 1). Little endian throughout.
//
// Header, 48 bytes:
//   0   4 bytes  magic "CAFG"
//   4   uint16   version (1)
//   6   uint16   header size in bytes (48)
//   8   uint32   point count N
//   12  uint32   flags (bit 0: has normals; bit 1: built from photos, else placeholder)
//   16  float32  x3  bounds min (x, y, z) in model units
//   28  float32  x3  bounds max (x, y, z)
//   40  uint32   x2  reserved (0)
// Body, struct of arrays, 10 bytes per point:
//   int16  x 3N  positions, interleaved x y z. Value = center + q / 32767 * halfExtent per axis,
//                where center = (min + max) / 2 and halfExtent = (max - min) / 2.
//                (In WebGL, bind as SHORT normalized and use center + a * halfExtent.)
//   uint8  x 2N  normals, octahedral encoding, interleaved u v. u = byte / 255 * 2 - 1.
//   uint8  x N   attribute: bits 0-1 group (0 body, 1 skin, 2 hair, 3 contour),
//                bits 2-7 weight 0..63 (size and brightness; outline points are high).
//   uint8  x N   seed: when the point arrives during the assemble, 0 first to 255 last.
//                Hair strands grow from the part to the tips; the outline lands a little early.
// Axes: x to the viewer's right, y up, z toward the viewer. The bust's lowest y is the chest cut.

export const MAGIC = 'CAFG';
export const HEADER_BYTES = 48;
export const BYTES_PER_POINT = 10;

function octEncode(nx, ny, nz) {
  const l = Math.abs(nx) + Math.abs(ny) + Math.abs(nz) || 1;
  let u = nx / l;
  let v = ny / l;
  if (nz < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  const q = (t) => Math.max(0, Math.min(255, Math.round((t * 0.5 + 0.5) * 255)));
  return [q(u), q(v)];
}

export function octDecode(bu, bv) {
  let u = (bu / 255) * 2 - 1;
  let v = (bv / 255) * 2 - 1;
  let z = 1 - Math.abs(u) - Math.abs(v);
  if (z < 0) {
    const ou = u;
    u = (1 - Math.abs(v)) * (ou >= 0 ? 1 : -1);
    v = (1 - Math.abs(ou)) * (v >= 0 ? 1 : -1);
  }
  const l = Math.hypot(u, v, z) || 1;
  return [u / l, v / l, z / l];
}

export function boundsOf(ps) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < ps.length; i++) {
    const p = [ps.x[i], ps.y[i], ps.z[i]];
    for (let d = 0; d < 3; d++) {
      if (p[d] < min[d]) min[d] = p[d];
      if (p[d] > max[d]) max[d] = p[d];
    }
  }
  return { min, max };
}

// ps is a PointSet (see points.mjs). Points are written in a shuffled order so any prefix is an
// even sample of the whole figure.
export function encode(ps, { fromPhotos = false, bounds = boundsOf(ps), shuffleSeed = 7 } = {}) {
  const N = ps.length;
  const buf = Buffer.alloc(HEADER_BYTES + N * BYTES_PER_POINT);
  buf.write(MAGIC, 0, 'ascii');
  buf.writeUInt16LE(1, 4);
  buf.writeUInt16LE(HEADER_BYTES, 6);
  buf.writeUInt32LE(N, 8);
  buf.writeUInt32LE(1 | (fromPhotos ? 2 : 0), 12);
  for (let d = 0; d < 3; d++) {
    buf.writeFloatLE(bounds.min[d], 16 + d * 4);
    buf.writeFloatLE(bounds.max[d], 28 + d * 4);
  }
  const center = [0, 1, 2].map((d) => (bounds.min[d] + bounds.max[d]) / 2);
  const half = [0, 1, 2].map((d) => Math.max(1e-9, (bounds.max[d] - bounds.min[d]) / 2));
  // Deterministic shuffle.
  const order = Array.from({ length: N }, (_, i) => i);
  let s = shuffleSeed >>> 0;
  for (let i = N - 1; i > 0; i--) {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    const j = s % (i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  const posOff = HEADER_BYTES;
  const nrmOff = posOff + N * 6;
  const attrOff = nrmOff + N * 2;
  const seedOff = attrOff + N;
  const coords = [ps.x, ps.y, ps.z];
  for (let k = 0; k < N; k++) {
    const i = order[k];
    for (let d = 0; d < 3; d++) {
      const q = Math.round(((coords[d][i] - center[d]) / half[d]) * 32767);
      buf.writeInt16LE(Math.max(-32767, Math.min(32767, q)), posOff + k * 6 + d * 2);
    }
    const [u, v] = octEncode(ps.nx[i], ps.ny[i], ps.nz[i]);
    buf[nrmOff + k * 2] = u;
    buf[nrmOff + k * 2 + 1] = v;
    const w = Math.max(0, Math.min(63, Math.round(ps.weight[i] * 63)));
    buf[attrOff + k] = (ps.group[i] & 3) | (w << 2);
    buf[seedOff + k] = Math.max(0, Math.min(255, Math.round(ps.order[i] * 255)));
  }
  return buf;
}

export function decode(buf) {
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  const magic = String.fromCharCode(buf[0], buf[1], buf[2], buf[3]);
  if (magic !== MAGIC) throw new Error('not a CAFG file');
  const headerBytes = dv.getUint16(6, true);
  const N = dv.getUint32(8, true);
  const flags = dv.getUint32(12, true);
  const min = [0, 1, 2].map((d) => dv.getFloat32(16 + d * 4, true));
  const max = [0, 1, 2].map((d) => dv.getFloat32(28 + d * 4, true));
  const center = [0, 1, 2].map((d) => (min[d] + max[d]) / 2);
  const half = [0, 1, 2].map((d) => (max[d] - min[d]) / 2);
  const pos = new Float32Array(N * 3);
  const nrm = new Float32Array(N * 3);
  const group = new Uint8Array(N);
  const weight = new Float32Array(N);
  const order = new Float32Array(N);
  const posOff = headerBytes;
  const nrmOff = posOff + N * 6;
  const attrOff = nrmOff + N * 2;
  const seedOff = attrOff + N;
  for (let k = 0; k < N; k++) {
    for (let d = 0; d < 3; d++) pos[k * 3 + d] = center[d] + (dv.getInt16(posOff + k * 6 + d * 2, true) / 32767) * half[d];
    const n = octDecode(buf[nrmOff + k * 2], buf[nrmOff + k * 2 + 1]);
    nrm.set(n, k * 3);
    group[k] = buf[attrOff + k] & 3;
    weight[k] = (buf[attrOff + k] >> 2) / 63;
    order[k] = buf[seedOff + k] / 255;
  }
  return { count: N, flags, fromPhotos: !!(flags & 2), min, max, pos, nrm, group, weight, order };
}
