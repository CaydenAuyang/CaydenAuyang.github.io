#!/usr/bin/env node
// Screenshots and frame times of the signal lab page (/lab/signal) at 390x844 and 1440x900.
//
//   node tools/figure/signal-shots.mjs [--base http://127.0.0.1:4329] [--out dir] [--only name,...]
//                                      [--world real|mock] [--gpu] [--bench] [--film B,C]
//
// Needs a dev server running (npx astro dev). --gpu uses the machine's GPU (Metal) instead of
// software WebGL, which is what the frame times should be measured on. Writes PNGs and a JSON
// report to ~/Documents/Claude/Projects/CERTIFICATE/figure-work/signal-shots/ by default (outside
// the repo; the screenshots show only the points and the city, but they are scratch output).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chromium, chromiumPath, GL_ARGS } from './harness/browser.mjs';

const args = process.argv.slice(2);
const arg = (name, def) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : def;
};
const flag = (name) => args.includes('--' + name);
const BASE = arg('base', 'http://127.0.0.1:4329');
const OUT = arg('out', path.join(os.homedir(), 'Documents/Claude/Projects/CERTIFICATE/figure-work/signal-shots'));
const WORLD = arg('world', 'real');
const ONLY = arg('only', null)?.split(',');
const GPU_ARGS = ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu'];
fs.mkdirSync(OUT, { recursive: true });

// name: [from, to, t, cam]
// --film B,C replaces the list with that morph at t = 0, 0.1, ... 1 (camera following it).
const FILM = arg('film', null);
const STATES = FILM
  ? Object.fromEntries(Array.from({ length: 11 }, (_, k) => [`${FILM.replace(',', '')}-${String(k * 10).padStart(3, '0')}`, [...FILM.split(','), k / 10, 'auto']]))
  : {
  'B-rest': ['B', 'B', 1, 'hero'],
  'AB-15': ['A', 'B', 0.15, 'hero'],
  'AB-35': ['A', 'B', 0.35, 'hero'],
  'AB-55': ['A', 'B', 0.55, 'hero'],
  'AB-80': ['A', 'B', 0.8, 'hero'],
  'BC-50': ['B', 'C', 0.5, 'auto'],
  'C-rest': ['C', 'C', 1, 'question'],
  'CD-50': ['C', 'D', 0.5, 'auto'],
  'D-rest': ['D', 'D', 1, 'summer'],
  'DA-50': ['D', 'A', 0.5, 'auto'],
  'A-rest': ['A', 'A', 1, 'och'],
  'A-hero': ['A', 'A', 1, 'hero'],
  'AF-50': ['A', 'F', 0.5, 'auto'],
  'F-rest': ['F', 'F', 1, 'since'],
  'FE-50': ['F', 'E', 0.5, 'auto'],
  'E-rest': ['E', 'E', 1, 'contact'],
  };

const VIEWPORTS = [
  { name: '1440x900', viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
  { name: '390x844', viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
];

async function main() {
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: flag('gpu') ? GPU_ARGS : GL_ARGS });
  const report = { base: BASE, world: WORLD, gpu: flag('gpu'), viewports: {} };
  for (const { name, ...ctx } of VIEWPORTS) {
    const context = await browser.newContext(ctx);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
    await page.goto(`${BASE}/lab/signal?hud=0&motion=1&world=${WORLD}`);
    await page.waitForFunction(() => window.__lab?.ready || window.__labError, null, { timeout: 60000 });
    const err = await page.evaluate(() => window.__labError);
    if (err) throw new Error(err);
    const r = (report.viewports[name] = { errors, shots: {} });
    r.gpu = await page.evaluate(() => window.__lab.gpu);
    r.info = await page.evaluate(() => ({ ...window.__lab.signal.info, count: window.__lab.signal.count, buildMs: Math.round(window.__lab.buildMs) }));
    for (const [shot, [from, to, t, cam]] of Object.entries(STATES)) {
      if (ONLY && !ONLY.includes(shot)) continue;
      await page.evaluate((s) => window.__lab.set(s), { from, to, t, cam });
      await page.waitForTimeout(250);
      const file = path.join(OUT, `${name}-${shot}.png`);
      await page.screenshot({ path: file });
      r.shots[shot] = file;
    }
    if (flag('bench')) {
      r.bench = {};
      for (const [shot, [from, to, t, cam]] of Object.entries({ hold: ['B', 'B', 1, 'hero'], 'AB-mid': ['A', 'B', 0.5, 'hero'], 'BC-mid': ['B', 'C', 0.5, 'auto'], 'C-hold': ['C', 'C', 1, 'question'], 'FE-mid': ['F', 'E', 0.5, 'auto'], 'E-hold': ['E', 'E', 1, 'contact'] })) {
        await page.evaluate((s) => window.__lab.set(s), { from, to, t, cam });
        await page.waitForTimeout(1500);
        const live = await page.evaluate(() => window.__lab.stats());
        const b = await page.evaluate(() => window.__lab.bench(90));
        r.bench[shot] = { ...live, ...b };
      }
    }
    await context.close();
    // A contact sheet of this viewport's shots, five across.
    const files = Object.entries(r.shots);
    if (files.length > 1) {
      const wide = name === '1440x900';
      const cellW = wide ? 576 : 234;
      const cellH = wide ? 360 : 506;
      const sheet = await browser.newPage({ viewport: { width: cellW * 5 + 48, height: 200 }, deviceScaleFactor: 1 });
      const html = `<body style="margin:0;padding:8px;background:#222;display:grid;grid-template-columns:repeat(5,${cellW}px);gap:8px;font:12px sans-serif;color:#ccc">${files
        .map(([k, f]) => `<figure style="margin:0"><img src="data:image/png;base64,${fs.readFileSync(f).toString('base64')}" style="width:${cellW}px;height:${cellH}px;display:block"><figcaption>${k}</figcaption></figure>`)
        .join('')}</body>`;
      await sheet.setContent(html);
      const file = path.join(OUT, `sheet-${name}.png`);
      await sheet.screenshot({ path: file, fullPage: true });
      r.sheet = file;
      await sheet.close();
    }
  }
  await browser.close();
  fs.writeFileSync(path.join(OUT, 'report.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
