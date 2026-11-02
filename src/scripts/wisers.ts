// wisers.ts: keeps the Wisers text off its pictures in the stack layout (Experience.astro;
// V4.md 8.2).
//
// Phones and upright iPads draw the 2024 feed and shoe and the 2025 screen agent across the upper
// part of the screen (WISERS_ANCHOR's phone box, contract.ts) while the Wisers block scrolls up from
// below: nothing is held there, and each picture draws while its summer's line is being read. So as
// the text reaches the pictures' bottom edge it fades out, over 48px from 8px under it, and its band
// of night with it: a mask on the frame whose edge stays on that line while the page scrolls, as
// civic.ts does for Civic Exchange under the archive columns. The text is read in the lower part of
// the screen with the pictures clear above it. Wisers' More, which follows the frame, is cut off the
// same way, since the screen agent is still drawn while it goes by. Nothing moves or changes size,
// and it runs with reduced motion too (it is where the text is cut, not an animation).
//
// It steps aside without WebGL or while the world's context is lost (no pictures then), side by
// side (short and wide put the text right of the pictures, and the pin layout holds the frame), and
// in snapshot and print, which show everything. It works only while a masked box is near the
// screen, one read and one write a frame for each.
import { wisersBox } from '../world/contract';

const GAP = 8;
const FADE = 48;

const html = document.documentElement;
const boxes = Array.from(
  document.querySelectorAll<HTMLElement>('[data-scene="wisers"] .wisers__frame, [data-wisers-more] .wisers-more__frame'),
);
const canvas = document.querySelector<HTMLElement>('[data-world]');

if (boxes.length && canvas && !html.hasAttribute('data-snapshot')) {
  const near = new Set<HTMLElement>();
  let queued = false;
  const masked = new Set<HTMLElement>();
  // The pictures' bottom edge in viewport px. Screen fractions are of the canvas, which is the
  // large viewport's height (base.css), as the signal places them.
  let line = 0;
  const measure = () => {
    const height = canvas.clientHeight || window.innerHeight;
    line = wisersBox(window.innerWidth, height).y1 * height + GAP;
  };

  const clear = (box: HTMLElement) => {
    if (!masked.delete(box)) return;
    box.style.removeProperty('-webkit-mask-image');
    box.style.removeProperty('mask-image');
  };

  const update = () => {
    queued = false;
    const off = html.dataset.layout !== 'stack' || html.classList.contains('no-webgl') || html.classList.contains('world-lost');
    for (const box of boxes) {
      if (off || !near.has(box)) {
        clear(box);
        continue;
      }
      const cut = line - box.getBoundingClientRect().top;
      if (cut <= 0) {
        clear(box);
        continue;
      }
      const mask = `linear-gradient(to bottom, transparent ${cut.toFixed(1)}px, #000 ${(cut + FADE).toFixed(1)}px)`;
      box.style.setProperty('-webkit-mask-image', mask);
      box.style.setProperty('mask-image', mask);
      masked.add(box);
    }
  };

  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };

  const io = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const box = entry.target as HTMLElement;
      if (entry.isIntersecting) near.add(box);
      else near.delete(box);
    }
    queue();
  });
  boxes.forEach((box) => io.observe(box));
  measure();
  window.addEventListener('scroll', () => near.size > 0 && queue(), { passive: true });
  window.addEventListener('resize', () => {
    measure();
    queue();
  });
  // The layout or the world changing.
  window.addEventListener('world:layout', queue);
  new MutationObserver(queue).observe(html, { attributes: true, attributeFilter: ['class', 'data-layout'] });
}
