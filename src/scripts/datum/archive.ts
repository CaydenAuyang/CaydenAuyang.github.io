// archive.ts: the Summer archive plate (Summer.astro). 2,347 dots, one per document, in 12
// notebooks: columns from 1024px wide, rows below that. Motion M7: on first view the dots
// settle from a loose scatter into their notebooks, 1200ms with the settle curve, 40ms later
// for each notebook, once. With motion off (or snapshot mode) they are drawn in place.
// The canvas is decorative; the figure's caption says what it shows.
import { motionAllowed, onMotionChange } from '../../components/ui/motion';
import { onFirstView } from './view';

const DURATION = 1200;
const STAGGER = 40;

// cubic-bezier(0.16, 1, 0.3, 1), the site's "settle" curve, solved by bisection.
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const at = (a: number, b: number, t: number) => 3 * a * t * (1 - t) ** 2 + 3 * b * t * t * (1 - t) + t ** 3;
  return (x: number) => {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    let lo = 0;
    let hi = 1;
    let t = x;
    for (let i = 0; i < 24; i++) {
      t = (lo + hi) / 2;
      if (at(x1, x2, t) < x) lo = t;
      else hi = t;
    }
    return at(y1, y2, t);
  };
}
const settle = bezier(0.16, 1, 0.3, 1);

// Small seeded random numbers, so the scatter looks the same on every visit.
function random(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Layout {
  tx: Float32Array;
  ty: Float32Array;
  r: number;
}

// Where each dot ends up, for a w x h drawing area.
function layout(counts: number[], w: number, h: number, columns: boolean): Layout {
  const total = counts.reduce((a, b) => a + b, 0);
  const most = Math.max(...counts);
  const n = counts.length;
  const tx = new Float32Array(total);
  const ty = new Float32Array(total);
  const gap = columns ? Math.max(6, w * 0.018) : Math.max(4, h * 0.03);
  const band = ((columns ? w : h) - gap * (n - 1)) / n;
  // Leave a little headroom above the tallest column.
  const length = columns ? h * 0.94 : w;

  // The largest dot pitch at which the biggest notebook still fits.
  let pitch = 1.5;
  for (let p = 10; p >= 1.5; p -= 0.1) {
    const across = Math.floor(band / p);
    if (across >= 1 && Math.ceil(most / across) * p <= length) {
      pitch = p;
      break;
    }
  }
  const across = Math.max(1, Math.floor(band / pitch));

  let k = 0;
  counts.forEach((count, i) => {
    const start = i * (band + gap) + (band - across * pitch) / 2;
    for (let j = 0; j < count; j++, k++) {
      const a = j % across; // position across the band
      const b = Math.floor(j / across); // position along it
      if (columns) {
        tx[k] = start + a * pitch + pitch / 2;
        ty[k] = h - (b * pitch + pitch / 2);
      } else {
        tx[k] = b * pitch + pitch / 2;
        ty[k] = start + a * pitch + pitch / 2;
      }
    }
  });
  return { tx, ty, r: Math.max(0.75, pitch * 0.37) };
}

function setup(canvas: HTMLCanvasElement) {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const counts = (canvas.dataset.counts || '').split(',').map(Number).filter((c) => c > 0);
  const total = counts.reduce((a, b) => a + b, 0);
  const group = new Uint8Array(total);
  let k = 0;
  counts.forEach((count, i) => {
    for (let j = 0; j < count; j++) group[k++] = i;
  });

  // The loose scatter the dots start from, as fractions of the drawing area.
  const rand = random(2347);
  const sx = Float32Array.from({ length: total }, () => rand());
  const sy = Float32Array.from({ length: total }, () => rand());

  const wide = window.matchMedia('(min-width: 1024px)');
  let w = 0;
  let h = 0;
  let plan: Layout | null = null;
  let color = '';
  let state: 'waiting' | 'running' | 'done' = motionAllowed() ? 'waiting' : 'done';
  let startedAt = 0;

  function measure() {
    const rect = canvas.getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = rect.width;
    h = rect.height;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx!.setTransform(dpr, 0, 0, dpr, 0, 0);
    plan = w > 0 && h > 0 ? layout(counts, w, h, wide.matches) : null;
    color = getComputedStyle(canvas).color;
  }

  // progress(i): 0 = scattered, 1 = settled, for notebook i.
  function draw(progress: (i: number) => number) {
    if (!plan) return;
    ctx!.clearRect(0, 0, w, h);
    ctx!.fillStyle = color;
    const { tx, ty, r } = plan;
    let k = 0;
    counts.forEach((count, i) => {
      const e = progress(i);
      ctx!.globalAlpha = 0.3 + 0.7 * Math.min(1, e * 1.5);
      ctx!.beginPath();
      for (let j = 0; j < count; j++, k++) {
        const x = sx[k] * w + (tx[k] - sx[k] * w) * e;
        const y = sy[k] * h + (ty[k] - sy[k] * h) * e;
        ctx!.moveTo(x + r, y);
        ctx!.arc(x, y, r, 0, Math.PI * 2);
      }
      ctx!.fill();
    });
    ctx!.globalAlpha = 1;
  }

  function frame(now: number) {
    if (state !== 'running') return;
    const elapsed = now - startedAt;
    draw((i) => settle((elapsed - i * STAGGER) / DURATION));
    if (elapsed >= DURATION + STAGGER * (counts.length - 1)) {
      state = 'done';
      draw(() => 1);
      return;
    }
    requestAnimationFrame(frame);
  }

  function paint() {
    if (state === 'done') draw(() => 1);
    else if (state === 'waiting') draw(() => 0);
  }

  measure();
  paint();

  if ('ResizeObserver' in window) {
    let last = '';
    new ResizeObserver(() => {
      const rect = canvas.getBoundingClientRect();
      const size = `${Math.round(rect.width)}x${Math.round(rect.height)}`;
      if (size === last) return;
      last = size;
      measure();
      paint();
    }).observe(canvas);
  }

  if (state === 'waiting') {
    onFirstView(canvas, 0.35, () => {
      if (state !== 'waiting') return;
      state = 'running';
      startedAt = performance.now();
      requestAnimationFrame(frame);
    });
  }

  // Motion switched off, or snapshot mode toggled: jump to the end, in the current colors.
  onMotionChange((enabled) => {
    if (!enabled) state = 'done';
    color = getComputedStyle(canvas).color;
    paint();
  });
}

document.querySelectorAll<HTMLCanvasElement>('[data-archive]').forEach(setup);
