// civic.ts: keeps the Civic Exchange text off the archive columns in the stack layout
// (Experience.astro; V4.md 8.2: the columns sit above the text, not behind it).
//
// Phones and upright iPads show the twelve columns across the upper half of the screen (the signal
// draws their feet at 0.53 to 0.55 of the canvas's height, signal.ts target D) while Civic Exchange
// scrolls up from below. So as the text reaches the columns' feet it fades out, over 48px from 8px
// under them, and its band of night with it: a mask on the block's frame whose edge stays on that
// line while the page scrolls. The block is read in the lower part of the screen with the chart
// standing clear above it. Nothing moves or changes size, and it runs with reduced motion too (it
// isn't an animation, only where the text is cut).
//
// A mask changes what is seen, not what a tap lands on: the faded lines and the More button would
// still catch taps meant for the columns over them (their labels open on tap, V4.md 8.4), since
// interact.ts gives any press on text or a control to the page, and a tap on the hidden button
// opened More. So while the mask is on, a bare layer covers the block down to the line: a tap there
// lands on it, finds no text, and goes to the world. (A keyboard still reaches the button; its
// scroll margin in Experience.astro brings it out from under the columns when it takes focus.)
//
// It steps aside while the More panel is open (the long text gets the whole screen; reading it is
// the point), without WebGL or while the world's context is lost (no columns then), side by side
// (short and wide put the text right of the chart), and in snapshot and print, which show
// everything. It works only while the frame is near the screen and crosses the line: two reads,
// then a write only for what changed.

/** The columns' feet in the stack layout, as a share of the canvas's height (signal.ts, target D):
 *  measured 0.53 to 0.55 at 375 x 667, 390 x 844 and 820 x 1180 through the whole experience scene. */
const COLUMNS_FOOT = 0.55;
const GAP = 8;
const FADE = 48;

const html = document.documentElement;
const frame = document.querySelector<HTMLElement>('.xp__wrap');
const block = frame?.querySelector<HTMLElement>('.xp__block');
const panel = frame?.querySelector<HTMLElement>('[data-more-panel]');
const canvas = document.querySelector<HTMLElement>('[data-world]');

if (frame && block && canvas && !html.hasAttribute('data-snapshot')) {
  let near = false;
  let queued = false;
  let masked = false;
  // What was last written, so an unchanged frame writes nothing.
  let shownMask = '';
  let shownTop = 0;
  let shownCover = -1;
  // The line in viewport px: the canvas is the large viewport's height (base.css).
  let line = 0;
  const measure = () => {
    line = COLUMNS_FOOT * (canvas.clientHeight || window.innerHeight) + GAP;
  };

  // The layer that takes taps over the faded part: last in the block (positioned by .scrim), above
  // its text, empty, and not a control, so interact.ts treats a press on it as the world's. (Last,
  // not first: WebKit's caret lookup on an empty box falls to the next text, which is Wisers, far
  // below, never a line under the finger.)
  const cover = document.createElement('div');
  cover.setAttribute('aria-hidden', 'true');
  cover.hidden = true;
  Object.assign(cover.style, { position: 'absolute', top: '0', left: '0', right: '0', zIndex: '1' });
  block.append(cover);

  const clear = () => {
    if (!masked) return;
    masked = false;
    shownMask = '';
    shownCover = -1;
    frame.style.removeProperty('-webkit-mask-image');
    frame.style.removeProperty('mask-image');
    cover.hidden = true;
  };

  const update = () => {
    queued = false;
    const off =
      !near ||
      html.dataset.layout !== 'stack' ||
      html.classList.contains('no-webgl') ||
      html.classList.contains('world-lost') ||
      !!panel?.hasAttribute('data-open');
    if (off) return clear();
    const box = frame.getBoundingClientRect();
    const inner = block.getBoundingClientRect();
    // Once the whole frame is above the line the mask hides all of it, and stops changing.
    const cut = Math.min(line - box.top, box.height);
    if (cut <= 0) return clear();
    masked = true;
    const mask = `linear-gradient(to bottom, transparent ${cut.toFixed(1)}px, #000 ${(cut + FADE).toFixed(1)}px)`;
    if (mask !== shownMask) {
      shownMask = mask;
      frame.style.setProperty('-webkit-mask-image', mask);
      frame.style.setProperty('mask-image', mask);
    }
    // The cover spans the same masked part of the frame, from its top: the title's glyphs reach
    // above the block's own top, and onText counts 4px around each line.
    const top = Math.round(box.top - inner.top);
    const covered = Math.round(cut);
    if (top !== shownTop || covered !== shownCover) {
      shownTop = top;
      shownCover = covered;
      cover.style.top = `${top}px`;
      cover.style.height = `${covered}px`;
      cover.hidden = covered === 0;
    }
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
  // More opening or closing, and the layout or the world changing.
  window.addEventListener('world:layout', queue);
  frame.addEventListener('click', queue);
  new MutationObserver(queue).observe(html, { attributes: true, attributeFilter: ['class', 'data-layout'] });
}
