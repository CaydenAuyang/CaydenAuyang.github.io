// Software rendering of points (for previews and the overlay test) and a tiny PNG encoder.

import zlib from 'node:zlib';

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
// rgba: Uint8Array w*h*4 (channels = 4) or w*h (channels = 1, grayscale)
export function encodePNG(data, w, h, channels = 4) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = channels === 4 ? 6 : channels === 3 ? 2 : 0;
  const stride = w * channels;
  const raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Orthographic projection of model points seen at a yaw (radians, positive turns the face toward
// image right) into an image frame given by a mapping { s, ox, oy }: u = ox + x' * s, v = oy - y * s.
export function projectOrtho(x, y, z, yaw, map) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const xr = x * c + z * s;
  const zr = -x * s + z * c;
  return [map.ox + xr * map.s, map.oy - y * map.s, zr];
}

// Splats points as discs into a float coverage buffer. Returns Float32Array w*h of summed alpha.
export function splat(pos, count, w, h, yaw, map, radius = 1.2, alphaOf = null) {
  const acc = new Float32Array(w * h);
  const r = Math.max(0.5, radius);
  const ri = Math.ceil(r);
  for (let i = 0; i < count; i++) {
    const [u, v] = projectOrtho(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2], yaw, map);
    const a = alphaOf ? alphaOf(i) : 1;
    const x0 = Math.floor(u);
    const y0 = Math.floor(v);
    for (let dy = -ri; dy <= ri; dy++) {
      const yy = y0 + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -ri; dx <= ri; dx++) {
        const xx = x0 + dx;
        if (xx < 0 || xx >= w) continue;
        const d = Math.hypot(xx + 0.5 - u, yy + 0.5 - v);
        const cov = Math.max(0, Math.min(1, r + 0.5 - d));
        if (cov > 0) acc[yy * w + xx] += cov * a;
      }
    }
  }
  return acc;
}

// Ink on vellum preview of a point figure. Returns RGBA bytes.
export function previewImage(dec, { w, h, yaw = 0, map, radius = 1.0, ink = [19, 33, 45], paper = [244, 247, 247], cull = true }) {
  // Like the site renderer: points on surfaces facing away from the viewer are hidden.
  const vx = -Math.sin(yaw);
  const vz = Math.cos(yaw);
  const alphaOf = (i) => {
    const f = dec.nrm[i * 3] * vx + dec.nrm[i * 3 + 2] * vz;
    if (cull && f < -0.15) return 0;
    return 0.45 + 0.5 * dec.weight[i];
  };
  const acc = splat(dec.pos, dec.count, w, h, yaw, map, radius, alphaOf);
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const a = 1 - Math.exp(-acc[i] * 0.9);
    for (let c = 0; c < 3; c++) out[i * 4 + c] = Math.round(paper[c] * (1 - a) + ink[c] * a);
    out[i * 4 + 3] = 255;
  }
  return out;
}

// Binary mask morphology on Uint8Array (0/1).
export function dilate(mask, w, h, r) {
  const tmp = new Uint8Array(w * h);
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    let last = -1e9;
    for (let x = 0; x < w; x++) {
      if (mask[y * w + x]) last = x;
      tmp[y * w + x] = x - last <= r ? 1 : 0;
    }
    last = 1e9;
    for (let x = w - 1; x >= 0; x--) {
      if (mask[y * w + x]) last = x;
      if (last - x <= r) tmp[y * w + x] = 1;
    }
  }
  for (let x = 0; x < w; x++) {
    let last = -1e9;
    for (let y = 0; y < h; y++) {
      if (tmp[y * w + x]) last = y;
      out[y * w + x] = y - last <= r ? 1 : 0;
    }
    last = 1e9;
    for (let y = h - 1; y >= 0; y--) {
      if (tmp[y * w + x]) last = y;
      if (last - y <= r) out[y * w + x] = 1;
    }
  }
  return out;
}
export function erode(mask, w, h, r) {
  const inv = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) inv[i] = mask[i] ? 0 : 1;
  const d = dilate(inv, w, h, r);
  for (let i = 0; i < w * h; i++) d[i] = d[i] ? 0 : 1;
  return d;
}
// Fills holes: anything not reachable from the border through background becomes foreground.
export function fillHoles(mask, w, h) {
  const seen = new Uint8Array(w * h);
  const stack = [];
  const push = (i) => {
    if (!seen[i] && !mask[i]) {
      seen[i] = 1;
      stack.push(i);
    }
  };
  for (let x = 0; x < w; x++) {
    push(x);
    push((h - 1) * w + x);
  }
  for (let y = 0; y < h; y++) {
    push(y * w);
    push(y * w + w - 1);
  }
  while (stack.length) {
    const i = stack.pop();
    const x = i % w;
    const y = (i - x) / w;
    if (x > 0) push(i - 1);
    if (x < w - 1) push(i + 1);
    if (y > 0) push(i - w);
    if (y < h - 1) push(i + w);
  }
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = seen[i] ? 0 : 1;
  return out;
}

// Silhouette of a point cloud at a yaw: splat, close the gaps, fill holes.
export function silhouette(pos, count, w, h, yaw, map, close = 4) {
  const acc = splat(pos, count, w, h, yaw, map, 1.0);
  let m = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) m[i] = acc[i] > 0.05 ? 1 : 0;
  m = erode(dilate(m, w, h, close), w, h, close);
  return fillHoles(m, w, h);
}
