// Fits one 3D bust to all three photo outlines, so the figure holds up when it turns.
//
// The photo fit (photo.mjs) builds a smooth head-and-shoulders template: a stack of horizontal
// sections, the front from the front photo's outline and depth, the back from proportions and the
// turned photos' trailing edges. That template matches the front outline but the turned ones only
// roughly (the back of the neck is too thin, the far shoulder too wide, the hair in front too
// small). This module deforms it until its outline matches every photo:
//
//   1. In a view turned by yaw t, a section's outline is its extent along (cos t, sin t) in the
//      x-z plane (its support), on both sides. The photos give that extent for every row of every
//      view, except where the photo frame clips the body.
//   2. Each template section is described by its support in 360 directions. A smooth correction
//      (a function of direction, bent as little as possible) is added so the support meets every
//      measured edge while the front edges stay where they are; directions no photo sees (the back
//      of the head) follow the template, bent smoothly between the measured ones. The corrections
//      are smoothed lightly across rows.
//   3. The new section is the convex shape with that support (the intersection of its 360
//      half-planes), so large corrections never fold. The face's own relief from the front photo's
//      depth (eye sockets, the sides of the nose) is then carved back in, inward only, so it never
//      changes an outline.
//   4. The sections become polar sections (a radius per angle about each row's center), which
//      model.mjs uses for the mesh, the hair strands and the implicit surface.
//
// Units are the model's (front photo pixels); axes as in model.mjs.

import { clamp, smooth1D, smoothstep } from './math.mjs';
import { partLine, rowAt, sectionPoint } from './model.mjs';

const TAU = 2 * Math.PI;
const wrap = (a) => ((a % TAU) + TAU) % TAU;

// Solves A x = b for a symmetric positive definite A (n x n, row major) by Cholesky.
function solveSPD(A, b, n) {
  const L = new Float64Array(n * n);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j <= i; j++) {
      let s = A[i * n + j];
      for (let k = 0; k < j; k++) s -= L[i * n + k] * L[j * n + k];
      if (i === j) L[i * n + i] = Math.sqrt(Math.max(s, 1e-12));
      else L[i * n + j] = s / L[j * n + j];
    }
  }
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    let s = b[i];
    for (let k = 0; k < i; k++) s -= L[i * n + k] * y[k];
    y[i] = s / L[i * n + i];
  }
  const x = new Float64Array(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = y[i];
    for (let k = i + 1; k < n; k++) s -= L[k * n + i] * x[k];
    x[i] = s / L[i * n + i];
  }
  return x;
}

// Linear interpolation weights of angle a on a periodic grid of M directions.
function gridWeights(a, M) {
  const t = (wrap(a) / TAU) * M;
  const m0 = Math.floor(t) % M;
  const f = t - Math.floor(t);
  return [m0, (m0 + 1) % M, 1 - f, f];
}

// The convex polygon { p : p . u_m <= h_m for every m } (Sutherland-Hodgman clipping of a big square).
function clipPolygon(h, dirs, big) {
  let poly = [[-big, -big], [big, -big], [big, big], [-big, big]];
  for (let m = 0; m < h.length; m++) {
    const [ux, uz] = dirs[m];
    const out = [];
    for (let k = 0; k < poly.length; k++) {
      const a = poly[k];
      const b = poly[(k + 1) % poly.length];
      const da = a[0] * ux + a[1] * uz - h[m];
      const db = b[0] * ux + b[1] * uz - h[m];
      if (da <= 0) out.push(a);
      if ((da <= 0) !== (db <= 0)) {
        const t = da / (da - db);
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
      }
    }
    poly = out;
    if (poly.length < 3) break;
  }
  return poly;
}

// Resamples a closed polygon to n points evenly spaced along its perimeter.
function resample(poly, n) {
  const acc = [0];
  for (let k = 1; k <= poly.length; k++) {
    const a = poly[k - 1];
    const b = poly[k % poly.length];
    acc.push(acc[k - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const total = acc[poly.length];
  const out = [];
  let k = 0;
  for (let s = 0; s < n; s++) {
    const d = (s / n) * total;
    while (k < poly.length - 1 && acc[k + 1] < d) k++;
    const a = poly[k];
    const b = poly[(k + 1) % poly.length];
    const f = (d - acc[k]) / Math.max(1e-9, acc[k + 1] - acc[k]);
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
  }
  return out;
}

/**
 * views: [{ name, front } | { name, yaw, k, b, c, H, edges: { L, R, clipL, clipR }, weight }] in the
 * overlay's convention: model x' = x cos(yaw) + z sin(yaw) appears at photo column (x' + c) / k,
 * and model row y at photo row (HF - y - b) / k.
 * Returns { rows, report }: rows with polar sections (rows.r, rows.cz, rows.A angles per row).
 */
export function deformToViews(model, views, HF, opts = {}) {
  const src = model.rows;
  const N = src.y.length;
  const C = opts.cols ?? 360; // template ring points per row
  const D = opts.support ?? 360; // directions of the support function
  const M = opts.dirs ?? 72; // directions of the correction
  const A = opts.angles ?? 360; // polar samples per row in the result
  const lambda = opts.stiffness ?? 0.002; // how much reshaping a section costs, against missing an edge
  const mu = opts.anchor ?? 1e-3; // pull toward the template where nothing is measured
  const rowCoupling = opts.rowCoupling ?? 6; // how strongly neighbouring rows' corrections agree
  const confWidth = ((opts.confWidth ?? 25) * Math.PI) / 180; // how far around a measured direction it counts as measured
  const frontWeight = opts.frontWeight ?? 8;
  const inset = opts.inset ?? (() => 0); // (view, side, y) -> px to pull a target in

  const dirs = Array.from({ length: D }, (_, m) => [Math.cos((TAU * m) / D), Math.sin((TAU * m) / D)]);
  const { chinY, headH } = model.meta;

  // ---- template rings and their support ----
  const cx = new Float64Array(N);
  const cz = new Float64Array(N);
  const h0 = new Float64Array(N * D);
  const rings = [];
  let big = 0;
  for (let i = 0; i < N; i++) {
    const y = src.y[i];
    const r = rowAt(src, y);
    cx[i] = r.cx;
    cz[i] = r.zb + (r.zf - r.zb) * r.cf;
    const ring = [];
    // The template's own face relief, on the face and head only (on the shirt the depth is noise).
    const faceRow = smoothstep(chinY - 0.12 * headH, chinY + 0.02 * headH, y);
    for (let j = 0; j < C; j++) {
      const p = sectionPoint(r, (TAU * j) / C);
      let z = p.z;
      if (p.s > 0 && model.front && faceRow > 0) {
        const f = model.front(p.x, y, z);
        if (f && f.w > 0) z += (f.z - z) * f.w * faceRow;
      }
      ring.push([p.x, z]);
      big = Math.max(big, Math.abs(p.x), Math.abs(z));
    }
    rings.push(ring);
    for (let m = 0; m < D; m++) {
      const [ux, uz] = dirs[m];
      let best = -Infinity;
      for (const [x, z] of ring) best = Math.max(best, x * ux + z * uz);
      h0[i * D + m] = best;
    }
  }
  const supportAt = (h, i, psi) => {
    const [m0, m1, w0, w1] = gridWeights(psi, D);
    return h[i * D + m0] * w0 + h[i * D + m1] * w1;
  };

  // ---- measured extents per row ----
  // Near the photo's bottom edge and next to rows where the frame clips a side, the matte's edge is
  // least trustworthy (and a target switching on or off from one row to the next would leave a
  // shelf), so targets fade in over a few dozen photo rows there.
  const taper = opts.taper ?? 30;
  const trust = new Map();
  for (const v of views) {
    if (v.front) continue;
    const H = v.H;
    const near = (clip) => {
      const d = new Float64Array(H).fill(Infinity);
      let last = -Infinity;
      for (let r = 0; r < H; r++) {
        if (clip[r] || !Number.isFinite(v.edges.L[r])) last = r;
        d[r] = r - last;
      }
      last = Infinity;
      for (let r = H - 1; r >= 0; r--) {
        if (clip[r] || !Number.isFinite(v.edges.L[r])) last = r;
        d[r] = Math.min(d[r], last - r, H - 1 - r);
      }
      return Float64Array.from(d, (x) => smoothstep(0, taper, x));
    };
    trust.set(v, { L: near(v.edges.clipL), R: near(v.edges.clipR) });
  }
  const targets = Array.from({ length: N }, () => []);
  let measured = 0;
  for (let i = 0; i < N; i++) {
    const y = src.y[i];
    for (const v of views) {
      if (v.front) {
        // The front outline is the template's own (ears smoothed out; ear plates add them back).
        targets[i].push({ psi: 0, h: supportAt(h0, i, 0), w: frontWeight, view: 'front' });
        targets[i].push({ psi: Math.PI, h: supportAt(h0, i, Math.PI), w: frontWeight, view: 'front' });
        continue;
      }
      const row = Math.round((HF - y - v.b) / v.k);
      if (row < 0 || row >= v.H) continue;
      const L = v.edges.L[row];
      const R = v.edges.R[row];
      if (!Number.isFinite(L) || !Number.isFinite(R)) continue;
      const w = v.weight ?? 1;
      const tr = trust.get(v);
      if (!v.edges.clipR[row] && tr.R[row] > 0) {
        targets[i].push({ psi: wrap(v.yaw), h: v.k * R - v.c - inset(v, 'R', y), w: w * tr.R[row], view: v.name });
        measured++;
      }
      if (!v.edges.clipL[row] && tr.L[row] > 0) {
        targets[i].push({ psi: wrap(v.yaw + Math.PI), h: -(v.k * L - v.c) - inset(v, 'L', y), w: w * tr.L[row], view: v.name });
        measured++;
      }
    }
  }

  // ---- the correction: one least squares solve per row ----
  // The bending energy is the change in the section's radius of curvature, (d + d'') for a
  // correction d of the support: moving a section costs nothing, rounding or sharpening it does,
  // so the fit prefers to move and gently reshape sections over creasing them.
  const base = new Float64Array(M * M);
  const step = TAU / M;
  for (let m = 0; m < M; m++) {
    const idx = [(m + M - 1) % M, m, (m + 1) % M];
    const co = [1 / (step * step), 1 - 2 / (step * step), 1 / (step * step)];
    for (let a = 0; a < 3; a++) for (let b = 0; b < 3; b++) base[idx[a] * M + idx[b]] += lambda * co[a] * co[b];
    base[m * M + m] += mu;
  }
  const delta = new Float64Array(N * M);
  const solveRow = (i) => {
    const T = targets[i];
    if (!T.length) return;
    const Amat = Float64Array.from(base);
    const bvec = new Float64Array(M);
    for (const t of T) {
      const goal = t.h + (t.relax || 0) - supportAt(h0, i, t.psi);
      const [m0, m1, w0, w1] = gridWeights(t.psi, M);
      Amat[m0 * M + m0] += t.w * w0 * w0;
      Amat[m0 * M + m1] += t.w * w0 * w1;
      Amat[m1 * M + m0] += t.w * w1 * w0;
      Amat[m1 * M + m1] += t.w * w1 * w1;
      bvec[m0] += t.w * w0 * goal;
      bvec[m1] += t.w * w1 * goal;
    }
    const sol = solveSPD(Amat, bvec, M);
    for (let m = 0; m < M; m++) delta[i * M + m] = sol[m];
  };
  // Along the rows, each direction's correction is smoothed by how well it is measured there: a
  // direction near a measured edge keeps its own value, and where nothing is measured (below the
  // bottom of a turned photo, where the frame clips it) the shape carries on from the rows that
  // are, instead of snapping back to the template from one row to the next.
  const conf = new Float64Array(N * M);
  for (let i = 0; i < N; i++) {
    for (const t of targets[i]) {
      for (let m = 0; m < M; m++) {
        let d = Math.abs(wrap((TAU * m) / M - t.psi));
        if (d > Math.PI) d = TAU - d;
        conf[i * M + m] += Math.min(1, t.w) * Math.exp(-((d / confWidth) ** 2));
      }
    }
  }
  const smoothRows = () => {
    const nu = rowCoupling;
    const a = new Float64Array(N);
    const b = new Float64Array(N);
    const c = new Float64Array(N);
    const r = new Float64Array(N);
    for (let m = 0; m < M; m++) {
      // Tridiagonal system (c_i + nu * neighbours) x_i - nu x_(i-1) - nu x_(i+1) = c_i d_i.
      for (let i = 0; i < N; i++) {
        const ci = conf[i * M + m] + 1e-4;
        const nb = (i > 0 ? 1 : 0) + (i < N - 1 ? 1 : 0);
        a[i] = i > 0 ? -nu : 0;
        c[i] = i < N - 1 ? -nu : 0;
        b[i] = ci + nu * nb;
        r[i] = ci * delta[i * M + m];
      }
      for (let i = 1; i < N; i++) {
        const w = a[i] / b[i - 1];
        b[i] -= w * c[i - 1];
        r[i] -= w * r[i - 1];
      }
      delta[(N - 1) * M + m] = r[N - 1] / b[N - 1];
      for (let i = N - 2; i >= 0; i--) delta[i * M + m] = (r[i] - c[i] * delta[(i + 1) * M + m]) / b[i];
    }
  };
  const correctedSupport = (i) => {
    const hi = new Float64Array(D);
    for (let m = 0; m < D; m++) {
      const [m0, m1, w0, w1] = gridWeights((TAU * m) / D, M);
      hi[m] = h0[i * D + m] + delta[i * M + m0] * w0 + delta[i * M + m1] * w1;
    }
    return hi;
  };
  // Where the photos disagree, the front wins. A section must reach the front outline at some
  // depth, and the turned photos' edges on either side of it bound that depth from the front and
  // from the back; at the trapezius rows they leave no room (the shoulders sit differently in the
  // turned photos). There the convex section would be clipped narrower than the front photo, so
  // the turned edges beside a clipped front edge are relaxed outward and the row is solved again.
  let relaxed = 0;
  for (let round = 0; round < (opts.relaxRounds ?? 14); round++) {
    for (let i = 0; i < N; i++) solveRow(i);
    smoothRows();
    let changed = 0;
    for (let i = 0; i < N; i++) {
      const T = targets[i];
      const fr = T.filter((t) => t.view === 'front');
      if (fr.length < 2) continue;
      const poly = clipPolygon(correctedSupport(i), dirs, big * 4);
      if (poly.length < 3) continue;
      for (const f of fr) {
        const [ux, uz] = [Math.cos(f.psi), Math.sin(f.psi)];
        let got = -Infinity;
        for (const [x, z] of poly) got = Math.max(got, x * ux + z * uz);
        const shrink = f.h - got;
        if (shrink <= 0.5) continue;
        for (const t of T) {
          if (t.view === 'front') continue;
          let d = wrap(t.psi - f.psi);
          if (d > Math.PI) d -= TAU;
          if (Math.abs(d) >= Math.PI / 2) continue;
          t.relax = (t.relax || 0) + 1.3 * shrink * Math.cos(d);
          changed++;
        }
      }
    }
    relaxed = changed;
    if (!changed) break;
  }

  // ---- new sections: convex shape with the corrected support, then the face relief ----
  const polys = [];
  const h = new Float64Array(N * D);
  for (let i = 0; i < N; i++) {
    const y = src.y[i];
    let poly = clipPolygon(correctedSupport(i), dirs, big * 4);
    if (poly.length < 3) poly = rings[i].slice();
    poly = resample(poly, 720);
    // Relief: the depth surface carves the front inward where the photo shows the face, only on
    // surfaces that face the front (within about 40 degrees), so the turned outlines, which run
    // along surfaces facing 50 degrees and more to the side, keep the fitted extents. Only the face
    // and head: on the shirt the depth is noise (folds, the placket), and the template's body front
    // is already smooth.
    const faceRow = smoothstep(chinY - 0.12 * headH, chinY + 0.02 * headH, y);
    if (model.front && faceRow > 0) {
      const nzs = poly.map((_, k) => {
        const a = poly[(k + poly.length - 1) % poly.length];
        const b = poly[(k + 1) % poly.length];
        const tx = b[0] - a[0];
        const tz = b[1] - a[1];
        return -tx / (Math.hypot(tx, tz) || 1);
      });
      poly.forEach((p, k) => {
        if (p[1] <= cz[i]) return;
        const face = smoothstep(0.72, 0.86, nzs[k]) * faceRow;
        if (face <= 0) return;
        const f = model.front(p[0], y, p[1]);
        if (f && f.w > 0) p[1] += (Math.min(f.z, p[1]) - p[1]) * f.w * face;
      });
    }
    for (let m = 0; m < D; m++) {
      const [ux, uz] = dirs[m];
      let best = -Infinity;
      for (const [x, z] of poly) best = Math.max(best, x * ux + z * uz);
      h[i * D + m] = best;
    }
    polys.push(poly);
  }
  // Polar centers: each section's centroid (area weighted), smoothed across rows so the implicit
  // surface has no kinks. The template's center is kept for the x position of the head axis.
  const pcx = new Float64Array(N);
  const pcz = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const poly = polys[i];
    let a2 = 0;
    let sx = 0;
    let sz = 0;
    for (let k = 0; k < poly.length; k++) {
      const [x0, z0] = poly[k];
      const [x1, z1] = poly[(k + 1) % poly.length];
      const c = x0 * z1 - x1 * z0;
      a2 += c;
      sx += (x0 + x1) * c;
      sz += (z0 + z1) * c;
    }
    pcx[i] = Math.abs(a2) > 1e-9 ? sx / (3 * a2) : cx[i];
    pcz[i] = Math.abs(a2) > 1e-9 ? sz / (3 * a2) : cz[i];
  }
  const scx = smooth1D(pcx, 3);
  const scz = smooth1D(pcz, 3);
  const rr = new Float32Array(N * A);
  let folds = 0;
  for (let i = 0; i < N; i++) {
    cx[i] = scx[i];
    cz[i] = scz[i];
    const pts = polys[i].map(([x, z]) => [wrap(Math.atan2(z - cz[i], x - cx[i])), Math.hypot(x - cx[i], z - cz[i])]);
    for (let j = 1; j < pts.length; j++) {
      let d = pts[j][0] - pts[j - 1][0];
      if (d > Math.PI) d -= TAU;
      if (d < -Math.PI) d += TAU;
      if (d < 0) folds++;
    }
    pts.sort((a, b) => a[0] - b[0]);
    let k = 0;
    for (let a = 0; a < A; a++) {
      const ang = (TAU * a) / A;
      while (k < pts.length && pts[k][0] < ang) k++;
      const p1 = pts[k % pts.length];
      const p0 = pts[(k + pts.length - 1) % pts.length];
      let a0 = p0[0];
      let a1 = p1[0];
      if (k === 0) a0 -= TAU;
      if (k === pts.length) a1 += TAU;
      const f = a1 > a0 ? clamp((ang - a0) / (a1 - a0), 0, 1) : 0;
      rr[i * A + a] = p0[1] + (p1[1] - p0[1]) * f;
    }
  }

  // ---- report: how far the outlines are from the photos, before and after ----
  const stats = (H) => {
    let s = 0;
    let n = 0;
    let worst = 0;
    for (let i = 0; i < N; i++) for (const t of targets[i]) {
      if (t.view === 'front') continue;
      const e = supportAt(H, i, t.psi) - t.h;
      s += e * e;
      n++;
      worst = Math.max(worst, Math.abs(e));
    }
    return { rms: +Math.sqrt(s / Math.max(1, n)).toFixed(2), worst: +worst.toFixed(1) };
  };

  // ---- the new rows ----
  const rows = { y: Float64Array.from(src.y) };
  for (const key of ['cx', 'hw', 'zf', 'zb', 'nf', 'nb', 'tf', 'cf']) rows[key] = Float64Array.from(src[key]);
  rows.cx = cx;
  rows.cz = cz;
  rows.r = rr;
  rows.A = A;
  for (let i = 0; i < N; i++) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (let a = 0; a < A; a++) {
      const ang = (TAU * a) / A;
      const x = cx[i] + rr[i * A + a] * Math.cos(ang);
      const z = cz[i] + rr[i * A + a] * Math.sin(ang);
      x0 = Math.min(x0, x);
      x1 = Math.max(x1, x);
      z0 = Math.min(z0, z);
      z1 = Math.max(z1, z);
    }
    rows.hw[i] = Math.max(x1 - cx[i], cx[i] - x0);
    rows.zf[i] = z1;
    rows.zb[i] = z0;
    rows.cf[i] = (cz[i] - z0) / Math.max(1e-6, z1 - z0);
  }
  const report = { measured, before: stats(h0), after: stats(h), folds, relaxedLastRound: relaxed };
  return { rows, report, delta, M };
}

/**
 * The photo model refitted to all three outlines: the deformed sections, the face relief baked in,
 * the ears re-attached to the new head sides and the part line placed again on the new shell.
 * photo: what photoModel returns (model, fit, views).
 */
export function turnModel(photo, opts = {}) {
  const { model } = photo;
  const d = deformToViews(model, photo.views, photo.fit.HF, opts);
  const rows = d.rows;
  const src = model.rows;
  const headHW = model.meta.headH * model.meta.proportions.headWidthWithHair * 0.5;
  // The x and z of a new section's outermost point on one side.
  const sideAt = (y, side) => {
    const r = rowAt(rows, y);
    let best = -Infinity;
    let z = r.cz;
    for (let k = -40; k <= 40; k++) {
      const a = (side > 0 ? 0 : Math.PI) + (k * Math.PI) / 180;
      const p = sectionPoint(r, a);
      if (side * p.x > best) {
        best = side * p.x;
        z = p.z;
      }
    }
    return z;
  };
  const ears = model.ears.map((e) => {
    // Ear plates are placed from their row's center x; keep their absolute x and move their depth
    // to the new head side.
    const shift = (y) => e.side * (rowAt(src, y).cx - rowAt(rows, y).cx);
    return { ...e, base: (y) => e.base(y) + shift(y), out: (y) => e.out(y) + shift(y), z: (y) => sideAt(y, e.side) - 0.04 * headHW };
  });
  const s = model.partSpec;
  const part = s
    ? { cx: s.x, line: partLine(rows, { headCenter: [s.x, s.midY, rowAt(rows, s.midY).cz], hairlineFront: [s.x, s.hairlineY, rowAt(rows, s.hairlineY).zf], crownAngle: s.crownAngle }) }
    : model.part;
  return { model: { ...model, rows, front: null, ears, part, meta: { ...model.meta, turnFit: d.report } }, report: d.report };
}
