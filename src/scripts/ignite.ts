// ignite.ts: lights each section headline like a neon sign the first time it enters view
// (NIGHT-SIGNAL.md 11b.2). Timing comes from src/components/ui/ignite.ts; the strike patterns are
// in base.css.
//
// html.js-ignite is set before the first paint (Base.astro) when motion is on and this isn't
// snapshot. Headlines ship as plain text, lit. This script waits for Barlow Condensed (at most
// 6 s; a slow font just means the plain lit text stays a while), then splits every headline into
// letter spans (a hidden copy for screen readers, aria-hidden letters, which start as unlit tubes)
// and watches them. The moment a headline enters view it gets
// .is-igniting, and .is-lit when its last letter is done. Once per headline. Under reduced motion
// (or if that setting changes) a headline simply lights.

const html = document.documentElement;
// Three strike patterns (base.css): a = one flicker, b = two flickers, c = one late flicker.
const PATTERNS = ['a', 'b', 'c', 'a', 'c', 'b'];

function split(el: HTMLElement) {
  const text = el.textContent ?? '';
  const hidden = document.createElement('span');
  hidden.className = 'sr-only';
  hidden.textContent = text;
  const letters = document.createElement('span');
  letters.className = 'ign';
  letters.setAttribute('aria-hidden', 'true');
  let i = 0;
  for (const c of text) {
    if (!c.trim()) {
      letters.append(c);
      continue;
    }
    const n = i++;
    const span = document.createElement('span');
    span.className = `ign__l ign__l--${PATTERNS[(n * 5 + text.length) % PATTERNS.length]}`;
    span.style.setProperty('--i', String(n));
    span.textContent = c;
    letters.append(span);
  }
  el.replaceChildren(hidden, letters);
  el.classList.add('is-split');
}

if (html.classList.contains('js-ignite')) {
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
  const start = () => {
    heads.forEach(split);
    if (!('IntersectionObserver' in window)) return heads.forEach(light);
    // Ignite the moment any part of the headline is in the window.
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        ignite(entry.target as HTMLElement);
      }
    });
    heads.forEach((el) => io.observe(el));
  };

  const first = heads[0];
  const fontReady = first && document.fonts?.load ? document.fonts.load(getComputedStyle(first).font, first.textContent ?? '') : Promise.resolve();
  let started = false;
  const go = () => {
    if (started) return;
    started = true;
    start();
  };
  fontReady.then(go, go);
  window.setTimeout(go, 6000);
}
