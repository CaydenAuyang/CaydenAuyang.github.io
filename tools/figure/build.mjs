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
import { writeOutputs } from './lib/emit.mjs';
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
  const args = { ...DEFAULTS, placeholder: false, fallback: true, hi: 60000, lo: 18000 };
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

async function maybeFallback(args) {
  if (!args.fallback) return;
  try {
    const mod = await import('./render-fallback.mjs');
    if (typeof mod.renderFallback === 'function') {
      const r = await mod.renderFallback({ repoRoot: REPO });
      console.log('fallback image:', r ? JSON.stringify(r) : 'done');
    }
  } catch (e) {
    console.warn(`fallback image skipped: ${e.message}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 11).join('\n'));
    return;
  }
  let model;
  let extra = {};
  if (args.placeholder) {
    model = placeholderModel();
  } else {
    assertOutsideRepo(args.work);
    const { photoModel } = await import('./lib/photo.mjs');
    const r = await photoModel(args);
    model = r.model;
    extra = r.extra || {};
  }
  const t0 = Date.now();
  const { json } = writeOutputs(model, { hiCount: args.hi, loCount: args.lo, outDir: OUT, extra });
  console.log(`wrote ${OUT}: hi ${json.hi.count} points (${(json.hi.bytes / 1024).toFixed(0)} KB), lo ${json.lo.count} points (${(json.lo.bytes / 1024).toFixed(0)} KB) in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  console.log('hi groups', json.hi.groups);
  await maybeFallback(args);
  if (!args.placeholder) {
    const { runOverlay } = await import('./overlay.mjs');
    await runOverlay(args);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
