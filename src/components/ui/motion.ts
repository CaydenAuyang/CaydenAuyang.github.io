// motion.ts: the site's small motion module. Loaded on every page by Base.astro.
//
// It does one thing for now: elements marked data-reveal fade and rise in once, when a quarter
// of them is on screen. It only runs when the first script in Base.astro added "js-motion"
// (motion allowed). When it starts it adds "motion-ready", which tells the 3.5 second safety
// net in Base.astro that the motion code is alive and nothing should be un-hidden.

const root = document.documentElement;

function reveal() {
  const items = document.querySelectorAll<HTMLElement>('[data-reveal]');
  if (!('IntersectionObserver' in window)) {
    items.forEach((el) => el.classList.add('is-in'));
    return;
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          io.unobserve(entry.target);
        }
      }
    },
    { threshold: 0.25 },
  );
  items.forEach((el) => io.observe(el));
}

if (root.classList.contains('js-motion')) {
  root.classList.add('motion-ready');
  reveal();
}

// Motion switched off in the footer: show everything in place at once.
document.addEventListener('ca:motion', (event) => {
  const { enabled } = (event as CustomEvent<{ enabled: boolean }>).detail;
  if (!enabled) {
    document.querySelectorAll('[data-reveal]').forEach((el) => el.classList.add('is-in'));
    root.classList.remove('js-motion');
  }
});
