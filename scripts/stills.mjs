// stills.mjs: renders the no-WebGL fallback images of the hero scene. Owned by the lead.
//
// Visitors whose browser can't run WebGL see a still picture of the night skyline (with the
// figure of light) behind the page instead of the live scene (NIGHT-SIGNAL.md section 8). This
// script makes those pictures from the real scene, so they always match it.
//
// Run it with the site built and previewed in another terminal:
//   npm run build && npm run preview          (terminal 1)
//   npm run stills                            (terminal 2)
// Another address: BASE=http://localhost:4411 npm run stills
//
// For a laptop (1440 x 900) and a phone (390 x 844) it opens the home page in snapshot mode (no
// intro, the world frozen on the hero's final frame), hides every bit of HTML so only the canvas
// shows, waits for the scene to draw, and saves public/world/fallback-hero.webp and
// public/world/fallback-hero-phone.webp. Commit the two files after checking them.

import { chromium } from 'playwright-core';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unlinkSync } from 'node:fs';
import sharp from 'sharp';

const BASE = process.env.BASE || 'http://localhost:4321';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = resolve(root, 'public/world');
mkdirSync(outDir, { recursive: true });

const shots = [
  { file: 'fallback-hero.webp', viewport: { width: 1440, height: 900 }, scale: 1 },
  // The phone still has no searchlight: its beam leans out of the left edge, and the fallback
  // mirrors the still's edges to fill wider windows, so it would show the beam twice, as a V.
  { file: 'fallback-hero-phone.webp', viewport: { width: 390, height: 844 }, scale: 2, mobile: true, noBeams: true },
];

// The GPU path renders the scene as visitors see it (on a Mac, Metal through ANGLE).
const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
for (const shot of shots) {
  const context = await browser.newContext({
    viewport: shot.viewport,
    deviceScaleFactor: shot.scale,
    isMobile: Boolean(shot.mobile),
    hasTouch: Boolean(shot.mobile),
  });
  const page = await context.newPage();
  await page.goto(new URL(shot.noBeams ? '/?snapshot&debug' : '/?snapshot', BASE).href, { waitUntil: 'networkidle' });
  // Wait until the world reports it is ready (main.ts adds "is-ready" to <html>).
  await page.waitForFunction(() => document.documentElement.classList.contains('is-ready'), null, { timeout: 30000 });
  await page.waitForTimeout(1200);
  // Hide everything but the canvas.
  await page.addStyleTag({
    content: 'body > *:not(.world-canvas):not([data-world]) { visibility: hidden !important; } [data-world] { opacity: 1 !important; visibility: visible !important; }',
  });
  await page.evaluate(() => window.scrollTo(0, 0));
  if (shot.noBeams) {
    await page.evaluate(() => {
      const world = window.__night.world;
      // The material, not the mesh: the beams set their mesh's visibility every frame.
      world.scene.getObjectByName('beams').material.visible = false;
      world.requestRender();
    });
  }
  await page.waitForTimeout(600);
  const png = resolve(outDir, shot.file.replace('.webp', '.png'));
  await page.screenshot({ path: png });
  // Convert to WebP (quality 80) with sharp, which Astro already installs, then remove the PNG.
  await sharp(png).webp({ quality: 80 }).toFile(resolve(outDir, shot.file));
  unlinkSync(png);
  console.log(`saved public/world/${shot.file}`);
  await context.close();
}
await browser.close();
