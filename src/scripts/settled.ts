// settled.ts: runs work that can wait (the print warm-ups) once the page has settled.
//
// Settled means: the page has loaded, the world is up (its first frame, html.is-ready, or
// html.no-webgl when there is none or its code failed to load, WorldBoot.astro and main.ts), its
// intro is over (done 3.4 s after that first frame) and the browser is idle. So nothing queued
// here competes with the hero or with the world's own downloads, even on a slow link, where the
// world can take 25 s or more to arrive (Slow 3G) and anything fetched before then held it back by
// seconds. A world that hangs without failing settles 60 s after load anyway.
//
// With Save-Data on, nothing runs: what the warm-ups fetch is for a print that may never come, and
// their beforeprint fallbacks still fetch it once printing starts (that print may miss it; the next
// one has it).
const html = document.documentElement;
const INTRO_MS = 4000;
const NO_WORLD_MS = 60000;

let settled: Promise<void> | null = null;

function settle(): Promise<void> {
  settled ??= new Promise((resolve) => {
    const worldUp = () => html.classList.contains('is-ready') || html.classList.contains('no-webgl');
    let started = false;
    const start = () => {
      if (started) return;
      started = true;
      observer.disconnect();
      window.setTimeout(() => {
        // A typeof test, not `in window`: TypeScript's DOM types always have it, so the other
        // branch would type window as never.
        if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(() => resolve(), { timeout: 3000 });
        else window.setTimeout(resolve, 200);
      }, INTRO_MS);
    };
    const observer = new MutationObserver(() => worldUp() && start());
    const afterLoad = () => {
      if (worldUp()) return start();
      observer.observe(html, { attributes: true, attributeFilter: ['class'] });
      window.setTimeout(start, NO_WORLD_MS);
    };
    if (document.readyState === 'complete') afterLoad();
    else window.addEventListener('load', afterLoad, { once: true });
  });
  return settled;
}

const saveData = () => (navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData === true;

/** Runs fn once the page has settled (see above); never with Save-Data on. */
export function whenSettled(fn: () => void): void {
  if (saveData()) return;
  void settle().then(fn);
}
