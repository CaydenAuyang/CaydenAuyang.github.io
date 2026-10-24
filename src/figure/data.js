// Loads and checks a point file (format "CAFG" version 1).
// The format is documented at the top of tools/figure/lib/format.mjs. In short: a 48 byte header,
// then int16 x3 positions, uint8 x2 octahedral normals, uint8 attribute, uint8 seed per point,
// stored as separate blocks. The renderer uploads the body as one buffer and points each
// attribute at its block, so nothing is decoded on the CPU.

const MAGIC = 'CAFG';
const BYTES_PER_POINT = 10;

export function parseFigure(buffer) {
  if (!(buffer instanceof ArrayBuffer) || buffer.byteLength < 48) throw new Error('figure: file too small');
  const dv = new DataView(buffer);
  const magic = String.fromCharCode(dv.getUint8(0), dv.getUint8(1), dv.getUint8(2), dv.getUint8(3));
  if (magic !== MAGIC) throw new Error('figure: not a CAFG file');
  const version = dv.getUint16(4, true);
  if (version !== 1) throw new Error('figure: unsupported version ' + version);
  const headerBytes = dv.getUint16(6, true);
  const count = dv.getUint32(8, true);
  const flags = dv.getUint32(12, true);
  const min = [0, 1, 2].map((d) => dv.getFloat32(16 + d * 4, true));
  const max = [0, 1, 2].map((d) => dv.getFloat32(28 + d * 4, true));
  if (headerBytes % 2 !== 0) throw new Error('figure: header must be 2 byte aligned');
  if (buffer.byteLength < headerBytes + count * BYTES_PER_POINT) throw new Error('figure: file is truncated');
  return {
    count,
    flags,
    fromPhotos: !!(flags & 2),
    min,
    max,
    center: [0, 1, 2].map((d) => (min[d] + max[d]) / 2),
    half: [0, 1, 2].map((d) => Math.max(1e-9, (max[d] - min[d]) / 2)),
    // Body as one byte view, plus the byte offsets of each block inside it.
    body: new Uint8Array(buffer, headerBytes, count * BYTES_PER_POINT),
    offsets: { pos: 0, nrm: count * 6, attr: count * 8, seed: count * 9 },
  };
}

export async function loadFigure(url, signal) {
  const res = await fetch(url, { signal, credentials: 'same-origin' });
  if (!res.ok) throw new Error('figure: ' + res.status + ' loading ' + url);
  return parseFigure(await res.arrayBuffer());
}
