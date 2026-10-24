#!/usr/bin/env node
// The likeness and turn check for the night scene's figure, on the points the site renders.
//
//   node tools/figure/turncheck.mjs [--file public/world/figure-signal.bin] [--work <dir>] [--count N]
//
// It decodes the signal file (CASG, lib/signal-format.mjs), puts the points back into the front
// photo's frame (figure-work/signal-fit.json, written by signal.mjs), and turns them about the
// figure's own center the way the signal's shader does (true depth, no squashing). Then:
//
//   - Likeness: for each photo it fills the outline the points make (per row, from the leftmost
//     to the rightmost point, a small closing, holes filled) and compares it with the person matte:
//     IoU = overlap / combined area. The front is scored at yaw 0. Each turned photo is scored at
//     the yaw the fit measured for it, and again at the yaw (within 16 degrees) and sideways shift
//     that match best. "head+neck" scores only the rows above the shoulders.
//   - Turn: the outline at every degree from -30 to +30 (orthographic, in the front frame): its
//     area, width and edges, and the largest jump from one degree to the next (second differences
//     relative to the area), to catch tears, flattening or pops.
//
// Writes turn-overlay-<view>.png, turn-overlay-all.png and turn-report.json to the work folder
// (outside the repo). Exit code 1 if a done-when score fails (front 0.95, each turned photo 0.90).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanMask } from './lib/photo.mjs';
import { dilate, encodePNG, erode, fillHoles } from './lib/raster.mjs';
import { decodeSignal } from './lib/signal-format.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DEG = Math.PI / 180;

export const DONE_WHEN = { front: 0.95, turned: 0.9 };

// Points in the front photo's frame, turned by yaw about the figure's center.
function project(P, view, yaw, shift, scale, HF) {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const n = P.X.length;
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const xr = (P.X[i] - P.cx) * c + P.Z[i] * s + P.cx;
    u[i] = ((xr + view.c) / view.k + shift) * scale;
    v[i] = ((HF - P.Y[i] - view.b) / view.k) * scale;
  }
  return { u, v };
}

function silhouette(proj, Wd, Hd, closeR) {
  const rowsU = Array.from({ length: Hd }, () => []);
  for (let i = 0; i < proj.u.length; i++) {
    const vi = Math.floor(proj.v[i]);
    if (vi >= 0 && vi < Hd) rowsU[vi].push(proj.u[i]);
  }
  const m = new Uint8Array(Wd * Hd);
  for (let v = 0; v < Hd; v++) {
    const r = rowsU[v];
    if (r.length < 3) continue;
    r.sort((a, b) => a - b);
    const trim = Math.min(Math.floor(r.length * 0.002), 3);
    const l = Math.max(0, Math.round(r[trim]));
    const rr = Math.min(Wd - 1, Math.round(r[r.length - 1 - trim]));
    for (let u = l; u <= rr; u++) m[v * Wd + u] = 1;
  }
  return fillHoles(erode(dilate(m, Wd, Hd, closeR), Wd, Hd, closeR), Wd, Hd);
}

function iou(a, b, rowLimit = 0, W = 1) {
  let inter = 0;
  let uni = 0;
  const end = rowLimit ? Math.min(a.length, rowLimit * W) : a.length;
  for (let i = 0; i < end; i++) {
    if (a[i] && b[i]) inter++;
    if (a[i] || b[i]) uni++;
  }
  return uni ? inter / uni : 0;
}

function downMask(mask, W, H, scale, Wd, Hd) {
  const out = new Uint8Array(Wd * Hd);
  for (let v = 0; v < Hd; v++) for (let u = 0; u < Wd; u++) {
    const su = Math.min(W - 1, Math.floor((u + 0.5) / scale));
    const sv = Math.min(H - 1, Math.floor((v + 0.5) / scale));
    out[v * Wd + u] = mask[sv * W + su];
  }
  return out;
}

function outline(mask, W, H) {
  const e = erode(mask, W, H, 1);
  const o = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) o[i] = mask[i] && !e[i] ? 1 : 0;
  return dilate(o, W, H, 1);
}

export function loadFigurePoints(file, fitFile, limit = Infinity) {
  const dec = decodeSignal(fs.readFileSync(file), limit);
  const norm = JSON.parse(fs.readFileSync(fitFile, 'utf8'));
  const n = dec.count;
  const P = { X: new Float32Array(n), Y: new Float32Array(n), Z: new Float32Array(n), cx: norm.cx, count: n, dec };
  for (let i = 0; i < n; i++) {
    P.X[i] = dec.pos[i * 3] * norm.height + norm.cx;
    P.Y[i] = dec.pos[i * 3 + 1] * norm.height + norm.cy;
    P.Z[i] = dec.pos[i * 3 + 2] * norm.height;
  }
  return P;
}

export function runTurnCheck({ work, file, count = Infinity, quiet = false }) {
  const { fit } = JSON.parse(fs.readFileSync(path.join(work, 'fit.json'), 'utf8'));
  const P = loadFigurePoints(file, path.join(work, 'signal-fit.json'), count);
  const HF = fit.HF;
  const log = quiet ? () => {} : console.log;
  const report = { file, points: P.count, views: {}, turn: null };
  const tiles = [];
  for (const name of ['front', 'right', 'left']) {
    const view = fit[name];
    if (!view) continue;
    const meta = JSON.parse(fs.readFileSync(path.join(view.dir, 'meta.json'), 'utf8'));
    const { width: W, height: H } = meta;
    const matte = cleanMask(new Uint8Array(fs.readFileSync(path.join(view.dir, 'matte.u8'))), W, H);
    const rgba = fs.readFileSync(path.join(view.dir, 'color.rgba'));
    const scale = 560 / H;
    const Wd = Math.round(W * scale);
    const Hd = Math.round(H * scale);
    const matteD = downMask(matte, W, H, scale, Wd, Hd);
    const closeR = 3;
    const cutY = fit.neckBaseY - 0.1 * fit.headH;
    const headRows = (sc) => Math.max(1, Math.round(((HF - cutY - view.b) / view.k) * sc));
    const evalAt = (yaw, shift) => iou(silhouette(project(P, view, yaw, shift, scale, HF), Wd, Hd, closeR), matteD);
    const shifts = name === 'front' ? [0] : Array.from({ length: 33 }, (_, k) => (k - 16) * 0.0025 * W);
    // At the fitted yaw: the best sideways shift (framing, not shape).
    let atFit = { iou: -1, shift: 0 };
    for (const sh of shifts) {
      const v = evalAt(view.yaw, sh);
      if (v > atFit.iou) atFit = { iou: v, shift: sh };
    }
    // Best yaw within 16 degrees (turned photos only).
    let best = { iou: atFit.iou, yaw: view.yaw, shift: atFit.shift };
    if (name !== 'front') {
      for (let d = -16; d <= 16; d += 2) for (let sh = -0.04 * W; sh <= 0.04 * W; sh += 0.01 * W) {
        const v = evalAt(view.yaw + d * DEG, sh);
        if (v > best.iou) best = { iou: v, yaw: view.yaw + d * DEG, shift: sh };
      }
      const c = { ...best };
      for (let d = -2; d <= 2; d += 0.5) for (let sh = c.shift - 0.01 * W; sh <= c.shift + 0.01 * W; sh += 0.0025 * W) {
        const v = evalAt(c.yaw + d * DEG, sh);
        if (v > best.iou) best = { iou: v, yaw: c.yaw + d * DEG, shift: sh };
      }
    }
    // Final numbers and the overlay picture at 800 px tall, at the fitted yaw.
    const so = 800 / H;
    const Wo = Math.round(W * so);
    const Ho = 800;
    const matteO = downMask(matte, W, H, so, Wo, Ho);
    const projFit = project(P, view, view.yaw, atFit.shift, so, HF);
    const sil = silhouette(projFit, Wo, Ho, 4);
    const iouFit = iou(sil, matteO);
    const iouHead = iou(sil, matteO, headRows(so), Wo);
    const silBest = silhouette(project(P, view, best.yaw, best.shift, so, HF), Wo, Ho, 4);
    const iouBest = iou(silBest, matteO);
    const hrO = Math.min(Ho - 1, headRows(so));
    const mo = outline(matteO, Wo, Ho);
    const fo = outline(sil, Wo, Ho);
    const img = new Uint8Array(Wo * Ho * 4);
    for (let v = 0; v < Ho; v++) for (let u = 0; u < Wo; u++) {
      const su = Math.min(W - 1, Math.floor((u + 0.5) / so));
      const sv = Math.min(H - 1, Math.floor((v + 0.5) / so));
      const si = (sv * W + su) * 4;
      const o = (v * Wo + u) * 4;
      for (let k = 0; k < 3; k++) img[o + k] = Math.round(rgba[si + k] * 0.45 + 255 * 0.55 * 0.6);
      img[o + 3] = 255;
    }
    for (let i = 0; i < projFit.u.length; i += 3) {
      const u = Math.floor(projFit.u[i]);
      const v = Math.floor(projFit.v[i]);
      if (u < 0 || u >= Wo || v < 0 || v >= Ho) continue;
      const o = (v * Wo + u) * 4;
      img[o] = Math.round(img[o] * 0.6 + 19 * 0.4);
      img[o + 1] = Math.round(img[o + 1] * 0.6 + 33 * 0.4);
      img[o + 2] = Math.round(img[o + 2] * 0.6 + 45 * 0.4);
    }
    for (let i = 0; i < Wo * Ho; i++) {
      if (mo[i]) img.set([0, 150, 160], i * 4);
      if (fo[i]) img.set([204, 82, 22], i * 4);
      if (mo[i] && fo[i]) img.set([90, 40, 120], i * 4);
    }
    for (let u = 0; u < Wo; u++) if ((u >> 3) % 2 === 0) img.set([120, 120, 120], (hrO * Wo + u) * 4);
    fs.writeFileSync(path.join(work, `turn-overlay-${name}.png`), encodePNG(img, Wo, Ho));
    tiles.push({ img, Wo, Ho });
    report.views[name] = {
      yawDeg: +(view.yaw / DEG).toFixed(1),
      iou: +iouFit.toFixed(4),
      iouHeadNeck: +iouHead.toFixed(4),
      shiftPx: +atFit.shift.toFixed(1),
      bestYawDeg: +(best.yaw / DEG).toFixed(1),
      bestIou: +iouBest.toFixed(4),
      overlay: path.join(work, `turn-overlay-${name}.png`),
    };
    log(`${name.padEnd(5)}  at the fitted yaw ${(view.yaw / DEG).toFixed(1).padStart(6)} deg: IoU ${iouFit.toFixed(4)} (head+neck ${iouHead.toFixed(4)})   best yaw ${(best.yaw / DEG).toFixed(1).padStart(6)} deg: IoU ${iouBest.toFixed(4)}`);
  }
  const Wall = tiles.reduce((s, t) => s + t.Wo, 0);
  const all = new Uint8Array(Wall * 800 * 4);
  let ox = 0;
  for (const t of tiles) {
    for (let v = 0; v < 800; v++) all.set(t.img.subarray(v * t.Wo * 4, (v + 1) * t.Wo * 4), (v * Wall + ox) * 4);
    ox += t.Wo;
  }
  fs.writeFileSync(path.join(work, 'turn-overlay-all.png'), encodePNG(all, Wall, 800));

  // ---- the turn: the outline at every degree from -30 to +30 ----
  {
    const view = fit.front;
    const scale = 560 / view.H;
    const Wd = Math.round(view.W * scale * 1.3);
    const Hd = Math.round(view.H * scale);
    const pad = Math.round(view.W * scale * 0.15);
    const rows = [];
    for (let deg = -30; deg <= 30; deg++) {
      const pr = project(P, { ...view, c: view.c + pad / scale }, deg * DEG, 0, scale, HF);
      const sil = silhouette(pr, Wd, Hd, 3);
      let area = 0;
      let x0 = Wd;
      let x1 = 0;
      let headW = 0;
      const headEnd = Math.round(((HF - (fit.neckBaseY ?? 0)) / view.k) * scale);
      for (let v = 0; v < Hd; v++) {
        let l = -1;
        let r = -1;
        for (let u = 0; u < Wd; u++) if (sil[v * Wd + u]) {
          area++;
          if (l < 0) l = u;
          r = u;
        }
        if (l >= 0) {
          x0 = Math.min(x0, l);
          x1 = Math.max(x1, r);
          if (v < headEnd) headW = Math.max(headW, r - l + 1);
        }
      }
      rows.push({ deg, area, width: x1 - x0 + 1, left: x0, right: x1, headW });
    }
    const meanArea = rows.reduce((s, r) => s + r.area, 0) / rows.length;
    let worst = { key: '', deg: 0, v: 0 };
    const jump = (key, norm) => {
      for (let k = 1; k < rows.length - 1; k++) {
        const d2 = Math.abs(rows[k + 1][key] - 2 * rows[k][key] + rows[k - 1][key]) / norm;
        if (d2 > worst.v) worst = { key, deg: rows[k].deg, v: d2 };
      }
    };
    jump('area', meanArea);
    const meanW = rows.reduce((s, r) => s + r.width, 0) / rows.length;
    for (const key of ['width', 'left', 'right', 'headW']) jump(key, meanW);
    report.turn = { every5: rows.filter((r) => r.deg % 5 === 0), worstSecondDifference: { ...worst, v: +worst.v.toFixed(4) } };
    log('turn   deg  area   width  head width');
    for (const r of rows) if (r.deg % 5 === 0) log(`       ${String(r.deg).padStart(3)}  ${(r.area / meanArea).toFixed(3)}  ${r.width}  ${r.headW}`);
    log(`turn   largest second difference: ${worst.key} at ${worst.deg} deg, ${(worst.v * 100).toFixed(2)}% (of the mean ${worst.key === 'area' ? 'area' : 'width'})`);
  }
  const f = report.views.front?.iou ?? 0;
  const r = report.views.right?.iou ?? 0;
  const l = report.views.left?.iou ?? 0;
  report.pass = f >= DONE_WHEN.front && r >= DONE_WHEN.turned && l >= DONE_WHEN.turned;
  fs.writeFileSync(path.join(work, 'turn-report.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (n, d) => (args.includes('--' + n) ? args[args.indexOf('--' + n) + 1] : d);
  const { DEFAULTS } = await import('./build.mjs');
  const rep = runTurnCheck({ work: arg('work', DEFAULTS.work), file: path.resolve(arg('file', path.join(REPO, 'public/world/figure-signal.bin'))), count: Number(arg('count', Infinity)) });
  console.log(rep.pass ? 'done-when: pass' : 'done-when: FAIL');
  process.exit(rep.pass ? 0 : 1);
}
