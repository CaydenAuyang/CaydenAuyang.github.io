// wisers.ts: keeps the Wisers text out of the pictures on phones (Experience.astro).
//
// The Wisers frame holds still at the bottom of the screen (motion on or off), below
// WISERS_ANCHOR's box (where the signal draws the feed, the shoe and the screen agent). When the
// hold ends, the frame scrolls away upward, which would carry the text up through the pictures; so
// on the phone layout the text fades out just before and as that exit begins (gone after 4% of the
// window); with reduced motion it cuts out at the same point instead. Nothing moves; only its
// opacity changes. Desktop keeps its text in the right column, clear of the box, so it stays.

const html = document.documentElement;
const track = document.querySelector<HTMLElement>('[data-scene="wisers"]');
const block = track?.querySelector<HTMLElement>('.wisers__block');
const held = () => html.classList.contains('js') && !html.hasAttribute('data-snapshot');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
const phone = window.matchMedia('(max-width: 767px), (max-width: 1023px) and (orientation: portrait)');

if (track && block && held()) {
  let queued = false;
  const update = () => {
    queued = false;
    if (!phone.matches) {
      block.style.opacity = '';
      return;
    }
    // The frame starts leaving when the track's bottom reaches the window's bottom. Fade from 6% of
    // the window before that to 4% after, so the text is gone before it rises into the box.
    const vh = window.innerHeight;
    const bottom = track.getBoundingClientRect().bottom;
    let fade = Math.min(1, Math.max(0, (vh * 1.06 - bottom) / (vh * 0.1)));
    // Reduced motion: no fade, a cut at the same midpoint.
    if (reduce.matches) fade = fade >= 0.5 ? 1 : 0;
    block.style.opacity = fade > 0 ? String(1 - fade) : '';
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('resize', queue);
  phone.addEventListener?.('change', queue);
  update();
}
