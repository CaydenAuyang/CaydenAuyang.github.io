// Screenshots and checks of the point figure in the harness (laid out like the Datum hero).
//
//   node tools/figure/harness/shoot.mjs [--out dir] [--src url --srclo url --srcmeta url] [--mount dir]
//
// Checks, at 390x844 (phone) and 1440x900 (laptop): the M1 assembly mid-flight and settled,
// figure:ready with the drawn count, the loop stopping when idle, the M2 pointer turn (laptop),
// the M3 scroll turn, reduced motion, Motion: Off and snapshot mode (one still frame, replay does
// nothing), no WebGL (the still image cross-fades in), and data later than 2.5 s (still image
// first, then the live figure). Prints a JSON report and the screenshot paths.
// Default output: ~/Documents/Claude/Projects/CERTIFICATE/figure-work/shots/ (outside the repo).

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
const MOUNT = arg('mount', null);
const extra = ['src', 'srclo', 'srcmeta'].filter((k) => arg(k, null)).map((k) => `${k}=${encodeURIComponent(arg(k))}`).join('&');
fs.mkdirSync(OUT, { recursive: true });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const stats = (page) => page.evaluate(() => ({ ...window.__fig.stats, readyCount: window.__readyCount ?? null, wrap: document.querySelector('[data-figure-mount]').getAttribute('data-state') }));
const waitDrawn = (page) => page.waitForFunction(() => window.__fig && ['ready', 'fallback'].includes(window.__fig.stats.state), null, { timeout: 20000 });

async function main() {
  const { port, close } = await serve(REPO_ROOT, 0, MOUNT ? { '/__test/': path.resolve(MOUNT) } : {});
  const url = (q = '') => `http://127.0.0.1:${port}/tools/figure/harness/index.html?${[extra, q].filter(Boolean).join('&')}`;
  const report = [];
  const shots = [];
  const shot = async (page, name) => {
    const file = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: file });
    shots.push(file);
  };
  const viewports = [
    { name: '390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
    { name: '1440x900', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2, isMobile: false, hasTouch: false },
  ];

  const browser = await launch();
  for (const { name, ...ctxOpts } of viewports) {
    // Motion on.
    {
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url());
      await waitDrawn(page);
      await sleep(550);
      await shot(page, `${name}-m1-mid`);
      await page.waitForFunction(() => window.__fig.stats.assembled, null, { timeout: 10000 });
      await sleep(400);
      await shot(page, `${name}-m1-settled`);
      const idle0 = (await stats(page)).frames;
      await sleep(700);
      const idle1 = (await stats(page)).frames;
      const row = { view: name, mode: 'motion', idleFramesAfterSettle: idle1 - idle0 };
      if (!ctxOpts.hasTouch) {
        // M2: hover over the hero's right side, then leave.
        const box = await page.locator('.hero__plate').boundingBox();
        await page.mouse.move(box.x + box.width * 0.95, box.y + box.height * 0.3, { steps: 8 });
        await sleep(900);
        await shot(page, `${name}-m2-pointer-right`);
        row.framesWhileHovering = (await stats(page)).frames - idle1;
      }
      // M3: scroll the plate partly out of view.
      const top = await page.evaluate(() => document.querySelector('.hero__plate').getBoundingClientRect().top + scrollY);
      await page.evaluate((y) => scrollTo(0, y), top + 200);
      await sleep(900);
      await shot(page, `${name}-m3-scrolled`);
      const s = await stats(page);
      row.benchmarkMs = +(await page.evaluate(() => window.__fig.benchmark(30))).toFixed(2);
      Object.assign(row, { device: s.device, file: s.file, count: s.count, readyCount: s.readyCount, webgl: s.webgl, errors });
      report.push(row);
      await ctx.close();
    }
    // Still modes: reduced motion, Motion: Off, snapshot.
    for (const mode of ['reduced', 'motion-off', 'snapshot']) {
      const ctx = await browser.newContext({ ...ctxOpts, reducedMotion: mode === 'reduced' ? 'reduce' : 'no-preference' });
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(String(e)));
      await page.goto(url(mode === 'motion-off' ? 'motion=off' : mode === 'snapshot' ? 'snapshot=1' : ''));
      await waitDrawn(page);
      await sleep(300);
      const f0 = (await stats(page)).frames;
      const replayed = await page.evaluate(() => window.__fig.replay());
      await sleep(600);
      const s = await stats(page);
      await shot(page, `${name}-${mode}`);
      const replayHidden = await page.evaluate(() => document.getElementById('replay').hidden);
      report.push({ view: name, mode, frames: s.frames, framesAfterReplay: s.frames - f0, replayReturned: replayed, replayButtonHidden: replayHidden, readyCount: s.readyCount, errors });
      await ctx.close();
    }
    // Data later than 2.5 s: still image first, then the live figure.
    {
      const ctx = await browser.newContext(ctxOpts);
      const page = await ctx.newPage();
      await page.route('**/*.bin', async (route) => {
        await sleep(4000);
        await route.continue();
      });
      await page.goto(url());
      await sleep(3600);
      const during = await page.evaluate(() => {
        const img = document.querySelector('.figure__fallback');
        return { wrap: document.querySelector('[data-figure-mount]').getAttribute('data-state'), imgOpacity: getComputedStyle(img).opacity, imgLoaded: img.naturalWidth > 0 };
      });
      await shot(page, `${name}-m4-slow-data`);
      await sleep(3000);
      const after = await stats(page);
      report.push({ view: name, mode: 'slow-data', during, afterWrap: after.wrap, afterAssembled: after.assembled });
      await ctx.close();
    }
  }
  await browser.close();

  // No WebGL: the still image cross-fades in.
  const nogl = await launch(['--disable-webgl', '--disable-3d-apis']);
  for (const { name, ...ctxOpts } of viewports) {
    const ctx = await nogl.newContext(ctxOpts);
    const page = await ctx.newPage();
    await page.goto(url());
    await page.waitForFunction(() => document.querySelector('[data-figure-mount]').getAttribute('data-state') === 'fallback', null, { timeout: 15000 });
    await sleep(500);
    const info = await page.evaluate(() => {
      const img = document.querySelector('.figure__fallback');
      return {
        wrap: document.querySelector('[data-figure-mount]').getAttribute('data-state'),
        imgOpacity: getComputedStyle(img).opacity,
        imgLoaded: img.naturalWidth > 0,
        canvasOpacity: getComputedStyle(document.querySelector('canvas')).opacity,
        reason: window.__fig && window.__fig.stats.reason,
      };
    });
    await shot(page, `${name}-no-webgl`);
    report.push({ view: name, mode: 'no-webgl', ...info });
    await ctx.close();
  }
  await nogl.close();
  await close();
  console.log(JSON.stringify(report, null, 1));
  console.log('screenshots:\n' + shots.join('\n'));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
