// hero-hint.ts: the one-time hint in the hero, "Click anywhere in the city" with a mouse and "Tap
// the city" on touch screens (NIGHT-SIGNAL.md 11b.1).
//
//   - It shows only once the world is drawn (html.is-ready) and its interactions are listening
//     (html.has-interactions, added by the lead's interact.ts), with motion on or off. Never in
//     snapshot mode or without WebGL (html.no-webgl), where there is nothing to click.
//   - With motion on it waits for the intro (about 2.6 s after the page started loading).
//   - The first successful pulse (`world:pulse` from interact.ts) fades it out, and localStorage
//     remembers that, so a returning visitor who already pulsed doesn't see it again. Storage can
//     be missing or blocked (private windows); then the hint simply shows again next visit.
import { ui } from '../data/site';

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
  const mouse = window.matchMedia('(hover: hover) and (pointer: fine)');
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const label = () => {
    text.textContent = mouse.matches ? ui.hintMouse : ui.hintTouch;
  };
  let state: 'waiting' | 'shown' | 'gone' = 'waiting';

  const ready = () =>
    html.classList.contains('is-ready') && html.classList.contains('has-interactions') && !html.classList.contains('no-webgl');

  const show = () => {
    if (state !== 'waiting' || !ready()) return;
    state = 'shown';
    watch.disconnect();
    label();
    hint.hidden = false;
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

  mouse.addEventListener?.('change', label);

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
