#!/usr/bin/env node
// Monocular depth for a photo that has no depth map of its own, with Depth Anything V2 Small
// (onnx-community/depth-anything-v2-small through @huggingface/transformers).
//
//   node tools/figure/depth.mjs <viewdir> [<viewdir> ...]
//
// Reads <viewdir>/color.rgba and meta.json (written by extract), writes <viewdir>/depth-da.f32
// (Float32, same size as color, relative inverse depth: larger = nearer, scale unknown) and a
// preview depth-da.png. The view folders live in the work folder outside the repo. The model
// itself is cached in <workdir>/models.

import fs from 'node:fs';
import path from 'node:path';
import { encodePNG } from './lib/raster.mjs';

export async function runDepth(viewDirs, { modelId = 'onnx-community/depth-anything-v2-small' } = {}) {
  const { pipeline, env, RawImage } = await import('@huggingface/transformers');
  env.cacheDir = path.join(path.dirname(path.resolve(viewDirs[0])), 'models');
  env.allowLocalModels = false;
  const estimator = await pipeline('depth-estimation', modelId, { dtype: 'fp32' });
  for (const dir of viewDirs) {
    const meta = JSON.parse(fs.readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    const { width: W, height: H } = meta;
    const rgba = fs.readFileSync(path.join(dir, 'color.rgba'));
    const rgb = new Uint8ClampedArray(W * H * 3);
    for (let i = 0; i < W * H; i++) {
      rgb[i * 3] = rgba[i * 4];
      rgb[i * 3 + 1] = rgba[i * 4 + 1];
      rgb[i * 3 + 2] = rgba[i * 4 + 2];
    }
    const image = new RawImage(rgb, W, H, 3);
    const t0 = Date.now();
    const out = await estimator(image);
    // predicted_depth is the raw model output (relative inverse depth) at the model's resolution.
    const pd = out.predicted_depth;
    const [ph, pw] = pd.dims.slice(-2);
    const src = pd.data;
    const dst = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      const sy = Math.min(ph - 1, Math.max(0, ((y + 0.5) / H) * ph - 0.5));
      const y0 = Math.floor(sy);
      const y1 = Math.min(ph - 1, y0 + 1);
      const ty = sy - y0;
      for (let x = 0; x < W; x++) {
        const sx = Math.min(pw - 1, Math.max(0, ((x + 0.5) / W) * pw - 0.5));
        const x0 = Math.floor(sx);
        const x1 = Math.min(pw - 1, x0 + 1);
        const tx = sx - x0;
        dst[y * W + x] = (src[y0 * pw + x0] * (1 - tx) + src[y0 * pw + x1] * tx) * (1 - ty) + (src[y1 * pw + x0] * (1 - tx) + src[y1 * pw + x1] * tx) * ty;
      }
    }
    fs.writeFileSync(path.join(dir, 'depth-da.f32'), Buffer.from(dst.buffer));
    let lo = Infinity;
    let hi = -Infinity;
    for (const v of dst) {
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    const g = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) g[i] = Math.round(((dst[i] - lo) / (hi - lo || 1)) * 255);
    fs.writeFileSync(path.join(dir, 'depth-da.png'), encodePNG(g, W, H, 1));
    meta.depthDA = { model: modelId, modelSize: [pw, ph], min: lo, max: hi, ms: Date.now() - t0 };
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
    console.log(`depth: ${dir} (${pw}x${ph} model output, ${Date.now() - t0} ms)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  runDepth(process.argv.slice(2)).catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
