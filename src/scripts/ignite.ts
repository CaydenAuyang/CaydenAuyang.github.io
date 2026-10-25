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

// Letters keep their word's span (.tw, which carries the word's color), so each letter strikes in
// its word's color. Spaces stay plain text between the words.
function split(el: HTMLElement) {
  const text = el.textContent ?? '';
  const hidden = document.createElement('span');
  hidden.className = 'sr-only';
  hidden.textContent = text;
  const letters = document.createElement('span');
  letters.className = 'ign';
  letters.setAttribute('aria-hidden', 'true');
  let i = 0;
  const addLetters = (into: Node, str: string) => {
    for (const c of str) {
      if (!c.trim()) {
        into.appendChild(document.createTextNode(c));
        continue;
      }
      const n = i++;
      const span = document.createElement('span');
      span.className = `ign__l ign__l--${PATTERNS[(n * 5 + text.length) % PATTERNS.length]}`;
      span.style.setProperty('--i', String(n));
      span.textContent = c;
      into.appendChild(span);
    }
  };
  for (const node of Array.from(el.childNodes)) {
    if (node instanceof HTMLElement) {
      const word = node.cloneNode(false) as HTMLElement;
      addLetters(word, node.textContent ?? '');
      letters.appendChild(word);
    } else {
      addLetters(letters, node.textContent ?? '');
    }
  }
  el.replaceChildren(hidden, letters);
  el.classList.add('is-split');
}

/*
  After the ignition the titles stay alive (11b.2 v3.1): while a lit title is on screen, every 4 to
  10 s (random per title) one or two of its letters, or now and then a whole word, flicker off and
  on for 80 to 200 ms, like a tired tube. At most one title flickers at a time; nothing moves (only
  color and glow change, base.css .is-flicker); it pauses while the tab is hidden; and there is
  none with reduced motion.
*/
const FLICKER_MIN_MS = 4000;
const FLICKER_MAX_MS = 10000;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

function startFlicker(reduce: MediaQueryList) {
  const titles = new Map<HTMLElement, { visible: boolean; next: number }>();
  let busy = false;
  let timer = 0;

  const flicker = (el: HTMLElement) => {
    const letters = Array.from(el.querySelectorAll<HTMLElement>('.ign__l'));
    const words = Array.from(el.querySelectorAll<HTMLElement>('.ign .tw'));
    if (!letters.length) return;
    let picked: HTMLElement[];
    if (words.length && Math.random() < 0.2) {
      // Now and then a whole word.
      picked = Array.from(words[Math.floor(Math.random() * words.length)].querySelectorAll<HTMLElement>('.ign__l'));
    } else {
      // One or two letters, next to each other or not.
      const count = Math.random() < 0.6 ? 1 : 2;
      picked = [];
      while (picked.length < Math.min(count, letters.length)) {
        const l = letters[Math.floor(Math.random() * letters.length)];
        if (!picked.includes(l)) picked.push(l);
      }
    }
    const ms = Math.round(rand(80, 200));
    busy = true;
    for (const l of picked) {
      l.style.setProperty('--flick', `${ms}ms`);
      l.classList.add('is-flicker');
    }
    window.setTimeout(() => {
      for (const l of picked) l.classList.remove('is-flicker');
      busy = false;
    }, ms + 20);
  };

  const schedule = () => {
    window.clearTimeout(timer);
    if (document.hidden || reduce.matches) return;
    const now = performance.now();
    let soonest = Infinity;
    for (const t of titles.values()) if (t.visible) soonest = Math.min(soonest, t.next);
    if (soonest === Infinity) return;
    timer = window.setTimeout(tick, Math.max(0, soonest - now));
  };

  const tick = () => {
    const now = performance.now();
    for (const [el, t] of titles) {
      if (!t.visible || t.next > now) continue;
      if (busy) {
        // Another title is flickering: this one waits a little.
        t.next = now + rand(300, 1200);
        continue;
      }
      flicker(el);
      t.next = now + rand(FLICKER_MIN_MS, FLICKER_MAX_MS);
    }
    schedule();
  };

  const watch = new IntersectionObserver((entries) => {
    for (const entry of entries) {
      const t = titles.get(entry.target as HTMLElement);
      if (!t) continue;
      t.visible = entry.isIntersecting;
      if (t.visible && t.next < performance.now()) t.next = performance.now() + rand(FLICKER_MIN_MS, FLICKER_MAX_MS);
    }
    schedule();
  });

  return {
    add(el: HTMLElement) {
      titles.set(el, { visible: false, next: performance.now() + rand(FLICKER_MIN_MS, FLICKER_MAX_MS) });
      watch.observe(el);
    },
    resume() {
      const now = performance.now();
      for (const t of titles.values()) t.next = now + rand(FLICKER_MIN_MS, FLICKER_MAX_MS);
      schedule();
    },
    stop() {
      window.clearTimeout(timer);
    },
  };
}

if (html.classList.contains('js-ignite')) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const heads = Array.from(document.querySelectorAll<HTMLElement>('[data-ignite]'));

  const alive = 'IntersectionObserver' in window ? startFlicker(reduce) : null;
  document.addEventListener('visibilitychange', () => (document.hidden ? alive?.stop() : alive?.resume()));
  reduce.addEventListener?.('change', () => (reduce.matches ? alive?.stop() : alive?.resume()));

  const light = (el: HTMLElement) => {
    el.classList.remove('is-igniting');
    el.classList.add('is-lit');
    alive?.add(el);
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
