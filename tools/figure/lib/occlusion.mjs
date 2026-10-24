// Which surface points can be seen from the site's view range (yaw -6, 0, +6 degrees)?
// The renderer has no depth test (points are see-through), so surfaces hidden behind the front of
// the figure, like the underside of the jaw behind the neck, would show through the sparse face.
// This z-buffers the mesh from those angles so the sampler can thin out hidden surfaces.

const YAWS = [-6, 0, 6].map((d) => (d * Math.PI) / 180);

export function buildVisibility(mesh, { res = 900, eps }) {
  const { pos, idx } = mesh;
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (let i = 0; i < pos.length; i += 3) {
    const r = Math.hypot(pos[i], pos[i + 2]);
    if (-r < minX) minX = -r;
    if (r > maxX) maxX = r;
    if (pos[i + 1] < minY) minY = pos[i + 1];
    if (pos[i + 1] > maxY) maxY = pos[i + 1];
  }
  const cell = (maxY - minY) / res;
  const W = Math.ceil((maxX - minX) / cell) + 2;
  const H = res + 2;
  const views = YAWS.map((yaw) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const zb = new Float32Array(W * H).fill(-Infinity);
    const P = (i) => [(pos[i] * c + pos[i + 2] * s - minX) / cell, (maxY - pos[i + 1]) / cell, -pos[i] * s + pos[i + 2] * c];
    for (let t = 0; t < idx.length; t += 3) {
      const a = P(idx[t] * 3);
      const b = P(idx[t + 1] * 3);
      const d = P(idx[t + 2] * 3);
      const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], d[0])));
      const x1 = Math.min(W - 1, Math.ceil(Math.max(a[0], b[0], d[0])));
      const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], d[1])));
      const y1 = Math.min(H - 1, Math.ceil(Math.max(a[1], b[1], d[1])));
      const den = (b[1] - d[1]) * (a[0] - d[0]) + (d[0] - b[0]) * (a[1] - d[1]);
      if (Math.abs(den) < 1e-12) continue;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        const l0 = ((b[1] - d[1]) * (px - d[0]) + (d[0] - b[0]) * (py - d[1])) / den;
        const l1 = ((d[1] - a[1]) * (px - d[0]) + (a[0] - d[0]) * (py - d[1])) / den;
        const l2 = 1 - l0 - l1;
        if (l0 < -0.01 || l1 < -0.01 || l2 < -0.01) continue;
        const z = l0 * a[2] + l1 * b[2] + l2 * d[2];
        const k = y * W + x;
        if (z > zb[k]) zb[k] = z;
      }
    }
    return { c, s, zb };
  });
  // Distance (in model units) from each covered pixel of the front view to the figure's outline.
  const zFront = views[1].zb;
  const dist = new Float32Array(W * H);
  const INF = 1e9;
  for (let k = 0; k < W * H; k++) dist[k] = zFront[k] === -Infinity ? 0 : INF;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const k = y * W + x;
    if (!dist[k]) continue;
    let d = dist[k];
    if (x > 0) d = Math.min(d, dist[k - 1] + 1);
    if (y > 0) d = Math.min(d, dist[k - W] + 1);
    if (x > 0 && y > 0) d = Math.min(d, dist[k - W - 1] + 1.414);
    if (x < W - 1 && y > 0) d = Math.min(d, dist[k - W + 1] + 1.414);
    dist[k] = d;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const k = y * W + x;
    if (!dist[k]) continue;
    let d = dist[k];
    if (x < W - 1) d = Math.min(d, dist[k + 1] + 1);
    if (y < H - 1) d = Math.min(d, dist[k + W] + 1);
    if (x < W - 1 && y < H - 1) d = Math.min(d, dist[k + W + 1] + 1.414);
    if (x > 0 && y < H - 1) d = Math.min(d, dist[k + W - 1] + 1.414);
    dist[k] = d;
  }
  const edgeDist = (p) => {
    const x = Math.floor((p[0] - minX) / cell);
    const y = Math.floor((maxY - p[1]) / cell);
    if (x < 0 || x >= W || y < 0 || y >= H) return 0;
    return dist[y * W + x] * cell;
  };
  // Fraction of the three views in which point p is at (or near) the front-most surface.
  const visible = (p) => {
    let seen = 0;
    for (const v of views) {
      const x = Math.floor((p[0] * v.c + p[2] * v.s - minX) / cell);
      const y = Math.floor((maxY - p[1]) / cell);
      if (x < 0 || x >= W || y < 0 || y >= H) {
        seen++;
        continue;
      }
      let front = -Infinity;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx;
        const yy = y + dy;
        if (xx >= 0 && xx < W && yy >= 0 && yy < H) front = Math.max(front, v.zb[yy * W + xx]);
      }
      const z = -p[0] * v.s + p[2] * v.c;
      if (z >= front - eps) seen++;
    }
    return seen / views.length;
  };
  return { visible, edgeDist };
}
