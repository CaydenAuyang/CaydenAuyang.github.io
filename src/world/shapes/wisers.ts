// wisers.ts: the three Wisers pictures (NIGHT-SIGNAL.md 5, F and G), authored as SVG paths and
// sampled into points by svg.ts. Owned by the Signal agent.
//
//   F1 (Summer 2024): a social feed, two columns of six post cards with staggered heights. Each
//      card is a rounded-rectangle outline, an image block (a dot grid over the top 60%) and two
//      short dotted text lines. The feed is a loop taller than the box; the shader scrolls it up.
//   F2 (Summer 2024): one generic running shoe in side profile (upper, heel tab, six lace dots in
//      window; midsole and outsole in cool). No stripes, logos or brand marks.
//   G  (Summer 2025): a laptop screen (16:10, rounded corners, thin bezel) with faint interface
//      blocks, and the screen agent's loop: five boxes in cool, a dotted path through them, a small
//      arrow cursor and a click ripple at each box, in white (the shader runs the loop).
//
// Units: the picture's box (WISERS_ANCHOR) is 1 tall and `aspect` wide, centred on 0. Paths are
// authored with y down, as in SVG; the points come out with v up. Each picture picks one line
// spacing so it uses about `budget` points (grids use a fixed multiple of it).

import { circle, rect, roundRect, sampleFill, sampleLine, type Pt } from './svg';

/** Point classes (the colour the shader gives them). */
export const CLS = { window: 0, cool: 1, white: 2 } as const;

/** G's roles for the screen agent loop (the shader's aShape.x). */
export const ROLE = { still: 0, box: 1, path: 2, cursor: 3, ripple: 4 } as const;

export interface PicPoint {
  u: number;
  v: number;
  cls: number;
  alpha: number;
  role: number;
  p1: number;
  p2: number;
  p3: number;
}

export interface Picture {
  points: PicPoint[];
  spacing: number; // line spacing, in box heights
}

/**
 * F1's loop: its height (the feed repeats every `loop` box heights), scroll speed (box heights a
 * second), and the band over which a card fades in and out as a whole by where its centre is (at
 * least half the tallest card, so no card is ever cut by the box's edge).
 */
export const FEED = { loop: 1.54, speed: 0.028, fade: 0.16 };

/** G's loop length in seconds, and the knots of the cursor's path (box centres, filled in by screen()). */
export const AGENT = { seconds: 6 };

const push = (out: PicPoint[], pts: Pt[], cls: number, alpha: number, role = 0, p: (k: number) => [number, number, number] = () => [0, 0, 0]) => {
  pts.forEach(([x, y], k) => {
    const [p1, p2, p3] = p(k);
    out.push({ u: x, v: -y, cls, alpha, role, p1, p2, p3 });
  });
};

// ---- F1: the feed ---------------------------------------------------------------------------

const COL_A = [0.24, 0.19, 0.27, 0.2, 0.23, 0.17];
const COL_B = [0.2, 0.26, 0.18, 0.25, 0.19, 0.22];
const CARD_GAP = 0.04;
/** The spacing from a card's last image row to its first text line, and between its two text lines (box heights). */
const TEXT_GAP = 0.028;

function feed(aspect: number, s: number): PicPoint[] {
  const out: PicPoint[] = [];
  const width = Math.min(aspect, 1.15) * 0.92;
  const gap = 0.06;
  const cw = (width - gap) / 2;
  const top = -FEED.loop / 2;
  [COL_A, COL_B].forEach((heights, col) => {
    const x = -width / 2 + col * (cw + gap);
    // The second column starts half a card lower, so the cards stagger.
    let y = top + (col ? 0.1 : 0);
    heights.forEach((h) => {
      const draw = (yy: number) => {
        const pad = 0.022;
        // p1 of every point of the card: its height above the card's centre (v up), so the shader
        // can fade the card as a whole.
        const vc = -(yy + h / 2);
        const card = (pts: Pt[], cls: number, alpha: number) => push(out, pts, cls, alpha, 0, (k) => [-pts[k][1] - vc, 0, 0]);
        card(sampleLine(roundRect(x, yy, cw, h, 0.022), s).pts, CLS.window, 0.85);
        // The image block: whole rows of a regular grid from the block's top, over about 60% of
        // the card; then the two text lines at one fixed spacing below the last row, the same in
        // every card.
        const innerH = h - 2 * pad;
        const gs = s * 1.7;
        const rows = Math.max(1, Math.floor((innerH * 0.6) / gs) + 1);
        const cols = Math.max(1, Math.floor((cw - 2 * pad) / gs) + 1);
        const gx = x + cw / 2 - ((cols - 1) * gs) / 2;
        const grid: Pt[] = [];
        for (let j = 0; j < rows; j++) for (let k = 0; k < cols; k++) grid.push([gx + k * gs, yy + pad + j * gs]);
        card(grid, CLS.cool, 0.42);
        const last = yy + pad + (rows - 1) * gs;
        const y1 = last + TEXT_GAP;
        const y2 = y1 + TEXT_GAP;
        card(sampleLine(`M ${x + pad} ${y1} H ${x + pad + (cw - 2 * pad) * 0.72}`, s).pts, CLS.window, 0.6);
        card(sampleLine(`M ${x + pad} ${y2} H ${x + pad + (cw - 2 * pad) * 0.44}`, s).pts, CLS.window, 0.6);
      };
      // The loop wraps, so a card that runs past the bottom also draws from the top.
      draw(y);
      if (y + h > top + FEED.loop) draw(y - FEED.loop);
      y += h + CARD_GAP;
    });
  });
  // Keep only what lies in the loop.
  return out.filter((p) => p.v <= FEED.loop / 2 && p.v > -FEED.loop / 2);
}

// ---- F2: the shoe ---------------------------------------------------------------------------

// Side profile, toe to the right, on a 1000 x 470 canvas (y down).
const SHOE = {
  upper:
    'M 168 112 C 128 128 104 178 100 245 C 97 290 102 322 114 340 C 330 364 620 362 860 340 C 905 335 940 322 952 302 C 960 286 948 272 922 262 C 840 236 738 214 642 192 L 432 132 C 418 108 398 88 372 84 C 346 81 330 96 326 116 C 292 142 216 146 168 112 Z',
  midsole:
    'M 114 340 C 330 364 620 362 860 340 C 905 335 940 322 952 302 C 978 310 988 338 970 360 C 920 392 720 404 470 410 C 310 414 180 424 122 420 C 98 412 98 362 114 340 Z',
  outsole: 'M 138 434 C 310 432 660 424 918 398 C 944 394 962 384 972 370',
  // Both ends sit on the topline, so the loop closes.
  tab: 'M 176 117 C 167 93 176 72 194 70 C 213 70 217 94 208 131',
  laces: Array.from({ length: 6 }, (_, k) => [460 + k * 36, 158 + k * 10.2] as Pt),
};

function shoe(aspect: number, s: number): PicPoint[] {
  const out: PicPoint[] = [];
  const width = Math.min(aspect, 1.15) * 0.94;
  const k = width / 1000;
  // Canvas units per box height, and the canvas centred in the box.
  const S = s / k;
  const fit = (pts: Pt[]): Pt[] => pts.map(([x, y]) => [(x - 540) * k, (y - 258) * k]);
  push(out, fit(sampleLine(SHOE.upper, S).pts), CLS.window, 0.95);
  push(out, fit(sampleFill(SHOE.upper, S * 1.7)), CLS.window, 0.26);
  push(out, fit(sampleLine(SHOE.tab, S).pts), CLS.window, 0.95);
  for (const [x, y] of SHOE.laces) {
    push(out, fit(sampleLine(circle(x, y, 9), S * 0.8).pts), CLS.window, 0.9);
    push(out, fit([[x, y]]), CLS.window, 0.9);
  }
  push(out, fit(sampleLine(SHOE.midsole, S).pts), CLS.cool, 0.95);
  push(out, fit(sampleFill(SHOE.midsole, S * 1.35)), CLS.cool, 0.34);
  push(out, fit(sampleLine(SHOE.outsole, S).pts), CLS.cool, 0.95);
  return out;
}

// ---- G: the screen agent ----------------------------------------------------------------------

/** The knots of the cursor's path for the last screen built (u, v), one per box. */
export const agentKnots: Pt[] = [];

/** A cubic through Catmull-Rom knots, as path data (the shader evaluates the same curve). */
export function knotPath(k: Pt[]): string {
  const at = (i: number) => k[Math.max(0, Math.min(k.length - 1, i))];
  let d = `M ${k[0][0]} ${k[0][1]}`;
  for (let i = 0; i < k.length - 1; i++) {
    const p0 = at(i - 1);
    const p1 = at(i);
    const p2 = at(i + 1);
    const p3 = at(i + 2);
    const c1: Pt = [p1[0] + (p2[0] - p0[0]) / 6, p1[1] + (p2[1] - p0[1]) / 6];
    const c2: Pt = [p2[0] - (p3[0] - p1[0]) / 6, p2[1] - (p3[1] - p1[1]) / 6];
    d += ` C ${c1[0]} ${c1[1]} ${c2[0]} ${c2[1]} ${p2[0]} ${p2[1]}`;
  }
  return d;
}

/** The arrow cursor's outline, tip at 0, pointing up and left (box heights, y down). */
const CURSOR = 'M 0 0 L 0 0.1 L 0.028 0.075 L 0.072 0.072 Z';

function screen(aspect: number, s: number): PicPoint[] {
  const out: PicPoint[] = [];
  const w = Math.min(aspect, 1.12) * 0.94;
  const h = w * 0.625;
  const x0 = -w / 2;
  const y0 = -h / 2 - 0.05;
  const b = 0.022;
  push(out, sampleLine(roundRect(x0, y0, w, h, 0.03), s).pts, CLS.window, 0.85);
  push(out, sampleLine(roundRect(x0 + b, y0 + b, w - 2 * b, h - 2 * b, 0.012), s).pts, CLS.window, 0.45);
  // The base, under the screen.
  push(out, sampleLine(roundRect(x0 - 0.04, y0 + h + 0.018, w + 0.08, 0.026, 0.013), s).pts, CLS.window, 0.6);

  const ix = x0 + b;
  const iy = y0 + b;
  const iw = w - 2 * b;
  const ih = h - 2 * b;
  const ui = (d: string, alpha = 0.36) => push(out, sampleLine(d, s).pts, CLS.cool, alpha);
  // Title bar: three window dots, a title, a rule under it.
  const th = ih * 0.11;
  for (let k = 0; k < 3; k++) ui(circle(ix + 0.024 + k * 0.022, iy + th / 2, 0.006));
  const title: [number, number, number] = [ix + iw * 0.4, iy + th / 2, iw * 0.2];
  ui(`M ${title[0]} ${title[1]} h ${title[2]}`);
  ui(`M ${ix} ${iy + th} h ${iw}`);
  // Sidebar: a rule and four menu lines.
  const sw = iw * 0.22;
  ui(`M ${ix + sw} ${iy + th} v ${ih - th}`);
  const menu = [0.6, 0.8, 0.5, 0.7].map((f, k) => [ix + 0.026, iy + th + (ih - th) * (0.14 + k * 0.12), (sw - 0.052) * f] as const);
  for (const [x, y, l] of menu) ui(`M ${x} ${y} h ${l}`);
  // Content: three rows of two text lines.
  const cx = ix + sw + 0.04;
  const cw = iw - sw - 0.08;
  const rows = [0.15, 0.36, 0.57].map((f) => iy + th + (ih - th) * f);
  for (const y of rows) {
    ui(`M ${cx} ${y} h ${cw * 0.8}`);
    ui(`M ${cx} ${y + 0.032} h ${cw * 0.55}`);
  }
  // Two buttons, bottom right, each with a short label.
  const bh = 0.058;
  const by = iy + ih - bh - 0.04;
  const b2: [number, number, number] = [ix + iw - 0.035 - 0.19, by, 0.19];
  const b1: [number, number, number] = [b2[0] - 0.03 - 0.15, by, 0.15];
  for (const [x, y, bw] of [b1, b2]) {
    ui(roundRect(x, y, bw, bh, 0.016), 0.5);
    ui(`M ${x + bw * 0.28} ${y + bh / 2} h ${bw * 0.44}`, 0.5);
  }

  // The five boxes the agent reads, in order: the title, a menu line, the first and third rows,
  // and the second button.
  const pad = 0.016;
  const boxes: [number, number, number, number][] = [
    [title[0] - pad, title[1] - pad, title[2] + 2 * pad, 2 * pad],
    [menu[1][0] - pad, menu[1][1] - pad, menu[1][2] + 2 * pad, 2 * pad],
    [cx - pad, rows[0] - pad, cw * 0.8 + 2 * pad, 0.032 + 2 * pad],
    [cx - pad, rows[2] - pad, cw * 0.8 + 2 * pad, 0.032 + 2 * pad],
    [b2[0] - pad * 0.6, b2[1] - pad * 0.6, b2[2] + 1.2 * pad, bh + 1.2 * pad],
  ];
  const knots: Pt[] = boxes.map(([x, y, bw, bh2]) => [x + bw / 2, y + bh2 / 2]);
  boxes.forEach(([x, y, bw, bh2], k) => {
    const line = sampleLine(rect(x, y, bw, bh2), s * 1.4);
    push(out, line.pts, CLS.cool, 0.95, ROLE.box, (j) => [line.at[j], k, 0]);
  });
  const path = sampleLine(knotPath(knots), s * 2.4);
  push(out, path.pts, CLS.white, 0.5, ROLE.path, (j) => [path.at[j], 0, 0]);
  // The cursor, about 30 points, as offsets from its tip (v up).
  const cursor = sampleLine(CURSOR, 0.27 / 30).pts;
  push(out, cursor.map(() => knots[0]), CLS.white, 1, ROLE.cursor, (j) => [cursor[j][0], -cursor[j][1], 0]);
  // A click ripple at each box: two rings of twelve.
  knots.forEach((c, k) => {
    for (let ring = 0; ring < 2; ring++) {
      const pts: Pt[] = Array.from({ length: 12 }, () => c);
      push(out, pts, CLS.white, 0.9, ROLE.ripple, (j) => [(j / 12) * Math.PI * 2 + ring * 0.26, k, ring]);
    }
  });
  agentKnots.length = 0;
  for (const [x, y] of knots) agentKnots.push([x, -y]);
  return out;
}

// ---- Spacing --------------------------------------------------------------------------------

/**
 * Builds a picture at the line spacing that uses as many points as possible up to `budget`. The
 * count goes roughly as lines / s + blocks / s^2, so two trial builds give the spacing; a short
 * bisection then settles it just under the budget.
 */
function fitBudget(make: (s: number) => PicPoint[], budget: number): Picture {
  const s1 = 0.01;
  const s2 = 0.014;
  const n1 = make(s1).length;
  const n2 = make(s2).length;
  // n = a / s + b / s^2, solved from the two trials.
  const b = (n1 * s1 - n2 * s2) / (1 / s1 - 1 / s2);
  const a = n1 * s1 - b / s1;
  let s = b > 0 ? (a + Math.sqrt(Math.max(0, a * a + 4 * budget * b))) / (2 * budget) : Math.max(1e-4, a / budget);
  let lo = s * 0.9;
  let hi = s * 1.25;
  let best: Picture | null = null;
  for (let k = 0; k < 7; k++) {
    const pts = make(s);
    if (pts.length <= budget) {
      if (!best || pts.length > best.points.length) best = { points: pts, spacing: s };
      hi = s;
    } else lo = s;
    if (best && best.points.length >= budget * 0.99) break;
    s = k === 0 && pts.length > budget ? s * 1.02 : (lo + hi) / 2;
  }
  return best ?? { points: make(hi * 1.2), spacing: hi * 1.2 };
}

export function buildFeed(aspect: number, budget: number): Picture {
  return fitBudget((s) => feed(aspect, s), budget);
}

export function buildShoe(aspect: number, budget: number): Picture {
  return fitBudget((s) => shoe(aspect, s), budget);
}

export function buildScreen(aspect: number, budget: number): Picture {
  return fitBudget((s) => screen(aspect, s), budget);
}
