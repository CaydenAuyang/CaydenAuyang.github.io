// Builds the bust model from three photos: a front view and two views turned about 45 degrees.
//
// Inputs per view (made by extract.swift and depth.mjs into the work folder, never the repo):
//   color.rgba, matte.u8 (person segmentation), depth-da.f32 (relative inverse depth), meta.json
//   (Vision face landmarks).
//
// Steps:
//   1. Clean each matte (threshold, largest blob, fill holes) and read its left/right edge per row.
//   2. Align the turned views to the front vertically with face landmarks (crown, brows, eyes, nose,
//      mouth, chin). Model units are front-photo pixels, y up, x from the neck center.
//   3. Estimate each turned view's yaw and the depth scale from the face's leading edge: in a view
//      turned by yaw t, the leading edge of row y is max over the front surface of
//      x cos t + z sin t, where the front surface z = alpha * depth.
//   4. Per row: width and center from the front matte (shoulders completed where the photo clips
//      them), front surface from depth, back of the head and neck fitted to the trailing edges of
//      the two turned views, torso depth from proportions where the photos are clipped.
//   5. Hair and skin from luminance inside the matte, ears from bumps in the front outline, the
//      center part from the front photo, faint face lines from the landmarks.

import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bilinear, clamp, lerp, open1D, pchip, smooth1D, smoothstep } from './math.mjs';
import { makeRows, partLine, rowAt } from './model.mjs';
import { featureFromSegments } from './placeholder.mjs';
import { dilate, erode, fillHoles } from './raster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEG = Math.PI / 180;

// ---------- inputs ----------

export async function ensureViews(args) {
  const work = args.work;
  fs.mkdirSync(work, { recursive: true });
  const bin = path.join(work, 'bin', 'extract');
  const swiftSrc = path.join(HERE, '..', 'extract.swift');
  if (!fs.existsSync(bin) || fs.statSync(bin).mtimeMs < fs.statSync(swiftSrc).mtimeMs) {
    fs.mkdirSync(path.dirname(bin), { recursive: true });
    console.log('compiling extract.swift (about 40 s, once)');
    execFileSync('swiftc', ['-O', swiftSrc, '-o', bin], { stdio: 'inherit' });
  }
  const views = { front: args.front, right: args.right, left: args.left };
  const need = [];
  for (const [name, file] of Object.entries(views)) {
    if (!file || !fs.existsSync(file)) {
      if (name === 'front') throw new Error(`front photo not found: ${file}`);
      console.warn(`no ${name} photo (${file}); building without it`);
      delete views[name];
      continue;
    }
    const dir = path.join(work, name);
    const meta = path.join(dir, 'meta.json');
    const fresh = fs.existsSync(meta) && fs.statSync(meta).mtimeMs > fs.statSync(file).mtimeMs && !args.fresh;
    if (!fresh) execFileSync(bin, [file, dir], { stdio: ['ignore', 'inherit', 'ignore'] });
    if (!fs.existsSync(path.join(dir, 'depth-da.f32')) || !fresh) need.push(dir);
  }
  if (need.length) {
    const { runDepth } = await import('../depth.mjs');
    await runDepth(need);
  }
  return Object.keys(views);
}

function loadView(dir) {
  const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
  const { width: W, height: H } = meta;
  const rd = (f) => (fs.existsSync(path.join(dir, f)) ? fs.readFileSync(path.join(dir, f)) : null);
  const matteRaw = new Uint8Array(rd('matte.u8'));
  const rgba = rd('color.rgba');
  const depthBuf = rd('depth-da.f32');
  const depth = depthBuf ? new Float32Array(depthBuf.buffer, depthBuf.byteOffset, W * H) : null;
  const lum = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) lum[i] = 0.2126 * rgba[i * 4] + 0.7152 * rgba[i * 4 + 1] + 0.0722 * rgba[i * 4 + 2];
  const mask = cleanMask(matteRaw, W, H);
  const edges = rowEdges(mask, W, H);
  return { dir, meta, W, H, matteRaw, mask, edges, lum, depth, rgba };
}

function blur2D(src, W, H, sigma) {
  const r = Math.ceil(sigma * 3);
  const k = [];
  let ks = 0;
  for (let i = -r; i <= r; i++) {
    const v = Math.exp(-(i * i) / (2 * sigma * sigma));
    k.push(v);
    ks += v;
  }
  for (let i = 0; i < k.length; i++) k[i] /= ks;
  const tmp = new Float32Array(W * H);
  const out = new Float32Array(W * H);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += src[y * W + Math.min(W - 1, Math.max(0, x + j))] * k[j + r];
    tmp[y * W + x] = s;
  }
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    let s = 0;
    for (let j = -r; j <= r; j++) s += tmp[Math.min(H - 1, Math.max(0, y + j)) * W + x] * k[j + r];
    out[y * W + x] = s;
  }
  return out;
}

export function cleanMask(raw, W, H) {
  let m = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) m[i] = raw[i] >= 128 ? 1 : 0;
  // Largest connected blob.
  const label = new Int32Array(W * H);
  let best = 0;
  let bestSize = 0;
  let next = 1;
  const stack = [];
  for (let i = 0; i < W * H; i++) {
    if (!m[i] || label[i]) continue;
    let size = 0;
    label[i] = next;
    stack.push(i);
    while (stack.length) {
      const j = stack.pop();
      size++;
      const x = j % W;
      const nb = [x > 0 ? j - 1 : -1, x < W - 1 ? j + 1 : -1, j - W, j + W];
      for (const k of nb) {
        if (k >= 0 && k < W * H && m[k] && !label[k]) {
          label[k] = next;
          stack.push(k);
        }
      }
    }
    if (size > bestSize) {
      bestSize = size;
      best = next;
    }
    next++;
  }
  for (let i = 0; i < W * H; i++) m[i] = label[i] === best ? 1 : 0;
  m = fillHoles(m, W, H);
  return m;
}

function rowEdges(mask, W, H) {
  const L = new Float64Array(H).fill(NaN);
  const R = new Float64Array(H).fill(NaN);
  const clipL = new Uint8Array(H);
  const clipR = new Uint8Array(H);
  let top = -1;
  for (let y = 0; y < H; y++) {
    let l = -1;
    let r = -1;
    for (let x = 0; x < W; x++) if (mask[y * W + x]) { l = x; break; }
    for (let x = W - 1; x >= 0; x--) if (mask[y * W + x]) { r = x; break; }
    if (l >= 0 && r - l >= 2) {
      L[y] = l;
      R[y] = r + 1;
      clipL[y] = l <= 1 ? 1 : 0;
      clipR[y] = r >= W - 2 ? 1 : 0;
      if (top < 0) top = y;
    }
  }
  return { L, R, clipL, clipR, top };
}

function landmarkHeights(view) {
  const f = view.meta.face;
  if (!f || !f.landmarks) throw new Error(`no face found in ${view.dir}`);
  const lm = f.landmarks;
  const mean = (pts, k) => pts.reduce((s, p) => s + p[k], 0) / pts.length;
  const maxY = (pts) => Math.max(...pts.map((p) => p[1]));
  const pupils = [...(lm.leftPupil || []), ...(lm.rightPupil || [])];
  const brows = [...(lm.leftEyebrow || []), ...(lm.rightEyebrow || [])];
  return {
    crown: view.edges.top,
    brow: brows.length ? mean(brows, 1) : NaN,
    eye: pupils.length ? mean(pupils, 1) : mean([...lm.leftEye, ...lm.rightEye], 1),
    nose: lm.nose ? maxY(lm.nose) : NaN,
    mouth: lm.outerLips ? mean(lm.outerLips, 1) : NaN,
    chin: lm.faceContour ? maxY(lm.faceContour) : NaN,
  };
}

// Least squares y_front = k * y_view + b over shared landmarks.
function fitVertical(hf, hv) {
  const w = { crown: 1.5, brow: 1, eye: 2, nose: 1, mouth: 2, chin: 1 };
  let sw = 0, sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (const k of Object.keys(w)) {
    if (!Number.isFinite(hf[k]) || !Number.isFinite(hv[k])) continue;
    sw += w[k];
    sx += w[k] * hv[k];
    sy += w[k] * hf[k];
    sxx += w[k] * hv[k] * hv[k];
    sxy += w[k] * hv[k] * hf[k];
  }
  const k = (sw * sxy - sx * sy) / (sw * sxx - sx * sx);
  const b = (sy - k * sx) / sw;
  const res = {};
  for (const key of Object.keys(w)) res[key] = +(k * hv[key] + b - hf[key]).toFixed(1);
  return { k, b, residuals: res };
}

function otsu(values) {
  const hist = new Float64Array(256);
  for (const v of values) hist[clamp(Math.round(v), 0, 255)]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 80;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB;
    const mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) {
      best = between;
      thr = t;
    }
  }
  return thr;
}

// Hair mask for one view: dark pixels inside the matte, above the chin, away from brows and eyes.
function hairMask(view, chinRow) {
  const { W, H, mask, lum } = view;
  const vals = [];
  for (let y = view.edges.top; y < chinRow; y++) for (let x = 0; x < W; x++) if (mask[y * W + x]) vals.push(lum[y * W + x]);
  const thr = Math.min(otsu(vals), 95);
  const lm = view.meta.face.landmarks;
  const boxes = [];
  for (const k of ['leftEyebrow', 'rightEyebrow', 'leftEye', 'rightEye']) {
    const p = lm[k];
    if (!p) continue;
    const xs = p.map((q) => q[0]);
    const ys = p.map((q) => q[1]);
    const isBrow = k.endsWith('Eyebrow');
    const padX = (Math.max(...xs) - Math.min(...xs)) * (isBrow ? 0.04 : 0.15) + 4;
    const padY = (Math.max(...ys) - Math.min(...ys)) * (isBrow ? 0.35 : 0.5) + 5;
    boxes.push([Math.min(...xs) - padX, Math.min(...ys) - padY, Math.max(...xs) + padX, Math.max(...ys) + padY]);
  }
  let hm = new Uint8Array(W * H);
  for (let y = view.edges.top; y < Math.min(H, chinRow); y++) {
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!mask[i] || lum[i] > thr) continue;
      if (boxes.some((b) => x >= b[0] && x <= b[2] && y >= b[1] && y <= b[3])) continue;
      hm[i] = 1;
    }
  }
  // Close small gaps (highlights in the hair) and drop specks (freckles, nostrils).
  hm = erode(dilate(hm, W, H, 4), W, H, 4);
  hm = dilate(erode(hm, W, H, 3), W, H, 3);
  for (let i = 0; i < W * H; i++) hm[i] &= view.mask[i];
  return { mask: hm, threshold: thr };
}

// ---------- the model ----------

export async function photoModel(args, opts = {}) {
  const names = await ensureViews(args);
  const V = Object.fromEntries(names.map((n) => [n, loadView(path.join(args.work, n))]));
  const F = V.front;
  const HF = F.H;
  const log = (...a) => console.log('  fit:', ...a);
  const report = { views: {} };

  // Model coordinates: x = u - u0, y = HF - v (front pixels).
  const hF = landmarkHeights(F);
  const rowOf = (y) => HF - y; // front row of model y
  const yOf = (v) => HF - v;
  const fe = F.edges;
  const crownY = yOf(fe.top);
  const eyeY = yOf(hF.eye);
  const chinY = yOf(hF.chin);
  const headH = crownY - chinY;

  // Front half widths per front row, smoothed lightly.
  const hwRow = new Float64Array(HF).fill(NaN);
  const cxRow = new Float64Array(HF).fill(NaN);
  for (let v = 0; v < HF; v++) {
    if (Number.isNaN(fe.L[v])) continue;
    hwRow[v] = (fe.R[v] - fe.L[v]) / 2;
    cxRow[v] = (fe.R[v] + fe.L[v]) / 2;
  }
  // Neck: narrowest row between the chin and 0.9 head heights below it.
  let neckRow = -1;
  let neckW = Infinity;
  for (let v = Math.round(hF.chin); v < Math.min(HF, hF.chin + headH * 0.9); v++) {
    if (fe.clipL[v] || fe.clipR[v] || Number.isNaN(hwRow[v])) continue;
    if (hwRow[v] < neckW) {
      neckW = hwRow[v];
      neckRow = v;
    }
  }
  const u0 = cxRow[neckRow];
  const neckY = yOf(neckRow);
  log(`front ${F.W}x${F.H}, crown row ${fe.top}, eye ${hF.eye.toFixed(0)}, chin ${hF.chin.toFixed(0)}, neck row ${neckRow} (half width ${neckW.toFixed(0)} px), head height ${headH.toFixed(0)} px`);

  // Head half width (widest head row above the chin, ignoring ears).
  let headHW = 0;
  for (let v = fe.top; v < hF.chin; v++) if (hwRow[v] > headHW) headHW = hwRow[v];

  // ---- shoulders: fit the visible outline below the neck, extend where the photo clips it ----
  const shoulderPts = [];
  for (let v = neckRow; v < HF; v++) {
    if (Number.isNaN(hwRow[v])) continue;
    const y = yOf(v);
    if (!fe.clipL[v]) shoulderPts.push([y, u0 - fe.L[v]]);
    if (!fe.clipR[v]) shoulderPts.push([y, fe.R[v] - u0]);
  }
  const visibleMax = Math.max(...shoulderPts.map((p) => p[1]));
  const prior = 2.45 * headHW; // bideltoid half width, about 2.45 head half widths (hair included)
  let bestFit = null;
  for (let hwM = Math.max(visibleMax, 1.6 * headHW); hwM <= 3.2 * headHW; hwM += headHW * 0.02) {
    for (let Ls = 0.25; Ls <= 1.6; Ls += 0.025) {
      const L = Ls * headH;
      for (const p of [1.6, 2, 2.5, 3]) {
        let e = 0;
        for (const [y, hw] of shoulderPts) {
          const t = clamp((neckY - y) / L, 0, 1);
          const pred = neckW + (hwM - neckW) * (1 - Math.pow(1 - t, p));
          e += (pred - hw) ** 2;
        }
        e = e / shoulderPts.length + 0.15 * (hwM - prior) ** 2;
        if (!bestFit || e < bestFit.e) bestFit = { e, hwM, L, p };
      }
    }
  }
  const shoulderHW = (y) => {
    const t = clamp((neckY - y) / bestFit.L, 0, 1);
    return neckW + (bestFit.hwM - neckW) * (1 - Math.pow(1 - t, bestFit.p));
  };
  log(`shoulders: visible max ${visibleMax.toFixed(0)} px, fitted half width ${bestFit.hwM.toFixed(0)} px (prior ${prior.toFixed(0)}), drop ${(bestFit.L / headH).toFixed(2)} head heights`);

  // Bust extends a little below the photo so the plate's bottom edge cuts through it.
  const yTop = crownY;
  const yBottom = -0.06 * headH;
  const N = Math.round((yTop - yBottom) / 2);
  const ys = Array.from({ length: N }, (_, i) => lerp(yTop, yBottom, i / (N - 1)));

  // Per model row: front half width and center.
  const hwY = new Float64Array(N);
  const cxY = new Float64Array(N);
  // Below the neck the width is the fitted shoulder curve plus the measured difference, which
  // fades out before the rows where the photo clips, so the outline has no steps.
  const resid = new Float64Array(N).fill(NaN);
  let firstClip = N;
  for (let i = 0; i < N; i++) {
    const y = ys[i];
    const v = Math.round(rowOf(y));
    const inPhoto = v >= 0 && v < HF && !Number.isNaN(hwRow[v]);
    if (y < neckY) {
      const clipped = !inPhoto || fe.clipL[v] || fe.clipR[v];
      if (clipped && i < firstClip) firstClip = i;
      if (!clipped) resid[i] = hwRow[v] - shoulderHW(y);
    } else {
      hwY[i] = inPhoto ? hwRow[v] : 0;
      cxY[i] = inPhoto ? cxRow[v] - u0 : 0;
    }
  }
  const residS = smooth1D(resid, 4);
  const taper = 25;
  for (let i = 0; i < N; i++) {
    const y = ys[i];
    if (y >= neckY) continue;
    const w = i < firstClip ? clamp((firstClip - i) / taper, 0, 1) : 0;
    const r = Number.isFinite(residS[i]) ? residS[i] : 0;
    hwY[i] = shoulderHW(y) + r * w;
    cxY[i] = 0;
  }

  // Ears: bumps in the front outline between the brows and the mouth, measured per side.
  const ears = [];
  const earLo = yOf(hF.mouth);
  const earHi = yOf(hF.brow) + 0.05 * headH;
  const sideOff = { L: new Float64Array(N), R: new Float64Array(N) };
  for (let i = 0; i < N; i++) {
    const v = Math.round(rowOf(ys[i]));
    sideOff.L[i] = v >= 0 && v < HF && !Number.isNaN(fe.L[v]) ? u0 - fe.L[v] : 0;
    sideOff.R[i] = v >= 0 && v < HF && !Number.isNaN(fe.R[v]) ? fe.R[v] - u0 : 0;
  }
  const earWin = Math.round((0.09 * headH) / 2);
  for (const [side, key] of [[-1, 'L'], [1, 'R']]) {
    const raw = sideOff[key];
    const orig = Float64Array.from(raw);
    const base = smooth1D(open1D(raw, earWin), 3);
    let best = 0;
    let rows = [];
    for (let i = 0; i < N; i++) {
      if (ys[i] > earHi || ys[i] < earLo) continue;
      const bump = raw[i] - base[i];
      if (bump > 0.006 * headHW * 2) rows.push(i);
      best = Math.max(best, bump);
    }
    // Keep the head section smooth through the whole ear zone on both sides, ear or not, so no
    // ledge runs across the face at the top or bottom of the ears.
    {
      const zone = [];
      for (let i = 0; i < N; i++) if (ys[i] <= earHi && ys[i] >= earLo) zone.push(i);
      if (zone.length) {
        const z0i = zone[0];
        const z1i = zone[zone.length - 1];
        const ext = 12;
        for (let i = Math.max(0, z0i - ext); i <= Math.min(N - 1, z1i + ext); i++) {
          const w = i < z0i ? 1 - (z0i - i) / ext : i > z1i ? 1 - (i - z1i) / ext : 1;
          raw[i] = raw[i] * (1 - w) + Math.min(raw[i], base[i]) * w;
        }
      }
    }
    if (rows.length > 6) {
      const i0 = Math.min(...rows);
      const i1 = Math.max(...rows);
      const yA = ys[i1];
      const yB = ys[i0];
      const outF = pchip(Array.from({ length: i1 - i0 + 1 }, (_, k) => [ys[i0 + k], orig[i0 + k]]));
      const baseF = pchip(Array.from({ length: i1 - i0 + 1 }, (_, k) => [ys[i0 + k], base[i0 + k]]));
      ears.push({ side, y0: yA, y1: yB, outRaw: outF, baseRaw: baseF });
      log(`ear ${key}: ${rows.length} rows, sticks out up to ${best.toFixed(1)} px`);
    } else log(`ear ${key}: not found in the outline (max bump ${best.toFixed(1)} px)`);
  }
  for (let i = 0; i < N; i++) {
    if (ys[i] < neckY) continue;
    if (sideOff.L[i] > 0 && sideOff.R[i] > 0) {
      hwY[i] = (sideOff.L[i] + sideOff.R[i]) / 2;
      cxY[i] = (sideOff.R[i] - sideOff.L[i]) / 2;
    }
  }
  {
    // Light smoothing across rows removes one-row steps (hair tufts, matte noise).
    const hs = smooth1D(hwY, 2.5);
    const cs = smooth1D(cxY, 4);
    const iCrown = 0;
    for (let i = iCrown + 3; i < N; i++) {
      hwY[i] = hs[i];
      cxY[i] = cs[i];
    }
  }

  // ---- front surface from depth ----
  const D = F.depth;
  // The surface itself uses blurred depth: lightly on the face, heavily on the shirt so collar
  // edges and folds do not turn into lines of points.
  const Dface = blur2D(D, F.W, HF, 2.5);
  const Dbody = blur2D(D, F.W, HF, 12);
  const dAt = (x, y) => {
    const t = smoothstep(chinY, chinY - 0.25 * headH, y);
    const u = x + u0;
    const v = rowOf(y);
    return bilinear(Dface, F.W, HF, u, v) * (1 - t) + bilinear(Dbody, F.W, HF, u, v) * t;
  };
  const inMask = (x, y) => {
    const u = Math.round(x + u0);
    const v = Math.round(rowOf(y));
    return u >= 0 && u < F.W && v >= 0 && v < HF && F.mask[v * F.W + u] === 1;
  };

  // ---- turned views: vertical alignment ----
  const turned = [];
  for (const name of ['right', 'left']) {
    if (!V[name]) continue;
    const view = V[name];
    const h = landmarkHeights(view);
    const vfit = fitVertical(hF, h);
    view.k = vfit.k;
    view.b = vfit.b;
    view.sign = name === 'right' ? 1 : -1;
    view.name = name;
    log(`${name}: scale ${vfit.k.toFixed(4)} (view px -> front px), landmark residuals ${JSON.stringify(vfit.residuals)}`);
    turned.push(view);
    report.views[name] = { scale: vfit.k, landmarkResiduals: vfit.residuals, visionYaw: view.meta.face.yawDeg };
  }
  // Turned view edge in model units at model y: x' = k * u - c. Returns [L, R, clippedL, clippedR].
  const viewEdge = (view, y) => {
    const vv = (HF - y - view.b) / view.k;
    const v = Math.round(vv);
    if (v < 0 || v >= view.H || Number.isNaN(view.edges.L[v])) return null;
    return { L: view.k * view.edges.L[v], R: view.k * view.edges.R[v], cL: view.edges.clipL[v], cR: view.edges.clipR[v] };
  };

  // ---- yaw and depth scale from the leading edges ----
  // Rows used: from the brow down to the chin (the leading edge there is the face).
  const faceRows = ys.filter((y) => y <= yOf(hF.brow) && y >= chinY + 0.02 * headH);
  const rowSamples = (y) => {
    const v = rowOf(y);
    const vi = Math.round(v);
    const l = fe.L[vi];
    const r = fe.R[vi];
    const pts = [];
    const inset = 0.03 * (r - l);
    for (let k = 0; k <= 80; k++) {
      const u = lerp(l + inset, r - inset, k / 80);
      pts.push([u - u0, bilinear(D, F.W, HF, u, v)]);
    }
    return pts;
  };
  const faceSamples = faceRows.map((y) => ({ y, pts: rowSamples(y) }));
  // depth spread across the face at the nose row, for a first alpha guess
  const noseSamples = rowSamples(yOf(hF.nose) + 0.02 * headH);
  const dMax = Math.max(...noseSamples.map((p) => p[1]));
  const dEdge = (noseSamples[0][1] + noseSamples[noseSamples.length - 1][1]) / 2;
  const alpha0 = (0.55 * 2 * headHW) / Math.max(1e-6, dMax - dEdge);

  const leadingFit = (view, A, B) => {
    // returns { C, rss, n } for fixed A (cos yaw) and B (alpha sin yaw, signed)
    let s = 0;
    let n = 0;
    const res = [];
    for (const fs_ of faceSamples) {
      const e = viewEdge(view, fs_.y);
      if (!e) continue;
      const meas = view.sign > 0 ? e.R : e.L;
      if ((view.sign > 0 && e.cR) || (view.sign < 0 && e.cL)) continue;
      let best = view.sign > 0 ? -Infinity : Infinity;
      for (const [x, d] of fs_.pts) {
        const val = A * x + B * d;
        if (view.sign > 0 ? val > best : val < best) best = val;
      }
      res.push(meas - best);
      s += meas - best;
      n++;
    }
    const C = s / n;
    let rss = 0;
    for (const r of res) rss += (r - C) ** 2;
    return { C, rss: rss / n, n };
  };
  // Joint search: yaw per view and a shared alpha.
  let best = null;
  const yawRange = opts.yawOverride ? null : [25, 62];
  for (let as = 0.4; as <= 2.5; as *= 1.04) {
    const alpha = alpha0 * as;
    let total = 0;
    const per = {};
    for (const view of turned) {
      let vb = null;
      const candidates = opts.yawOverride ? [Math.abs(opts.yawOverride[view.name])] : [];
      if (!opts.yawOverride) for (let t = yawRange[0]; t <= yawRange[1]; t += 0.5) candidates.push(t);
      for (const t of candidates) {
        const A = Math.cos(t * DEG);
        const B = view.sign * alpha * Math.sin(t * DEG);
        const r = leadingFit(view, A, B);
        if (!vb || r.rss < vb.rss) vb = { yaw: t, ...r };
      }
      per[view.name] = vb;
      total += vb.rss;
    }
    // Prior: head depth to width about 1.2 (hair included); checked after the back fit, so here
    // only a weak pull toward the anatomical alpha guess.
    total += 0.02 * Math.log(as) ** 2 * total;
    if (!best || total < best.total) best = { total, alpha, per };
  }
  const alpha = best.alpha;
  for (const view of turned) {
    const p = best.per[view.name];
    view.yaw = view.sign * p.yaw * DEG;
    view.c = p.C;
    log(`${view.name}: yaw ${(view.yaw / DEG).toFixed(1)} deg from the leading edge (rms ${Math.sqrt(p.rss).toFixed(1)} px over ${p.n} rows)`);
    report.views[view.name].yawLeadingEdge = +(view.yaw / DEG).toFixed(1);
    report.views[view.name].leadingRms = +Math.sqrt(p.rss).toFixed(2);
  }
  log(`depth scale alpha ${alpha.toFixed(1)} px per depth unit (first guess ${alpha0.toFixed(1)})`);
  report.alpha = alpha;

  // ---- per-row sections ----
  const nfFit = new Float64Array(N).fill(2.2);
  const zfY = new Float64Array(N);
  const zbY = new Float64Array(N);
  const zcY = new Float64Array(N);
  const okY = new Uint8Array(N);
  const frontPts = [];
  for (let i = 0; i < N; i++) {
    const y = ys[i];
    const v = rowOf(y);
    const vi = Math.round(v);
    const inPhoto = vi >= 0 && vi < HF && !Number.isNaN(fe.L[vi]);
    if (!inPhoto || hwY[i] < 2) {
      frontPts.push(null);
      continue;
    }
    const l = Math.max(fe.L[vi], 0);
    const r = Math.min(fe.R[vi], F.W - 1);
    const inset = Math.min(0.04 * (r - l), 6);
    const pts = [];
    for (let k = 0; k <= 64; k++) {
      const u = lerp(l + inset, r - inset, k / 64);
      pts.push([u - u0, alpha * bilinear(D, F.W, HF, u, v)]);
    }
    frontPts.push(pts);
    // Depth right at the outline bleeds into the background, so fit the interior of the row with
    // a superellipse arc z = zc + bF * (1 - |u|^n)^(1/n), u = (x - cx) / hw, by least squares.
    // The exponent is fitted too: a peaked profile (only the chin or nose forward) gets a pointed
    // front, a flat one (forehead, chest) a fuller one.
    let zc;
    let bF;
    let bestRes = Infinity;
    let nBest = 2.2;
    let s00 = 0;
    for (const n of [1.3, 1.5, 1.75, 2.0, 2.3, 2.7]) {
      let t0 = 0, t1 = 0, s01 = 0, s11 = 0;
      s00 = 0;
      const use = [];
      for (const [x, z] of pts) {
        const u = (x - cxY[i]) / hwY[i];
        if (Math.abs(u) > 0.8) continue;
        const g = Math.pow(1 - Math.pow(Math.abs(u), n), 1 / n);
        use.push([g, z]);
        s00 += 1; s01 += g; s11 += g * g; t0 += z; t1 += g * z;
      }
      const det = s00 * s11 - s01 * s01;
      if (s00 < 6 || Math.abs(det) < 1e-9) continue;
      const b = (s00 * t1 - s01 * t0) / det;
      const c0 = (t0 - b * s01) / s00;
      let res = 0;
      for (const [g, z] of use) res += (c0 + b * g - z) ** 2;
      if (res < bestRes) {
        bestRes = res;
        bF = b;
        zc = c0;
        nBest = n;
      }
    }
    nfFit[i] = nBest;
    if (Number.isFinite(bF)) {
      // fitted above
    } else {
      bF = 0.8 * hwY[i];
      zc = Math.max(...pts.map((p) => p[1])) - bF;
    }
    const lim = y > chinY ? [0.45, 1.3] : [0.3, 1.2];
    const bFc = clamp(bF, lim[0] * hwY[i], lim[1] * hwY[i]);
    zc += bF - bFc;
    zcY[i] = zc;
    // The section's front is the fitted arc; narrow features (nose, lips) come from the depth
    // surface itself, so they do not push the whole row forward.
    zfY[i] = zc + bFc;
    okY[i] = 1;
  }
  // Smooth the section center and front over many rows; the per-row fit is noisy.
  const zcS = smooth1D(Array.from(zcY, (z, i) => (okY[i] ? z : NaN)), 12);
  const bS = smooth1D(Array.from(zfY, (z, i) => (okY[i] ? z - zcY[i] : NaN)), 12);
  for (let i = 0; i < N; i++) if (okY[i]) {
    zcY[i] = zcS[i];
    zfY[i] = zcS[i] + bS[i];
  }

  // Back extent from the trailing edges of the turned views.
  const bBY = new Float64Array(N).fill(NaN);
  const NB_HEAD = 2.2;
  const NB_TORSO = 2.0;
  const nbAt = (y) => (y < neckY - 0.1 * headH ? NB_TORSO : NB_HEAD);
  const sectionExtent = (cx, hw, zc, zfront, bB, pts, yaw, wantMin, nb = NB_HEAD) => {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let m = wantMin ? Infinity : -Infinity;
    for (let k = 0; k <= 48; k++) {
      const th = Math.PI + (Math.PI * k) / 48; // back half
      const cc = Math.cos(th);
      const ss = Math.sin(th);
      const x = cx + hw * Math.sign(cc) * Math.pow(Math.abs(cc), 2 / nb);
      const z = zc + bB * Math.sign(ss) * Math.pow(Math.abs(ss), 2 / nb);
      const val = x * c + z * s;
      m = wantMin ? Math.min(m, val) : Math.max(m, val);
    }
    if (pts) for (const [x, z] of pts) {
      const val = x * c + z * s;
      m = wantMin ? Math.min(m, val) : Math.max(m, val);
    }
    return m;
  };
  for (let i = 0; i < N; i++) {
    if (!okY[i]) continue;
    const meas = [];
    const vfi = Math.round(rowOf(ys[i]));
    if (fe.clipL[vfi] || fe.clipR[vfi]) continue;
    for (const view of turned) {
      const e = viewEdge(view, ys[i]);
      if (!e) continue;
      // trailing edge: left for a view turned right (yaw > 0), right for one turned left
      if (view.sign > 0 && !e.cL) meas.push({ view, t: e.L - view.c, min: true });
      if (view.sign < 0 && !e.cR) meas.push({ view, t: e.R - view.c, min: false });
    }
    if (!meas.length) continue;
    let bestB = NaN;
    let bestE = Infinity;
    for (let bB = 0.1 * hwY[i]; bB <= 3.5 * hwY[i] + 2; bB += Math.max(0.5, hwY[i] * 0.01)) {
      let e = 0;
      for (const m of meas) {
        const pred = sectionExtent(cxY[i], hwY[i], zcY[i], zfY[i], bB, frontPts[i], m.view.yaw, m.min, nbAt(ys[i]));
        e += (pred - m.t) ** 2;
      }
      if (e < bestE) {
        bestE = e;
        bestB = bB;
      }
    }
    bBY[i] = bestB;
  }
  // Fill and smooth the back: torso rows get depth from proportions where the photos are clipped.
  const bBs = smooth1D(bBY, 5);
  const torsoDepth = (y) => {
    // Total chest depth about 0.46 of the shoulder width; blend in from the neck down.
    const t = smoothstep(neckY, neckY - 0.9 * headH, y);
    return t;
  };
  let lastHeadBack = NaN;
  const neckDepthRows = [];
  for (let i = 0; i < N; i++) if (Number.isFinite(bBs[i]) && Math.abs(ys[i] - neckY) < 0.06 * headH) neckDepthRows.push(bBs[i] + (zfY[i] - zcY[i]));
  const neckDepth = neckDepthRows.length ? neckDepthRows.reduce((a, b) => a + b, 0) / neckDepthRows.length : 2.1 * neckW;
  const chestDepth = 0.42 * 2 * bestFit.hwM;
  // Where the neck widens into the shoulders.
  let neckBaseY = neckY;
  for (let i = 0; i < N; i++) if (ys[i] < neckY && hwY[i] > 1.25 * neckW) { neckBaseY = ys[i]; break; }
  for (let i = 0; i < N; i++) {
    const y = ys[i];
    const bF = okY[i] ? zfY[i] - zcY[i] : NaN;
    // Measured back, clamped to plausible ranges (head with hair, then neck).
    let meas = NaN;
    if (Number.isFinite(bBs[i])) {
      const lim = y > chinY + 0.05 * headH ? [0.55, 1.75] : y > neckBaseY ? [0.4, 1.25] : [0.18, 0.7];
      meas = clamp(bBs[i], lim[0] * hwY[i], lim[1] * hwY[i]);
      lastHeadBack = meas;
    } else if (y > chinY) meas = Number.isFinite(lastHeadBack) ? lastHeadBack : hwY[i] * 1.2;
    // Torso back from proportions where the photos are clipped: the shoulder tops stay about as
    // deep as the neck, and the chest reaches full depth near the armpits.
    const t = smoothstep(neckBaseY - 0.3 * headH, neckBaseY - 1.0 * headH, y);
    const total = lerp(neckDepth, chestDepth, t);
    const bf = Number.isFinite(bF) ? bF : total * 0.45;
    const priorB = Math.max(total - bf, total * 0.4);
    zbY[i] = zcY[i] - (Number.isFinite(meas) ? meas : priorB);
    if (y < neckBaseY) {
      // Torso: a smooth depth profile from the neck to the chest, the widest point at mid depth.
      // (The turned photos clip the shoulders, and their trailing edge there mostly measures width.)
      const tt = smoothstep(neckBaseY, neckBaseY - 1.0 * headH, y);
      const tot = lerp(neckDepth, chestDepth, tt);
      const zfr = okY[i] ? zfY[i] : zfY[Math.max(0, i - 1)];
      zbY[i] = zfr - tot;
      zcY[i] = zfr - tot / 2;
      const wB = smoothstep(neckBaseY - 0.08 * headH, neckBaseY, y);
      if (Number.isFinite(meas) && wB > 0) zbY[i] = lerp(zbY[i], zcY[i] - meas, wB);
    }
  }
  // Rows outside the photo (below the bottom, completed shoulders): continue the last measured row.
  let lastOk = -1;
  for (let i = 0; i < N; i++) if (okY[i]) lastOk = i;
  for (let i = lastOk + 1; i < N; i++) {
    zcY[i] = zcY[lastOk];
    zfY[i] = zfY[lastOk];
    zbY[i] = zbY[lastOk];
  }
  for (let i = 0; i < N; i++) {
    if (!okY[i] && i < lastOk) {
      // gaps inside the photo (rare): copy neighbor
      zcY[i] = zcY[Math.max(0, i - 1)];
      zfY[i] = zfY[Math.max(0, i - 1)];
      zbY[i] = zbY[Math.max(0, i - 1)];
    }
  }
  // Below the chin, depth changes gradually: limit how fast the back can push out and the front
  // can pull in from one row to the next (no collar shelf between the neck and the shoulders).
  {
    const iChin = ys.findIndex((y) => y < chinY);
    const dy = (yTop - yBottom) / (N - 1);
    for (let i = Math.max(1, iChin + 1); i < N; i++) {
      zbY[i] = Math.max(zbY[i], zbY[i - 1] - 0.55 * dy);
      zbY[i] = Math.min(zbY[i], zbY[i - 1] + 0.8 * dy);
      zfY[i] = Math.max(zfY[i], zfY[i - 1] - 0.35 * dy);
      zfY[i] = Math.min(zfY[i], zfY[i - 1] + 0.8 * dy);
    }
  }
  const zbS = smooth1D(zbY, 6);
  const zfS = smooth1D(zfY, 2);

  // Center everything so the neck axis is x = 0, z = 0.
  const iNeck = ys.reduce((bi, y, i) => (Math.abs(y - neckY) < Math.abs(ys[bi] - neckY) ? i : bi), 0);
  const z0 = (zfS[iNeck] + zbS[iNeck]) / 2;
  // The turned views' offsets were measured with the uncentered z; correct them for the shift.
  for (const view of turned) view.cm = view.c + z0 * Math.sin(view.yaw);

  const nfS = smooth1D(nfFit, 14);
  // Cap the crown smoothly: the top rows shrink to a point.
  const rowsObj = { y: Float64Array.from(ys) };
  for (const k of ['cx', 'hw', 'zf', 'zb', 'nf', 'nb', 'tf', 'cf']) rowsObj[k] = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const y = ys[i];
    const capT = clamp((crownY - y) / (0.035 * headH), 0, 1);
    const cap = Math.sqrt(1 - (1 - capT) ** 2);
    const zc = zcY[i] - z0;
    let zf = zfS[i] - z0;
    let zb = zbS[i] - z0;
    zf = zc + Math.max(0.5, zf - zc) * cap;
    zb = zc - Math.max(0.5, zc - zb) * cap;
    rowsObj.cx[i] = cxY[i];
    rowsObj.hw[i] = Math.max(0.5, hwY[i]) * (capT < 1 ? cap : 1);
    rowsObj.zf[i] = zf;
    rowsObj.zb[i] = zb;
    const torso = y < neckY - 0.25 * headH;
    rowsObj.nf[i] = torso ? 2.0 : nfS[i];
    rowsObj.nb[i] = nbAt(y);
    rowsObj.tf[i] = 0;
    const tw = smoothstep(neckBaseY + 0.06 * headH, neckBaseY - 0.12 * headH, y);
    rowsObj.cf[i] = lerp(clamp((zc - zb) / Math.max(1e-6, zf - zb), 0.3, 0.7), 0.5, tw);
  }
  {
    // A last pass so the widest point of each section drifts slowly from row to row.
    const cfS = smooth1D(rowsObj.cf, 14);
    for (let i = 0; i < N; i++) rowsObj.cf[i] = cfS[i];
  }
  // The crown cap: rows near the top are too thin for depth, so carry the section center (and the
  // front/back split) up from a reliable row a little below the crown.
  {
    const iRef = ys.findIndex((y) => y < crownY - 0.07 * headH);
    const zcRef = rowsObj.zb[iRef] + (rowsObj.zf[iRef] - rowsObj.zb[iRef]) * rowsObj.cf[iRef];
    const bFr = rowsObj.zf[iRef] - zcRef;
    const bBr = zcRef - rowsObj.zb[iRef];
    const hwr = rowsObj.hw[iRef];
    for (let i = 0; i < iRef; i++) {
      const k = rowsObj.hw[i] / Math.max(1e-6, hwr);
      rowsObj.zf[i] = zcRef + bFr * k;
      rowsObj.zb[i] = zcRef - bBr * k;
      rowsObj.cf[i] = bBr / (bFr + bBr);
    }
  }
  const rows = rowsObj;

  // Front override: the depth surface where the photo shows it, fading out near the outline.
  const edgeFade = 0.06 * 2 * headHW;
  const front = (x, y, z) => {
    if (!inMask(x, y)) return null;
    const v = rowOf(y);
    const vi = Math.round(v);
    if (vi < 0 || vi >= HF) return null;
    // Distance to where the depth stops being trustworthy: the outline, or the photo border where
    // the photo clips the shoulders (fade wider there, the model surface takes over beyond it).
    const dl = (x + u0 - fe.L[vi]) / (fe.clipL[vi] ? 3 : 1);
    const dr = (fe.R[vi] - (x + u0)) / (fe.clipR[vi] ? 3 : 1);
    const w = smoothstep(0, edgeFade, Math.min(dl, dr));
    const zd = alpha * dAt(x, y) - z0;
    const torsoW = 1 - 0.4 * smoothstep(neckY - 0.4 * headH, neckY - 0.8 * headH, y);
    return { z: Math.max(zd, z - edgeFade), w: w * torsoW };
  };

  // Ears as plates on the model.
  const czAt = (y) => {
    const r = rowAt(rows, y);
    return r.zb + (r.zf - r.zb) * r.cf;
  };
  const earObjs = ears.map((e) => ({
    side: e.side,
    y0: e.y0,
    y1: e.y1,
    base: (y) => Math.max(1, (e.side > 0 ? e.baseRaw(y) - rowAt(rows, y).cx : e.baseRaw(y) + rowAt(rows, y).cx) - 3),
    out: (y) => (e.side > 0 ? e.outRaw(y) - rowAt(rows, y).cx : e.outRaw(y) + rowAt(rows, y).cx),
    z: (y) => czAt(y) - 0.04 * headHW,
    angle: 0.35,
    thick: 0.02 * headHW,
  }));

  // ---- hair and skin ----
  const hairF = hairMask(F, Math.round(hF.chin));
  log(`hair threshold (front) luminance ${hairF.threshold}`);
  const hairV = {};
  for (const view of turned) {
    const h = landmarkHeights(view);
    hairV[view.name] = hairMask(view, Math.round(h.chin));
  }
  // Lowest hair row at the back of the head, from the turned views (nape).
  let napeY = chinY + 0.2 * headH;
  for (const view of turned) {
    const hm = hairV[view.name].mask;
    let lowest = -1;
    for (let v = 0; v < view.H; v++) {
      const l = view.edges.L[v];
      const r = view.edges.R[v];
      if (Number.isNaN(l)) continue;
      const u = view.sign > 0 ? Math.round(l + 3) : Math.round(r - 4);
      if (u >= 0 && u < view.W && hm[v * view.W + u]) lowest = v;
    }
    if (lowest > 0) napeY = Math.min(napeY, HF - (view.k * lowest + view.b));
  }
  const viewProj = (view, p) => {
    const xr = p[0] * Math.cos(view.yaw) + p[2] * Math.sin(view.yaw);
    return [(xr + view.cm) / view.k, (HF - p[1] - view.b) / view.k];
  };
  const sample = (m, W, H, u, v) => {
    const ui = Math.round(u);
    const vi = Math.round(v);
    return ui >= 0 && ui < W && vi >= 0 && vi < H ? m[vi * W + ui] : 0;
  };
  const skinFront = (x, y) => {
    const u = Math.round(x + u0);
    const v = Math.round(rowOf(y));
    if (u < 0 || u >= F.W || v < 0 || v >= HF || !F.mask[v * F.W + u]) return 0;
    return F.lum[v * F.W + u] > hairF.threshold + 12 ? 1 : 0;
  };
  const classify = (p, n, vtag) => {
    if (vtag === 1) return { hair: 0, skin: 1 };
    const [x, y] = p;
    if (y < chinY - 0.02 * headH) {
      // neck and chest: skin where the front photo shows skin, else shirt
      if (y > neckY - 0.6 * headH && n[2] > 0.2) return { hair: 0, skin: skinFront(x, y) };
      const neckHalf = rowAt(rows, y).hw;
      return { hair: 0, skin: y > neckY - 0.25 * headH && neckHalf < neckW * 1.3 ? 1 : 0 };
    }
    // head: ask the view that sees this point best
    let bestV = null;
    let bestDot = 0.3;
    if (n[2] > bestDot) {
      bestDot = n[2];
      bestV = 'front';
    }
    for (const view of turned) {
      const d = -n[0] * Math.sin(view.yaw) * -1 * 0 + (n[0] * Math.sin(view.yaw) + n[2] * Math.cos(view.yaw)) * 1;
      // view direction in model space for a figure turned by yaw: (sin yaw, 0, cos yaw)
      if (d > bestDot) {
        bestDot = d;
        bestV = view;
      }
    }
    let hair;
    if (bestV === 'front') {
      const u = x + u0;
      const v = rowOf(y);
      // No hair faces the camera below the eyes (shadows under the jaw read dark in the photo).
      hair = y < eyeY - 0.05 * headH ? 0 : sample(hairF.mask, F.W, HF, u, v);
    } else if (bestV) {
      const [u, v] = viewProj(bestV, p);
      hair = sample(hairV[bestV.name].mask, bestV.W, bestV.H, u, v);
    } else {
      hair = y > napeY ? 1 : 0;
    }
    return { hair, skin: 1 - hair };
  };

  // ---- center part ----
  // Look for the lightest narrow column (scalp) in the top band of hair near the head center.
  const partBand = [Math.round(fe.top + 0.03 * headH), Math.round(fe.top + 0.14 * headH)];
  const colScore = [];
  const cxTop = cxRow[Math.round(fe.top + 0.1 * headH)];
  const span = Math.round(0.22 * headHW);
  for (let u = Math.round(cxTop - span); u <= Math.round(cxTop + span); u++) {
    let s = 0;
    let n = 0;
    for (let v = partBand[0]; v < partBand[1]; v++) {
      if (F.mask[v * F.W + u]) {
        s += F.lum[v * F.W + u];
        n++;
      }
    }
    colScore.push([u, n ? s / n : 0]);
  }
  const sm = smooth1D(colScore.map((c) => c[1]), 2);
  let partU = cxTop;
  let partBest = -Infinity;
  for (let k = 0; k < sm.length; k++) {
    // prefer the center a little
    const score = sm[k] - 0.05 * Math.abs(colScore[k][0] - cxTop);
    if (score > partBest) {
      partBest = score;
      partU = colScore[k][0];
    }
  }
  const partX = partU - u0;
  // Front hairline at the part column: first row below the crown where the hair ends.
  // The part column itself shows scalp, so measure in two bands just beside it.
  let hlRow = Math.round(hF.brow);
  const bandOff = Math.round(0.1 * headHW);
  const bandHalf = Math.round(0.05 * headHW);
  for (let v = fe.top + Math.round(0.04 * headH); v < hF.brow; v++) {
    let n = 0;
    let hcount = 0;
    for (const side of [-1, 1]) for (let du = -bandHalf; du <= bandHalf; du++) {
      const u = Math.round(partU + side * bandOff + du);
      n++;
      if (hairF.mask[v * F.W + u]) hcount++;
    }
    if (hcount / n < 0.3) {
      hlRow = v;
      break;
    }
  }
  const hlY = yOf(hlRow);
  log(`part at x ${partX.toFixed(0)} px from the neck center (head center ${(cxTop - u0).toFixed(0)}), front hairline ${((crownY - hlY) / headH).toFixed(2)} head heights below the crown, nape ${((crownY - napeY) / headH).toFixed(2)}`);
  const midY = (crownY + eyeY) / 2;
  const headCenter = [partX, midY, czAt(midY)];
  const hlZ = rowAt(rows, hlY).zf;
  const part = { cx: partX, line: partLine(rows, { headCenter, hairlineFront: [partX, hlY, hlZ], crownAngle: 0.95 }) };

  // ---- faint face lines from landmarks ----
  const lm = F.meta.face.landmarks;
  const toM = (pts) => pts.map((p) => [p[0] - u0, yOf(p[1])]);
  const segs = [];
  const addPoly = (pts, closed) => {
    if (!pts) return;
    const m = toM(pts);
    for (let i = 0; i < m.length - 1; i++) segs.push([m[i], m[i + 1]]);
    if (closed) segs.push([m[m.length - 1], m[0]]);
  };
  addPoly(lm.leftEyebrow, false);
  addPoly(lm.rightEyebrow, false);
  addPoly(lm.nose, false);
  if (lm.innerLips) {
    // the lip line: the middle of the inner lip contour
    const m = toM(lm.innerLips);
    const mid = m.slice().sort((a, b) => a[0] - b[0]);
    for (let i = 0; i < mid.length - 1; i++) segs.push([mid[i], mid[i + 1]]);
  }
  const featSigma = 0.012 * headH;
  const faceFeature = (p) => featureFromSegments(segs, p[0], p[1], featSigma);

  // Proportions, in head heights (crown to chin).
  const proportions = {
    headWidthWithHair: +((2 * headHW) / headH).toFixed(3),
    neckWidth: +((2 * neckW) / headH).toFixed(3),
    shoulderWidthFitted: +((2 * bestFit.hwM) / headH).toFixed(3),
    crownToEye: +((crownY - eyeY) / headH).toFixed(3),
    chinToNeck: +((chinY - neckY) / headH).toFixed(3),
  };
  // Head depth at the widest head row, for a sanity check.
  let hd = 0;
  let hdW = 1;
  for (let i = 0; i < N; i++) if (ys[i] > eyeY && ys[i] < crownY - 0.15 * headH && rows.zf[i] - rows.zb[i] > hd) {
    hd = rows.zf[i] - rows.zb[i];
    hdW = 2 * rows.hw[i];
  }
  proportions.headDepthToWidth = +(hd / hdW).toFixed(3);
  log(`proportions (head heights): ${JSON.stringify(proportions)}`);
  report.proportions = proportions;

  const shoulderY = neckY - bestFit.L * 0.85;
  const model = {
    rows,
    front,
    ears: earObjs,
    classify,
    faceFeature,
    part,
    hairOpts: { maxLen: headH * 0.7, partHalf: headH * 0.009 },
    meta: {
      units: 'front-photo px',
      source: 'photos',
      yTop,
      yBottom,
      headH,
      crownY,
      eyeY,
      chinY,
      neckY,
      shoulderY,
      shoulderHalfWidth: bestFit.hwM,
      centerX: 0,
      neckBaseY,
      proportions,
    },
  };
  // Everything the overlay check needs to project the figure into each photo.
  const fit = {
    front: { yaw: 0, k: 1, b: 0, c: u0, W: F.W, H: F.H, dir: F.dir },
    alpha,
    z0,
    u0,
    HF,
    neckBaseY,
    headH,
  };
  for (const view of turned) fit[view.name] = { yaw: view.yaw, k: view.k, b: view.b, c: view.cm, W: view.W, H: view.H, dir: view.dir };
  fs.writeFileSync(path.join(args.work, 'fit.json'), JSON.stringify({ fit, report }, null, 2));
  return { model, fit, report, extra: {} };
}
