#!/usr/bin/env node
// Renders the no-WebGL still of the intro module's phone: public/intro/photos/phone-closed.webp.
//
//   node tools/intro/phone-still/render.mjs            (from the repo root, after npm ci)
//   node tools/intro/phone-still/render.mjs --serve    only start the server (http://localhost:4523)
//
// Visitors without WebGL see this picture in the phone's box instead of the live scene (V4.md 6.1),
// it stands in while a lost context is gone (8.8), and with reduced motion it shows while the scene
// loads, so it has to be the scene's own reduced-motion pose: closed, the vertical photo on its
// cover screen, in the closed display pose (V5.md 1.4). This script makes it from the real scene.
// It starts Vite on index.html beside it (the phone alone, served from the repo root, so it uses
// src/intro/phone and public/ as they are), opens it in Chromium on the GPU with reduced motion and
// a transparent page, waits for the first frame, and screenshots the box: 600 x 600 CSS px at 2x,
// so 1200 x 1200 px, the largest the box shows at DPR 2. The PNG keeps its alpha; sharp turns it
// into a WebP with alpha, at the highest quality that keeps it within 80 KB (V4.md 8.7). If even
// quality 60 is over, it writes nothing and exits with an error. Check the picture, then commit it.
//
// Vite and sharp come with Astro (Vite is one of its dependencies, sharp an optional one that npm
// installs by default), as for scripts/stills.mjs; they aren't listed in package.json themselves.

import { chromium } from 'playwright-core';
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const OUT = resolve(REPO, 'public/intro/photos/phone-closed.webp');
const PORT = Number(process.env.PORT || 4523);
const SIZE = 600;
const MAX_BYTES = 80 * 1024;
const MIN_QUALITY = 60;

const load = (name) =>
  import(name).catch(() => {
    console.error(`render.mjs needs ${name}, which Astro installs: run npm ci first.`);
    process.exit(1);
  });
const { createServer } = await load('vite');
const sharp = (await load('sharp')).default;

const server = await createServer({
  root: REPO,
  configFile: false,
  publicDir: resolve(REPO, 'public'),
  logLevel: 'warn',
  server: { port: PORT, strictPort: true },
});
await server.listen();
const url = `http://localhost:${PORT}/tools/intro/phone-still/index.html`;

if (process.argv.includes('--serve')) {
  console.log(`serving ${url}`);
} else {
  const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
  const context = await browser.newContext({ viewport: { width: SIZE + 80, height: SIZE + 80 }, deviceScaleFactor: 2, reducedMotion: 'reduce' });
  const page = await context.newPage();
  page.on('console', (m) => m.type() === 'error' && console.error(m.text()));
  // debug&dpr=2: draw the canvas at exactly 2x, past the live 1.3 megapixel cap.
  await page.goto(`${url}?motion=0&bg=transparent&w=${SIZE}&h=${SIZE}&debug&dpr=2`, { waitUntil: 'networkidle' });
  await page.waitForSelector('[data-phone-ready]', { timeout: 30000 });
  await page.waitForTimeout(400);
  const png = await page.locator('[data-intro-phone]').screenshot({ omitBackground: true });
  let quality = 86;
  let webp = await sharp(png).webp({ quality, alphaQuality: 90, effort: 6 }).toBuffer();
  while (webp.length > MAX_BYTES && quality > MIN_QUALITY) {
    quality -= 2;
    webp = await sharp(png).webp({ quality, alphaQuality: 90, effort: 6 }).toBuffer();
  }
  if (webp.length > MAX_BYTES) {
    console.error(`still over 80 KB at quality ${quality} (${(webp.length / 1024).toFixed(1)} KB): nothing written`);
    await browser.close();
    await server.close();
    process.exit(1);
  }
  writeFileSync(OUT, webp);
  const meta = await sharp(OUT).metadata();
  console.log(`saved public/intro/photos/phone-closed.webp (${meta.width} x ${meta.height}, alpha: ${meta.hasAlpha}, quality ${quality}, ${(webp.length / 1024).toFixed(1)} KB)`);
  await browser.close();
  await server.close();
}
