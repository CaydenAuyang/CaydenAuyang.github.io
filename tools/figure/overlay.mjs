#!/usr/bin/env node
// The likeness check: does the figure's outline match each photo?
//
//   node tools/figure/overlay.mjs [--work <dir>]
//
// For each photo (front, right, left) it projects the published points (public/figure/figure-hi.bin)
// at that photo's angle, fills the outline they make, and compares it with the person matte:
//   IoU = overlap area / combined area (1.0 is a perfect match; above about 0.93 the outlines are
//   hard to tell apart by eye).
// For the turned photos it also searches the angle (and a small sideways shift) that gives the best
// IoU, which is the estimated yaw.
// Writes overlay-<view>.png, overlay-all.png and overlay-report.json to the work folder (outside the
// repo): the photo dimmed, the matte outline in teal, the figure outline in orange, points faint.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from './lib/format.mjs';
import { cleanMask } from './lib/photo.mjs';
import { dilate, encodePNG, erode, fillHoles } from './lib/raster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const DEG = Math.PI / 180;

function silhouetteAt(dec, view, fitAll, yaw, shift, scale, Wd, Hd, closeR) {
  const { HF } = fitAll;
  const m = new Uint8Array(Wd * Hd);
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  const pts = new Float32Array(dec.count * 2);
  // Per row, the span between the outermost points (after trimming a few strays) is the outline.
  const rowsU = Array.from({ length: Hd }, () => []);
  for (let i = 0; i < dec.count; i++) {
    const x = dec.pos[i * 3];
    const y = dec.pos[i * 3 + 1];
    const z = dec.pos[i * 3 + 2];
    const xr = x * c + z * s;
    const u = ((xr + view.c) / view.k + shift) * scale;
    const v = ((HF - y - view.b) / view.k) * scale;
    pts[i * 2] = u;
    pts[i * 2 + 1] = v;
    const vi = Math.floor(v);
    if (vi >= 0 && vi < Hd) rowsU[vi].push(u);
  }
  const span = new Float64Array(Hd * 2).fill(NaN);
  for (let v = 0; v < Hd; v++) {
    const r = rowsU[v];
    if (r.length < 3) continue;
    r.sort((a, b) => a - b);
    const trim = Math.min(Math.floor(r.length * 0.002), 3);
    span[v * 2] = r[trim];
    span[v * 2 + 1] = r[r.length - 1 - trim];
  }
  for (let v = 0; v < Hd; v++) {
    if (Number.isNaN(span[v * 2])) continue;
    const l = Math.max(0, Math.round(span[v * 2]));
    const rr = Math.min(Wd - 1, Math.round(span[v * 2 + 1]));
    for (let u = l; u <= rr; u++) m[v * Wd + u] = 1;
  }
  let sil = erode(dilate(m, Wd, Hd, closeR), Wd, Hd, closeR);
  sil = fillHoles(sil, Wd, Hd);
  return { sil, pts };
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

export async function runOverlay(args = {}) {
  const work = args.work;
  const fitPath = path.join(work, 'fit.json');
  if (!fs.existsSync(fitPath)) throw new Error(`no fit.json in ${work}; run build.mjs first`);
  const { fit } = JSON.parse(fs.readFileSync(fitPath, 'utf8'));
  const dec = decode(fs.readFileSync(path.join(args.dataDir || path.join(REPO, 'public/figure'), 'figure-hi.bin')));
  const report = { builtFrom: dec.fromPhotos ? 'photos' : 'placeholder', views: {} };
  const tiles = [];
  for (const name of ['front', 'right', 'left']) {
    const view = fit[name];
    if (!view) continue;
    const dir = view.dir;
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const { width: W, height: H } = meta;
    const matte = cleanMask(new Uint8Array(fs.readFileSync(path.join(dir, 'matte.u8'))), W, H);
    const rgba = fs.readFileSync(path.join(dir, 'color.rgba'));
    // Search at a reduced size, render the final overlay at 800 px tall.
    const scale = 560 / H;
    const Wd = Math.round(W * scale);
    const Hd = Math.round(H * scale);
    const matteD = downMask(matte, W, H, scale, Wd, Hd);
    const closeR = 3;
    let best = { iou: -1, yaw: view.yaw, shift: 0 };
    const yaw0 = view.yaw;
    // Head and neck only (measured from the photos); the shoulders below come partly from
    // proportions because the photos clip them.
    const cutY = (fit.neckBaseY ?? -Infinity) - 0.1 * (fit.headH ?? 0);
    const headRows = (sc) => Math.max(1, Math.round(((fit.HF - cutY - view.b) / view.k) * sc));
    if (name === 'front') {
      const { sil } = silhouetteAt(dec, view, fit, 0, 0, scale, Wd, Hd, closeR);
      best = { iou: iou(sil, matteD), yaw: 0, shift: 0 };
    } else {
      const hr = headRows(scale);
      const evalAt = (yaw, shift) => iou(silhouetteAt(dec, view, fit, yaw, shift, scale, Wd, Hd, closeR).sil, matteD, hr, Wd);
      // coarse then fine
      for (let d = -16; d <= 16; d += 2) for (let sh = -0.04 * W; sh <= 0.04 * W; sh += 0.01 * W) {
        const v = evalAt(yaw0 + d * DEG, sh);
        if (v > best.iou) best = { iou: v, yaw: yaw0 + d * DEG, shift: sh };
      }
      const c = { ...best };
      for (let d = -2; d <= 2; d += 0.5) for (let sh = c.shift - 0.01 * W; sh <= c.shift + 0.01 * W; sh += 0.0025 * W) {
        const v = evalAt(c.yaw + d * DEG, sh);
        if (v > best.iou) best = { iou: v, yaw: c.yaw + d * DEG, shift: sh };
      }
    }
    const fitted = name === 'front' ? best.iou : iou(silhouetteAt(dec, view, fit, yaw0, 0, scale, Wd, Hd, closeR).sil, matteD);
    // Final overlay image.
    const so = 800 / H;
    const Wo = Math.round(W * so);
    const Ho = 800;
    const { sil, pts } = silhouetteAt(dec, view, fit, best.yaw, best.shift, so, Wo, Ho, 4);
    const matteO = downMask(matte, W, H, so, Wo, Ho);
    const iouFull = iou(sil, matteO);
    const iouHead = iou(sil, matteO, headRows(so), Wo);
    // a dashed line marks the head-and-neck region boundary
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
    for (let i = 0; i < dec.count; i += 3) {
      const u = Math.floor(pts[i * 2]);
      const v = Math.floor(pts[i * 2 + 1]);
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
    fs.writeFileSync(path.join(work, `overlay-${name}.png`), encodePNG(img, Wo, Ho));
    tiles.push({ img, Wo, Ho });
    report.views[name] = {
      yawFittedDeg: +(yaw0 / DEG).toFixed(1),
      yawEstimatedDeg: +(best.yaw / DEG).toFixed(1),
      shiftPx: +best.shift.toFixed(1),
      iouAtFittedYaw: +fitted.toFixed(4),
      iou: +iouFull.toFixed(4),
      iouHeadNeck: +iouHead.toFixed(4),
      overlay: path.join(work, `overlay-${name}.png`),
    };
    console.log(`overlay ${name.padEnd(5)}  yaw ${(best.yaw / DEG).toFixed(1).padStart(6)} deg (fit said ${(yaw0 / DEG).toFixed(1)})  IoU ${iouFull.toFixed(4)}  head+neck ${iouHead.toFixed(4)}  -> overlay-${name}.png`);
  }
  // Side by side.
  const Wall = tiles.reduce((s, t) => s + t.Wo, 0);
  const all = new Uint8Array(Wall * 800 * 4);
  let ox = 0;
  for (const t of tiles) {
    for (let v = 0; v < 800; v++) all.set(t.img.subarray(v * t.Wo * 4, (v + 1) * t.Wo * 4), (v * Wall + ox) * 4);
    ox += t.Wo;
  }
  fs.writeFileSync(path.join(work, 'overlay-all.png'), encodePNG(all, Wall, 800));
  fs.writeFileSync(path.join(work, 'overlay-report.json'), JSON.stringify(report, null, 2));
  return report;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { parseArgs } = await import('./build.mjs');
  runOverlay(parseArgs(process.argv.slice(2))).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
