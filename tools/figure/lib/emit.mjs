// Model -> points -> public/figure/*.bin + figure.json

import fs from 'node:fs';
import path from 'node:path';
import { encode, boundsOf } from './format.mjs';
import { rng } from './math.mjs';
import { buildMesh } from './model.mjs';
import { buildVisibility } from './occlusion.mjs';
import { GROUP, LOOK, PointSet, hairStrands, sampleSurface } from './points.mjs';

function hairSeeds(mesh, model, count, rand) {
  const { pos, nrm, idx, tag } = mesh;
  const T = idx.length / 3;
  const list = [];
  const cdf = [];
  let acc = 0;
  for (let t = 0; t < T; t++) {
    if (tag[idx[t * 3]] !== 0) continue;
    const a = idx[t * 3] * 3;
    const b = idx[t * 3 + 1] * 3;
    const c = idx[t * 3 + 2] * 3;
    const p = [0, 1, 2].map((d) => (pos[a + d] + pos[b + d] + pos[c + d]) / 3);
    const n = [0, 1, 2].map((d) => nrm[a + d] + nrm[b + d] + nrm[c + d]);
    if (p[1] < model.meta.chinY) continue;
    if (model.classify(p, n, 0).hair <= 0.5) continue;
    const u = [0, 1, 2].map((d) => pos[b + d] - pos[a + d]);
    const v = [0, 1, 2].map((d) => pos[c + d] - pos[a + d]);
    const area = 0.5 * Math.hypot(u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]);
    acc += area;
    list.push(p);
    cdf.push(acc);
  }
  const seeds = [];
  for (let k = 0; k < count && list.length; k++) {
    const u = rand() * acc;
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const m = (lo + hi) >> 1;
      if (cdf[m] < u) lo = m + 1;
      else hi = m;
    }
    seeds.push(list[lo]);
  }
  return seeds;
}

export function buildPoints(model, total, seed = 1, look = LOOK) {
  const rand = rng(seed);
  const mesh = buildMesh(model, { cols: look.turn ? 360 : 220 });
  // A turning figure is seen from its whole yaw range; the paper figure from -6, 0 and +6 degrees.
  const yaws = look.turn ? Array.from({ length: 7 }, (_, k) => ((-look.turn + (2 * look.turn * k) / 6) * Math.PI) / 180) : undefined;
  const vis = buildVisibility(mesh, { eps: 0.012 * model.meta.headH, yaws });
  model.visible = vis.visible;
  model.edgeDist = vis.edgeDist;
  model.outlineAt = vis.outlineAt;
  const surface = sampleSurface(mesh, model, total, rand, look);
  const strandBudget = Math.round(total * look.share.hair * (1 - look.hairFillShare));
  const seeds = hairSeeds(mesh, model, 4000, rand);
  // Smaller files keep the same number of strands with sparser dots along each one, so strands stay
  // light lines instead of solid ones at phone point sizes.
  const H = model.meta.headH;
  const k = Math.sqrt(60000 / total);
  const strands = hairStrands(model, strandBudget, rand, seeds, { ...(model.hairOpts || {}), spacing: H * 0.0055 * k, look });
  const all = new PointSet();
  all.append(surface);
  all.append(strands);
  // Trim or top up to the exact count.
  while (all.length > total) {
    const i = Math.floor(rand() * all.length);
    for (const k of Object.keys(all)) {
      all[k][i] = all[k][all[k].length - 1];
      all[k].pop();
    }
  }
  return { points: all, mesh, strands: strands.length, surface: surface.length };
}

export function groupCounts(ps) {
  const c = { body: 0, skin: 0, hair: 0, contour: 0 };
  const names = Object.fromEntries(Object.entries(GROUP).map(([k, v]) => [v, k]));
  for (const g of ps.group) c[names[g]]++;
  return c;
}

// Writes a file so readers never see it half written: temp file in the same folder, then rename.
export function writeAtomic(file, data) {
  const tmp = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.tmp`);
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export const PUBLISHED = ['figure-hi.bin', 'figure-lo.bin', 'figure.json', 'figure-fallback.webp', 'figure-fallback.png'];

// Copies a staged build into public/figure, one atomic rename per file (data first, json last).
export function publish(stageDir, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const order = ['figure-hi.bin', 'figure-lo.bin', 'figure-fallback.png', 'figure-fallback.webp', 'figure.json'];
  const done = [];
  for (const f of order) {
    const src = path.join(stageDir, f);
    if (!fs.existsSync(src)) continue;
    writeAtomic(path.join(outDir, f), fs.readFileSync(src));
    done.push(f);
  }
  return done;
}

export function writeOutputs(model, { hiCount = 60000, loCount = 18000, outDir, seed = 1, extra = {} }) {
  fs.mkdirSync(outDir, { recursive: true });
  const hi = buildPoints(model, hiCount, seed);
  const lo = buildPoints(model, loCount, seed + 101);
  // Both files share the hi bounds so they line up exactly.
  const bounds = boundsOf(hi.points);
  const pad = (bounds.max[1] - bounds.min[1]) * 0.002;
  for (let d = 0; d < 3; d++) {
    bounds.min[d] -= pad;
    bounds.max[d] += pad;
  }
  const fromPhotos = model.meta.source !== 'placeholder';
  const hiBuf = encode(hi.points, { fromPhotos, bounds });
  const loBuf = encode(lo.points, { fromPhotos, bounds });
  writeAtomic(path.join(outDir, 'figure-hi.bin'), hiBuf);
  writeAtomic(path.join(outDir, 'figure-lo.bin'), loBuf);
  const m = model.meta;
  const json = {
    version: 1,
    format: 'CAFG v1, see tools/figure/lib/format.mjs',
    source: m.source,
    units: m.units,
    builtAt: new Date().toISOString(),
    hi: { file: 'figure-hi.bin', count: hi.points.length, bytes: hiBuf.length, groups: groupCounts(hi.points) },
    lo: { file: 'figure-lo.bin', count: lo.points.length, bytes: loBuf.length, groups: groupCounts(lo.points) },
    bounds,
    // Framing landmarks in model units (y up). The renderer uses these to place the crown and eyeline.
    landmarks: {
      crownY: m.crownY,
      eyeY: m.eyeY,
      chinY: m.chinY,
      neckY: m.neckY,
      shoulderY: m.shoulderY,
      shoulderHalfWidth: m.shoulderHalfWidth,
      centerX: m.centerX,
      headH: m.headH,
    },
    proportions: m.proportions || null,
    ...extra,
  };
  writeAtomic(path.join(outDir, 'figure.json'), JSON.stringify(json, null, 2) + '\n');
  return { hi, lo, json };
}
