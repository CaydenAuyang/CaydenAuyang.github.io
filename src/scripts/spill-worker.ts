// spill-worker.ts: averages a video frame's color for the light spill (loop-video.ts), off the
// main thread. It receives an 8 x 5 ImageBitmap, draws it into a tiny OffscreenCanvas and reads
// the 40 pixels back. Reading back can wait on a busy GPU; here that wait never blocks the page.

const W = 8;
const H = 5;
const canvas = new OffscreenCanvas(W, H);
const ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false }) as OffscreenCanvasRenderingContext2D | null;
// This file runs as a worker, so `self` is the worker's global scope.
const scope = self as unknown as Worker;

scope.onmessage = (event: MessageEvent<{ id: number; frame: ImageBitmap }>) => {
  const { id, frame } = event.data;
  try {
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(frame, 0, 0, W, H);
    const px = ctx.getImageData(0, 0, W, H).data;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let i = 0; i < px.length; i += 4) {
      r += px[i];
      g += px[i + 1];
      b += px[i + 2];
    }
    const n = (px.length / 4) * 255;
    scope.postMessage({ id, color: [r / n, g / n, b / n] });
  } catch {
    scope.postMessage({ id, color: null });
  } finally {
    frame.close();
  }
};
