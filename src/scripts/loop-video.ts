// loop-video.ts: plays and pauses the project previews (LoopVideo.astro).
//
//   - Loading: preload="none" until the video is within one viewport of the screen, then
//     "auto", so the first frames are ready by the time it is in view.
//   - Plays while at least half of it is visible, pauses otherwise.
//   - Plays on its own only when motion is allowed. Under reduced motion the visitor presses
//     Play. A pause the visitor makes sticks until they press Play again.
//   - Snapshot mode: never plays; the poster stays.
//   - If play() is refused (Low Power Mode, data saver), the poster stays and the button says
//     Play; it won't try again on its own until the visitor presses it.
//   - Light spill (NIGHT-SIGNAL.md 11b.4): while a preview plays, its average color is sampled
//     about 4 times a second from a tiny 8 x 5 canvas and sent to the night scene as `world:spill`
//     ({ color: [r, g, b] from 0 to 1, strength: 1, rect: the video's box on screen }), which tints
//     the harbour and the nearest windows. When it pauses, ends or leaves view, one
//     { color: null, strength: 0 } clears it. Sampling follows the video's own frames
//     (requestVideoFrameCallback where it exists) and is skipped with motion off: the tint is
//     decorative motion. If the browser refuses to read the frame, the spill simply stays off.
import { ui } from '../data/site';

type Want = 'auto' | 'play' | 'pause';

interface Player {
  figure: HTMLElement;
  video: HTMLVideoElement;
  button: HTMLButtonElement;
  label: string;
  inView: boolean;
  want: Want;
  refused: boolean;
  // Light spill: whether this video is being sampled, and when it was last.
  sampling: boolean;
  lastSample: number;
}

const html = document.documentElement;
const snapshot = html.hasAttribute('data-snapshot');
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionAllowed = () => !snapshot && !reduceQuery.matches;

const players: Player[] = [];

// ---- Light spill ----------------------------------------------------------------------------------

const SPILL_EVERY_MS = 250;
const SPILL_W = 8;
const SPILL_H = 5;
const spill: { ctx: CanvasRenderingContext2D | null; off: boolean; from: Player | null } = { ctx: null, off: false, from: null };

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

function spillContext(): CanvasRenderingContext2D | null {
  if (spill.off) return null;
  if (!spill.ctx) {
    const canvas = document.createElement('canvas');
    canvas.width = SPILL_W;
    canvas.height = SPILL_H;
    spill.ctx = canvas.getContext('2d', { willReadFrequently: true, alpha: false });
    if (!spill.ctx) spill.off = true;
  }
  return spill.ctx;
}

function sendSpill(detail: { color: [number, number, number] | null; strength: number; rect?: DOMRect }) {
  window.dispatchEvent(new CustomEvent('world:spill', { detail }));
}

// Reading a video frame back from the GPU can stall the thread that does it (tens of ms when the
// GPU is busy), so the main thread never does: createImageBitmap shrinks the frame to 8 x 5 (async,
// off the main thread) and a small worker (spill-worker.ts) reads those 40 pixels and averages
// them. Without workers that can draw (OffscreenCanvas), the tiny bitmap is read here instead.
let bitmaps = typeof window.createImageBitmap === 'function';
let worker: Worker | null = null;
let workerOk = bitmaps && typeof Worker === 'function' && typeof OffscreenCanvas === 'function';
let nextId = 0;
const waiting = new Map<number, Player>();

function spillWorker(): Worker | null {
  if (!workerOk) return null;
  if (worker) return worker;
  try {
    worker = new Worker(new URL('./spill-worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<{ id: number; color: [number, number, number] | null }>) => {
      const p = waiting.get(event.data.id);
      waiting.delete(event.data.id);
      if (!p || !p.sampling) return;
      if (!event.data.color) {
        spill.off = true;
        stopSpill(p);
        return;
      }
      spill.from = p;
      sendSpill({ color: event.data.color, strength: 1, rect: p.video.getBoundingClientRect() });
    };
    worker.onerror = () => {
      workerOk = false;
      worker = null;
    };
  } catch {
    workerOk = false;
    worker = null;
  }
  return worker;
}

function averageHere(p: Player, source: CanvasImageSource) {
  const ctx = spillContext();
  if (!ctx) return;
  ctx.drawImage(source, 0, 0, SPILL_W, SPILL_H);
  const px = ctx.getImageData(0, 0, SPILL_W, SPILL_H).data;
  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < px.length; i += 4) {
    r += px[i];
    g += px[i + 1];
    b += px[i + 2];
  }
  const n = (px.length / 4) * 255;
  spill.from = p;
  sendSpill({ color: [r / n, g / n, b / n], strength: 1, rect: p.video.getBoundingClientRect() });
}

async function sampleSpill(p: Player) {
  // Only when the night scene is listening (no WebGL, or not started yet: nothing to tint).
  if (spill.off || p.video.readyState < 2 || !html.classList.contains('has-interactions')) return;
  try {
    if (!bitmaps) return averageHere(p, p.video);
    let frame: ImageBitmap;
    try {
      frame = await createImageBitmap(p.video, { resizeWidth: SPILL_W, resizeHeight: SPILL_H, resizeQuality: 'low' });
    } catch {
      bitmaps = false;
      return averageHere(p, p.video);
    }
    // It may have stopped while the frame was being prepared.
    if (!p.sampling) return frame.close();
    const w = spillWorker();
    if (!w) {
      averageHere(p, frame);
      return frame.close();
    }
    const id = nextId++;
    waiting.set(id, p);
    w.postMessage({ id, frame }, [frame]);
  } catch {
    // A frame the browser won't let a page read: no spill for this visit.
    spill.off = true;
    stopSpill(p);
  }
}

function startSpill(p: Player) {
  if (p.sampling || spill.off || !motionAllowed()) return;
  p.sampling = true;
  p.lastSample = 0;
  const video = p.video as FrameVideo;
  const tick = () => {
    if (!p.sampling) return;
    const now = performance.now();
    if (now - p.lastSample >= SPILL_EVERY_MS - 8) {
      p.lastSample = now;
      void sampleSpill(p);
    }
    if (!p.sampling) return;
    if (typeof video.requestVideoFrameCallback === 'function') video.requestVideoFrameCallback(tick);
    else window.setTimeout(tick, SPILL_EVERY_MS);
  };
  tick();
}

function stopSpill(p: Player) {
  p.sampling = false;
  if (spill.from !== p) return;
  spill.from = null;
  sendSpill({ color: null, strength: 0 });
}

function render(p: Player) {
  const playing = !p.video.paused;
  p.figure.dataset.state = playing ? 'playing' : 'paused';
  p.button.setAttribute('aria-label', `${playing ? ui.pause : ui.play} ${p.label}`);
}

function wantsToPlay(p: Player): boolean {
  if (snapshot || !p.inView || p.want === 'pause') return false;
  if (p.want === 'play') return true;
  return motionAllowed() && !p.refused;
}

function warm(video: HTMLVideoElement) {
  if (video.preload === 'auto') return;
  video.preload = 'auto';
  // Nothing has loaded yet under preload="none"; ask again now that loading is allowed.
  if (video.readyState === 0 && video.paused) video.load();
}

function start(p: Player) {
  warm(p.video);
  const attempt = p.video.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch((error: DOMException) => {
      // AbortError only means a pause() came first (scrolled away quickly). Anything else is a
      // refusal: keep the poster, show Play.
      if (error && error.name === 'AbortError') return;
      p.refused = true;
      if (p.want === 'play') p.want = 'auto';
      render(p);
    });
  }
}

function update(p: Player) {
  if (wantsToPlay(p)) {
    if (p.video.paused) start(p);
  } else if (!p.video.paused) {
    p.video.pause();
  }
  render(p);
}

const canObserve = 'IntersectionObserver' in window;

// Half visible: play. Less: pause.
const playObserver = canObserve
  ? new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const p = players.find((x) => x.video === entry.target);
          if (!p) continue;
          p.inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
          if (!p.inView) stopSpill(p);
          update(p);
        }
      },
      { threshold: [0, 0.5, 1] },
    )
  : null;

// Within one viewport: allow loading.
const nearObserver =
  canObserve && !snapshot
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            warm(entry.target as HTMLVideoElement);
            nearObserver?.unobserve(entry.target);
          }
        },
        { rootMargin: '100% 0px 100% 0px' },
      )
    : null;

document.querySelectorAll<HTMLElement>('[data-vf]').forEach((figure) => {
  const video = figure.querySelector('video');
  const button = figure.querySelector<HTMLButtonElement>('[data-vf-btn]');
  if (!video || !button) return;
  const p: Player = {
    figure,
    video,
    button,
    label: button.dataset.label || '',
    inView: !canObserve,
    want: 'auto',
    refused: false,
    sampling: false,
    lastSample: 0,
  };
  players.push(p);

  video.addEventListener('play', () => render(p));
  video.addEventListener('pause', () => render(p));
  // Spill while frames are actually showing; clear it when they stop.
  video.addEventListener('playing', () => startSpill(p));
  for (const type of ['pause', 'ended', 'emptied']) video.addEventListener(type, () => stopSpill(p));

  button.addEventListener('click', () => {
    if (!video.paused) {
      p.want = 'pause';
      video.pause();
    } else {
      p.want = 'play';
      p.refused = false;
      p.inView = true;
      start(p);
    }
    render(p);
  });

  playObserver?.observe(video);
  nearObserver?.observe(video);
  update(p);
});

// The device's reduced-motion setting changed while the page is open.
reduceQuery.addEventListener?.('change', () =>
  players.forEach((p) => {
    if (!motionAllowed()) stopSpill(p);
    else if (!p.video.paused) startSpill(p);
    update(p);
  }),
);

// Hidden tab: pause; back: resume what was playing.
document.addEventListener('visibilitychange', () => {
  players.forEach((p) => {
    if (document.hidden) {
      if (!p.video.paused) p.video.pause();
    } else {
      update(p);
    }
  });
});
