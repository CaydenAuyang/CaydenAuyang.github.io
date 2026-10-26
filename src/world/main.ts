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

/** Whether WebGL works here. The probe's context is released at once: V4.md 8.8 allows two on the page (the world and the intro phone). */
function webglAvailable(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = (probe.getContext('webgl2') || probe.getContext('webgl')) as WebGLRenderingContext | null;
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
    return Boolean(gl);
  } catch {
    return false;
  }
}

/**
 * 4.7: the searchlight never lights or slices the figure, the archive columns or the Wisers
 * pictures. Every frame the world gets the figure's box while it shows, the columns' box while
 * any column is drawn, and the Wisers box while Wisers is on screen and a picture is drawn in it.
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
    const columns = signal?.columnsBox();
    if (columns) boxes.push(columns);
    if (wisersOn && (!signal || signal.pictureShowing())) boxes.push(wisersAt);
    world.setBeamKeepOut?.(boxes);
  });
}

async function boot() {
  const canvas = document.querySelector<HTMLCanvasElement>('[data-world]');
  const gl = Boolean(canvas) && webglAvailable();
  // Fetch the chunks all at once rather than one after another: on a cold load that chain of
  // requests held the intro back by most of a second.
  const loadTimeline = timelineModules['./timeline.ts']?.() as Promise<typeof import('./timeline')> | undefined;
  const loadWorld = gl ? (worldModules['./renderer.ts']?.() as Promise<typeof import('./renderer')> | undefined) : undefined;
  const loadSignal = gl ? (signalModules['./signal.ts']?.() as Promise<typeof import('./signal')> | undefined) : undefined;
  // Awaited later; this only stops a failed fetch being reported before then.
  loadSignal?.catch(() => {});

  const timeline = loadTimeline ? await loadTimeline : null;
  const tl = timeline?.createTimeline({ motion, snapshot });

  if (!canvas || !loadWorld) {
    html.classList.add('no-webgl');
    return;
  }

  try {
    const { createWorld } = await loadWorld;
    const world = await createWorld({ canvas, motion });
    const signal = loadSignal
      ? await (await loadSignal).createSignal({
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

// A chunk that fails to load before the world's own try (the timeline's) counts as no world too.
boot().catch((error) => {
  console.error('Night scene failed to start', error);
  html.classList.add('no-webgl');
});
