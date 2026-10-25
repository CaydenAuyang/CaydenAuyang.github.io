// hero-hint.ts: the one-time hint in the hero, "Click anywhere in the city" with a mouse and "Tap
// the city" on touch screens (NIGHT-SIGNAL.md 11b.1).
//
//   - It shows only once the world is drawn (html.is-ready) and its interactions are listening
//     (html.has-interactions, added by the lead's interact.ts), with motion on or off. Never in
//     snapshot mode or without WebGL (html.no-webgl), where there is nothing to click, nor while
//     the world's context is lost (html.world-lost; base.css hides it if that happens later).
//   - "Click" with a mouse, "Tap" otherwise: the input from src/world/layout.ts, which follows a
//     hybrid device as it switches.
//   - With motion on it waits for the intro (about 2.6 s after the page started loading).
//   - It fades away once the page has scrolled a little (on phones it would otherwise slide up
//     across the figure's bright outline) and comes back at the top. If it would touch the hero's
//     lines on a short screen, it doesn't show at all.
//   - The first successful pulse (`world:pulse` from interact.ts) fades it out, and localStorage
//     remembers that, so a returning visitor who already pulsed doesn't see it again. Storage can
//     be missing or blocked (private windows); then the hint simply shows again next visit.
import { ui } from '../data/site';
import { hasMouse, onLayoutChange } from '../world/layout';

const KEY = 'night-signal:pulsed';
const html = document.documentElement;
const hint = document.querySelector<HTMLElement>('[data-hero-hint]');
const text = hint?.querySelector<HTMLElement>('[data-hint-text]');

function pulsedBefore(): boolean {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

function rememberPulse() {
  try {
    window.localStorage.setItem(KEY, '1');
  } catch {
    // Storage blocked: nothing to remember with.
  }
}

if (hint && text && !html.hasAttribute('data-snapshot') && !pulsedBefore()) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const label = () => {
    text.textContent = hasMouse() ? ui.hintMouse : ui.hintTouch;
  };
  let state: 'waiting' | 'shown' | 'gone' = 'waiting';

  const ready = () =>
    html.classList.contains('is-ready') &&
    html.classList.contains('has-interactions') &&
    !html.classList.contains('no-webgl') &&
    !html.classList.contains('world-lost');

  const show = () => {
    if (state !== 'waiting' || !ready()) return;
    state = 'shown';
    watch.disconnect();
    label();
    hint.hidden = false;
    // Short screens: no room under the hero's lines.
    const lines = document.querySelector<HTMLElement>('.hero__text');
    if (lines && hint.getBoundingClientRect().top < lines.getBoundingClientRect().bottom + 8) {
      hint.hidden = true;
      return;
    }
    const scrolled = () => hint.classList.toggle('is-scrolled', window.scrollY > window.innerHeight * 0.12);
    window.addEventListener('scroll', scrolled, { passive: true });
    scrolled();
    const wait = reduce.matches ? 0 : Math.max(0, 2600 - performance.now());
    window.setTimeout(() => {
      // One frame after unhiding, so the fade runs.
      requestAnimationFrame(() => {
        if (state === 'shown') hint.classList.add('is-in');
      });
    }, wait);
  };

  const watch = new MutationObserver(show);
  watch.observe(html, { attributes: true, attributeFilter: ['class'] });
  show();

  onLayoutChange(label);

  window.addEventListener(
    'world:pulse',
    () => {
      rememberPulse();
      const was = state;
      state = 'gone';
      watch.disconnect();
      if (was !== 'shown') return;
      hint.classList.remove('is-in');
      hint.classList.add('is-gone');
      window.setTimeout(() => (hint.hidden = true), reduce.matches ? 0 : 450);
    },
    { once: true },
  );
}
