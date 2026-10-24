#!/usr/bin/env node
// Renders public/world/figure-still.webp: the glowing figure (target B) on a transparent
// background, drawn from the points by the signal itself, for the no-WebGL fallback. It never
// touches the photos.
//
//   node tools/figure/signal-still.mjs [--base http://127.0.0.1:4329] [--max-kb 150]
//
// Needs a dev server running (npx astro dev). Renders /lab/signal?still=1 at 1440x900 (the world
// caps the pixel ratio at 1.75, so the figure is about 790 px tall), turns light on black into
// light on transparent in the page, crops to the figure, then encodes WebP with cwebp (Homebrew
// webp), lowering quality and then size until it fits under --max-kb.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { chromium, chromiumPath } from './harness/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const BASE = arg('base', 'http://127.0.0.1:4329');
const MAX = Number(arg('max-kb', 150)) * 1000;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(REPO, 'public/world/figure-still.webp');
const SCRATCH = path.join(os.homedir(), 'Documents/Claude/Projects/CERTIFICATE/figure-work');

const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 });
  await page.goto(`${BASE}/lab/signal?still=1&motion=0&hud=0`);
  await page.waitForFunction(() => window.__lab?.ready || window.__labError, null, { timeout: 60000 });
  const err = await page.evaluate(() => window.__labError);
  if (err) throw new Error(err);
  await page.waitForTimeout(500);
  const still = await page.evaluate(() => window.__lab.still());
  fs.mkdirSync(SCRATCH, { recursive: true });
  const png = path.join(SCRATCH, 'figure-still.png');
  fs.writeFileSync(png, Buffer.from(still.dataUrl.split(',')[1], 'base64'));
  let done = false;
  let scale = 1;
  for (let attempt = 0; attempt < 6 && !done; attempt++) {
    for (const q of [86, 80, 74, 68, 62]) {
      const resize = scale < 1 ? ['-resize', String(Math.round(still.width * scale)), String(Math.round(still.height * scale))] : [];
      execFileSync('cwebp', ['-quiet', '-q', String(q), '-alpha_q', '90', '-m', '6', ...resize, png, '-o', OUT]);
      const bytes = fs.statSync(OUT).size;
      if (bytes <= MAX) {
        console.log(`figure-still.webp ${(bytes / 1000).toFixed(1)} KB, ${Math.round(still.width * scale)}x${Math.round(still.height * scale)}, quality ${q}, from ${still.count} points (png kept at ${png})`);
        done = true;
        break;
      }
    }
    scale *= 0.88;
  }
  if (!done) throw new Error(`could not get figure-still.webp under ${MAX / 1000} KB`);
} finally {
  await browser.close();
}
