// Shared Playwright setup for the harness screenshots and the fallback renderer.
// Uses playwright-core from tools/figure/node_modules and the Chromium 1217 build cached in
// ~/Library/Caches/ms-playwright (no browser download).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
export const { chromium } = require('playwright-core');

export function chromiumPath() {
  const base = path.join(os.homedir(), 'Library/Caches/ms-playwright');
  const candidates = [
    'chromium_headless_shell-1217/chrome-headless-shell-mac-arm64/chrome-headless-shell',
    'chromium-1217/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
    'chromium-1217/chrome-mac-arm64/Chromium.app/Contents/MacOS/Chromium',
  ];
  for (const c of candidates) {
    const p = path.join(base, c);
    if (fs.existsSync(p)) return p;
  }
  return undefined; // let playwright-core find its own
}

// Software WebGL so headless runs render the same everywhere.
export const GL_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader', '--ignore-gpu-blocklist'];

export function launch(args = GL_ARGS) {
  return chromium.launch({ executablePath: chromiumPath(), headless: true, args });
}
