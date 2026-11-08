// origins.ts: Where it started's two lines of light (StartPanel.astro). Like the titles' neon
// ignition (ignite.ts) it runs only under html.js-ignite (motion on, not snapshot); in every other
// case the lines ship drawn and lit, and nothing runs on them.
//
// Drawing: the moment the list's top comes a fifth of the way up the window, the panel gets
// .is-drawing: the CSS draws each line down row by row, --step a row, and strikes each stop as the
// light reaches it. When the last stop is done it gets .is-drawn, the resting state. Once per page.
//
// Then, while the panel is on screen and the tab is showing, a light runs down each line every
// PERIOD ms (the Wisers line a little after the AI Simply line), at SPEED, from its first stop to
// its last, and each stop flares as the light's tip reaches it. Both are Web Animations on the
// head's transform and the stops' filter, laid out again whenever the list changes size. Under
// reduced motion (or if that setting changes) the lines are simply drawn and nothing runs.

const PERIOD = 7000;
const SPEED = 0.17; // px per ms
const HEAD = 64; // the head's height (StartPanel.astro .start__head), its tip at the bottom
const LAG = 1400; // the Wisers line's light, after the AI Simply line's

const html = document.documentElement;
const panel = document.querySelector<HTMLElement>('[data-origins]');
const list = panel?.querySelector<HTMLElement>('ol');

if (panel && list && html.classList.contains('js-ignite')) {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  const trains = Array.from(panel.querySelectorAll<HTMLElement>('[data-train]'));
  let timer = 0;
  let isDrawn = false;
  let onScreen = false;
  let running: Animation[] = [];

  const stopTrains = () => {
    running.forEach((a) => a.cancel());
    running = [];
  };
  const playOrPause = () => {
    const go = onScreen && !document.hidden;
    running.forEach((a) => (go ? a.play() : a.pause()));
  };
  const runTrains = () => {
    stopTrains();
    if (!isDrawn || reduce.matches || !('animate' in Element.prototype)) return;
    const top = list.getBoundingClientRect().top;
    trains.forEach((train, k) => {
      const head = train.firstElementChild as HTMLElement | null;
      const stops = Array.from(list.querySelectorAll<HTMLElement>(`.start__stop--${train.dataset.train}`));
      if (!head || stops.length < 2) return train.removeAttribute('style');
      const ys = stops.map((s) => {
        const r = s.getBoundingClientRect();
        return r.top + r.height / 2 - top;
      });
      const len = ys[ys.length - 1] - ys[0];
      train.style.top = `${ys[0]}px`;
      train.style.height = `${len}px`;
      // The head runs from just above the first stop until its tip is at the last, then waits.
      const end = (len + HEAD) / SPEED / PERIOD;
      const timing: KeyframeAnimationOptions = { duration: PERIOD, iterations: Infinity, delay: k * LAG };
      running.push(
        head.animate(
          [
            { transform: `translateY(${-HEAD}px)`, offset: 0 },
            { transform: `translateY(${len}px)`, offset: end },
            { transform: `translateY(${len}px)`, offset: 1 },
          ],
          timing,
        ),
      );
      ys.forEach((y, i) => {
        // The tip reaches this stop when the head has gone HEAD + (y - first) of its HEAD + len.
        const at = ((y - ys[0] + HEAD) / (len + HEAD)) * end;
        const peak = Math.min(at + 0.012, 0.98);
        running.push(
          stops[i].animate(
            [
              { filter: 'brightness(1)', offset: 0 },
              { filter: 'brightness(1)', offset: at },
              { filter: 'brightness(2.2)', offset: peak },
              { filter: 'brightness(1)', offset: Math.min(peak + 0.08, 0.99) },
              { filter: 'brightness(1)', offset: 1 },
            ],
            timing,
          ),
        );
      });
    });
    playOrPause();
  };

  const drawn = () => {
    window.clearTimeout(timer);
    panel.classList.remove('is-drawing');
    panel.classList.add('is-drawn');
    isDrawn = true;
    runTrains();
  };
  const draw = () => {
    if (reduce.matches) return drawn();
    panel.classList.add('is-drawing');
    // The last row's stop strikes at its row's start plus 30% of a step and takes 380 ms; the
    // first stops' ring runs 900 ms from 300 ms after they strike, well inside that.
    const step = parseFloat(getComputedStyle(panel).getPropertyValue('--step')) || 220;
    timer = window.setTimeout(drawn, (list.children.length - 1) * step + step * 0.3 + 380 + 60);
  };

  if (!('IntersectionObserver' in window)) drawn();
  else {
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.some((entry) => entry.isIntersecting)) return;
        io.disconnect();
        draw();
      },
      { rootMargin: '0px 0px -20% 0px' },
    );
    io.observe(list);
    new IntersectionObserver((entries) => {
      onScreen = entries[entries.length - 1].isIntersecting;
      playOrPause();
    }).observe(panel);
  }
  if ('ResizeObserver' in window) {
    let width = 0;
    let height = 0;
    new ResizeObserver(([entry]) => {
      const { width: w, height: h } = entry.contentRect;
      if (w === width && h === height) return;
      width = w;
      height = h;
      if (isDrawn) runTrains();
    }).observe(list);
  }
  document.addEventListener('visibilitychange', playOrPause);
  reduce.addEventListener?.('change', () => (reduce.matches ? (drawn(), stopTrains()) : runTrains()));
}
