// layout.ts: the page's three layouts and its two kinds of input (V4.md section 8.1), for scripts.
//
// The same queries are in src/styles/media.css for the CSS (Hero.astro stops the build if the
// two disagree). Base.astro's head script sets html[data-layout] and html[data-input] from these
// before the first paint and keeps them current; scripts can read those, or call the helpers here.
//
//   stack  width 767 or less, or portrait up to 1199 wide: phones upright, iPads upright
//   short  landscape, 768 wide or more, 560 tall or less: phones sideways
//   wide   everything else: laptops, desktops, iPads sideways
//   pin    wide and at least 600 tall: the only place sections are held still while you scroll
//   mouse  a mouse or trackpad that hovers; touch is everything else (an iPad with a trackpad
//          counts as touch)

export type LayoutMode = 'stack' | 'short' | 'wide';

export const STACK = '(max-width: 767px), (orientation: portrait) and (max-width: 1199px)';
export const SHORT = '(orientation: landscape) and (min-width: 768px) and (max-height: 560px)';
export const WIDE =
  '(orientation: landscape) and (min-width: 768px) and (min-height: 561px), (orientation: portrait) and (min-width: 1200px)';
export const PIN =
  '(orientation: landscape) and (min-width: 768px) and (min-height: 600px), (orientation: portrait) and (min-width: 1200px) and (min-height: 600px)';
export const MOUSE = '(hover: hover) and (pointer: fine)';
export const TOUCH = '(hover: none), (pointer: coarse), (pointer: none)';

/** The layout for a window size, as the queries above decide it (square counts as portrait, as in CSS). */
export function layoutFor(width: number, height: number): LayoutMode {
  const portrait = height >= width;
  if (width <= 767 || (portrait && width <= 1199)) return 'stack';
  if (!portrait && height <= 560) return 'short';
  return 'wide';
}

/** Whether sections are held still at this window size: wide, and at least 600 tall. */
export function pinsFor(width: number, height: number): boolean {
  return layoutFor(width, height) === 'wide' && height >= 600;
}

const query = (q: string) => typeof window !== 'undefined' && window.matchMedia(q).matches;

/** The current layout. */
export function layoutMode(): LayoutMode {
  return query(STACK) ? 'stack' : query(SHORT) ? 'short' : 'wide';
}

/** Whether sections are held still now. */
export const pinning = () => query(PIN);

/** Whether the main pointer is a mouse or trackpad that hovers. */
export const hasMouse = () => query(MOUSE);

/** Calls back whenever the layout or the input changes (orientation change, window resize). */
export function onLayoutChange(cb: (mode: LayoutMode) => void): () => void {
  const lists = [STACK, SHORT, PIN, MOUSE].map((q) => window.matchMedia(q));
  const fire = () => cb(layoutMode());
  lists.forEach((l) => l.addEventListener('change', fire));
  return () => lists.forEach((l) => l.removeEventListener('change', fire));
}
