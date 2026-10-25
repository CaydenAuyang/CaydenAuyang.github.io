// perf.mjs: checks the frame budgets (V4.md 8.10: 60 fps on the laptop, 45 or better on the phone
// tier, 50 or better on the tablet sizes).
//
// Run it with the site previewed (or the dev server) in another terminal:
//   npm run build && npm run preview          (terminal 1)
//   npm run perf                              (terminal 2)
// Another address: BASE=http://localhost:4411 npm run perf. Add --json for the raw numbers, and
// --only=phone,tablet-portrait for some of the sizes.
//
// For each size it opens the page with ?debug on this machine's GPU, then at every scene on the
// page ([data-scene] and the Work stops, [data-stop], read from the page so the list stays in step):
//   - fps: frames the world drew per second over 2 s, kept at its full rate (on touch the world
//     drops to 30 fps after 2 s with nothing moving, which is the design, not a slow frame)
//   - gpuMs: the cost of one frame, rendering 60 in a row and waiting for the GPU to finish
//     (readPixels), so it counts GPU work as well as the CPU's
//   - the gaps between the world's frames, p50 and p95, and how many ran over 25 ms
// Then it scrolls the whole page in 12 s and reports the same, plus long tasks, and any steps the
// automatic step-down took (V4.md 8.5; a step means this machine fell under 45 fps for 2 s).
// The world never draws more than 60 fps, so 60 is the most any row can show.
// The phone and tablet numbers are this Mac's GPU drawing those tiers; they are not the devices.

import { chromium } from 'playwright-core';

const BASE = process.env.BASE || 'http://localhost:4321';
const json = process.argv.includes('--json');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');

const configs = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, scale: 2, budget: 60 },
  { name: 'phone', viewport: { width: 390, height: 844 }, scale: 3, touch: true, budget: 45 },
  { name: 'tablet-portrait', viewport: { width: 820, height: 1180 }, scale: 2, touch: true, budget: 50 },
  { name: 'tablet-landscape', viewport: { width: 1180, height: 820 }, scale: 2, touch: true, budget: 50 },
].filter((c) => !only || only.includes(c.name));

/** A budget is met within 3% (a 60 fps world drops the odd frame to timer jitter). */
const meets = (fps, budget) => fps >= budget * 0.97;

const browser = await chromium.launch({ args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'] });
const report = {};

for (const cfg of configs) {
  const context = await browser.newContext({
    viewport: cfg.viewport,
    deviceScaleFactor: cfg.scale,
    isMobile: Boolean(cfg.touch),
    hasTouch: Boolean(cfg.touch),
  });
  const page = await context.newPage();
  await page.goto(new URL('/?debug', BASE).href, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__night?.world, null, { timeout: 30000 });
  await page.waitForTimeout(4000); // the intro

  await page.evaluate(() => {
    const { world } = window.__night;
    // Every frame the world draws, with when.
    const stamps = [];
    world.onFrame(() => stamps.push(performance.now()));
    window.__perf = {
      /** The world's frames over ms: frames per second and the gaps between them. awake: keep the full rate (no resting rate on touch). */
      frames(ms, awake = true) {
        return new Promise((done) => {
          const from = stamps.length;
          const t0 = performance.now();
          const wake = awake ? setInterval(() => world.keepAwake?.(), 250) : 0;
          world.keepAwake?.();
          setTimeout(() => {
            clearInterval(wake);
            const s = stamps.slice(from);
            const gaps = s.slice(1).map((t, i) => t - s[i]);
            done({ fps: s.length / ((performance.now() - t0) / 1000), gaps });
          }, ms);
        });
      },
      bench(frames = 60) {
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
        const s = world.stats?.() ?? {};
        return { tier: world.tier.tier, calls: world.renderer.info.render.calls, dpr: world.renderer.getPixelRatio(), steps: s.steps ?? [], particles: window.__night.signal?.count };
      },
    };
  });

  const stat = (gaps) => {
    const s = [...gaps].sort((a, b) => a - b);
    const q = (p) => (s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0);
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
    const { fps, gaps } = await page.evaluate(() => window.__perf.frames(2000));
    const info = await page.evaluate(() => window.__perf.info());
    rows.push({ scene: key, fps: +fps.toFixed(1), gpuMs: +gpuMs.toFixed(2), calls: info.calls, ...stat(gaps) });
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
    const framesPromise = window.__perf.frames(12500, false);
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
    const { fps, gaps } = await framesPromise;
    po?.disconnect();
    return { fps, gaps, longTasks };
  });
  const info = await page.evaluate(() => window.__perf.info());
  const sweepFps = +sweep.fps.toFixed(1);
  const minScene = rows.reduce((m, r) => Math.min(m, r.fps), Infinity);
  report[cfg.name] = {
    ...info,
    budget: cfg.budget,
    scenes: rows,
    sweep: { fps: sweepFps, ...stat(sweep.gaps), longTasks: sweep.longTasks },
    pass: meets(sweepFps, cfg.budget) && meets(minScene, cfg.budget),
  };
  await context.close();
}
await browser.close();

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  for (const [name, r] of Object.entries(report)) {
    console.log(`\n${name}: tier ${r.tier}, ${r.particles} particles, dpr ${r.dpr}, budget ${r.budget} fps`);
    console.log('scene              fps  gpu ms  calls  gap p50  p95  long');
    for (const s of r.scenes) {
      console.log(`${s.scene.padEnd(16)} ${String(s.fps).padStart(5)}  ${String(s.gpuMs).padStart(6)}  ${String(s.calls).padStart(5)}  ${String(s.p50).padStart(7)}  ${String(s.p95).padStart(4)}  ${String(s.long).padStart(4)}`);
    }
    const w = r.sweep;
    console.log(`full scroll      ${String(w.fps).padStart(5)} fps  gap p50 ${w.p50}  p95 ${w.p95}  long frames ${w.long}/${w.n}  long tasks ${w.longTasks.length ? w.longTasks.join(', ') + ' ms' : 'none'}`);
    if (r.steps.length) console.log(`step-down: ${r.steps.map((s) => `${s.step} at ${(s.at / 1000).toFixed(1)} s (p90 ${s.p90 ?? '-'} ms)`).join('; ')}`);
    console.log(`${r.pass ? 'PASS' : 'FAIL'}  ${name}: ${r.pass ? 'meets' : 'misses'} ${r.budget} fps (full scroll ${w.fps}, slowest scene ${Math.min(...r.scenes.map((s) => s.fps))})`);
  }
}
process.exit(Object.values(report).every((r) => r.pass) ? 0 : 1);
