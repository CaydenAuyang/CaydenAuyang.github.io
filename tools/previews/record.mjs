#!/usr/bin/env node
// Records the muted project preview loops for the portfolio site.
//
//   cd tools/previews && npm install && node record.mjs
//
// Options:
//   --only=aisimply,ourcityhealth,civicaiclub   limit to some sites (default: all)
//   --framing=desktop,phone                      limit to some framings (default: both, desktop first)
//   --encode-only                                skip capture, re-encode the frames already in raw/
//   --preview                                    capture 4 stills per clip into raw/<id>/preview-*.jpg and stop
//   --selftest                                   check the on-screen claim scanner against pages known to have them
//
// How it works: each clip is a frame sequence. For every output frame the script sets the page
// to an exact pose (a scroll position, or the Cesium camera for the globe), waits for the page to
// paint, takes a viewport screenshot, then ffmpeg encodes the frames at 30 fps. Camera moves are
// ping-pong (hold, ease out, hold, ease back) so the last frame flows into the first.
// Before and during capture, the text on screen is checked against the flagged-claims list and
// the clip fails if any of it is visible.

import { chromium } from 'playwright-core';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '../..');
const RAW = path.join(HERE, 'raw');
const OUT = path.join(REPO, 'public/media/previews');
const JSON_OUT = path.join(REPO, 'src/data/previews.json');
const FFMPEG = fs.existsSync('/opt/homebrew/bin/ffmpeg') ? '/opt/homebrew/bin/ffmpeg' : 'ffmpeg';
const CWEBP = fs.existsSync('/opt/homebrew/bin/cwebp') ? '/opt/homebrew/bin/cwebp' : 'cwebp';

const FPS = 30;
const DURATION = 9.6; // seconds; a multiple of the 2.4 s "breathe" animation on aisimply.co
const VIDEO_BUDGET = 2_000_000; // bytes per video file
const POSTER_BUDGET = 100_000; // bytes per poster
const RECORDED_ON = '2026-10-23';
const RECORDED_LABEL = 'Oct 23, 2026';

const FRAMINGS = {
  desktop: {
    context: { viewport: { width: 1440, height: 900 }, deviceScaleFactor: 2 },
    out: { w: 1280, h: 800 },
  },
  phone: {
    context: {
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      userAgent:
        'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    },
    out: { w: 720, h: 1558 }, // 390x844 aspect, even dimensions
  },
};

// Text that must never be readable in a clip. Checked on every captured frame.
const GLOBAL_FLAGS = [
  /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, // email addresses
  /\+1[\s-]?\d{3}[\s-]?\d{3}/, // phone numbers
  /398 Pomfret Street/i, // street address
];

const easeInOutCubic = (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);

// Ping-pong progress for t in [0, DURATION): hold at 0, ease to 1, hold, ease back to 0, hold.
function pingPong(t, { edgeHold = 0.4, midHold = 0.8 } = {}) {
  const move = (DURATION - 2 * edgeHold - midHold) / 2;
  if (t < edgeHold) return 0;
  t -= edgeHold;
  if (t < move) return easeInOutCubic(t / move);
  t -= move;
  if (t < midHold) return 1;
  t -= midHold;
  if (t < move) return 1 - easeInOutCubic(t / move);
  return 0;
}

const lerp = (a, b, p) => a + (b - a) * p;

const HIDE_CSS = `
  html { scrollbar-width: none !important; }
  ::-webkit-scrollbar { display: none !important; width: 0 !important; height: 0 !important; }
  * { caret-color: transparent !important; }
`;

// ---------------------------------------------------------------- site definitions

const SITES = {
  aisimply: {
    project: 'AI Simply',
    url: 'https://aisimply.co',
    caption: {
      desktop: `AI Simply's website, scrolling from the home page headline and services to its mission statement. Recorded ${RECORDED_LABEL}.`,
      phone: `AI Simply's website on a phone, scrolling through its services: Automate, Scale and Enrich. Recorded ${RECORDED_LABEL}.`,
    },
    // Audit (Oct 11) items that must not appear: stats on /about, OurCityHealth as a client,
    // Civic Exchange staff quotes, client counts, revenue or paid-client claims.
    flags: [
      /100\s*%/, /satisfaction/i, /hours saved/i, /client'?s average/i, /client industries/i,
      /120\+/, /tools leveraged/i, /our\s*city\s*health/i, /kay huang/i, /lionel mok/i,
      /revenue/i, /paid client/i, /featured clients/i, /us in numbers/i,
      // Softer audit items that are easy to keep out of frame.
      /student expert/i, /ready-made/i, /proudest/i, /under a month/i,
    ],
    imageFlags: [/our_city_health/i, /ourcityhealth/i],
    scrollEnd: { desktop: 880, phone: 1250 },
    async prepare(page) {
      await page.waitForLoadState('load');
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(4000);
      await preScroll(page, 4200);
      // The top-right starburst is a 6 s looping video; hold it on the full burst.
      await freezeVideos(page, () => 2.5);
    },
    pose: scrollPose,
  },

  ourcityhealth: {
    project: 'OurCityHealth',
    url: 'https://caydenauyang.github.io/OurCityHealth/',
    caption: {
      desktop: `OurCityHealth's demo globe, showing saved demo data (news dated 2014 to early 2024). Recorded ${RECORDED_LABEL}.`,
      phone: `OurCityHealth's demo globe on a phone, showing saved demo data (news dated 2014 to early 2024). Recorded ${RECORDED_LABEL}.`,
    },
    demoData: true,
    flags: [/sub-?\s?50\s?ms/i, /380,?000/i, /outlets/i, /weekly update/i, /investor/i],
    imageFlags: [],
    camera: {
      // [lon, lat, height in metres], straight down. Zooms toward Hong Kong and back out.
      desktop: { from: [106, 21, 16_500_000], to: [113.5, 22.8, 7_000_000] },
      phone: { from: [110, 19, 23_000_000], to: [114, 22.5, 10_000_000] },
    },
    async prepare(page, framing) {
      await page.waitForFunction(() => window.Cesium && window.Cesium.Scene, null, { timeout: 60000 });
      // Grab the Cesium scene the app creates by wrapping Scene.prototype.render.
      await page.evaluate(() => {
        const C = window.Cesium;
        const orig = C.Scene.prototype.render;
        C.Scene.prototype.render = function (...a) { window.__scene = this; return orig.apply(this, a); };
      });
      await page.waitForFunction(() => window.__scene, null, { timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await page.waitForTimeout(4000);
      // Dismiss the "About the data you see here" popup.
      const gotIt = page.getByRole('button', { name: /got it/i });
      await gotIt.waitFor({ timeout: 20000 }).then(() => gotIt.click()).catch(() => {});
      await page.waitForTimeout(800);
      if (framing === 'phone') {
        // The city list covers half the globe on a phone; close it.
        await page.getByRole('button', { name: /close sidebar/i }).click().catch(() => {});
        await page.waitForTimeout(800);
      }
      // Warm the imagery tiles along the whole path.
      for (let i = 0; i <= 12; i++) {
        await this.pose(page, (DURATION / 2) * (i / 12), framing);
        await waitForTiles(page);
      }
      await this.pose(page, 0, framing);
      await waitForTiles(page);
      await page.waitForTimeout(1000);
    },
    async pose(page, t, framing) {
      const { from, to } = this.camera[framing];
      const p = pingPong(t);
      const lon = lerp(from[0], to[0], p);
      const lat = lerp(from[1], to[1], p);
      const h = Math.exp(lerp(Math.log(from[2]), Math.log(to[2]), p)); // zoom feels even in log space
      await page.evaluate(([lon, lat, h]) => {
        const s = window.__scene, C = window.Cesium;
        s.camera.setView({
          destination: C.Cartesian3.fromDegrees(lon, lat, h),
          orientation: { heading: 0, pitch: C.Math.toRadians(-90), roll: 0 },
        });
        s.requestRender && s.requestRender();
      }, [lon, lat, h]);
      await nextFrames(page, 2);
      await waitForTiles(page);
    },
  },

  civicaiclub: {
    project: 'Civic AI Club',
    url: 'https://civicaiclub.github.io',
    caption: {
      desktop: `The Civic AI Club website, scrolling from its home page title to how the club works with teachers. Recorded ${RECORDED_LABEL}.`,
      phone: `The Civic AI Club website on a phone, scrolling from its home page title to how the club works with teachers. Recorded ${RECORDED_LABEL}.`,
    },
    // Student names with class years, e.g. "Luke Ryan ’27", stay off screen.
    flags: [/[A-Z][a-z]+ [A-Z][A-Za-z-]+ [’']\d\d\b/],
    imageFlags: [],
    scrollEnd: { desktop: 1700, phone: 900 },
    virtualTime: true, // GSAP + Lenis: step their clock with the frames
    async prepare(page) {
      // Let the first-visit preloader finish.
      await page.waitForFunction(
        () => !document.documentElement.classList.contains('js-preload') &&
          document.documentElement.classList.contains('motion-ready'),
        null, { timeout: 60000 });
      await page.evaluate(() => document.fonts.ready);
      await page.addStyleTag({ content: '.cursor{display:none!important}' });
      await page.waitForTimeout(1500);
      await preScroll(page, 3000);
      // The home reel cycles through four tools; one of them shows demo email addresses.
      // Hold it on AutoPlanner's color-coded weekly table (demo data) at 10.0 s.
      await freezeVideos(page, (src) => (/home-reel/.test(src) ? 10.0 : 0.5));
    },
    pose: scrollPose,
  },
};

// ---------------------------------------------------------------- page helpers

async function nextFrames(page, n = 2) {
  await page.evaluate((n) => new Promise((r) => {
    const step = (k) => (k <= 0 ? r() : requestAnimationFrame(() => step(k - 1)));
    step(n);
  }), n);
}

async function waitForTiles(page, timeout = 15000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    const ok = await page.evaluate(() => window.__scene && window.__scene.globe.tilesLoaded);
    if (ok) { await nextFrames(page, 2); return true; }
    await nextFrames(page, 2);
  }
  console.warn('    tiles did not finish loading within', timeout, 'ms');
  return false;
}

async function preScroll(page, to) {
  for (let y = 0; y <= to; y += 250) {
    await page.evaluate((y) => window.scrollTo(0, y), y);
    await page.waitForTimeout(90);
  }
  await page.waitForTimeout(800);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(2000);
}

// Pause every <video> at a fixed time and stop the page from restarting them. Each video plays for
// a moment from its hold time first, so pages that paint video into a canvas (Wix tints its
// decorative videos this way) draw that frame before the pause.
async function freezeVideos(page, timeFor) {
  const srcs = await page.evaluate(() => [...document.querySelectorAll('video')].map((v) => v.currentSrc || v.src || ''));
  const times = srcs.map((s) => timeFor(s));
  await page.evaluate(async (times) => {
    const realPlay = HTMLMediaElement.prototype.play;
    const vids = [...document.querySelectorAll('video')];
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    await Promise.all(vids.map(async (v, i) => {
      v.muted = true;
      v.removeAttribute('autoplay');
      if (!(v.readyState >= 1)) {
        if (v.preload === 'none') v.preload = 'auto';
        v.load();
        await Promise.race([new Promise((r) => v.addEventListener('loadedmetadata', r, { once: true })), wait(5000)]);
      }
      if (!(Number.isFinite(v.duration) && v.duration > 0)) { v.pause(); return; }
      v.pause();
      const t = Math.min(times[i], v.duration - 0.4);
      await Promise.race([new Promise((r) => { v.addEventListener('seeked', r, { once: true }); v.currentTime = t; }), wait(5000)]);
      try { await realPlay.call(v); await wait(250); } catch { /* autoplay refused; the seeked frame stays */ }
      v.pause();
    }));
    HTMLMediaElement.prototype.play = function () { this.pause(); return Promise.resolve(); };
  }, times);
}

// Step every CSS animation and transition on the document timeline to the capture clock, so they
// play at true speed in the encoded clip however long each screenshot takes.
async function stepAnimations(page, t) {
  await page.evaluate((t) => {
    const base = (window.__animBase ||= new WeakMap());
    for (const a of document.getAnimations()) {
      if (a.timeline && a.timeline !== document.timeline) continue; // scroll-driven, already exact
      if (!base.has(a)) base.set(a, { t0: t, c0: a.currentTime || 0 });
      const b = base.get(a);
      if (a.playState !== 'paused') a.pause();
      a.currentTime = b.c0 + (t - b.t0) * 1000;
    }
  }, t);
}

// A page clock that runs normally until capture starts, then only moves when told to. It drives
// requestAnimationFrame timestamps, performance.now() and Date.now(), which is what GSAP and Lenis
// read, so scripted motion advances exactly one frame per screenshot.
function installClock() {
  const realPerf = performance.now.bind(performance);
  const realDate = Date.now;
  const realRaf = window.requestAnimationFrame.bind(window);
  let manual = false, vPerf = 0, vDate = 0;
  window.__clock = {
    freeze() { vPerf = realPerf(); vDate = realDate(); manual = true; },
    advance(ms) { vPerf += ms; vDate += ms; },
  };
  performance.now = () => (manual ? vPerf : realPerf());
  Date.now = () => (manual ? vDate : realDate());
  window.requestAnimationFrame = (cb) => realRaf((ts) => cb(manual ? vPerf : ts));
}

async function scrollPose(page, t, framing) {
  const y = Math.round(this.scrollEnd[framing] * pingPong(t));
  await page.evaluate((y) => window.scrollTo(0, y), y);
  await nextFrames(page, 2);
}

// Returns visible text or images that match a flag pattern.
async function scanViewport(page, flags, imageFlags) {
  return page.evaluate(([flagSrc, imgSrc]) => {
    const flags = flagSrc.map(([s, f]) => new RegExp(s, f));
    const imgFlags = imgSrc.map(([s, f]) => new RegExp(s, f));
    const W = innerWidth, H = innerHeight;
    const visible = (el, rect) => {
      if (rect.width < 1 || rect.height < 1) return false;
      if (rect.bottom <= 0 || rect.top >= H || rect.right <= 0 || rect.left >= W) return false;
      for (let e = el; e && e !== document.documentElement; e = e.parentElement) {
        const cs = getComputedStyle(e);
        if (cs.visibility === 'hidden' || cs.display === 'none' || parseFloat(cs.opacity) < 0.05) return false;
      }
      const cx = Math.min(W - 1, Math.max(0, rect.left + rect.width / 2));
      const cy = Math.min(H - 1, Math.max(0, rect.top + rect.height / 2));
      const top = document.elementFromPoint(cx, cy);
      return !!top && (top === el || el.contains(top) || top.contains(el));
    };
    const hits = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      const text = n.textContent.replace(/\s+/g, ' ').trim();
      if (!text || !n.parentElement || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(n.parentElement.tagName)) continue;
      const f = flags.find((re) => re.test(text));
      if (!f) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      const rect = range.getBoundingClientRect();
      if (visible(n.parentElement, rect)) hits.push(`text "${text.slice(0, 80)}" (${f})`);
    }
    for (const img of document.querySelectorAll('img')) {
      const key = `${img.alt} ${img.currentSrc || img.src}`;
      const f = imgFlags.find((re) => re.test(key));
      if (f && visible(img, img.getBoundingClientRect())) hits.push(`image ${img.alt || img.src} (${f})`);
    }
    return hits;
  }, [flags.map((r) => [r.source, r.flags]), imageFlags.map((r) => [r.source, r.flags])]);
}

// ---------------------------------------------------------------- capture

async function capture(browser, siteId, framing, { preview = false } = {}) {
  const site = SITES[siteId];
  const id = `${siteId}-${framing}`;
  const dir = path.join(RAW, id);
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });

  const context = await browser.newContext({
    ...FRAMINGS[framing].context,
    locale: 'en-US',
    timezoneId: 'America/New_York',
    colorScheme: 'light',
    reducedMotion: 'no-preference',
  });
  if (site.virtualTime) await context.addInitScript(installClock);
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log(`    [page error] ${String(e.message).slice(0, 120)}`));
  console.log(`  loading ${site.url}`);
  await page.goto(site.url, { waitUntil: 'load', timeout: 120000 });
  await page.addStyleTag({ content: HIDE_CSS });
  await site.prepare.call(site, page, framing);

  const flags = [...GLOBAL_FLAGS, ...site.flags];
  const frames = Math.round(DURATION * FPS);
  const indices = preview ? [0, Math.round(frames * 0.25), Math.round(frames * 0.45), Math.round(frames * 0.6)] : [...Array(frames).keys()];
  const problems = new Set();
  const t0 = Date.now();
  if (site.virtualTime) await page.evaluate(() => window.__clock.freeze());
  let last = 0;
  for (const i of indices) {
    const t = i / FPS;
    if (site.virtualTime) await page.evaluate((ms) => window.__clock.advance(ms), (t - last) * 1000);
    last = t;
    await site.pose.call(site, page, t, framing);
    await stepAnimations(page, t);
    await nextFrames(page, 1);
    for (const hit of await scanViewport(page, flags, site.imageFlags)) problems.add(`t=${t.toFixed(2)}s ${hit}`);
    const file = preview ? `preview-${String(i).padStart(4, '0')}.jpg` : `f_${String(i).padStart(4, '0')}.jpg`;
    await page.screenshot({ path: path.join(dir, file), type: 'jpeg', quality: 95, animations: 'allow', caret: 'hide' });
    if (!preview && i % 60 === 0) console.log(`    frame ${i}/${frames}`);
  }
  console.log(`  captured ${indices.length} frames in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
  await context.close();
  if (problems.size) {
    const list = [...problems];
    fs.writeFileSync(path.join(dir, 'FLAGGED.txt'), list.join('\n') + '\n');
    throw new Error(`${id}: flagged content visible on screen:\n    ${list.slice(0, 12).join('\n    ')}`);
  }
}

// ---------------------------------------------------------------- encode

function ff(args) {
  execFileSync(FFMPEG, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { stdio: 'inherit' });
}

function scaleFilter({ w, h }) {
  return `scale=${w}:${h}:flags=lanczos:out_color_matrix=bt709:out_range=tv,format=yuv420p`;
}

const COLOR_TAGS = ['-colorspace', 'bt709', '-color_primaries', 'bt709', '-color_trc', 'bt709', '-color_range', 'tv'];

// Encode at the lowest CRF (best quality) whose file fits the budget.
function encodeToBudget(label, startCrf, maxCrf, encode) {
  let crf = startCrf;
  for (;;) {
    const size = encode(crf);
    console.log(`    ${label} crf ${crf}: ${size} bytes`);
    if (size <= VIDEO_BUDGET || crf >= maxCrf) return { crf, size };
    // Size roughly halves every +6 CRF; step to the estimate and re-check.
    crf = Math.min(maxCrf, crf + Math.max(1, Math.ceil(6 * Math.log2(size / VIDEO_BUDGET))));
  }
}

function encode(siteId, framing) {
  const id = `${siteId}-${framing}`;
  const dir = path.join(RAW, id);
  const input = path.join(dir, 'f_%04d.jpg');
  if (!fs.existsSync(path.join(dir, 'f_0000.jpg'))) throw new Error(`${id}: no frames in ${dir}`);
  const out = FRAMINGS[framing].out;
  fs.mkdirSync(OUT, { recursive: true });
  const mp4 = path.join(OUT, `${id}.mp4`);
  const webm = path.join(OUT, `${id}.webm`);
  const poster = path.join(OUT, `${id}-poster.webp`);
  const vf = scaleFilter(out);

  const h264 = encodeToBudget('mp4', 20, 40, (crf) => {
    ff(['-framerate', String(FPS), '-i', input, '-vf', vf, '-c:v', 'libx264', '-preset', 'veryslow',
      '-crf', String(crf), '-profile:v', 'high', '-pix_fmt', 'yuv420p', ...COLOR_TAGS,
      '-movflags', '+faststart', '-an', '-r', String(FPS), mp4]);
    return fs.statSync(mp4).size;
  });

  const passlog = path.join(dir, 'vp9pass');
  const vp9 = encodeToBudget('webm', 26, 56, (crf) => {
    const common = ['-framerate', String(FPS), '-i', input, '-vf', vf, '-c:v', 'libvpx-vp9', '-b:v', '0',
      '-crf', String(crf), '-row-mt', '1', '-tile-columns', '2', '-deadline', 'good', '-pix_fmt', 'yuv420p',
      ...COLOR_TAGS, '-an', '-r', String(FPS), '-passlogfile', passlog];
    ff([...common, '-cpu-used', '4', '-pass', '1', '-f', 'webm', '/dev/null']);
    ff([...common, '-cpu-used', '1', '-pass', '2', webm]);
    return fs.statSync(webm).size;
  });

  // Poster: the first frame (the loop's resting pose), WebP under the budget.
  const posterPng = path.join(dir, 'poster.png');
  ff(['-i', path.join(dir, 'f_0000.jpg'), '-vf', `scale=${out.w}:${out.h}:flags=lanczos`, '-frames:v', '1', posterPng]);
  let q = 82;
  for (;;) {
    execFileSync(CWEBP, ['-quiet', '-q', String(q), '-m', '6', '-sharp_yuv', '-metadata', 'none', posterPng, '-o', poster]);
    const size = fs.statSync(poster).size;
    if (size < POSTER_BUDGET || q <= 30) { console.log(`    poster q ${q}: ${size} bytes`); break; }
    q -= 6;
  }

  const probe = JSON.parse(execFileSync(FFMPEG.replace(/ffmpeg$/, 'ffprobe'),
    ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', mp4]).toString());
  const duration = +(+probe.format.duration).toFixed(2);
  const site = SITES[siteId];
  return {
    id,
    project: site.project,
    projectId: siteId,
    framing,
    width: out.w,
    height: out.h,
    duration,
    fps: FPS,
    src: {
      mp4: `/media/previews/${id}.mp4`,
      webm: `/media/previews/${id}.webm`,
      poster: `/media/previews/${id}-poster.webp`,
    },
    bytes: {
      mp4: fs.statSync(mp4).size,
      webm: fs.statSync(webm).size,
      poster: fs.statSync(poster).size,
    },
    liveUrl: site.url,
    caption: site.caption[framing],
    demoData: !!site.demoData,
    recorded: RECORDED_ON,
  };
}

// ---------------------------------------------------------------- main

function argList(name, all) {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`));
  return a ? a.split('=')[1].split(',').filter((x) => all.includes(x)) : all;
}

const siteIds = argList('only', Object.keys(SITES));
const framings = argList('framing', Object.keys(FRAMINGS));
const encodeOnly = process.argv.includes('--encode-only');
const preview = process.argv.includes('--preview');

if (process.argv.includes('--selftest')) {
  // The scanner must see the claims the audit lists where they are still live.
  const b = await chromium.launch({ args: ['--hide-scrollbars'] });
  const ctx = await b.newContext(FRAMINGS.desktop.context);
  const pg = await ctx.newPage();
  const site = SITES.aisimply;
  const checks = [
    ['https://www.aisimply.co/about', /Us in Numbers/],
    ['https://www.aisimply.co/about', /Featured Clients/],
    ['https://www.aisimply.co/post/case-study-institutional-memory-and-ai-writing-for-a-hong-kong-think-tank', /Kay Huang/],
  ];
  let ok = true;
  for (const [url, anchor] of checks) {
    await pg.goto(url, { waitUntil: 'load', timeout: 120000 });
    await pg.waitForTimeout(4000);
    await preScroll(pg, 7000);
    await pg.getByText(anchor).first().scrollIntoViewIfNeeded();
    await pg.evaluate(() => window.scrollBy(0, 150));
    await pg.waitForTimeout(2500);
    const hits = await scanViewport(pg, [...GLOBAL_FLAGS, ...site.flags], site.imageFlags);
    console.log(`${hits.length ? 'caught' : 'MISSED'} ${anchor} on ${url}\n  ${hits.join('\n  ')}`);
    if (!hits.length) ok = false;
  }
  await b.close();
  process.exit(ok ? 0 : 1);
}

const jobs = [];
for (const framing of framings) for (const siteId of siteIds) jobs.push([siteId, framing]);

let browser = null;
if (!encodeOnly) {
  browser = await chromium.launch({
    headless: true,
    args: ['--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--hide-scrollbars', '--mute-audio'],
  });
}

const results = [];
const failures = [];
for (const [siteId, framing] of jobs) {
  const id = `${siteId}-${framing}`;
  console.log(`\n== ${id}`);
  try {
    if (!encodeOnly) await capture(browser, siteId, framing, { preview });
    if (!preview) results.push(encode(siteId, framing));
  } catch (e) {
    console.error(`  FAILED: ${e.message}`);
    failures.push(id);
  }
}
if (browser) await browser.close();

if (results.length) {
  // Merge into the existing manifest so partial re-records keep the other clips.
  let manifest = [];
  try { manifest = JSON.parse(fs.readFileSync(JSON_OUT, 'utf8')); } catch { /* new file */ }
  for (const r of results) {
    const i = manifest.findIndex((m) => m.id === r.id);
    if (i >= 0) manifest[i] = r; else manifest.push(r);
  }
  const order = (m) => Object.keys(FRAMINGS).indexOf(m.framing) * 10 + Object.keys(SITES).indexOf(m.projectId);
  manifest.sort((a, b) => order(a) - order(b));
  fs.mkdirSync(path.dirname(JSON_OUT), { recursive: true });
  fs.writeFileSync(JSON_OUT, JSON.stringify(manifest, null, 2) + '\n');
  console.log(`\nwrote ${path.relative(REPO, JSON_OUT)} (${manifest.length} clips)`);
  for (const r of results) console.log(`  ${r.id}: ${r.duration}s  mp4 ${r.bytes.mp4}  webm ${r.bytes.webm}  poster ${r.bytes.poster}`);
}
if (failures.length) {
  console.error(`\nfailed: ${failures.join(', ')}`);
  process.exitCode = 1;
}
