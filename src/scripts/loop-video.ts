// loop-video.ts: plays and pauses the project previews (LoopVideo.astro).
//
//   - Loading: a video has no sources until it is within one viewport of the screen. Then its file
//     is picked by layout (V4.md 8.7) and it gets preload="auto", so the first frames are ready by
//     the time it is in view. The stack and short layouts (phones upright and sideways, iPads
//     upright) get the 720px encode, unless the frame is wider than 720px (an upright iPad Air or
//     Pro), where that file would be stretched past its own size even at 1x; everything else gets
//     the 1280px encode. A video keeps the file it started with. Its poster is set at the same
//     time, from data-poster (at once in snapshot mode, without IntersectionObserver, and before
//     printing).
//   - Plays while at least half of it is visible, pauses otherwise, and pauses while the tab is
//     hidden.
//   - While one video plays, any other paused video on screen shows its frame as a still: a canvas
//     drawn from it, over it, with the video itself made transparent. Chromium drops two or three
//     whole-page frames (about 33 ms each) whenever a video starts playing while another video's
//     paused frame is on screen, which is every hand-off from one work stop to the next; with the
//     paused one shown as an image, it doesn't. A video paused with no other playing (the visitor's
//     Pause, the last stop scrolling away) stays as it is. When a video plays again it shows under
//     its still, and the still goes once the video's next frame is up (requestVideoFrameCallback).
//     The files are tagged sRGB (the recordings are page screenshots), so the video and the canvas
//     show the same colours: untagged, Chromium drew the video lighter than any canvas draws it.
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
import { layoutMode } from '../world/layout';

type Want = 'auto' | 'play' | 'pause';

interface Player {
  figure: HTMLElement;
  video: HTMLVideoElement;
  button: HTMLButtonElement;
  label: string;
  // At least half visible (plays), and any of it visible (a still while another plays).
  inView: boolean;
  visible: boolean;
  want: Want;
  refused: boolean;
  // Sources added and loading allowed.
  warm: boolean;
  // The paused frame, drawn over the hidden video (made the first time it is needed).
  still: HTMLCanvasElement | null;
  // Light spill: whether this video is being sampled, and when it was last.
  sampling: boolean;
  lastSample: number;
}

type FrameVideo = HTMLVideoElement & { requestVideoFrameCallback?: (cb: () => void) => number };

const html = document.documentElement;
const snapshot = html.hasAttribute('data-snapshot');
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionAllowed = () => !snapshot && !reduceQuery.matches;

const players: Player[] = [];

// ---- Which file ----------------------------------------------------------------------------------

/** The small encodes' width: a frame wider than this would stretch them past their own size. */
const SMALL_WIDTH = 720;

function useSmall(width: number): boolean {
  const layout = layoutMode();
  return (layout === 'stack' || layout === 'short') && width <= SMALL_WIDTH;
}

function setPoster(p: Player) {
  const poster = p.video.dataset.poster;
  if (poster && !p.video.getAttribute('poster')) p.video.poster = poster;
}

/** Picks the file for this layout, adds its sources and lets it load. `width`: the frame's, if known. */
function warm(p: Player, width?: number) {
  if (p.warm) return;
  p.warm = true;
  setPoster(p);
  const d = p.video.dataset;
  const small = !!d.smallMp4 && useSmall(width ?? p.video.getBoundingClientRect().width);
  // The small files go H.264 first: every phone decodes it in hardware, which is easier on an
  // iPhone's battery than VP9 might be; the WebM is the fallback.
  const files: [string | undefined, string][] = small
    ? [
        [d.smallMp4, 'video/mp4'],
        [d.smallWebm, 'video/webm'],
      ]
    : [
        [d.webm, 'video/webm'],
        [d.mp4, 'video/mp4'],
      ];
  for (const [src, type] of files) {
    if (!src) continue;
    const source = document.createElement('source');
    source.src = src;
    source.type = type;
    p.video.append(source);
  }
  p.video.preload = 'auto';
  p.video.load();
}

// ---- The paused frame as a still -------------------------------------------------------------------

function showStill(p: Player) {
  const { video } = p;
  if (!video.paused || video.readyState < 2 || !video.videoWidth) return;
  if (p.still && !p.still.hidden && video.style.opacity === '0') return;
  try {
    if (!p.still) {
      const canvas = document.createElement('canvas');
      canvas.className = 'vf__still';
      canvas.setAttribute('aria-hidden', 'true');
      canvas.hidden = true;
      video.after(canvas);
      p.still = canvas;
    }
    const canvas = p.still;
    if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    canvas.hidden = false;
    // Transparent rather than hidden, so screen readers still find the video and its label.
    video.style.opacity = '0';
  } catch {
    // A frame the browser won't draw: the video stays as it is.
    if (p.still) p.still.hidden = true;
    video.style.opacity = '';
  }
}

/** A video is playing (or about to): every other paused video on screen becomes a still. */
function stillsBeside(p: Player) {
  for (const q of players) if (q !== p && q.visible && q.video.paused) showStill(q);
}

/** Frames are flowing again: show the video, and drop the still once its next frame is up. */
function hideStill(p: Player) {
  const { video, still } = p;
  video.style.opacity = '';
  if (!still || still.hidden) return;
  const done = () => {
    if (!video.paused) still.hidden = true;
  };
  const v = video as FrameVideo;
  if (typeof v.requestVideoFrameCallback === 'function') v.requestVideoFrameCallback(done);
  else requestAnimationFrame(() => requestAnimationFrame(done));
}

// ---- Light spill ----------------------------------------------------------------------------------

const SPILL_EVERY_MS = 250;
const SPILL_W = 8;
const SPILL_H = 5;
const spill: { ctx: CanvasRenderingContext2D | null; off: boolean; from: Player | null } = { ctx: null, off: false, from: null };

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

// ---- Playing ----------------------------------------------------------------------------------------

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

function start(p: Player) {
  warm(p);
  stillsBeside(p);
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
const playerOf = (target: Element) => players.find((x) => x.video === target);

// Pause the videos that are leaving before playing the ones arriving, so the arriving one's
// start() finds them paused and makes them stills. A paused video that comes on screen while
// another plays becomes a still too.
const playObserver = canObserve
  ? new IntersectionObserver(
      (entries) => {
        const changed: Player[] = [];
        for (const entry of entries) {
          const p = playerOf(entry.target);
          if (!p) continue;
          p.visible = entry.isIntersecting;
          p.inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
          if (!p.inView) stopSpill(p);
          changed.push(p);
        }
        changed.sort((a, b) => Number(a.inView) - Number(b.inView)).forEach(update);
        const playing = players.find((x) => !x.video.paused);
        if (playing) stillsBeside(playing);
      },
      { threshold: [0, 0.5, 1] },
    )
  : null;

// Within one viewport: pick the file and allow loading.
const nearObserver =
  canObserve && !snapshot
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            const p = playerOf(entry.target);
            if (p) warm(p, entry.boundingClientRect.width);
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
    visible: !canObserve,
    want: 'auto',
    refused: false,
    warm: false,
    still: null,
    sampling: false,
    lastSample: 0,
  };
  players.push(p);

  video.addEventListener('play', () => render(p));
  video.addEventListener('pause', () => render(p));
  // Frames are showing: the video comes back from under its still, and the spill starts.
  video.addEventListener('playing', () => {
    hideStill(p);
    startSpill(p);
  });
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
  if (nearObserver) nearObserver.observe(video);
  else setPoster(p);
  update(p);
});

window.addEventListener('beforeprint', () => players.forEach(setPoster));

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
