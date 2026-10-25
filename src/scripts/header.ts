// header.ts: the header's backing (Header.astro) is clear at the very top of the page, so it never
// dims the figure's crown, and on once the page has scrolled past 16px, where text can start to
// pass under the name and Menu. A reload or a deep link that lands mid-page gets it at once.

const header = document.querySelector<HTMLElement>('.site-header');

if (header) {
  let queued = false;
  const update = () => {
    queued = false;
    header.classList.toggle('is-scrolled', window.scrollY > 16);
  };
  const queue = () => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(update);
  };
  window.addEventListener('scroll', queue, { passive: true });
  window.addEventListener('hashchange', queue);
  window.addEventListener('load', update);
  update();
}
