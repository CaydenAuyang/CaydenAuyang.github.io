// more.ts: the "More" expanders (More.astro).
//
// Click toggles the panel. The height animates from 0 to the content's height (and back) over
// 420 ms with power2.inOut; under reduced motion it simply appears. The panel is display:none
// while closed (html.js rule in More.astro), so closed text is out of the tab order and the
// accessibility tree. After each change, `world:layout` tells the timeline the page height moved.
import { ui } from '../data/site';

const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const EASE = 'cubic-bezier(0.455, 0.03, 0.515, 0.955)';
const DURATION = 420;

const layoutChanged = () => window.dispatchEvent(new CustomEvent('world:layout'));

document.querySelectorAll<HTMLElement>('[data-more]').forEach((root) => {
  const button = root.querySelector<HTMLButtonElement>('[data-more-btn]');
  const panel = root.querySelector<HTMLElement>('[data-more-panel]');
  const text = root.querySelector<HTMLElement>('[data-more-text]');
  if (!button || !panel) return;
  let animation: Animation | null = null;

  const set = (open: boolean) => {
    button.setAttribute('aria-expanded', String(open));
    if (text) text.textContent = open ? ui.less : ui.more;
  };

  button.addEventListener('click', () => {
    const opening = button.getAttribute('aria-expanded') !== 'true';
    const animate = !reduceQuery.matches && typeof panel.animate === 'function';
    const from = panel.hasAttribute('data-open') ? panel.getBoundingClientRect().height : 0;
    animation?.cancel();
    set(opening);

    if (opening) panel.setAttribute('data-open', '');
    if (!animate) {
      if (!opening) panel.removeAttribute('data-open');
      layoutChanged();
      return;
    }

    const to = opening ? panel.scrollHeight : 0;
    animation = panel.animate([{ height: `${from}px` }, { height: `${to}px` }], { duration: DURATION, easing: EASE });
    animation.onfinish = () => {
      animation = null;
      if (!opening) panel.removeAttribute('data-open');
      layoutChanged();
    };
  });
});
