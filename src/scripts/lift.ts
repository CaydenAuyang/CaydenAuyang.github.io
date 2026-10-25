// lift.ts: keeps the lift indicator (Lift.astro) on the right floor.
//
// The current floor is the section whose range on the page contains the middle of the window.
// Section ranges are measured once and again whenever the page's size changes (More panels,
// fonts, resizing), so following the scroll reads no layout: each scroll frame only compares
// numbers. The lit floor carries aria-current="location". Where the rail is hidden (the stack and
// short layouts, touch screens; Lift.astro) it does nothing until the layout or input changes.
import { onLayoutChange } from '../world/layout';

const nav = document.querySelector<HTMLElement>('[data-lift]');
const links = nav ? Array.from(nav.querySelectorAll<HTMLAnchorElement>('[data-floor]')) : [];
const floors = links
  .map((link) => ({ link, el: document.getElementById(link.dataset.floor || '') }))
  .filter((f): f is { link: HTMLAnchorElement; el: HTMLElement } => !!f.el);

if (nav && floors.length) {
  let ranges: { top: number; bottom: number }[] = [];
  let lit = -1;
  let queued = false;
  let shown = false;

  const measure = () => {
    const y = window.scrollY;
    ranges = floors.map(({ el }) => {
      const r = el.getBoundingClientRect();
      return { top: r.top + y, bottom: r.bottom + y };
    });
  };

  const light = (i: number) => {
    if (i === lit) return;
    if (lit >= 0) floors[lit].link.removeAttribute('aria-current');
    if (i >= 0) floors[i].link.setAttribute('aria-current', 'location');
    lit = i;
  };

  const update = () => {
    queued = false;
    if (!shown) return;
    const mid = window.scrollY + window.innerHeight / 2;
    let found = -1;
    for (let i = 0; i < ranges.length; i++) {
      if (mid >= ranges[i].top && mid < ranges[i].bottom) {
        found = i;
        break;
      }
    }
    // Between sections (never, as they touch) or past the end: the nearest one above.
    if (found < 0) {
      for (let i = ranges.length - 1; i >= 0; i--) {
        if (mid >= ranges[i].top) {
          found = i;
          break;
        }
      }
    }
    light(Math.max(0, found));
  };

  const queue = () => {
    if (queued || !shown) return;
    queued = true;
    requestAnimationFrame(update);
  };
  const remeasure = () => {
    shown = getComputedStyle(nav).display !== 'none';
    if (!shown) return;
    measure();
    update();
  };

  remeasure();
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', remeasure);
  onLayoutChange(remeasure);
  window.addEventListener('world:layout', () => requestAnimationFrame(remeasure));
  if ('ResizeObserver' in window) new ResizeObserver(() => remeasure()).observe(document.body);
  document.fonts?.ready.then(remeasure);
}
