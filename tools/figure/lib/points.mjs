// Turns a bust model into points: surface points weighted toward the outline, plus hair strands.

import { clamp, gauss, lerp, rimWeight, smoothstep } from './math.mjs';
import { shellNormal, shellProject } from './model.mjs';

export const GROUP = { body: 0, skin: 1, hair: 2, contour: 3 };

export class PointSet {
  constructor() {
    this.x = [];
    this.y = [];
    this.z = [];
    this.nx = [];
    this.ny = [];
    this.nz = [];
    this.group = [];
    this.weight = []; // 0..1, drives size and brightness
    this.order = []; // 0..1, when the point arrives during the assemble
  }
  get length() {
    return this.x.length;
  }
  push(p, n, group, weight, order) {
    this.x.push(p[0]);
    this.y.push(p[1]);
    this.z.push(p[2]);
    this.nx.push(n[0]);
    this.ny.push(n[1]);
    this.nz.push(n[2]);
    this.group.push(group);
    this.weight.push(clamp(weight, 0, 1));
    this.order.push(clamp(order, 0, 1));
  }
  append(other) {
    for (const k of Object.keys(this)) this[k].push(...other[k]);
  }
}

// Default look. These numbers are the art direction in code; the README explains them.
// Shares of the point budget follow the Datum spec: outline band 40%, hair 25%, neck/shoulders/bust
// 25%, ears 3%, face interior 7%.
export const LOOK = {
  share: { outline: 0.4, hair: 0.25, body: 0.25, ears: 0.03, face: 0.07 },
  hairFillShare: 0.12, // part of the hair share spent on a light surface fill under the strands
  outlineRim: 0.62, // static rim weight (1 - |n.v|) where the outline band starts
  outlinePower: 1.4,
  rimFloor: 0.12, // body density facing the viewer, relative to edge on
  rimPower: 1.5,
  backFacing: 0.35, // surfaces facing away from the front camera are seen only through the figure
  bottomFade: 0.16, // fraction of bust height over which the chest thins out
};

// Category of a triangle: 'outline' | 'body' | 'face' | 'ears' | 'hair'
function categorize(model, p, n, vtag, rim, look) {
  if (vtag === 1) return { cat: 'ears', group: GROUP.skin };
  const cls = model.classify(p, n, vtag);
  const hair = cls.hair > 0.5;
  const face = !hair && cls.skin > 0.5 && p[1] > model.meta.chinY - 0.02 * model.meta.headH;
  if (rim >= look.outlineRim && n[2] > -0.5) return { cat: 'outline', group: GROUP.contour, hair, face };
  if (hair) return { cat: 'hair', group: GROUP.hair };
  if (face && n[2] > 0) return { cat: 'face', group: GROUP.skin };
  return { cat: 'body', group: cls.skin > 0.5 ? GROUP.skin : GROUP.body };
}

// Samples the surface into the outline, body, face, ears and hair fill budgets. Returns a PointSet.
export function sampleSurface(mesh, model, total, rand, look = LOOK) {
  const { pos, nrm, idx, tag } = mesh;
  const T = idx.length / 3;
  const { yTop, yBottom } = model.meta;
  const H = yTop - yBottom;
  const cats = ['outline', 'body', 'face', 'ears', 'hair'];
  const tri = { cat: new Uint8Array(T), w: new Float64Array(T) };
  const sums = Object.fromEntries(cats.map((c) => [c, 0]));
  const fadeAt = (y) => smoothstep(yBottom, yBottom + look.bottomFade * H, y);
  for (let t = 0; t < T; t++) {
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const ux = pos[b] - pos[a];
    const uy = pos[b + 1] - pos[a + 1];
    const uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a];
    const vy = pos[c + 1] - pos[a + 1];
    const vz = pos[c + 2] - pos[a + 2];
    const area = 0.5 * Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx);
    if (!(area > 0)) continue;
    const p = [(pos[a] + pos[b] + pos[c]) / 3, (pos[a + 1] + pos[b + 1] + pos[c + 1]) / 3, (pos[a + 2] + pos[b + 2] + pos[c + 2]) / 3];
    let n = [nrm[a] + nrm[b] + nrm[c], nrm[a + 1] + nrm[b + 1] + nrm[c + 1], nrm[a + 2] + nrm[b + 2] + nrm[c + 2]];
    const nl = Math.hypot(...n) || 1;
    n = [n[0] / nl, n[1] / nl, n[2] / nl];
    const rim = rimWeight(n[0], n[1], n[2]);
    const k = categorize(model, p, n, tag[idx[t * 3]], rim, look);
    const ci = cats.indexOf(k.cat);
    let w;
    const fade = fadeAt(p[1]);
    if (k.cat === 'outline') w = Math.pow((rim - look.outlineRim) / (1 - look.outlineRim), look.outlinePower) + 0.15;
    else if (k.cat === 'body') {
      w = look.rimFloor + (1 - look.rimFloor) * Math.pow(rim / look.outlineRim, look.rimPower);
      if (n[2] < -0.25) w *= look.backFacing;
    } else if (k.cat === 'face') {
      // Sparse interior with a faint gather where the face folds (brow, nose edge, lip line).
      const feat = model.faceFeature ? model.faceFeature(p) : 0;
      w = 0.25 + 0.75 * Math.pow(rim / look.outlineRim, 1.2) + 2.2 * feat;
    } else if (k.cat === 'ears') w = 0.4 + rim;
    else w = 0.3 + rim;
    w *= area * (k.cat === 'face' || k.cat === 'ears' ? 1 : fade);
    tri.cat[t] = ci;
    tri.w[t] = w;
    sums[k.cat] += w;
  }
  const out = new PointSet();
  const budget = {
    outline: Math.round(total * look.share.outline),
    body: Math.round(total * look.share.body),
    face: Math.round(total * look.share.face),
    ears: Math.round(total * look.share.ears),
    hair: Math.round(total * look.share.hair * look.hairFillShare),
  };
  for (let ci = 0; ci < cats.length; ci++) {
    const cat = cats[ci];
    const count = budget[cat];
    if (!count || !(sums[cat] > 0)) continue;
    // Stratified picks along this category's weight CDF, each with its own jitter.
    const list = [];
    for (let t = 0; t < T; t++) if (tri.cat[t] === ci && tri.w[t] > 0) list.push(t);
    const cdf = new Float64Array(list.length);
    let acc = 0;
    for (let i = 0; i < list.length; i++) cdf[i] = acc += tri.w[list[i]];
    const step = acc / count;
    let j = 0;
    for (let s = 0; s < count; s++) {
      const u = (s + rand()) * step;
      while (j < list.length - 1 && cdf[j] < u) j++;
      const t = list[j];
      const ia = idx[t * 3];
      const ib = idx[t * 3 + 1];
      const ic = idx[t * 3 + 2];
      let r1 = rand();
      let r2 = rand();
      if (r1 + r2 > 1) {
        r1 = 1 - r1;
        r2 = 1 - r2;
      }
      const r0 = 1 - r1 - r2;
      const p = [0, 1, 2].map((d) => pos[ia * 3 + d] * r0 + pos[ib * 3 + d] * r1 + pos[ic * 3 + d] * r2);
      let n = [0, 1, 2].map((d) => nrm[ia * 3 + d] * r0 + nrm[ib * 3 + d] * r1 + nrm[ic * 3 + d] * r2);
      const nl = Math.hypot(...n) || 1;
      n = n.map((v) => v / nl);
      const rim = rimWeight(n[0], n[1], n[2]);
      const fade = Math.sqrt(fadeAt(p[1]));
      let group;
      let weight;
      let order;
      // order: when the point lands. Outline first, face interior last (Datum M1).
      if (cat === 'outline') {
        group = GROUP.contour;
        weight = 0.75 + 0.25 * rim;
        order = 0.3 * rand();
      } else if (cat === 'face') {
        group = GROUP.skin;
        weight = 0.25 + 0.35 * rim;
        order = 0.72 + 0.28 * rand();
      } else if (cat === 'ears') {
        group = GROUP.skin;
        weight = 0.55 + 0.4 * rim;
        order = 0.15 + 0.4 * rand();
      } else if (cat === 'hair') {
        group = GROUP.hair;
        weight = 0.35 + 0.4 * rim;
        order = 0.3 + 0.4 * rand();
      } else {
        group = tri.cat[t] === ci && model.classify(p, n, 0).skin > 0.5 ? GROUP.skin : GROUP.body;
        weight = 0.3 + 0.6 * rim;
        order = 0.2 + 0.5 * rand();
      }
      out.push(p, n, group, weight * fade, order);
    }
  }
  return out;
}

function nearestOnPolyline(pts, p) {
  let best = Infinity;
  let bi = 0;
  let bt = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const ap = [p[0] - a[0], p[1] - a[1], p[2] - a[2]];
    const l2 = ab[0] * ab[0] + ab[1] * ab[1] + ab[2] * ab[2] || 1e-12;
    const t = clamp((ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / l2, 0, 1);
    const q = [a[0] + ab[0] * t, a[1] + ab[1] * t, a[2] + ab[2] * t];
    const d = Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
    if (d < best) {
      best = d;
      bi = i;
      bt = t;
    }
  }
  const a = pts[bi];
  const b = pts[bi + 1];
  return { d: best, s: (bi + bt) / (pts.length - 1), q: [lerp(a[0], b[0], bt), lerp(a[1], b[1], bt), lerp(a[2], b[2], bt)] };
}

// Hair flows away from the center part, then falls with gravity. Behind the crown it radiates out
// from the crown; in front of the hairline it sweeps forward and out to the sides (curtains).
function flowDir(model, p, n) {
  const part = model.part.line;
  const H = model.meta.headH;
  const near = nearestOnPolyline(part, p);
  let away = [p[0] - near.q[0], p[1] - near.q[1], p[2] - near.q[2]];
  const side = Math.sign(p[0] - model.part.cx) || 1;
  if (near.s <= 0.001) away = [away[0] + side * 0.6 * near.d, away[1], away[2]];
  const proj = (v) => {
    const k = v[0] * n[0] + v[1] * n[1] + v[2] * n[2];
    const t = [v[0] - k * n[0], v[1] - k * n[1], v[2] - k * n[2]];
    const l = Math.hypot(...t);
    return l > 1e-9 ? t.map((c) => c / l) : null;
  };
  const a = proj(away) || proj([side, 0, 0]);
  const g = proj([0, -1, 0]) || a;
  const k = 0.85 * smoothstep(0.12 * H, 0.55 * H, near.d);
  const d = [a[0] * (1 - k) + g[0] * k, a[1] * (1 - k) + g[1] * k, a[2] * (1 - k) + g[2] * k];
  const l = Math.hypot(...d) || 1;
  return { d: d.map((c) => c / l), partDist: near.d };
}

// Traces hair strands until about `budget` points exist. Returns a PointSet.
export function hairStrands(model, budget, rand, seeds, opts = {}) {
  const H = model.meta.headH;
  const step = opts.step ?? H * 0.006;
  const spacing = opts.spacing ?? H * 0.0055;
  const partHalf = opts.partHalf ?? H * 0.016;
  const maxLen = opts.maxLen ?? H * 0.75;
  const lift = opts.lift ?? H * 0.006;
  const h = H * 0.002;
  const rows = model.rows;
  const out = new PointSet();
  const isHair = (p) => {
    const n = shellNormal(rows, p, h);
    return { ok: model.classify(p, n, 0).hair > 0.5, n };
  };
  const trace = (start, dirSign, len) => {
    const pts = [];
    let p = start;
    for (let s = 0; s < len; s += step) {
      const n = shellNormal(rows, p, h);
      const f = flowDir(model, p, n);
      if (dirSign < 0 && f.partDist < partHalf) break;
      const q = shellProject(rows, [p[0] + f.d[0] * step * dirSign, p[1] + f.d[1] * step * dirSign, p[2] + f.d[2] * step * dirSign], h);
      if (!isHair(q).ok) break;
      if (Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]) < step * 0.2) break;
      pts.push(q);
      p = q;
    }
    return pts;
  };
  let si = 0;
  let guard = 0;
  while (out.length < budget && guard++ < seeds.length * 2) {
    const seed = seeds[si++ % seeds.length];
    const start = shellProject(rows, seed, h);
    if (!isHair(start).ok) continue;
    const len = maxLen * (0.55 + 0.45 * rand());
    const up = trace(start, -1, len * 0.7).reverse();
    const down = trace(start, 1, len);
    const line = [...up, start, ...down];
    if (line.length < 4) continue;
    // Arc length along the strand.
    const acc = [0];
    for (let i = 1; i < line.length; i++) acc.push(acc[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1], line[i][2] - line[i - 1][2]));
    const total = acc[acc.length - 1];
    if (total < H * 0.06) continue;
    const bright = 0.65 + 0.35 * rand();
    const strandLift = lift * (0.4 + rand());
    const strandOrder = rand() * 0.2;
    let j = 0;
    for (let s = rand() * spacing; s < total; s += spacing * (0.8 + 0.4 * rand())) {
      while (j < line.length - 2 && acc[j + 1] < s) j++;
      const t = (s - acc[j]) / (acc[j + 1] - acc[j] || 1);
      const a = line[j];
      const b = line[j + 1];
      const base = [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
      const n = shellNormal(rows, base, h);
      const u = s / total;
      // Strands sit just above the shell; tips lift a little more, like real hair volume.
      const off = strandLift * (0.5 + u) + Math.abs(gauss(rand)) * lift * 0.25;
      const p = [base[0] + n[0] * off, base[1] + n[1] * off, base[2] + n[2] * off];
      const rim = rimWeight(n[0], n[1], n[2]);
      const tip = 1 - smoothstep(0.82, 1, u);
      const weight = (0.3 + 0.7 * Math.pow(rim, 1.1)) * bright * (0.55 + 0.45 * tip);
      // Strands grow from the part toward their tips during the assemble.
      const order = 0.2 + strandOrder * 0.6 + 0.45 * u;
      // The back of the head is never faced on the site (yaw stays within about 15 degrees), and its
      // strands would show through the sparse face, so keep only a few there.
      if (n[2] < -0.2 && rand() > 0.15) continue;
      out.push(p, n, GROUP.hair, weight, order);
    }
  }
  return out;
}
