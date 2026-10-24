// check-a11y.mjs: an automatic accessibility check of every page, using axe inside a real browser.
//
// Run it with the site built and previewed in another terminal:
//   npm run build && npm run preview          (terminal 1)
//   npm run check:a11y                        (terminal 2)
// It drives the Chromium that Playwright keeps in ~/Library/Caches/ms-playwright. If that is
// missing, download it once with:  npx playwright-core install chromium
//
// For every page, at a laptop size (1440 x 900) and a phone size (390 x 844), each with motion on
// and with the device asking for reduced motion, it:
//   1. opens the page, waits for the hero intro to finish (it reveals by 2.5 s at the latest),
//      and runs axe with the WCAG 2.2 A and AA rules at the top of the page,
//   2. scrolls to the bottom a screen at a time, so every pin and scene has played and all text
//      is in its final place, and runs axe again (axe checks what is on screen, including color
//      contrast; text over the night gradient or the canvas comes back as "needs review", which
//      the measured ratios in src/styles/tokens.css cover),
//   3. lists every problem. "Serious" and "critical" ones end the script with exit code 1 (they
//      block the deploy); "moderate" and "minor" ones are listed as warnings.
// Another address can be checked with:  BASE=http://localhost:4411 npm run check:a11y

import { chromium } from 'playwright-core';
import { AxeBuilder } from '@axe-core/playwright';

const BASE = process.env.BASE || 'http://localhost:4321';
// '/?snapshot' checks snapshot mode (motion off, every section in full, no buttons).
const PAGES = ['/', '/?snapshot', '/404'];

const setups = [
  { name: 'laptop', viewport: { width: 1440, height: 900 }, reducedMotion: 'no-preference' },
  { name: 'laptop, reduced motion', viewport: { width: 1440, height: 900 }, reducedMotion: 'reduce' },
  { name: 'phone', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'no-preference' },
  { name: 'phone, reduced motion', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, reducedMotion: 'reduce' },
];

// Scroll to the bottom a screen at a time, then wait, so every pin and scene has played.
async function scrollThrough(page) {
  let last = -1;
  for (let i = 0; i < 400; i++) {
    await page.evaluate(() => window.scrollBy(0, Math.round(window.innerHeight * 0.7)));
    await page.waitForTimeout(60);
    const y = await page.evaluate(() => window.scrollY);
    if (Math.abs(y - last) < 1) break;
    last = y;
  }
  await page.waitForTimeout(1500);
}

async function check(page) {
  const tags = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22a', 'wcag22aa'];
  return new AxeBuilder({ page }).withTags(tags).analyze();
}

try {
  await fetch(new URL('/', BASE));
} catch {
  console.error(`Nothing answers at ${BASE}. Is "npm run preview" running?`);
  process.exit(1);
}

const browser = await chromium.launch();
let serious = 0;
let minor = 0;

for (const setup of setups) {
  const { name, ...options } = setup;
  const context = await browser.newContext(options);
  for (const path of PAGES) {
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`page error [${name}] ${path}: ${error.message}`));
    // The 404 address answers with status 404 on purpose; only a failed load is an error.
    await page.goto(new URL(path, BASE).href, { waitUntil: 'networkidle' });
    await page.waitForTimeout(3000);
    for (const where of ['top', 'bottom']) {
      if (where === 'bottom') await scrollThrough(page);
      const results = await check(page);
      for (const violation of results.violations) {
        const bad = violation.impact === 'serious' || violation.impact === 'critical';
        if (bad) serious += 1;
        else minor += 1;
        console.log(`${bad ? 'FAIL' : 'warn'} [${name}, ${where}] ${path}: ${violation.id} (${violation.impact}) ${violation.help}`);
        violation.nodes.slice(0, 5).forEach((node) => console.log(`       ${node.target.join(' ')}`));
      }
    }
    await page.close();
  }
  await context.close();
}
await browser.close();

console.log(`\nAccessibility check: ${PAGES.length} pages x ${setups.length} setups, top and bottom.`);
console.log(`${serious} serious or critical problem(s), ${minor} smaller one(s).`);
process.exit(serious > 0 ? 1 : 0);
