// devices.mjs: the phone, tablet and desktop check for V4.md section 8.
//
// "npm run check" runs it for you against a fresh build. To run it alone, with the site previewed in
// another terminal:
//   npm run build && npm run preview          (terminal 1)
//   npm run check:devices                     (terminal 2, Chromium)
//   npm run check:devices -- --webkit         (Safari's engine; needs: npx playwright-core install webkit)
// Options: BASE=http://localhost:4321, --only=iphone-15,ipad-air-portrait, --shard=1/2 (every
// second size, starting with the first: CI splits the matrix over two machines), --shots (save
// screenshots to .devices/, which is gitignored).
//
// For every size in the matrix it loads the page, waits for the intro, then checks the whole page
// (header, main and the footer with Contact), at the top and at ten points down it (a pin or a
// reveal that slides something in from the side only shows while it's on screen):
//   - no horizontal scroll. body, main and the footer clip sideways overflow (overflow-x: clip),
//     so the page itself can only widen from what sits outside them (the header, fixed layers);
//     inside them, what that clip would cut off at the window edge is checked instead: no line of
//     text past the edge (even when an ancestor clips it), and no control, picture or bordered box
//     cut off by the window edge (a strip that clips inside the window, like the logos, is its own
//     business; aria-hidden decoration, like the phone canvas's bleed, doesn't count)
//   - on touch sizes, every link and button is at least 44 x 44 px (visually hidden ones excepted)
//   - phones sideways (Chromium only, which can pretend to have a notch): no text or control sits
//     under the notch or the home indicator (safe-area insets of 59 px left and right, 21 px below)
// and once per size:
//   - the layout mode is the one V4.md 8.1 says for that size (html[data-layout]), and the input
//     mode matches the device (html[data-input]: touch or mouse)
//   - the intro phone canvas is there wherever the browser has WebGL 2 (it scrolls the module
//     into view first), and keeps its drawing buffer at or under 1.3 megapixels
//   - at most two live WebGL contexts (the world and the intro phone, V4.md 8.8)
//   - no console errors
// Then it simulates the browser toolbar hiding and showing (a height-only resize of 80 px) and
// checks the world did not rebuild (window.__night.world.stats().rebuilds stays the same).
//
// Where WebGL is missing (a CI machine whose browser can't start even its software renderer), the
// world never starts, so the toolbar check is skipped, and without WebGL 2 so is the intro canvas
// check (the phone keeps its still); it says so at the end, and everything else still runs.
// On a Mac it uses the real GPU (Metal); on Linux, Chromium's software renderer (SwiftShader).
// It exits with code 1 if anything fails, so CI can run it.

import { chromium, webkit } from 'playwright-core';
import fs from 'node:fs';

const BASE = process.env.BASE || 'http://localhost:4321';
const useWebkit = process.argv.includes('--webkit');
const shots = process.argv.includes('--shots');
const only = process.argv.find((a) => a.startsWith('--only='))?.slice(7).split(',');
const [shard, shards] = (process.argv.find((a) => a.startsWith('--shard='))?.slice(8) || '1/1').split('/').map(Number);
const engineName = useWebkit ? 'webkit' : 'chromium';

// [name, width, height, scale, touch, expected layout]
const MATRIX = [
  ['android-small', 360, 800, 3, true, 'stack'],
  ['iphone-se', 375, 667, 2, true, 'stack'],
  ['iphone-15', 393, 852, 3, true, 'stack'],
  ['iphone-pro-max', 430, 932, 3, true, 'stack'],
  ['iphone-landscape', 852, 393, 3, true, 'short'],
  ['pro-max-landscape', 932, 430, 3, true, 'short'],
  ['ipad-mini-portrait', 744, 1133, 2, true, 'stack'],
  ['ipad-air-portrait', 820, 1180, 2, true, 'stack'],
  ['ipad-pro13-portrait', 1024, 1366, 2, true, 'stack'],
  ['ipad-mini-landscape', 1133, 744, 2, true, 'wide'],
  ['ipad-air-landscape', 1180, 820, 2, true, 'wide'],
  ['ipad-pro13-landscape', 1366, 1024, 2, true, 'wide'],
  ['laptop-13', 1280, 800, 2, false, 'wide'],
  ['laptop-15', 1440, 900, 2, false, 'wide'],
  ['desktop-hd', 1920, 1080, 1, false, 'wide'],
]
  .filter(([name]) => !only || only.includes(name))
  .filter((_, i) => i % shards === shard - 1);

if (!(shard >= 1 && shard <= shards)) {
  console.error('--shard takes the form k/n, with k from 1 to n (--shard=1/2).');
  process.exit(1);
}
if (!MATRIX.length) {
  console.error(`No sizes match${only ? ` --only=${only.join(',')}` : ''}${shards > 1 ? ` --shard=${shard}/${shards}` : ''}.`);
  process.exit(1);
}

// An iPhone 15 held sideways: the notch side and the home indicator.
const SAFE_AREA = { top: 0, left: 59, right: 59, bottom: 21 };

try {
  await fetch(new URL('/', BASE));
} catch {
  console.error(`Nothing answers at ${BASE}. Is "npm run preview" running?`);
  process.exit(1);
}

// GPU=software tries the CI setup on a Mac.
const software = process.env.GPU === 'software' || process.platform !== 'darwin';
const gpuArgs = software
  ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']
  : ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist'];
const browser = useWebkit
  ? await webkit.launch()
  : await chromium.launch({ args: gpuArgs, executablePath: process.env.PW_CHROMIUM || undefined });
if (shots) fs.mkdirSync('.devices', { recursive: true });
let failures = 0;
let skippedWorld = 0;
let skippedIntro = 0;

// Runs in the page before its own scripts: keeps every WebGL context it makes, so the check can
// count the live ones (a probe that released its context with loseContext() reads as lost).
function trackContexts() {
  const made = [];
  for (const Canvas of [window.HTMLCanvasElement, window.OffscreenCanvas]) {
    if (!Canvas) continue;
    const getContext = Canvas.prototype.getContext;
    Canvas.prototype.getContext = function (type, ...rest) {
      const ctx = getContext.call(this, type, ...rest);
      if (ctx && /webgl/i.test(String(type)) && !made.includes(ctx)) made.push(ctx);
      return ctx;
    };
  }
  window.__liveGl = () => made.filter((gl) => !gl.isContextLost()).length;
}

// The checks that read the page as it stands, at whatever point it's scrolled to. Runs in the page.
// `top` adds the ones made once per size (the layout and input modes, WebGL and the world).
function inspect({ touch, expect, safe, top }) {
  const problems = [];
  const root = document.documentElement;
  const vw = root.clientWidth;
  const vh = window.innerHeight;
  // Only what sits outside body's clipped children (the header, fixed layers) can widen the page.
  if (root.scrollWidth > vw + 1) problems.push(`horizontal scroll: page is ${root.scrollWidth}px wide`);
  if (top) {
    const layout = root.dataset.layout;
    if (layout !== expect) problems.push(`layout is "${layout}", expected "${expect}"`);
    const input = root.dataset.input;
    const expectInput = touch ? 'touch' : 'mouse';
    if (input !== expectInput) problems.push(`input is "${input}", expected "${expectInput}"`);
  }

  const visible = (el) => {
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return r.width > 2 && r.height > 2 && cs.visibility !== 'hidden' && cs.display !== 'none' && !el.closest('[hidden],[inert],[aria-hidden="true"]');
  };
  // Visually hidden text (screen-reader copies, clipped to 1px) is skipped.
  const srOnly = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) {
      const cs = getComputedStyle(a);
      if (cs.getPropertyValue('clip') !== 'auto' || cs.clipPath !== 'none' || cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return true;
      const r = a.getBoundingClientRect();
      if (r.width <= 1 && r.height <= 1) return true;
      if (a.matches('[hidden],[inert],[aria-hidden="true"]')) return true;
    }
    return false;
  };
  const fixed = (el) => {
    for (let a = el; a && a !== document.body; a = a.parentElement) if (getComputedStyle(a).position === 'fixed') return true;
    return false;
  };
  // Parked above the page (or, pinned to the window, above the window) until focused, like the
  // skip link: counts as hidden.
  const parked = (el, r) => (fixed(el) ? r.bottom : r.bottom + window.scrollY) <= 0;
  const textBoxes = (scope) => {
    const boxes = [];
    const walker = document.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (!node.textContent.trim() || srOnly(node.parentElement)) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      const r = range.getBoundingClientRect();
      if (r.width && r.height && !parked(node.parentElement, r)) boxes.push({ text: node.textContent.trim().slice(0, 30), r, el: node.parentElement });
    }
    return boxes;
  };

  // Text past the window edge, anywhere on the page (Contact sits in the footer, outside <main>),
  // even when an ancestor clips it (a clipped title still reads wrong).
  const texts = textBoxes(document.body);
  for (const { text, r } of texts) {
    if (r.right > vw + 1 || r.left < -1) problems.push(`text past the edge: "${text}" [${Math.round(r.left)}, ${Math.round(r.right)}]`);
  }

  // What the page-level clip (body, main, the footer) would cut off at the window edge: controls,
  // pictures and boxes with a side border. The cut is where the ancestors that clip sideways end;
  // one that ends inside the window (the logo strip's mask) is the strip's own design, and an
  // ancestor that scrolls sideways is a swipe strip. aria-hidden decoration is skipped.
  const CONTENT = 'a[href], button, [role="button"], summary, input, select, textarea, img, video, iframe, canvas, svg, [role="img"]';
  const bordered = (cs) => ['Left', 'Right'].some((s) => parseFloat(cs[`border${s}Width`]) > 0 && cs[`border${s}Style`] !== 'none' && !/rgba\(.*,\s*0\)$|transparent/.test(cs[`border${s}Color`]));
  for (const el of document.body.querySelectorAll('*')) {
    const r = el.getBoundingClientRect();
    const pastLeft = r.left < -1;
    const pastRight = r.right > vw + 1;
    // An svg counts as one picture, not each of its shapes.
    if ((!pastLeft && !pastRight) || !r.width || !r.height || (el.closest('svg') && el.closest('svg') !== el)) continue;
    if (!el.matches(CONTENT) && !bordered(getComputedStyle(el))) continue;
    if (srOnly(el)) continue;
    let left = -Infinity;
    let right = Infinity;
    let scroller = false;
    for (let a = el.parentElement; a && a !== root; a = a.parentElement) {
      const overflow = getComputedStyle(a).overflowX;
      if (overflow === 'visible') continue;
      if (overflow === 'auto' || overflow === 'scroll') scroller = true;
      const b = a.getBoundingClientRect();
      left = Math.max(left, b.left);
      right = Math.min(right, b.right);
    }
    if (scroller || !((pastLeft && left <= 1) || (pastRight && right >= vw - 1))) continue;
    const name = `${el.tagName.toLowerCase()}${el.classList.length ? `.${[...el.classList].join('.')}` : ''}`;
    const label = (el.getAttribute('aria-label') || el.getAttribute('alt') || el.textContent || '').trim().slice(0, 24);
    problems.push(`cut off by the window edge: ${name}${label ? ` "${label}"` : ''} [${Math.round(r.left)}, ${Math.round(r.right)}]`);
  }

  const controls = [...document.querySelectorAll('a[href], button, [role="button"], summary, input:not(.sr-only)')].filter(visible);
  if (touch) {
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width < 44 || r.height < 44) problems.push(`tap target under 44px: ${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}" ${Math.round(r.width)}x${Math.round(r.height)}`);
    }
  }

  // Safe areas: no text under the notch (left, right) or, for things pinned to the window, the
  // home indicator (bottom). A control's tap area may reach into the inset, as Apple allows (the
  // edges beside the notch still take touches), but its middle may not sit there.
  if (safe) {
    const middle = (r) => {
      const x = (r.left + r.right) / 2;
      const y = (r.top + r.bottom) / 2;
      return { left: x, right: x, top: y, bottom: y };
    };
    const items = [
      ...texts.map(({ text, r, el }) => ({ what: `text "${text}"`, r, el })),
      ...controls
        .map((el) => ({ what: `${el.tagName.toLowerCase()} "${(el.textContent || el.getAttribute('aria-label') || '').trim().slice(0, 24)}"`, r: el.getBoundingClientRect(), el }))
        .filter(({ r, el }) => !parked(el, r))
        .map((item) => ({ ...item, r: middle(item.r) })),
    ];
    const under = { left: [], right: [], bottom: [] };
    for (const { what, r, el } of items) {
      if (r.left < safe.left - 1) under.left.push(`${what} at ${Math.round(r.left)}`);
      else if (r.right > vw - safe.right + 1) under.right.push(`${what} to ${Math.round(r.right)}`);
      else if (fixed(el) && r.bottom > vh - safe.bottom + 1 && r.top < vh) under.bottom.push(`${what} to ${Math.round(r.bottom)}`);
    }
    const where = { left: `the notch (left ${safe.left}px)`, right: `the notch (right ${safe.right}px of ${vw})`, bottom: `the home indicator (bottom ${safe.bottom}px of ${vh})` };
    for (const side of ['left', 'right', 'bottom']) {
      const list = [...new Set(under[side])];
      if (list.length) problems.push(`${list.length} under ${where[side]}: ${list.slice(0, 3).join('; ')}${list.length > 3 ? '; ...' : ''}`);
    }
  }

  if (!top) return { problems };
  const world = window.__night?.world;
  // A probe context each, released at once (the live-context count reads them as lost).
  const probe = (type) => {
    const gl = document.createElement('canvas').getContext(type);
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return !!gl;
  };
  const webgl2 = probe('webgl2');
  const webgl = webgl2 || probe('webgl');
  return { problems, webgl, webgl2, tier: world?.tier?.tier, dpr: world?.renderer?.getPixelRatio?.(), rebuilds: world?.stats?.().rebuilds };
}

for (const [name, w, h, scale, touch, expect] of MATRIX) {
  const context = await browser.newContext({
    viewport: { width: w, height: h },
    deviceScaleFactor: scale,
    isMobile: touch && !useWebkit ? true : undefined,
    hasTouch: touch,
  });
  await context.addInitScript(trackContexts);
  const page = await context.newPage();
  const safe = !useWebkit && touch && expect === 'short' ? SAFE_AREA : null;
  if (safe) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setSafeAreaInsetsOverride', { insets: safe });
  }
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  // A failed load names its address only in the location, so add it.
  page.on('console', (m) => m.type() === 'error' && errors.push(/^Failed to load resource/.test(m.text()) ? `${m.text()} ${m.location().url}` : m.text()));
  await page.goto(new URL('/?debug', BASE).href, { waitUntil: 'load' });
  await page.waitForTimeout(5000);
  if (shots) await page.screenshot({ path: `.devices/${name}-${engineName}-hero.png` });

  const result = await page.evaluate(inspect, { touch, expect, safe, top: true });

  // The intro phone: scroll it into view so its canvas is built (waiting up to 6 s for it, for a
  // slow software renderer), then measure the buffer. With WebGL 2 there must be a canvas: a lazy
  // chunk that didn't load, or a WebGL path that gave up, would otherwise leave the still in
  // place and pass.
  const intro = await page.evaluate(async () => {
    const box = document.querySelector('[data-intro-phone]') || document.querySelector('[data-phone]');
    if (!box) return { found: false };
    box.scrollIntoView({ block: 'center' });
    const start = performance.now();
    while (!box.querySelector('canvas') && performance.now() - start < 6000) await new Promise((r) => setTimeout(r, 100));
    await new Promise((r) => setTimeout(r, Math.max(1000, 2500 - (performance.now() - start))));
    const canvas = box.querySelector('canvas');
    return { found: true, canvas: !!canvas, buffer: canvas ? canvas.width * canvas.height : 0 };
  });
  if (!intro.found) result.problems.push('intro phone not found ([data-intro-phone])');
  else if (!intro.canvas && result.webgl2) result.problems.push('intro phone has no canvas, though the browser has WebGL 2 (did its chunk load?)');
  else if (!intro.canvas) skippedIntro++;
  else if (intro.buffer > 1.3e6) result.problems.push(`intro phone canvas buffer is ${(intro.buffer / 1e6).toFixed(2)} MP (max 1.3)`);
  if (shots && intro.found) await page.screenshot({ path: `.devices/${name}-${engineName}-intro.png` });

  // The whole page again at ten points down it: a pin or a reveal that slides in from the side
  // shows only while it's on screen. A problem seen at several points is listed once, where it
  // first showed (numbers aside, so a box that moves counts as one).
  const key = (p) => p.replace(/-?\d+(\.\d+)?/g, '#');
  const seen = new Set(result.problems.map(key));
  for (let i = 1; i <= 10; i++) {
    const at = i / 10;
    await page.evaluate((at) => window.scrollTo(0, (document.documentElement.scrollHeight - window.innerHeight) * at), at);
    await page.waitForTimeout(500);
    const { problems } = await page.evaluate(inspect, { touch, expect, safe, top: false });
    for (const p of problems) {
      if (seen.has(key(p))) continue;
      seen.add(key(p));
      result.problems.push(`${p} (${i * 10}% down)`);
    }
  }

  const contexts = await page.evaluate(() => window.__liveGl?.() ?? 0);
  if (contexts > 2) result.problems.push(`${contexts} live WebGL contexts (max 2: the world and the intro phone)`);

  // The browser toolbar hiding and showing: height-only resizes must not rebuild the world (8.3).
  if (touch && result.rebuilds !== undefined) {
    await page.setViewportSize({ width: w, height: h + 80 });
    await page.waitForTimeout(600);
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(600);
    const after = await page.evaluate(() => window.__night?.world?.stats?.().rebuilds);
    if (after !== result.rebuilds) result.problems.push(`toolbar resize rebuilt the world (${result.rebuilds} -> ${after})`);
  } else if (touch && !result.webgl) {
    skippedWorld++;
  } else if (touch) {
    result.problems.push('world.stats().rebuilds is missing (add a rebuild counter, V4.md 8.3)');
  }

  for (const e of errors.slice(0, 3)) result.problems.push(`console: ${e.slice(0, 200)}`);
  const ok = result.problems.length === 0;
  if (!ok) failures++;
  const world = result.webgl ? `tier ${result.tier ?? '-'}  dpr ${result.dpr ?? '-'}` : 'no WebGL';
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name.padEnd(22)} ${`${w}x${h}`.padEnd(10)} ${world}  gl contexts ${contexts}`);
  for (const p of [...new Set(result.problems)].slice(0, 12)) console.log(`      - ${p}`);
  await context.close();
}

await browser.close();
console.log(`\nDevice check (${engineName}): ${MATRIX.length - failures} of ${MATRIX.length} sizes pass.`);
if (skippedWorld) console.log(`No WebGL in this browser, so the toolbar rebuild check was skipped at ${skippedWorld} touch size(s).`);
if (skippedIntro) console.log(`No WebGL 2 in this browser, so the intro phone kept its still and its canvas check was skipped at ${skippedIntro} size(s).`);
process.exit(failures ? 1 : 0);
