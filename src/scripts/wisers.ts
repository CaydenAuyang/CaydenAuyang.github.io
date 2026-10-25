// wisers.ts: keeps the Wisers text off its pictures in the stack layout (Experience.astro;
// V4.md 8.2).
//
// Phones and upright iPads draw the 2024 feed and shoe and the 2025 screen agent across the upper
// part of the screen (WISERS_ANCHOR's phone box, contract.ts) while the Wisers block scrolls up from
// below: nothing is held there, and each picture draws while its summer's line is being read. So as
// the text reaches the pictures' bottom edge it fades out, over 48px from 8px under it, and its band
// of night with it: a mask on the frame whose edge stays on that line while the page scrolls, as
// civic.ts does for Civic Exchange under the archive columns. The text is read in the lower part of
// the screen with the pictures clear above it. Nothing moves or changes size, and it runs with
// reduced motion too (it is where the text is cut, not an animation).
//
// It steps aside without WebGL or while the world's context is lost (no pictures then), side by
// side (short and wide put the text right of the pictures, and the pin layout holds the frame), and
// in snapshot and print, which show everything. It works only while the frame is near the screen,
// one read and one write a frame.
import { wisersBox } from '../world/contract';

const GAP = 8;
const FADE = 48;

const html = document.documentElement;
const frame = document.querySelector<HTMLElement>('[data-scene="wisers"] .wisers__frame');
const canvas = document.querySelector<HTMLElement>('[data-world]');

if (frame && canvas && !html.hasAttribute('data-snapshot')) {
  let near = false;
  let queued = false;
  let masked = false;
  // The pictures' bottom edge in viewport px. Screen fractions are of the canvas, which is the
  // large viewport's height (base.css), as the signal places them.
  let line = 0;
  const measure = () => {
    const height = canvas.clientHeight || window.innerHeight;
    line = wisersBox(window.innerWidth, height).y1 * height + GAP;
  };

  const clear = () => {
    if (!masked) return;
    masked = false;
    frame.style.removeProperty('-webkit-mask-image');
    frame.style.removeProperty('mask-image');
  };

  const update = () => {
    queued = false;
    const off = !near || html.dataset.layout !== 'stack' || html.classList.contains('no-webgl') || html.classList.contains('world-lost');
    if (off) return clear();
    const cut = line - frame.getBoundingClientRect().top;
    if (cut <= 0) return clear();
    const mask = `linear-gradient(to bottom, transparent ${cut.toFixed(1)}px, #000 ${(cut + FADE).toFixed(1)}px)`;
    frame.style.setProperty('-webkit-mask-image', mask);
    frame.style.setProperty('mask-image', mask);
    masked = true;
  };

  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  new IntersectionObserver(([entry]) => {
    near = entry.isIntersecting;
    queue();
  }).observe(frame);
  measure();
  window.addEventListener('scroll', () => near && queue(), { passive: true });
  window.addEventListener('resize', () => {
    measure();
    queue();
  });
  // The layout or the world changing.
  window.addEventListener('world:layout', queue);
  new MutationObserver(queue).observe(html, { attributes: true, attributeFilter: ['class', 'data-layout'] });
}
