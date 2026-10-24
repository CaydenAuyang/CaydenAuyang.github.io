#!/usr/bin/env node
// Builds the figure for the night scene's signal (target B) into public/world/.
//
//   node tools/figure/signal.mjs                    rebuild from the photos and publish if it passes
//   node tools/figure/signal.mjs --no-publish       build and check, leave public/world alone
//   node tools/figure/signal.mjs --count 60000 --seed 3 --turn 35 --work <dir>
//
// Same privacy rule as build.mjs: photos are read in place and every photo-derived intermediate
// (decoded images, mattes, depth, fit.json, signal-fit.json, the overlays) stays in the work
// folder outside the repo. The only files written into the repo are the point data below.
//
// The figure turns on the site (up to 30 degrees each way, NIGHT-SIGNAL.md 5.1), so it is truly
// three-dimensional: the photo fit's template is deformed until its outline matches all three
// photos (lib/turnfit.mjs), and the points carry their surface normals so the shader can fade the
// ones facing away and brighten the ones on the outline at any angle.
//
// Output:
//   public/world/figure-signal.bin    "CASG" v2 points with normals, lib/signal-format.mjs
//   public/world/figure-signal.json   counts, groups, landmarks, how it was built
//
// The build is staged in <work>/stage-signal/ and checked there (turncheck.mjs: the outline
// against each photo and through the turn). It is copied into public/world only if the front
// match is 0.95 or more and each turned photo's 0.90 or more, one atomic rename per file.
//
// One file serves every tier: the points are ordered so the first N of them are an even sample
// of the whole figure (each group keeps its share in every prefix), so phones read only the first
// 16,000 points and low-tier desktops the first 30,000.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS, REPO, assertOutsideRepo } from './build.mjs';
import { buildPoints, groupCounts, writeAtomic } from './lib/emit.mjs';
import { GROUP, LOOK } from './lib/points.mjs';
import { encodeSignal, decodeSignal, orderForPrefixes, SIGNAL_STRIDE, SIGNAL_VERSION } from './lib/signal-format.mjs';
import { turnModel } from './lib/turnfit.mjs';
import { DONE_WHEN, runTurnCheck } from './turncheck.mjs';

const OUT = path.join(REPO, 'public/world');

// The night-sky look. Compared with the paper look (LOOK in points.mjs): more of the budget on the
// outline, a slightly smaller face share, hair strands a little heavier, quieter creases, and the
// chest dissolves over a third of the bust's height so the figure fades out above the skyline
// instead of ending in a cut.
export const SIGNAL_LOOK = {
  ...LOOK,
  share: { outline: 0.46, hair: 0.27, body: 0.205, ears: 0.025, face: 0.04 },
  hairFillShare: 0.1,
  bottomFade: 0.3,
  // Additive light turns any crease inside the outline into a bright line, so creases (the collar)
  // get less lift than on paper and the chest stays an even glow.
  rimFloor: 0.2,
  interiorCap: 0.1,
  // The yaw range the figure is seen from (30 degrees each way, plus room for the spring's
  // overshoot): visibility, the outline band and the edge-on weights all cover it.
  turn: 35,
};

function parseArgs(argv) {
  const args = { ...DEFAULTS, count: 60000, seed: 1, publish: true, turn: SIGNAL_LOOK.turn, fit: {} };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--no-publish') args.publish = false;
    else if (a === '--turn') args.turn = Number(next());
    else if (a === '--fit') args.fit = JSON.parse(next());
    else if (a === '--count') args.count = Number(next());
    else if (a === '--seed') args.seed = Number(next());
    else if (a === '--work') args.work = path.resolve(next());
    else if (a === '--front') args.front = path.resolve(next());
    else if (a === '--right') args.right = path.resolve(next());
    else if (a === '--left') args.left = path.resolve(next());
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return args;
}

async function fromPhotos(args) {
  assertOutsideRepo(args.work);
  const { photoModel } = await import('./lib/photo.mjs');
  // The paper build's best round used the fitted yaws; read its report so this fit matches it.
  let yawOverride = null;
  try {
    yawOverride = JSON.parse(fs.readFileSync(path.join(args.work, 'overlay-report.json'), 'utf8')).yawOverride ?? null;
  } catch {}
  const photo = await photoModel(args, { yawOverride });
  const turned = turnModel(photo, args.fit);
  const f = turned.report;
  console.log(`turn fit: turned outlines rms ${f.before.rms} -> ${f.after.rms} px (worst ${f.before.worst} -> ${f.after.worst}), ${f.measured} measured edges`);
  const m = turned.model.meta;
  const { points } = buildPoints(turned.model, args.count, args.seed, { ...SIGNAL_LOOK, turn: args.turn });
  const landmarks = { crownY: m.crownY, eyeY: m.eyeY, chinY: m.chinY, neckY: m.neckY, shoulderY: m.shoulderY, shoulderHalfWidth: m.shoulderHalfWidth, centerX: m.centerX, headH: m.headH };
  return { points, landmarks, source: 'photos (fit in figure-work, outside the repo)', turnFit: f };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 19).join('\n'));
    return;
  }
  const t0 = Date.now();
  const built = await fromPhotos(args);
  const ps = built.points;
  const L = built.landmarks;

  // Frame: origin at the center of the figure's bounding box, one unit = the figure's height
  // (crown to the bottom of the bust). FIGURE_ANCHOR places exactly this box.
  let minY = Infinity;
  let maxY = -Infinity;
  let minX = Infinity;
  let maxX = -Infinity;
  for (let i = 0; i < ps.length; i++) {
    minY = Math.min(minY, ps.y[i]);
    maxY = Math.max(maxY, ps.y[i]);
    minX = Math.min(minX, ps.x[i]);
    maxX = Math.max(maxX, ps.x[i]);
  }
  const height = maxY - minY;
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const norm = { x: [], y: [], z: [] };
  for (let i = 0; i < ps.length; i++) {
    norm.x.push((ps.x[i] - cx) / height);
    norm.y.push((ps.y[i] - cy) / height);
    norm.z.push(ps.z[i] / height);
  }
  // Hair strands: the pipeline writes each strand's dots one after another, so a run of hair points
  // with small steps between them is one strand. Keep strands whole in the prefix order.
  const runs = new Int32Array(ps.length).fill(-1);
  {
    const step = 0.012 * height;
    let run = 0;
    for (let i = 1; i < ps.length; i++) {
      if (ps.group[i] !== GROUP.hair || ps.group[i - 1] !== GROUP.hair) continue;
      const d = Math.hypot(ps.x[i] - ps.x[i - 1], ps.y[i] - ps.y[i - 1], ps.z[i] - ps.z[i - 1]);
      if (d < step) {
        if (runs[i - 1] < 0) runs[i - 1] = run++;
        runs[i] = runs[i - 1];
      }
    }
    const sizes = new Map();
    for (const r of runs) if (r >= 0) sizes.set(r, (sizes.get(r) || 0) + 1);
    console.log(`hair strands: ${sizes.size}, median ${[...sizes.values()].sort((a, b) => a - b)[sizes.size >> 1] ?? 0} dots`);
  }
  const order = orderForPrefixes(ps.group, args.seed + 17, runs);
  const buf = encodeSignal({ ...norm, nx: ps.nx, ny: ps.ny, nz: ps.nz, weight: ps.weight, group: ps.group, order: ps.order }, order);

  // Round trip check before anything is published.
  const back = decodeSignal(buf);
  if (back.count !== ps.length) throw new Error('round trip lost points');

  const ny = (y) => (y - cy) / height;
  const counts = groupCounts(ps);
  const prefixShares = [16000, 30000, ps.length].map((n) => {
    const c = [0, 0, 0, 0];
    for (let k = 0; k < Math.min(n, back.count); k++) c[back.group[k]]++;
    return { first: n, contour: +(c[GROUP.contour] / n).toFixed(3), hair: +(c[GROUP.hair] / n).toFixed(3), body: +(c[GROUP.body] / n).toFixed(3), skin: +(c[GROUP.skin] / n).toFixed(3) };
  });
  const json = {
    version: SIGNAL_VERSION,
    format: `CASG v${SIGNAL_VERSION} (positions, weight, group and arrival, normals), see tools/figure/lib/signal-format.mjs`,
    file: 'figure-signal.bin',
    count: ps.length,
    bytes: buf.length,
    bytesPerPoint: SIGNAL_STRIDE,
    tiers: { high: 60000, low: 30000, phone: 16000 },
    note: 'The first N points are an even sample of the whole figure; read a prefix for smaller tiers.',
    source: built.source,
    builtAt: new Date().toISOString(),
    units: 'figure heights; origin at the center of the bounding box in x and y, on the neck axis in z; x right, y up, z toward the viewer; true depth',
    turn: { maxYawDeg: 30, maxPitchDeg: 5, fittedTo: 'front, turned toward viewer right, turned toward viewer left' },
    aspect: +((maxX - minX) / height).toFixed(4),
    groups: counts,
    prefixShares,
    landmarks: {
      crown: +ny(L.crownY).toFixed(4),
      eye: +ny(L.eyeY).toFixed(4),
      chin: +ny(L.chinY).toFixed(4),
      shoulder: +ny(L.shoulderY).toFixed(4),
      shoulderHalfWidth: +(L.shoulderHalfWidth / height).toFixed(4),
    },
  };
  // Stage, check on the staged points, then publish.
  const stage = path.join(args.work, 'stage-signal');
  fs.mkdirSync(stage, { recursive: true });
  writeAtomic(path.join(stage, 'figure-signal.bin'), buf);
  writeAtomic(path.join(stage, 'figure-signal.json'), JSON.stringify(json, null, 2) + '\n');
  // Where the figure's units sit in the front photo's frame: photo-derived, so work folder only.
  fs.writeFileSync(path.join(args.work, 'signal-fit.json'), JSON.stringify({ height, cx, cy, turnFit: built.turnFit }, null, 2));
  console.log(`figure-signal.bin: ${ps.length} points, ${(buf.length / 1024).toFixed(0)} KB, groups ${JSON.stringify(counts)} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log(`prefix shares ${JSON.stringify(prefixShares)}`);
  const rep = runTurnCheck({ work: args.work, file: path.join(stage, 'figure-signal.bin') });
  if (!rep.pass) {
    console.warn(`not publishing: the done-when scores are front ${DONE_WHEN.front} and turned ${DONE_WHEN.turned} (staged in ${stage})`);
    process.exitCode = 1;
    return;
  }
  if (!args.publish) {
    console.log(`passes; staged in ${stage} (not published)`);
    return;
  }
  fs.mkdirSync(OUT, { recursive: true });
  writeAtomic(path.join(OUT, 'figure-signal.bin'), buf);
  writeAtomic(path.join(OUT, 'figure-signal.json'), JSON.stringify(json, null, 2) + '\n');
  console.log(`published to ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
