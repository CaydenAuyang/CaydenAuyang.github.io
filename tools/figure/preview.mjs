#!/usr/bin/env node
// Renders quick ink-on-vellum previews of public/figure/figure-*.bin at a few yaws, side by side.
//   node tools/figure/preview.mjs [hi|lo] [outfile.png] [--yaws 0,12,45,90]
// These are renders of the points only, never of a photo.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { decode } from './lib/format.mjs';
import { encodePNG, previewImage } from './lib/raster.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const level = args.find((a) => a === 'hi' || a === 'lo') || 'hi';
const yi = args.indexOf('--yaws');
const yaws = (yi >= 0 ? args[yi + 1] : '0,12,-12,45,90').split(',').map(Number);
const out = args.find((a) => a.endsWith('.png')) || path.join(os.homedir(), 'Documents/Claude/Projects/CERTIFICATE/figure-work/preview-points.png');
const dec = decode(fs.readFileSync(path.join(HERE, '../../public/figure', `figure-${level}.bin`)));
const H = 720;
const W = 560;
const hgt = dec.max[1] - dec.min[1];
const s = (H * 0.92) / hgt;
const cx = (dec.min[0] + dec.max[0]) / 2;
const tiles = yaws.map((deg) => previewImage(dec, { w: W, h: H, yaw: (deg * Math.PI) / 180, map: { s, ox: W / 2 - cx * s, oy: H * 0.04 + dec.max[1] * s }, radius: level === 'hi' ? 0.75 : 1.1 }));
const big = new Uint8Array(W * tiles.length * H * 4);
for (let t = 0; t < tiles.length; t++) for (let y = 0; y < H; y++) big.set(tiles[t].subarray(y * W * 4, (y + 1) * W * 4), (y * W * tiles.length + t * W) * 4);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, encodePNG(big, W * tiles.length, H));
console.log(out, `yaws ${yaws.join(', ')}`);
