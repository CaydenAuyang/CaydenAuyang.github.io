// Screenshots of the point figure in the harness, for checking it renders, assembles, holds still
// with reduced motion, and falls back to the image without WebGL.
//
//   node tools/figure/harness/shoot.mjs [--out dir] [--src url --srclo url] [--mount dir]
//
// Defaults: point data from public/figure/, screenshots to
// ~/Documents/Claude/Projects/CERTIFICATE/figure-work/shots/ (outside the repo).
// --mount serves a folder at /__test/ so --src /__test/file.bin can point at test data.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve, REPO_ROOT } from './serve.mjs';
import { launch } from './browser.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const OUT = arg('out', path.join(os.homedir(), 'Documents/Claude/Projects/CERTIFICATE/figure-work/shots'));
const SRC = arg('src', null);
const SRCLO = arg('srclo', null);
const MOUNT = arg('mount', null);
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitReady(page, timeout = 15000) {
  await page.waitForFunction(() => window.__fig && (window.__fig.stats.state === 'ready' || window.__fig.stats.state === 'fallback'), null, { timeout });
  return page.evaluate(() => ({ ...window.__fig.stats }));
}

async function main() {
  const { port, close } = await serve(REPO_ROOT, 0, MOUNT ? { '/__test/': path.resolve(MOUNT) } : {});
  const base = `http://127.0.0.1:${port}/tools/figure/harness/index.html`;
  const extra = [SRC && `src=${encodeURIComponent(SRC)}`, SRCLO && `srclo=${encodeURIComponent(SRCLO)}`].filter(Boolean).join('&');
  const url = (q = '') => `${base}?${[extra, q].filter(Boolean).join('&')}`;
  const report = [];
  const shots = [];

  const browser = await launch();
  const viewports = [
    { name: '390x844', width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
    { name: '1440x900', width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false, hasTouch: false },
  ];
  for (const vp of viewports) {
    const { name, ...ctxOpts } = vp;
    // Motion on: mid assemble, then settled, then (laptop) turned toward the pointer.
    {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...ctxOpts });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(url());
      const s0 = await waitReady(page);
      await sleep(900);
      const mid = path.join(OUT, `${name}-motion-1s.png`);
      await page.screenshot({ path: mid });
      shots.push(mid);
      await page.waitForFunction(() => window.__fig.stats.assembled, null, { timeout: 15000 }).catch(() => {});
      await sleep(600);
      const settled = path.join(OUT, `${name}-motion-settled.png`);
      await page.screenshot({ path: settled });
      shots.push(settled);
      if (!vp.hasTouch) {
        // Sweep the pointer for two seconds to measure frame times while it moves.
        const t0 = Date.now();
        while (Date.now() - t0 < 2000) {
          const k = (Date.now() - t0) / 2000;
          await page.mouse.move(vp.width * (0.5 + 0.5 * Math.sin(k * Math.PI * 2)), vp.height * 0.4);
          await sleep(16);
        }
        await page.mouse.move(vp.width - 5, vp.height * 0.3);
        await sleep(1500);
        const turned = path.join(OUT, `${name}-pointer-right.png`);
        await page.screenshot({ path: turned });
        shots.push(turned);
      } else {
        await sleep(2000);
      }
      const s1 = await page.evaluate(() => ({ ...window.__fig.stats }));
      report.push({ view: name, mode: 'motion', level: s1.level, count: s1.count, webgl: s1.webgl, frameMs: +s1.frameMs.toFixed(2), fps: +s1.fps.toFixed(1), assembled: s1.assembled, firstState: s0.state, errors });
      await ctx.close();
    }
    // Reduced motion (device setting) and the site's Motion switch (data-motion="off").
    for (const mode of ['reduced', 'motion-off']) {
      const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, ...ctxOpts, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url(mode === 'motion-off' ? 'motion=off' : ''));
      const s = await waitReady(page);
      await sleep(400);
      const frames0 = await page.evaluate(() => window.__fig.stats.frames);
      await sleep(800);
      const frames1 = await page.evaluate(() => window.__fig.stats.frames);
      const file = path.join(OUT, `${name}-${mode}.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      report.push({ view: name, mode, level: s.level, count: s.count, frames: frames1, framesWhileIdle: frames1 - frames0, errors });
      await ctx.close();
    }
  }
  await browser.close();

  // No WebGL: the fallback image must show.
  {
    const nogl = await launch(['--disable-webgl', '--disable-3d-apis']);
    for (const vp of viewports) {
      const { name, ...ctxOpts } = vp;
      const ctx = await nogl.newContext({ viewport: { width: vp.width, height: vp.height }, ...ctxOpts });
      const page = await ctx.newPage();
      await page.goto(url());
      await page.waitForFunction(() => document.querySelector('[data-figure-mount]').getAttribute('data-state') === 'fallback', null, { timeout: 15000 });
      await page.waitForFunction(() => {
        const img = document.querySelector('.figure__fallback');
        return img.complete && img.naturalWidth > 0;
      }, null, { timeout: 15000 }).catch(() => {});
      const info = await page.evaluate(() => {
        const img = document.querySelector('.figure__fallback');
        const canvas = document.querySelector('canvas');
        return {
          state: document.querySelector('[data-figure-mount]').getAttribute('data-state'),
          imgShown: getComputedStyle(img).display !== 'none',
          imgLoaded: img.naturalWidth > 0,
          canvasShown: getComputedStyle(canvas).display !== 'none',
          descHidden: document.querySelector('.figure__desc').hidden,
          reason: window.__fig && window.__fig.stats.reason,
        };
      });
      const file = path.join(OUT, `${name}-no-webgl.png`);
      await page.screenshot({ path: file });
      shots.push(file);
      report.push({ view: name, mode: 'no-webgl', ...info });
      await ctx.close();
    }
    await nogl.close();
  }
  await close();
  console.log(JSON.stringify(report, null, 2));
  console.log('screenshots:\n' + shots.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
