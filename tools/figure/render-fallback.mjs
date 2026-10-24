// Renders the still image shown when WebGL is missing, the context is lost, or the data is late:
// the settled figure, drawn from the point data by the real renderer (in headless Chromium
// through the harness) as dark ink points on a transparent background, so it works on the
// vellum plate and on white. It never touches the photos.
//
//   node tools/figure/render-fallback.mjs [--point '#13212D'] [--floor 0.55] [--scale 1.2]
//                                         [--width 720] [--height 900] [--dpr 1]
//
// Writes public/figure/figure-fallback.png and public/figure/figure-fallback.webp. The WebP is
// kept under 120 KB by lowering its quality, then its size, until it fits. Needs cwebp
// (Homebrew webp). The image is 4:5 like the laptop plate; on the 9:10 phone plate the
// component shows it with object-fit: cover from the top.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { serve, REPO_ROOT } from './harness/serve.mjs';
import { launch } from './harness/browser.mjs';

export async function renderFallback({
  repoRoot = REPO_ROOT,
  point = '#13212D',
  floor = 0.55,
  scale = 1.2, // points a little larger than live, since the image is shown scaled up
  width = 720,
  height = 900,
  dpr = 1,
  count = 60000,
  src = '/public/figure/figure-hi.bin',
  srcmeta = '/public/figure/figure.json',
  mount = null,
  outDir = path.join(repoRoot, 'public/figure'),
  maxBytes = 115000, // stays under 120 KB with room to spare
  quiet = false,
} = {}) {
  const log = quiet ? () => {} : (...a) => console.log(...a);
  const { port, close } = await serve(repoRoot, 0, mount ? { '/__test/': mount } : {});
  const browser = await launch();
  try {
    const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: dpr });
    const q = new URLSearchParams({
      still: '1', transparent: '1', bare: '1', device: 'laptop', count: String(count), yaw: '0',
      src, srcmeta, point, origin: point, floor: String(floor), scale: String(scale),
    });
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
    const W = Math.round(width * dpr);
    const H = Math.round(height * dpr);
    let done = false;
    let s = 1;
    for (let attempt = 0; attempt < 5 && !done; attempt++) {
      for (const qv of [82, 74, 66, 58, 50]) {
        const resize = s < 1 ? ['-resize', String(Math.round(W * s)), String(Math.round(H * s))] : [];
        execFileSync('cwebp', ['-quiet', '-q', String(qv), '-alpha_q', '85', '-m', '6', ...resize, png, '-o', webp]);
        const bytes = fs.statSync(webp).size;
        if (bytes <= maxBytes) {
          log(`figure-fallback.webp ${(bytes / 1000).toFixed(1)} KB (quality ${qv}, ${Math.round(W * s)}x${Math.round(H * s)}, ${stats.count} points)`);
          done = true;
          break;
        }
      }
      s *= 0.88;
    }
    if (!done) throw new Error(`could not get figure-fallback.webp under ${maxBytes / 1000} KB`);
    log(`figure-fallback.png ${(fs.statSync(png).size / 1000).toFixed(1)} KB (${W}x${H})`);
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
    point: arg('point', '#13212D'),
    floor: Number(arg('floor', 0.55)),
    scale: Number(arg('scale', 1.2)),
    width: Number(arg('width', 720)),
    height: Number(arg('height', 900)),
    dpr: Number(arg('dpr', 1)),
    src: arg('src', '/public/figure/figure-hi.bin'),
    srcmeta: arg('srcmeta', '/public/figure/figure.json'),
    mount: arg('mount', null),
    outDir: arg('out', undefined),
  }).catch((e) => {
    console.error(e.message || e);
    process.exit(1);
  });
}
