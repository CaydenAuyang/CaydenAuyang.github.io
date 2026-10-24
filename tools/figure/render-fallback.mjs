// Renders the still image shown when WebGL is missing: the assembled figure, drawn from the point
// data by the real renderer (in headless Chromium through the harness), on a transparent
// background. It never touches the photos.
//
//   node tools/figure/render-fallback.mjs [--point '#8b93a3'] [--glow '#c9ced8'] [--width 720] [--height 900]
//
// Writes public/figure/figure-fallback.png and public/figure/figure-fallback.webp (kept under
// 120 KB by lowering the WebP quality, then the size, until it fits). Needs cwebp (Homebrew webp).
// Pass the site's colors to match the page, for example:
//   node tools/figure/render-fallback.mjs --point '#1a1a1a' --glow 'rgb(43 74 203 / 0.35)'

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serve, REPO_ROOT } from './harness/serve.mjs';
import { launch } from './harness/browser.mjs';

export async function renderFallback({
  repoRoot = REPO_ROOT,
  point = '#8b93a3',
  glow = '#c9ced8',
  width = 720,
  height = 900,
  src = '/public/figure/figure-hi.bin',
  mount = null,
  outDir = path.join(repoRoot, 'public/figure'),
  maxBytes = 115000, // stays under 120 KB with room to spare
  quiet = false,
} = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const { port, close } = await serve(repoRoot, 0, mount ? { '/__test/': mount } : {});
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
    const q = new URLSearchParams({ still: '1', transparent: '1', bare: '1', level: 'hi', yaw: '0', src, point, glow });
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto(`http://127.0.0.1:${port}/tools/figure/harness/index.html?${q}`);
    await page.waitForFunction(() => window.__fig && ['ready', 'fallback'].includes(window.__fig.stats.state), null, { timeout: 20000 });
    const stats = await page.evaluate(() => ({ ...window.__fig.stats }));
    if (stats.state !== 'ready') throw new Error(`renderer did not draw (${stats.reason || 'unknown'}) ${errors.join(' ')}`);
    await page.waitForTimeout(300);
    fs.mkdirSync(outDir, { recursive: true });
    const png = path.join(outDir, 'figure-fallback.png');
    await page.locator('canvas').screenshot({ path: png, omitBackground: true });
    const webp = path.join(outDir, 'figure-fallback.webp');
    let done = false;
    let scale = 1;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      for (const qv of [80, 72, 64, 56, 48]) {
        const resize = scale < 1 ? ['-resize', String(Math.round(width * scale)), String(Math.round(height * scale))] : [];
        execFileSync('cwebp', ['-quiet', '-q', String(qv), '-alpha_q', '80', '-m', '6', ...resize, png, '-o', webp]);
        const bytes = fs.statSync(webp).size;
        if (bytes <= maxBytes) {
          log(`figure-fallback.webp ${(bytes / 1000).toFixed(1)} KB (quality ${qv}, ${Math.round(width * scale)}x${Math.round(height * scale)})`);
          done = true;
          break;
        }
      }
      scale *= 0.85;
    }
    if (!done) throw new Error(`could not get figure-fallback.webp under ${maxBytes / 1000} KB`);
    log(`figure-fallback.png ${(fs.statSync(png).size / 1000).toFixed(1)} KB (${width}x${height})`);
    return { png, webp, count: stats.count };
  } finally {
    await browser.close();
    await close();
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const arg = (name, def) => {
    const i = args.indexOf('--' + name);
    return i >= 0 ? args[i + 1] : def;
  };
  renderFallback({
    point: arg('point', '#8b93a3'),
    glow: arg('glow', '#c9ced8'),
    width: Number(arg('width', 720)),
    height: Number(arg('height', 900)),
    src: arg('src', '/public/figure/figure-hi.bin'),
    mount: arg('mount', null),
    outDir: arg('out', undefined),
  }).catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
