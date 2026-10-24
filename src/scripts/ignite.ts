// ignite.ts: lights each section headline like a neon sign the first time it enters view
// (NIGHT-SIGNAL.md 11b.2). The letters are built by src/components/ui/ignite.ts; the strike
// patterns are in base.css.
//
// html.js-ignite is set before the first paint (Base.astro) when motion is on and this isn't
// snapshot: the letters start as unlit tubes. This script marks the page ignite-ready (which also
// cancels base.css's safety net that lights everything after 4 s if this script never ran), then
// adds .is-igniting to a headline once it enters view, and .is-lit when its last letter is done.
// Once per headline. Under reduced motion (or if the setting changes) a headline simply lights.

const html = document.documentElement;

if (html.classList.contains('js-ignite')) {
  html.classList.add('ignite-ready');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const heads = Array.from(document.querySelectorAll<HTMLElement>('[data-ignite]'));

  const light = (el: HTMLElement) => {
    el.classList.remove('is-igniting');
    el.classList.add('is-lit');
  };
  const ignite = (el: HTMLElement) => {
    if (reduce.matches) return light(el);
    el.classList.add('is-igniting');
    const ms = Number(el.dataset.igniteMs) || 700;
    window.setTimeout(() => light(el), ms + 40);
  };

  if (!('IntersectionObserver' in window)) {
    heads.forEach(light);
  } else {
    // "Enters view": its top has come up past the bottom 12% of the window.
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          io.unobserve(entry.target);
          ignite(entry.target as HTMLElement);
        }
      },
      { rootMargin: '0px 0px -12% 0px' },
    );
    heads.forEach((el) => io.observe(el));
  }
}
