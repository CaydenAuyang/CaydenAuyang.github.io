// The bust model.
//
// A bust is a stack of horizontal cross sections ("rows"), from the top of the head down to the
// chest cut. Each row is a superellipse with its own center, half width (from the front
// silhouette) and front and back extent (from the side silhouettes), or, once the bust has been
// fitted to all three photos (turnfit.mjs), a polar section: a radius for every angle about the
// row's center (rows.r, rows.A angles per row, centers rows.cx and rows.cz). On top of that:
//   front(x, y)    an optional 2.5D override for the face side, from the front photo's depth
//   ears[]         small curved plates that stick out of the head sides
//   classify(p, n) says how much a surface point is hair or skin
//   part           the center part line, used by the hair strands
//
// Units are whatever the source uses (meters for the placeholder, front photo pixels for photos).
// Axes: x to the viewer's right in the front view, y up, z toward the front camera.

import { clamp, lerp } from './math.mjs';

export const ROW_KEYS = ['cx', 'hw', 'zf', 'zb', 'nf', 'nb', 'tf', 'cf'];

// rows: { y: Float64Array (top to bottom, evenly spaced, descending), cx, hw, zf, zb, nf, nb, tf, cf }
export function makeRows(n, yTop, yBottom, fns) {
  const rows = { y: new Float64Array(n) };
  for (const k of ROW_KEYS) rows[k] = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const y = lerp(yTop, yBottom, i / (n - 1));
    rows.y[i] = y;
    rows.cx[i] = fns.cx ? fns.cx(y) : 0;
    rows.hw[i] = Math.max(0, fns.hw(y));
    rows.zf[i] = fns.zf(y);
    rows.zb[i] = fns.zb(y);
    rows.nf[i] = fns.nf ? fns.nf(y) : 2.4;
    rows.nb[i] = fns.nb ? fns.nb(y) : 2.4;
    rows.tf[i] = fns.tf ? fns.tf(y) : 0;
    rows.cf[i] = fns.cf ? fns.cf(y) : 0.5;
  }
  return rows;
}

export function rowAt(rows, y) {
  const n = rows.y.length;
  const y0 = rows.y[0];
  const y1 = rows.y[n - 1];
  const t = clamp((y0 - y) / (y0 - y1), 0, 1) * (n - 1);
  const i = Math.min(n - 2, Math.floor(t));
  const f = t - i;
  const out = { y };
  for (const k of ROW_KEYS) out[k] = rows[k][i] * (1 - f) + rows[k][i + 1] * f;
  if (rows.r) {
    out.cz = rows.cz[i] * (1 - f) + rows.cz[i + 1] * f;
    out.polar = { rows, i, f };
  }
  return out;
}

// Radius of a polar section at angle a (radians, 0 = viewer's right, pi/2 = front), interpolated
// between the two rows around it and the two angles around a.
export function polarRadius(polar, a) {
  const { rows, i, f } = polar;
  const A = rows.A;
  const t = ((((a / (2 * Math.PI)) % 1) + 1) % 1) * A;
  const k0 = Math.floor(t) % A;
  const k1 = (k0 + 1) % A;
  const g = t - Math.floor(t);
  const r = rows.r;
  const a0 = r[i * A + k0] * (1 - g) + r[i * A + k1] * g;
  const a1 = r[(i + 1) * A + k0] * (1 - g) + r[(i + 1) * A + k1] * g;
  return a0 * (1 - f) + a1 * f;
}

const spow = (v, e) => Math.sign(v) * Math.pow(Math.abs(v), e);

// The point of row r at angle th (0 = viewer's right, pi/2 = front, pi = left, 3pi/2 = back).
export function sectionPoint(r, th) {
  const c = Math.cos(th);
  const s = Math.sin(th);
  if (r.polar) {
    const rad = polarRadius(r.polar, th);
    return { x: r.cx + rad * c, z: r.cz + rad * s, s };
  }
  const n = s >= 0 ? r.nf : r.nb;
  const cz = r.zb + (r.zf - r.zb) * r.cf;
  const xr = spow(c, 2 / n) * (1 - r.tf * Math.max(0, s) ** 2);
  const zr = spow(s, 2 / n);
  return {
    x: r.cx + r.hw * xr,
    z: cz + (s >= 0 ? r.zf - cz : cz - r.zb) * zr,
    s,
  };
}

// Builds a triangle mesh: { pos, nrm, tag, idx } with tag 0 = body/head shell, 1 = ear.
export function buildMesh(model, { cols = 200, normalSmooth } = {}) {
  const { rows } = model;
  const R = rows.y.length;
  const parts = [];

  // Main shell.
  {
    const V = R * cols;
    const pos = new Float32Array(V * 3);
    for (let i = 0; i < R; i++) {
      const r = rowAt(rows, rows.y[i]);
      for (let j = 0; j < cols; j++) {
        const th = (2 * Math.PI * j) / cols;
        const p = sectionPoint(r, th);
        let z = p.z;
        if (p.s > 0 && model.front) {
          const f = model.front(p.x, r.y, z);
          if (f && f.w > 0) z = z + (f.z - z) * f.w;
        }
        const v = (i * cols + j) * 3;
        pos[v] = p.x;
        pos[v + 1] = r.y;
        pos[v + 2] = z;
      }
    }
    const idx = [];
    for (let i = 0; i < R - 1; i++) {
      for (let j = 0; j < cols; j++) {
        const a = i * cols + j;
        const b = i * cols + ((j + 1) % cols);
        const c = (i + 1) * cols + j;
        const d = (i + 1) * cols + ((j + 1) % cols);
        // Rows go downward and angles run from the viewer's right toward the front, so (a, b, c)
        // has its normal (b - a) x (c - a) pointing out of the bust.
        idx.push(a, b, c, b, d, c);
      }
    }
    parts.push({ pos, idx, tag: 0 });
  }

  // Ears: two layers (front and back face) of a thin plate.
  for (const ear of model.ears || []) {
    const ER = 28;
    const EC = 10;
    const pos = new Float32Array(ER * EC * 2 * 3);
    let k = 0;
    for (let layer = 0; layer < 2; layer++) {
      for (let i = 0; i < ER; i++) {
        const y = lerp(ear.y0, ear.y1, i / (ER - 1));
        const r = rowAt(rows, y);
        const base = r.cx + ear.side * (ear.base(y) ?? r.hw * 0.97);
        const outer = r.cx + ear.side * ear.out(y);
        const zc = ear.z(y);
        const tilt = Math.tan(ear.angle ?? 0.45);
        for (let j = 0; j < EC; j++) {
          const u = j / (EC - 1);
          const x = lerp(base, outer, u);
          const dx = Math.abs(x - base);
          // The plate sweeps backward as it leaves the head, with a little cup.
          const cup = Math.sin(Math.PI * u) * ear.thick * 1.2;
          const off = (layer === 0 ? 0.5 : -0.5) * ear.thick;
          pos[k++] = x;
          pos[k++] = y;
          pos[k++] = zc - dx * tilt + off + (layer === 0 ? cup : -cup * 0.4);
        }
      }
    }
    const idx = [];
    for (let layer = 0; layer < 2; layer++) {
      const o = layer * ER * EC;
      for (let i = 0; i < ER - 1; i++) {
        for (let j = 0; j < EC - 1; j++) {
          const a = o + i * EC + j;
          const b = a + 1;
          const c = a + EC;
          const d = c + 1;
          const flip = (layer === 0) !== (ear.side > 0);
          if (flip) idx.push(a, b, c, b, d, c);
          else idx.push(a, c, b, b, c, d);
        }
      }
    }
    parts.push({ pos, idx, tag: 1, side: ear.side });
  }

  // Merge and compute normals.
  let V = 0;
  let T = 0;
  for (const p of parts) {
    V += p.pos.length / 3;
    T += p.idx.length;
  }
  const pos = new Float32Array(V * 3);
  const tag = new Uint8Array(V);
  const idx = new Uint32Array(T);
  let vo = 0;
  let io = 0;
  for (const p of parts) {
    pos.set(p.pos, vo * 3);
    tag.fill(p.tag, vo, vo + p.pos.length / 3);
    for (let i = 0; i < p.idx.length; i++) idx[io + i] = p.idx[i] + vo;
    vo += p.pos.length / 3;
    io += p.idx.length;
  }
  const nrm = new Float32Array(V * 3);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const v of [a, b, c]) {
      nrm[v] += nx;
      nrm[v + 1] += ny;
      nrm[v + 2] += nz;
    }
  }
  for (let v = 0; v < V; v++) {
    const l = Math.hypot(nrm[v * 3], nrm[v * 3 + 1], nrm[v * 3 + 2]);
    if (l > 0) {
      nrm[v * 3] /= l;
      nrm[v * 3 + 1] /= l;
      nrm[v * 3 + 2] /= l;
    } else nrm[v * 3 + 1] = 1;
  }
  // A fitted (polar) shell: rows are 2 px apart, so a sub-pixel wobble from one row's fit to the
  // next tips its normals by many degrees, and the sampler and the shader (both of which read the
  // normals) would turn that into horizontal bands. Smooth the shell's normals down the rows.
  if (model.rows.r && (normalSmooth ?? 4) > 0) {
    const sigma = normalSmooth ?? 4;
    const k = [];
    for (let d = -Math.ceil(3 * sigma); d <= Math.ceil(3 * sigma); d++) k.push([d, Math.exp(-(d * d) / (2 * sigma * sigma))]);
    const src = nrm.slice(0, R * cols * 3);
    for (let i = 0; i < R; i++) {
      for (let j = 0; j < cols; j++) {
        let sx = 0;
        let sy = 0;
        let sz = 0;
        for (const [d, w] of k) {
          const ii = Math.min(R - 1, Math.max(0, i + d));
          const v = (ii * cols + j) * 3;
          sx += src[v] * w;
          sy += src[v + 1] * w;
          sz += src[v + 2] * w;
        }
        const l = Math.hypot(sx, sy, sz) || 1;
        nrm.set([sx / l, sy / l, sz / l], (i * cols + j) * 3);
      }
    }
  }
  // An ear plate is two thin layers whose triangle normals are noise at this size; what matters is
  // that an ear faces out to its side and a little forward (seen from the front it is part of the
  // outline, turned toward the viewer it faces them, turned away it is behind the head).
  {
    let vo = 0;
    for (const p of parts) {
      const n = p.pos.length / 3;
      if (p.tag === 1) {
        const l = Math.hypot(1, 0.35);
        for (let v = vo; v < vo + n; v++) nrm.set([p.side / l, 0, 0.35 / l], v * 3);
      }
      vo += n;
    }
  }
  return { pos, nrm, tag, idx };
}

// Implicit form of the shell, used to walk hair strands along the head surface.
// G < 0 inside, 0 on the surface, > 0 outside (roughly in units of the section radius).
export function shellG(rows, x, y, z) {
  const r = rowAt(rows, y);
  if (r.polar) {
    const dx = x - r.cx;
    const dz = z - r.cz;
    const scale = 1e-4 * (rows.y[0] - rows.y[rows.y.length - 1]);
    const rad = Math.max(polarRadius(r.polar, Math.atan2(dz, dx)), scale);
    const g = Math.hypot(dx, dz) / rad - 1;
    const above = y - rows.y[0];
    return above > 0 ? g + above / Math.max(r.hw, scale) : g;
  }
  const cz = r.zb + (r.zf - r.zb) * r.cf;
  const dx = x - r.cx;
  const dz = z - cz;
  const n = dz >= 0 ? r.nf : r.nb;
  const a = Math.max(r.hw, 1e-4 * (rows.y[0] - rows.y[rows.y.length - 1]));
  const b = Math.max(dz >= 0 ? r.zf - cz : cz - r.zb, 1e-4 * (rows.y[0] - rows.y[rows.y.length - 1]));
  const g = Math.pow(Math.pow(Math.abs(dx / a), n) + Math.pow(Math.abs(dz / b), n), 1 / n) - 1;
  // Above the top row there is no section, so count height above the top as outside.
  const above = y - rows.y[0];
  return above > 0 ? g + above / Math.max(a, b) : g;
}

export function shellNormal(rows, p, h) {
  const g0x = shellG(rows, p[0] + h, p[1], p[2]) - shellG(rows, p[0] - h, p[1], p[2]);
  const g0y = shellG(rows, p[0], p[1] + h, p[2]) - shellG(rows, p[0], p[1] - h, p[2]);
  const g0z = shellG(rows, p[0], p[1], p[2] + h) - shellG(rows, p[0], p[1], p[2] - h);
  const l = Math.hypot(g0x, g0y, g0z) || 1;
  return [g0x / l, g0y / l, g0z / l];
}

// Pulls a point onto the shell with a few Newton steps along the gradient.
export function shellProject(rows, p, h) {
  let q = [p[0], p[1], p[2]];
  for (let it = 0; it < 6; it++) {
    const g = shellG(rows, q[0], q[1], q[2]);
    const gx = (shellG(rows, q[0] + h, q[1], q[2]) - shellG(rows, q[0] - h, q[1], q[2])) / (2 * h);
    const gy = (shellG(rows, q[0], q[1] + h, q[2]) - shellG(rows, q[0], q[1] - h, q[2])) / (2 * h);
    const gz = (shellG(rows, q[0], q[1], q[2] + h) - shellG(rows, q[0], q[1], q[2] - h)) / (2 * h);
    const l2 = gx * gx + gy * gy + gz * gz;
    if (l2 < 1e-12) break;
    q = [q[0] - (g * gx) / l2, q[1] - (g * gy) / l2, q[2] - (g * gz) / l2];
    if (Math.abs(g) < 1e-4) break;
  }
  return q;
}

// Casts a ray from c along d and returns the first point where it leaves the shell.
export function shellRay(rows, c, d, tMax) {
  let lo = 0;
  let hi = tMax;
  const at = (t) => shellG(rows, c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t);
  if (at(hi) < 0) return null;
  for (let it = 0; it < 40; it++) {
    const m = (lo + hi) / 2;
    if (at(m) < 0) lo = m;
    else hi = m;
  }
  const t = (lo + hi) / 2;
  return [c[0] + d[0] * t, c[1] + d[1] * t, c[2] + d[2] * t];
}

// The center part runs over the top of the head in the midline, from the front hairline back to
// the crown. headCenter is a point inside the skull; the part sweeps through the midline plane
// from the direction of the front hairline to crownAngle radians behind straight up.
export function partLine(rows, { headCenter, hairlineFront, crownAngle = 0.95, steps = 64 }) {
  const c = headCenter;
  const a0 = Math.atan2(hairlineFront[2] - c[2], hairlineFront[1] - c[1]); // toward the front, > 0
  const a1 = -crownAngle;
  const reach = 4 * Math.max(rows.y[0] - c[1], 1e-6);
  const pts = [];
  for (let k = 0; k <= steps; k++) {
    const a = lerp(a0, a1, k / steps);
    const p = shellRay(rows, c, [0, Math.cos(a), Math.sin(a)], reach);
    if (p) pts.push([c[0], p[1], p[2]]);
  }
  return pts;
}
