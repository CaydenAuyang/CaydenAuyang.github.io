// perf.mjs: checks the frame budget (NIGHT-SIGNAL.md section 8: 60 fps on an M-series laptop,
// 45 fps or better on an iPhone 13). Owned by the lead.
//
// Run it with the site previewed (or the dev server) in another terminal:
//   npm run build && npm run preview          (terminal 1)
//   npm run perf                              (terminal 2)
// Another address: BASE=http://localhost:4411 npm run perf. Add --json for the raw numbers.
//
// For a laptop (1440 x 900 at 2x, high tier) and a phone (390 x 844 at 3x, phone tier) it opens
// the page with ?debug on this machine's GPU, then at every scene:
//   - gpuMs: the cost of one frame, rendering 60 in a row and waiting for the GPU to finish
//     (readPixels), so it counts GPU work as well as the CPU's.
//   - rAF: the gaps between animation frames over 2 s, p50 and p95, and how many ran long.
// Then it scrolls the whole page in 12 s and reports the same gaps plus long tasks.
// The phone numbers are this Mac's GPU drawing the phone tier; they are not an iPhone.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:4321';
const json = process.argv.includes('--json');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7);

const configs = [
  { name: 'desktop', viewport: { width: 1440, height: 900 }, scale: 2 },
  { name: 'phone', viewport: { width: 390, height: 844 }, scale: 3, mobile: true },
].filter((c) => !only || c.name === only);

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = {};

for (const cfg of configs) {
  const context = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: cfg.scale,
    isMobile: Boolean(cfg.mobile),
    hasTouch: Boolean(cfg.mobile),
  });
  const page = await context.newPage();
  await page.goto(new URL('/?debug', BASE).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__night?.world, null, { timeout: 30000 });
  await page.waitForTimeout(4000); // the intro

  await page.evaluate(() => {
    window.__perf = {
      gaps(ms) {
        return new Promise((done) => {
          const out = [];
          let last = performance.now();
          const end = last + ms;
          const step = (now) => {
            out.push(now - last);
            last = now;
            if (now < end) requestAnimationFrame(step);
            else done(out);
          };
          requestAnimationFrame(step);
        });
      },
      bench(frames = 60) {
        const { world } = window.__night;
        const gl = world.renderer.getContext();
        const px = new Uint8Array(4);
        world.renderer.render(world.scene, world.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t = performance.now();
        for (let i = 0; i < frames; i++) world.renderer.render(world.scene, world.camera);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        return (performance.now() - t) / frames;
      },
      info() {
        const { world } = window.__night;
        return { tier: world.tier.tier, calls: world.renderer.info.render.calls, dpr: world.renderer.getPixelRatio() };
      },
    };
  });

  const stat = (gaps) => {
    const s = [...gaps].sort((a, b) => a - b);
    const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
    return { p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), long: gaps.filter((g) => g > 25).length, n: gaps.length };
  };

  const scenes = await page.evaluate(() =>
    Array.from(document.querySelectorAll('[data-scene], [data-stop]')).map((el) => el.getAttribute('data-stop') || el.getAttribute('data-scene')),
  );
  const rows = [];
  for (const key of scenes) {
    await page.evaluate((k) => {
      const el = document.querySelector(`[data-stop="${k}"]`) || document.querySelector(`[data-scene="${k}"]`);
      const top = el.getBoundingClientRect().top + window.scrollY;
      // Contact is read at the bottom of the page; everything else a little into the section.
      const y = k === 'contact' ? document.documentElement.scrollHeight : top + Math.min(el.offsetHeight * 0.35, window.innerHeight * 0.6);
      window.scrollTo({ top: y, behavior: 'instant' });
    }, key);
    await page.waitForTimeout(1500);
    const gpuMs = await page.evaluate(() => window.__perf.bench(60));
    const gaps = await page.evaluate(() => window.__perf.gaps(2000));
    const info = await page.evaluate(() => window.__perf.info());
    rows.push({ scene: key, gpuMs: +gpuMs.toFixed(2), calls: info.calls, ...stat(gaps) });
  }

  // A full scroll from top to bottom in 12 s.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.waitForTimeout(1200);
  const sweep = await page.evaluate(async () => {
    const longTasks = [];
    let po = null;
    try {
      po = new PerformanceObserver((list) => list.getEntries().forEach((e) => longTasks.push(Math.round(e.duration))));
      po.observe({ type: 'longtask', buffered: false });
    } catch {
      /* no long task timing */
    }
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const gapsPromise = window.__perf.gaps(12500);
    const t0 = performance.now();
    await new Promise((done) => {
      const step = () => {
        const k = Math.min(1, (performance.now() - t0) / 12000);
        window.scrollTo({ top: k * max, behavior: 'instant' });
        if (k < 1) requestAnimationFrame(step);
        else done();
      };
      requestAnimationFrame(step);
    });
    const gaps = await gapsPromise;
    po?.disconnect();
    return { gaps, longTasks };
  });
  const info = await page.evaluate(() => window.__perf.info());
  report[cfg.name] = { ...info, scenes: rows, sweep: { ...stat(sweep.gaps), longTasks: sweep.longTasks } };
  await context.close();
}
await browser.close();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [name, r] of Object.entries(report)) {
    console.log(`\n${name}: tier ${r.tier}, dpr ${r.dpr}`);
    console.log('scene        gpu ms  calls  rAF p50  p95  long');
    for (const s of r.scenes) {
      console.log(`${s.scene.padEnd(12)} ${String(s.gpuMs).padStart(6)}  ${String(s.calls).padStart(5)}  ${String(s.p50).padStart(7)}  ${String(s.p95).padStart(4)}  ${String(s.long).padStart(4)}`);
    }
    const w = r.sweep;
    console.log(`full scroll  rAF p50 ${w.p50}  p95 ${w.p95}  long frames ${w.long}/${w.n}  long tasks ${w.longTasks.length ? w.longTasks.join(', ') + ' ms' : 'none'}`);
  }
}
