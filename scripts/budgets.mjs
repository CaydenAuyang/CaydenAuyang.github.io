// budgets.mjs: the loading budgets from V4.md 8.7, measured on a production build.
//
//   npm run build && npm run check:budgets
//   npm run check:budgets -- --lighthouse     (also runs Lighthouse mobile; fetches it with npx once)
//   npm run check:budgets -- --lighthouse=5   (five Lighthouse runs instead of three)
// Options: --dist=<folder> (default dist), BASE=http://... to measure a server that's already
// running instead of starting one on the build.
//
// It measures, with gzip as GitHub Pages serves it:
//   1. All the JavaScript the home page can load (its scripts, everything they import, and the
//      lazy chunks, the world's and the intro phone's): under 300 KB.
//   2. The intro phone's own lazy code (what only the intro's dynamic import pulls in, so three.js,
//      shared with the world, isn't counted twice): at most 25 KB. It also checks three.js is in
//      the build once.
//   3. First load on a phone (iPhone 15 size, touch) in Chromium, everything fetched in the first
//      8 s at the top of the page, without videos and photos: under 1 MB. Images and videos are
//      listed beside it.
//   4. With --lighthouse: Lighthouse mobile, the median of three runs: Performance at least 85,
//      Accessibility 100, CLS under 0.05, LCP under 2.5 s, and the LCP element should be the hero's
//      name (a warning, not a failure). It lists what's fetched before the first paint and the
//      longest tasks, the usual reasons for a slow LCP or a high Total Blocking Time.
// It exits with code 1 if a budget is over.

import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { serve } from './serve.mjs';

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = path.resolve(arg('dist') || process.env.DIST || 'dist');
const lighthouseArg = process.argv.find((a) => a === '--lighthouse' || a.startsWith('--lighthouse='));
const lighthouseRuns = lighthouseArg ? Math.max(1, Number(lighthouseArg.split('=')[1]) || 3) : 0;
const KB = 1024;
const gz = (buf) => zlib.gzipSync(buf).length;
const kb = (n) => `${(n / KB).toFixed(1)} KB`;
let over = 0;
const verdict = (ok) => {
  if (!ok) over++;
  return ok ? 'ok  ' : 'OVER';
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) {
  console.error(`No build at ${DIST}. Run "npm run build" first (or pass --dist=<folder>).`);
  process.exit(1);
}

// ---- 1 and 2: JavaScript, from the files in the build ------------------------------------------
const ASTRO = path.join(DIST, '_astro');
const jsFiles = new Map(
  fs
    .readdirSync(ASTRO)
    .filter((f) => f.endsWith('.js'))
    .map((f) => [f, fs.readFileSync(path.join(ASTRO, f))]),
);
const jsName = /[\w.$~-]+\.js\b/g;
// Every other chunk a file names. Static imports load with it; any other mention (import(),
// the preload list beside it, a worker URL) loads later.
function edges(source) {
  const text = source.toString();
  const now = new Set();
  for (const m of text.matchAll(/(?:\bfrom\s*|\bimport\s*)["'`]\.?\/?(?:_astro\/)?([\w.$~-]+\.js)["'`]/g)) now.add(m[1]);
  const later = new Set([...text.matchAll(jsName)].map((m) => m[0]).filter((f) => jsFiles.has(f) && !now.has(f)));
  return { now: [...now].filter((f) => jsFiles.has(f)), later: [...later] };
}
function closure(roots, lazy = true) {
  const seen = new Set();
  const queue = [...roots];
  while (queue.length) {
    const f = queue.shift();
    if (seen.has(f) || !jsFiles.has(f)) continue;
    seen.add(f);
    const e = edges(jsFiles.get(f));
    queue.push(...e.now, ...(lazy ? e.later : []));
  }
  return seen;
}

const page = fs.readFileSync(path.join(DIST, 'index.html'), 'utf8');
const entries = [...page.matchAll(/<script[^>]*\bsrc="\/_astro\/([^"]+\.js)"/g)].map((m) => m[1]);
const inline = [...page.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)].filter(([, attrs, body]) => !/\bsrc=/.test(attrs) && !/application\/(ld\+)?json/.test(attrs) && body.trim());
const inlineRoots = inline.flatMap(([, , body]) => [...body.matchAll(jsName)].map((m) => m[0]).filter((f) => jsFiles.has(f)));
const inlineBytes = gz(Buffer.from(inline.map(([, , body]) => body).join('\n')));

const all = closure([...entries, ...inlineRoots]);
const eager = closure([...entries, ...inlineRoots], false);
const size = (set) => [...set].reduce((n, f) => n + gz(jsFiles.get(f)), 0);
const totalJs = size(all) + inlineBytes;

// The intro's lazy code: reached from an Intro script, and from nothing else.
const isIntro = (f) => /intro/i.test(f);
const introEntries = entries.filter(isIntro);
const introAll = closure(introEntries);
const othersAll = closure([...entries.filter((f) => !isIntro(f)), ...inlineRoots]);
const introLazy = [...introAll].filter((f) => !othersAll.has(f) && !eager.has(f));
const introBytes = introLazy.reduce((n, f) => n + gz(jsFiles.get(f)), 0);

// three.js once: the classes that define its renderer and its core each live in exactly one chunk.
const markers = { 'three.js renderer': 'this.isWebGLRenderer=', 'three.js core': 'this.isBufferGeometry=' };
const dupes = Object.entries(markers)
  .map(([what, marker]) => [what, [...all].filter((f) => jsFiles.get(f).includes(marker))])
  .filter(([, files]) => files.length > 1);

console.log(`Budgets for ${DIST}\n`);
console.log('JavaScript (gzip)');
console.log(`  ${verdict(totalJs < 300 * KB)} everything the home page can load   ${kb(totalJs).padStart(9)}   budget under 300 KB`);
console.log(`       before any lazy chunk                   ${kb(size(eager) + inlineBytes).padStart(9)}   (${eager.size} files and ${inline.length} inline scripts)`);
const biggest = [...all].map((f) => [f, gz(jsFiles.get(f))]).sort((a, b) => b[1] - a[1]).slice(0, 6);
for (const [f, n] of biggest) console.log(`       ${f.padEnd(52)} ${kb(n).padStart(9)}`);
if (introEntries.length) {
  console.log(`  ${verdict(introBytes <= 25 * KB && introLazy.length > 0)} intro phone, lazy code                 ${kb(introBytes).padStart(9)}   budget at most 25 KB`);
  console.log(`       ${introLazy.join(', ') || 'no lazy chunk found: is the phone imported eagerly?'}`);
} else {
  console.log(`  ${verdict(false)} intro phone: no Intro script in index.html, so its chunk can't be found`);
}
for (const [what, files] of dupes) console.log(`  ${verdict(false)} ${what} is in ${files.length} chunks: ${files.join(', ')}`);

// ---- 3: first load on a phone ------------------------------------------------------------------
let base = process.env.BASE;
let server;
if (!base) {
  ({ server, url: base } = await serve(DIST, 0));
}
const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 393, height: 852 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const tab = await context.newPage();
const loads = [];
tab.on('response', async (response) => {
  const request = response.request();
  const url = new URL(response.url());
  if (!url.protocol.startsWith('http')) return;
  const type = request.resourceType();
  let bytes = 0;
  try {
    bytes = (await request.sizes()).responseBodySize;
  } catch {}
  loads.push({ path: url.pathname, type, bytes, encoded: response.headers()['content-encoding'] === 'gzip' });
});
await tab.goto(new URL('/', base).href, { waitUntil: 'load' });
await tab.waitForTimeout(8000);
await browser.close();

const isVideo = (l) => l.type === 'media' || /\.(mp4|webm)$/.test(l.path);
const isImage = (l) => !isVideo(l) && (l.type === 'image' || /\.(webp|png|jpe?g|avif|gif)$/.test(l.path));
const sum = (list) => list.reduce((n, l) => n + l.bytes, 0);
const videos = loads.filter(isVideo);
const images = loads.filter(isImage);
const rest = loads.filter((l) => !isVideo(l) && !isImage(l));
const byType = {};
for (const l of rest) byType[l.type] = (byType[l.type] || 0) + l.bytes;
console.log('\nFirst load on a phone (393 x 852, the first 8 s at the top, gzip where Pages uses it)');
console.log(`  ${verdict(sum(rest) < 1024 * KB)} without videos and photos              ${kb(sum(rest)).padStart(9)}   budget under 1 MB (${rest.length} requests)`);
console.log(`       ${Object.entries(byType).sort((a, b) => b[1] - a[1]).map(([t, n]) => `${t} ${kb(n)}`).join(', ')}`);
const heavy = rest.filter((l) => l.bytes > 40 * KB).sort((a, b) => b.bytes - a.bytes);
for (const l of heavy) console.log(`       ${l.path.padEnd(52)} ${kb(l.bytes).padStart(9)}`);
console.log(`       images ${kb(sum(images))} (${images.length}): ${images.map((l) => `${path.basename(l.path)} ${kb(l.bytes)}`).join(', ') || 'none'}`);
console.log(`       videos ${kb(sum(videos))} (${videos.length})`);

// ---- 4: Lighthouse mobile ----------------------------------------------------------------------
// Lighthouse simulates a slow phone from what it observed, so a busy computer moves its numbers
// (Total Blocking Time most). It runs three times (--lighthouse=5 for more) and reports the median.
// Each run is awaited, never run with spawnSync: the server above lives in this process, and a
// blocked event loop would leave Lighthouse's page load unanswered.
if (lighthouseRuns) {
  const chrome = process.env.CHROME_PATH || (fs.existsSync('/Applications/Google Chrome.app') ? undefined : chromium.executablePath());
  const reports = [];
  for (let i = 0; i < lighthouseRuns; i++) {
    const out = path.join(process.env.TMPDIR || '/tmp', `lighthouse-${process.pid}-${i}.json`);
    const status = await new Promise((done) => {
      const child = spawn(
        process.platform === 'win32' ? 'npx.cmd' : 'npx',
        ['-y', 'lighthouse@12', new URL('/', base).href, '--form-factor=mobile', '--only-categories=performance,accessibility', '--output=json', `--output-path=${out}`, '--chrome-flags=--headless=new', '--quiet'],
        { stdio: ['ignore', 'inherit', 'inherit'], env: { ...process.env, ...(chrome ? { CHROME_PATH: chrome } : {}) } },
      );
      child.on('error', (error) => {
        console.error(error.message);
        done(1);
      });
      child.on('exit', (code, signal) => done(signal ? 1 : code));
    });
    if (status === 0 && fs.existsSync(out)) {
      reports.push(JSON.parse(fs.readFileSync(out, 'utf8')));
      fs.rmSync(out);
    }
  }
  if (!reports.length) {
    console.log("\nLighthouse didn't finish.");
    over++;
  } else {
    const score = (report, c) => Math.round((report.categories[c]?.score ?? 0) * 100);
    const value = (report, id) => report.audits[id]?.numericValue ?? NaN;
    reports.sort((a, b) => score(a, 'performance') - score(b, 'performance'));
    const report = reports[Math.floor(reports.length / 2)];
    const audit = (id) => report.audits[id];
    const cls = value(report, 'cumulative-layout-shift');
    const lcp = value(report, 'largest-contentful-paint');
    const lcpNode = audit('largest-contentful-paint-element')?.details?.items?.[0]?.items?.[0]?.node;
    const lcpIsName = !!lcpNode && /hero-name|hero__name/.test(`${lcpNode.selector} ${lcpNode.snippet}`);
    console.log(`\nLighthouse mobile (simulated slow 4G and a 4x slower CPU), the median of ${reports.length} run(s)`);
    console.log(`       each run: ${reports.map((r) => `Performance ${score(r, 'performance')}, LCP ${(value(r, 'largest-contentful-paint') / 1000).toFixed(2)} s, TBT ${Math.round(value(r, 'total-blocking-time'))} ms`).join('; ')}`);
    console.log(`  ${verdict(score(report, 'performance') >= 85)} Performance                            ${String(score(report, 'performance')).padStart(9)}   budget at least 85`);
    console.log(`  ${verdict(score(report, 'accessibility') === 100)} Accessibility                          ${String(score(report, 'accessibility')).padStart(9)}   budget 100`);
    console.log(`  ${verdict(cls < 0.05)} CLS                                    ${cls.toFixed(3).padStart(9)}   budget under 0.05`);
    console.log(`  ${verdict(lcp < 2500)} LCP                                    ${`${(lcp / 1000).toFixed(2)} s`.padStart(9)}   budget under 2.5 s`);
    console.log(`  ${lcpIsName ? 'ok  ' : 'warn'} LCP element: ${lcpNode ? `${lcpNode.nodeLabel} (${lcpNode.selector})` : 'not reported'}${lcpIsName ? '' : ', should be the hero name'}`);
    for (const id of ['first-contentful-paint', 'total-blocking-time', 'speed-index', 'interactive']) {
      const a = audit(id);
      if (a) console.log(`       ${a.title.padEnd(38)} ${a.displayValue}`);
    }
    // What the simulated phone downloads before it paints: Lighthouse counts every request that
    // started before the observed first paint as standing in the way of the LCP.
    const observed = audit('metrics')?.details?.items?.[0]?.observedLargestContentfulPaint ?? 0;
    const early = (audit('network-requests')?.details?.items ?? []).filter((r) => r.networkRequestTime <= observed && r.transferSize > 16 * KB);
    if (early.length) console.log(`       fetched before the first paint (each delays the simulated LCP): ${early.map((r) => `${new URL(r.url).pathname} ${kb(r.transferSize)}`).join(', ')}`);
    const file = (url) => (/^https?:/.test(url || '') ? path.basename(new URL(url).pathname) || '/' : 'unattributed');
    for (const t of (audit('long-tasks')?.details?.items ?? []).slice(0, 5)) console.log(`       long task ${String(Math.round(t.duration)).padStart(4)} ms at ${Math.round(t.startTime)} ms: ${file(t.url)}`);
    for (const a of Object.values(report.audits).filter((a) => a.score !== null && a.score < 1 && report.categories.accessibility.auditRefs.some((r) => r.id === a.id && r.weight > 0))) {
      console.log(`       accessibility: ${a.id}: ${a.title}`);
    }
  }
}

server?.close();
console.log(over ? `\n${over} budget(s) over.` : '\nAll budgets met.');
process.exit(over ? 1 : 0);
