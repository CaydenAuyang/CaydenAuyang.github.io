// main.ts: starts the night scene once the page has painted. Owned by the lead.
//
// Base.astro imports this after first paint. It reads the visitor's motion and snapshot settings,
// starts the scroll timeline (which works on the HTML alone), then, if WebGL is available, builds
// the world and the signal and hands them to the timeline. The world and signal modules are
// loaded through import.meta.glob so the site still builds while they are being written.

import { wisersBox, type ScreenBox, type Signal, type World } from './contract';

const worldModules = import.meta.glob('./renderer.ts');
const signalModules = import.meta.glob('./signal.ts');
const timelineModules = import.meta.glob('./timeline.ts');
const interactModules = import.meta.glob('./interact.ts');

const html = document.documentElement;
const snapshot = html.hasAttribute('data-snapshot');
const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const motion = !reduced && !snapshot && html.dataset.motion !== 'off';

function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    return Boolean(probe.getContext('webgl2') || probe.getContext('webgl'));
  } catch {
    return false;
  }
}

/**
 * 4.7: the searchlight never lights or slices the figure or the Wisers pictures. Every frame the
 * world gets the figure's box while it shows and the Wisers box while Wisers is on screen.
 */
function keepBeamsOff(world: World, signal: Signal | null) {
  const wisers = document.querySelector('[data-scene="wisers"]');
  let wisersOn = false;
  if (wisers) new IntersectionObserver(([entry]) => (wisersOn = entry.isIntersecting)).observe(wisers);
  let wisersAt = wisersBox(window.innerWidth, window.innerHeight);
  window.addEventListener('resize', () => (wisersAt = wisersBox(window.innerWidth, window.innerHeight)));
  const boxes: ScreenBox[] = [];
  world.onFrame(() => {
    boxes.length = 0;
    const figure = signal?.figureBox();
    if (figure) boxes.push(figure);
    if (wisersOn) boxes.push(wisersAt);
    world.setBeamKeepOut?.(boxes);
  });
}

async function boot() {
  const loadTimeline = timelineModules['./timeline.ts'];
  const timeline = loadTimeline ? await (loadTimeline() as Promise<typeof import('./timeline')>) : null;
  const tl = timeline?.createTimeline({ motion, snapshot });

  const canvas = document.querySelector<HTMLCanvasElement>('[data-world]');
  const loadWorld = worldModules['./renderer.ts'];
  if (!canvas || !loadWorld || !webglAvailable()) {
    html.classList.add('no-webgl');
    return;
  }

  try {
    const { createWorld } = (await loadWorld()) as typeof import('./renderer');
    const world = await createWorld({ canvas, motion });
    const loadSignal = signalModules['./signal.ts'];
    const signal = loadSignal
      ? await ((await loadSignal()) as typeof import('./signal')).createSignal({
          world,
          motion,
          // The video-built figure: figure-{hi|lo|phone}.json and .bin in this folder (spec v3).
          figureUrl: '/figure',
        })
      : null;
    tl?.attach(world, signal);
    keepBeamsOff(world, signal);
    html.classList.add('is-ready');
    // Pointer, tap, drag and key interactions (never in snapshot, which is a still poster).
    const loadInteract = interactModules['./interact.ts'];
    if (loadInteract && !snapshot) {
      try {
        const { createInteractions } = (await loadInteract()) as typeof import('./interact');
        createInteractions({ world, signal, motion });
      } catch (error) {
        // The scene still works without its interactions.
        console.error('Night scene interactions failed to start', error);
      }
    }
    // ?debug exposes the scene to the test scripts (scripts/perf.mjs).
    if (new URLSearchParams(location.search).has('debug')) (window as unknown as { __night: unknown }).__night = { world, signal };
  } catch (error) {
    // Anything failing here leaves the HTML and the still fallback in place.
    console.error('Night scene failed to start', error);
    html.classList.add('no-webgl');
  }
}

boot();
