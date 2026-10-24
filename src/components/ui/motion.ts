// motion.ts: the one place components ask "may I animate?". Loaded on every page by Base.astro.
//
// The rules (set before first paint by the inline script in Base.astro):
//   - html.js-motion      motion is allowed right now; hide-before-animate CSS hangs off it.
//   - html.motion-ready   added here when this module starts. The 3.5 second safety net in
//                         Base.astro removes js-motion if this never arrives (a script failed).
//   - html[data-motion="off"]  the visitor switched Motion off in the footer.
//   - html[data-snapshot]      snapshot mode (?snapshot, the footer toggle): counts as motion off.
//   - prefers-reduced-motion   the device setting: motion off.
// When any of these changes while the page is open, a "ca:motion" event fires on document with
// detail.enabled. Use onMotionChange() rather than listening for all of them yourself.
//
// Usage in a component script:
//   import { motionAllowed, onMotionChange, isSnapshot } from '../ui/motion';
//   if (motionAllowed()) startAnimation(); else showEndState();
//   onMotionChange((enabled) => { if (!enabled) showEndState(); });

const root = document.documentElement;
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

export function isSnapshot(): boolean {
  return root.hasAttribute('data-snapshot');
}

export function motionAllowed(): boolean {
  return !reduceQuery.matches && root.getAttribute('data-motion') !== 'off' && !isSnapshot();
}

export function onMotionChange(callback: (enabled: boolean) => void): void {
  document.addEventListener('ca:motion', (event) => {
    callback((event as CustomEvent<{ enabled: boolean }>).detail.enabled);
  });
}

// Keep js-motion in step with the rules, and tell everyone when they change.
function sync() {
  const enabled = motionAllowed();
  root.classList.toggle('js-motion', enabled);
  document.dispatchEvent(new CustomEvent('ca:motion', { detail: { enabled } }));
}

// Start once per page (a module can be imported by several components; it still runs once).
if (!root.classList.contains('motion-ready')) {
  root.classList.add('motion-ready');
  reduceQuery.addEventListener('change', sync);
  // The footer switches change data-motion / data-snapshot; watch those attributes so every
  // component hears about it the same way.
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-motion', 'data-snapshot'] });
}
