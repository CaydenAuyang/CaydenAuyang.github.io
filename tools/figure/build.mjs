#!/usr/bin/env node
// Builds the point figure into public/figure/.
//
//   node tools/figure/build.mjs --placeholder          procedural bust, no photos needed
//   node tools/figure/build.mjs                         the three photos (see README.md)
//   node tools/figure/build.mjs --front a.heic --right b.heic --left c.heic --work <dir>
//
// Photos are read in place. Everything made from them goes to the work folder, which defaults to
// ~/Documents/Claude/Projects/CERTIFICATE/figure-work and must stay outside the repo. Only point
// data and renders of the points are written into the repo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { publish, writeOutputs } from './lib/emit.mjs';
import { placeholderModel } from './lib/placeholder.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO = path.resolve(HERE, '../..');
export const OUT = path.join(REPO, 'public/figure');
const CERT = path.join(os.homedir(), 'Documents/Claude/Projects/CERTIFICATE');
export const DEFAULTS = {
  front: path.join(CERT, 'site-handoff/photos/1-front_IMG_1601.heic'),
  right: path.join(CERT, 'site-handoff/photos/2-turned-toward-viewer-right_IMG_1611.heic'),
  left: path.join(CERT, 'site-handoff/photos/3-turned-toward-viewer-left_IMG_1621.heic'),
  work: path.join(CERT, 'figure-work'),
};

export function parseArgs(argv) {
  const args = { ...DEFAULTS, placeholder: false, fallback: true, publish: true, hi: 60000, lo: 18000 };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--placeholder') args.placeholder = true;
    else if (a === '--no-fallback') args.fallback = false;
    else if (a === '--front') args.front = path.resolve(next());
    else if (a === '--right') args.right = path.resolve(next());
    else if (a === '--left') args.left = path.resolve(next());
    else if (a === '--work') args.work = path.resolve(next());
    else if (a === '--hi') args.hi = Number(next());
    else if (a === '--lo') args.lo = Number(next());
    else if (a === '--fresh') args.fresh = true;
    else if (a === '--rounds') args.rounds = Number(next());
    else if (a === '--no-publish') args.publish = false;
    else if (a === '--help' || a === '-h') args.help = true;
    else throw new Error(`unknown option ${a}`);
  }
  return args;
}

export function assertOutsideRepo(dir) {
  const rel = path.relative(REPO, path.resolve(dir));
  if (!rel.startsWith('..') && !path.isAbsolute(rel)) {
    throw new Error(`The work folder ${dir} is inside the repo. Photo-derived files must stay outside it.`);
  }
}

async function maybeFallback(args, stage) {
  if (!args.fallback) return;
  try {
    const mod = await import('./render-fallback.mjs');
    await mod.renderFallback({ repoRoot: REPO, mount: stage, src: '/__test/figure-hi.bin', srcmeta: '/__test/figure.json', outDir: stage });
  } catch (e) {
    console.warn(`fallback image skipped: ${e.message}`);
  }
}

function finish(args, stage) {
  if (args.publish === false) {
    console.log(`staged in ${stage} (not published; run again without --no-publish, or copy with care)`);
    return;
  }
  const files = publish(stage, OUT);
  console.log(`published to ${OUT}: ${files.join(', ')}`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
    return;
  }
  // Every build is staged first and published at the end, so public/figure never holds a mix.
  const stage = path.join(args.placeholder ? path.join(HERE, 'work') : args.work, 'stage');
  fs.mkdirSync(stage, { recursive: true });
  if (args.placeholder) {
    const t0 = Date.now();
    const { json } = writeOutputs(placeholderModel(), { hiCount: args.hi, loCount: args.lo, outDir: stage });
    console.log(`placeholder: hi ${json.hi.count} points (${(json.hi.bytes / 1024).toFixed(0)} KB), lo ${json.lo.count} points (${(json.lo.bytes / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    await maybeFallback(args, stage);
    finish(args, stage);
    return;
  }
  assertOutsideRepo(args.work);
  args.dataDir = stage;
  const { photoModel } = await import('./lib/photo.mjs');
  const { runOverlay } = await import('./overlay.mjs');
  // Fit, check the outline against each photo, feed the best-matching yaws back into the fit, and
  // repeat until the overlap stops improving. The best round is the one that ends up published.
  let best = null;
  let yawOverride = null;
  for (let round = 1; round <= (args.rounds ?? 4); round++) {
    console.log(`round ${round}${yawOverride ? ` (yaws ${JSON.stringify(yawOverride)})` : ''}`);
    const r = await photoModel(args, { yawOverride });
    writeOutputs(r.model, { hiCount: args.hi, loCount: args.lo, outDir: stage, extra: r.extra });
    const rep = await runOverlay(args);
    const turned = Object.entries(rep.views).filter(([n]) => n !== 'front');
    const score = Object.values(rep.views).reduce((a, v) => a + v.iou + v.iouHeadNeck, 0) / 2;
    console.log(`  total IoU ${score.toFixed(4)}`);
    if (!best || score > best.score + 1e-4) best = { score, round, yawOverride };
    else break;
    const next = Object.fromEntries(turned.map(([n, v]) => [n, v.yawEstimatedDeg]));
    const moved = turned.some(([n, v]) => Math.abs(v.yawEstimatedDeg - v.yawFittedDeg) > 1);
    if (!moved) break;
    yawOverride = next;
  }
  if (best) {
    console.log(`best: round ${best.round}, total IoU ${best.score.toFixed(4)}`);
    // Rebuild the best round if a later round overwrote it.
    const r = await photoModel(args, { yawOverride: best.yawOverride });
    const { json } = writeOutputs(r.model, { hiCount: args.hi, loCount: args.lo, outDir: stage, extra: r.extra });
    console.log(`staged: hi ${json.hi.count} points (${(json.hi.bytes / 1024).toFixed(0)} KB), lo ${json.lo.count} points (${(json.lo.bytes / 1024).toFixed(0)} KB)`);
    const rep = await runOverlay(args);
    fs.writeFileSync(path.join(args.work, 'overlay-report.json'), JSON.stringify({ ...rep, round: best.round, yawOverride: best.yawOverride }, null, 2));
    const front = rep.views.front?.iou ?? 0;
    if (front < (args.minFrontIoU ?? 0.97)) {
      console.warn(`front IoU ${front.toFixed(4)} is below ${args.minFrontIoU ?? 0.97}; not publishing`);
      args.publish = false;
    }
  }
  await maybeFallback(args, stage);
  finish(args, stage);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
