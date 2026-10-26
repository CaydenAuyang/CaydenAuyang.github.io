// timeline.ts: scroll drives the night scene. Owned by the lead.
//
// One timeline over the whole page (NIGHT-SIGNAL.md section 6). Each section (and each project
// stop inside Work) gets a ScrollTrigger; every frame we read which one the viewport's center is
// in and how far through it we are, then set the camera, the signal's morph and the project
// highlight from that. Smooth scrolling is Lenis, driven by GSAP's ticker.
//
// Every beat lives in the table below and nowhere else (V4 section 9): which element starts each
// scene, what the camera and the signal do over it, and how that changes with the layout and the
// mode (V4 8.1 and 8.2). The rest of the file only reads it.
//
// The HTML half (smooth scroll, the hero text reveals, the scroll cue, holds) starts right away in
// createTimeline(). The world half starts in attach(), once the world and signal exist.
//
// Modes:
//   - motion on: Lenis, the intro sequence, flowing camera and morphs. Sections are held still only
//     in the pin layout (layout.ts: wide and at least 600 tall), by CSS sticky frames, never by a
//     script pin. A layout change (a phone turned sideways, a window resized) rebuilds the scenes
//     without a reload.
//   - reduced motion: no Lenis, no holds (Wisers keeps whatever its CSS does), no intro; camera
//     and signal cut to each scene's key.
//   - snapshot (?snapshot): as reduced motion, and every scene shows its best frame.

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { FIGURE_ANCHOR, HERO_FRAMING, usePhoneLayout, wisersBox, type SceneKey, type Signal, type Target, type World } from './contract';
import { layoutMode, onLayoutChange, pinning, type LayoutMode } from './layout';

gsap.registerPlugin(ScrollTrigger);

type HighlightKey = 'och' | 'ais' | 'club';

interface Morph {
  from: Target;
  to: Target;
  over: [number, number];
}

/** What each scene does as you scroll through it (progress 0 to 1, from its start to the next scene's). */
interface Beat {
  /** The camera key this scene arrives at. */
  key: SceneKey;
  /** Camera moves from the previous scene's key into this one over [from, to] of the scene (a number n is [0, n]). */
  arrive: number | [number, number];
  /**
   * Signal morph shown in this scene and the share of the scene it takes; or several morphs in a
   * row (steps), holding each picture between them. Snapshot shows each step's picture finished.
   */
  morph: Morph | { hold: Target } | { steps: Morph[] };
  highlight?: HighlightKey;
  /** The highlight fades in over [0] to [1] of the scene and out over [2] to [3]. */
  light?: [number, number, number, number];
  /** Where the scene starts: when this edge of its element meets this line of the window (ScrollTrigger). */
  start?: string;
  /**
   * The picture this scene ends on leaves as the next section's first block rises toward it, never
   * later than its own morph says (figureClear and agentClear below): the hero's figure before the
   * intro module, the screen agent before SELECTED WORK. It leaves by this scene's own morph when
   * that starts from it, otherwise into the next scene's picture.
   */
  clear?: 'figure' | 'agent';
}

/** A scene's row in the table: the element it lives on, its beat, and what changes by layout or mode. */
interface Row extends Beat {
  el: string;
  /** Phones and tablets upright (V4 8.1). */
  stack?: Partial<Beat>;
  /** Phones sideways. */
  short?: Partial<Beat>;
  /** While sections are held still (the pin layout with motion on). */
  held?: Partial<Beat>;
  /** Reduced motion (not snapshot). */
  still?: Partial<Beat>;
  snapshot?: Partial<Beat>;
}

type SceneName = 'hero' | 'intro' | 'mission' | 'experience' | 'wisers' | 'wisers2024' | 'wisers2025' | 'work' | 'och' | 'ais' | 'club' | 'more' | 'contact';

/** The highlight's default fade: in from 5% to 30% of the scene, out from 75% to 97%. */
const LIGHT: [number, number, number, number] = [0.05, 0.3, 0.75, 0.97];
/** The picture each clearance takes away. */
const LEAVING: Record<NonNullable<Beat['clear']>, Target> = { figure: 'B', agent: 'G' };

const BEATS: Record<SceneName, Row> = {
  hero: { el: '[data-scene="hero"]', key: 'hero', arrive: 0, morph: { hold: 'B' }, clear: 'figure' },
  // The intro module (V4 sections 2 and 6), on the G floor. The camera holds on the hero view and
  // the figure goes back into the city before the module's words come up (the figure's clearance),
  // so the card and the logos sit on dark sky over the city band, the way the hero text does.
  // (Kept at the Mission view instead, the skyline sat behind the card and the landed current
  // under the logo strip.) Its CSS holds it still for 40vh in the pin layout, so the phone unfolds
  // in view.
  intro: { el: '[data-scene="intro"]', key: 'hero', arrive: 0, morph: { from: 'B', to: 'A', over: [0, 0.5] }, clear: 'figure' },
  // The Mission: the city's light gathers into the current over the water while the camera dollies
  // forward and down to it. Held (wide) and on short, the scene starts as the Mission enters the
  // window (held, as the intro module lets go), so the camera arrives with the current, whole by
  // the time the panel's top is a third of the way down the window (where the Mission link lands
  // it), as before v4; the gather waits for the module's words to rise clear of the water. On
  // stack the dolly starts as the Mission enters the window too, so it keeps the length it had
  // before v4 (about 120vh at 390 x 844), and the current gathers in its second half. Snapshot
  // cuts to the Mission view as the scene starts, so it starts at the middle of the window in every
  // layout, once the module's words and logos are above that view's skyline.
  mission: {
    el: '[data-scene="question"]',
    key: 'question',
    arrive: 0.62,
    morph: { from: 'A', to: 'C', over: [0.05, 0.62] },
    stack: { start: 'top bottom', arrive: 0.95, morph: { from: 'A', to: 'C', over: [0.35, 0.95] } },
    short: { start: 'top bottom', arrive: 0.5, morph: { from: 'A', to: 'C', over: [0.15, 0.5] } },
    held: { start: 'top bottom', arrive: [0.1, 0.58], morph: { from: 'A', to: 'C', over: [0.22, 0.58] } },
    snapshot: { start: 'top center' },
  },
  // The twelve columns are whole by the time EXPERIENCE nears the top of the window (V4 section 1),
  // and the camera has arrived with them, so they stand still while Civic Exchange is held (pin
  // layout) or read. On stack and short (V4 8.2) the columns form over the first 20% (the half
  // screen of sky above EXPERIENCE there) and the camera arrives soon after, before the four facts
  // scroll in; the scene starts as Experience is a quarter of the way up the window, which gives
  // the turn at least the scroll it had before. Reduced motion cuts the current back into the city
  // as soon as Experience enters the window, so the Civic Exchange header never rises through the
  // current, which sat right behind its meta lines, and cuts in the columns once the Mission panel
  // has gone up past their tops (columnsClear() below), so they never stand behind its glass.
  experience: {
    el: '[data-scene="experience"]',
    key: 'experience',
    arrive: 0.25,
    morph: { from: 'C', to: 'D', over: [0, 0.25] },
    stack: { start: 'top 75%', arrive: 0.38, morph: { from: 'C', to: 'D', over: [0, 0.2] } },
    short: { start: 'top 75%', arrive: 0.33, morph: { from: 'C', to: 'D', over: [0, 0.2] } },
    still: { start: 'top 90%' },
  },
  // Wisers held on screen (its frame is a CSS sticky frame): the columns become the 2024 feed, the
  // feed folds into the shoe, then the shoe becomes the 2025 screen agent, each picture held a
  // while before the next (V4 section 1). The feed starts once the Wisers frame is held. Summer
  // 2024 is the highlighted line until the middle of the last morph, Summer 2025 after it.
  wisers: {
    el: '[data-scene="wisers"]',
    start: 'top top',
    key: 'wisers',
    arrive: 0.3,
    morph: {
      steps: [
        { from: 'D', to: 'F1', over: [0.08, 0.2] },
        { from: 'F1', to: 'F2', over: [0.32, 0.46] },
        { from: 'F2', to: 'G', over: [0.6, 0.72] },
      ],
    },
    clear: 'agent',
  },
  // Wisers not held (V4 8.2: stack, short, and wherever its frame scrolls): each picture holds while
  // its summer's line is being read. The feed draws as the 2024 line comes up into the window and
  // folds into the shoe while it is read; the screen agent takes over as the 2025 line is a quarter
  // of the way up, and holds until SELECTED WORK comes up behind it (at 390 x 844 each morph takes
  // about 130px and the screen agent holds about 200px).
  wisers2024: {
    el: '[data-scene="wisers"] [data-summer="2024"]',
    start: 'top bottom',
    key: 'wisers',
    arrive: 0.4,
    morph: {
      steps: [
        { from: 'D', to: 'F1', over: [0, 0.33] },
        { from: 'F1', to: 'F2', over: [0.5, 0.83] },
      ],
    },
  },
  wisers2025: {
    el: '[data-scene="wisers"] [data-summer="2025"]',
    start: 'top 75%',
    key: 'wisers',
    arrive: 0,
    morph: { from: 'F2', to: 'G', over: [0, 0.35] },
    clear: 'agent',
  },
  // The top of Work (its headline, before the first project): the camera travels to the first stop
  // while the screen agent dissolves back into the city, gone before OurCityHealth's text arrives.
  // On stack and short the headline sits closer to the first project, so the turn starts as the
  // section is a quarter of the way up the window, which keeps it at least as long as before.
  work: {
    el: '[data-scene="work"]',
    key: 'och',
    arrive: 1,
    morph: { from: 'G', to: 'A', over: [0, 0.8] },
    clear: 'agent',
    stack: { start: 'top 75%' },
    short: { start: 'top 75%' },
  },
  // The project stops. Each starts when its top reaches the top of the window, so the top of Work
  // gets real scroll length on phones too; the next two start a little earlier (35%) where nothing
  // is held, so the city never shows the last project under the next video. Held (a 150vh track
  // whose one-screen frame stays still for 50vh, step 6), the next two start as their frame enters
  // the window: the camera travels while one frame leaves and the next comes in (100vh, 2/3 of the
  // stop), and stands still with the project's highlight on for the hold.
  och: { el: '[data-stop="och"]', start: 'top top', key: 'och', arrive: 0, morph: { hold: 'A' }, highlight: 'och', held: { light: [0, 0.2, 0.8, 1] } },
  ais: {
    el: '[data-stop="ais"]',
    start: 'top 35%',
    key: 'ais',
    arrive: 0.45,
    morph: { hold: 'A' },
    highlight: 'ais',
    held: { start: 'top bottom', arrive: 0.67, light: [0.3, 0.6, 0.9, 1] },
  },
  club: {
    el: '[data-stop="club"]',
    start: 'top 35%',
    key: 'club',
    arrive: 0.45,
    morph: { hold: 'A' },
    highlight: 'club',
    held: { start: 'top bottom', arrive: 0.67, light: [0.3, 0.6, 0.9, 1] },
  },
  // More work: held, it starts as Civic AI Club's hold ends, so that stop is 150vh like the others.
  // On stack and short the cards are closer to Contact, so the camera takes more of the scene.
  more: {
    el: '[data-stop="more"]',
    key: 'more',
    arrive: 0.7,
    morph: { hold: 'A' },
    held: { start: 'top bottom' },
    stack: { arrive: 0.75 },
    short: { arrive: 0.9 },
  },
  // Straight from Work to Contact (V4 section 2): Contact starts as it enters the window, after the
  // open sky below More work. The city's lights gather into the two lights while the camera rises
  // after them: the camera starts just before the gather, so the light visibly leaves the city
  // before the tilt takes the city out of frame. The harbour light show runs while Contact is the
  // current scene (spec v3, 11b.9). Snapshot freezes More work on the city and Contact on the two
  // lights, and its screens follow straight on, so Contact starts at the middle of the window there.
  contact: {
    el: '[data-scene="contact"]',
    start: 'top bottom',
    key: 'contact',
    arrive: [0.3, 0.85],
    morph: { from: 'A', to: 'E', over: [0.35, 0.9] },
    snapshot: { start: 'top center' },
  },
};

/** How the page is laid out right now: the layout, and whether sections are held still. */
interface Mode {
  layout: LayoutMode;
  /** The pin layout (wide, at least 600 tall), whatever the motion setting. */
  pin: boolean;
  /** Sections held still: the pin layout with motion on. */
  held: boolean;
  still: boolean;
  snapshot: boolean;
}

/** A beat as a scene uses it: its start resolved, and its camera arrival as [from, to]. */
type SceneBeat = Beat & { start: string; arrive: [number, number] };

/** A row's beat for a mode: the row, then its layout's changes, then the held, still or snapshot ones. */
function beatFor(row: Row, mode: Mode): SceneBeat {
  const layout = mode.layout === 'stack' ? row.stack : mode.layout === 'short' ? row.short : undefined;
  const beat = {
    start: 'top center',
    ...row,
    ...layout,
    ...(mode.held ? row.held : undefined),
    ...(mode.still ? row.still : undefined),
    ...(mode.snapshot ? row.snapshot : undefined),
  };
  return { ...beat, arrive: typeof beat.arrive === 'number' ? [0, beat.arrive] : beat.arrive };
}

interface Scene {
  name: SceneName;
  beat: SceneBeat;
  el: HTMLElement;
}

/**
 * The scenes in page order. Wisers is one scene while its frame is held and one per summer line
 * while it scrolls (the CSS decides which: a sticky frame holds).
 */
function sceneList(mode: Mode): Scene[] {
  const wisers = document.querySelector<HTMLElement>(BEATS.wisers.el);
  const frame = wisers?.querySelector<HTMLElement>('.wisers__frame') ?? (wisers?.firstElementChild as HTMLElement | null) ?? null;
  const wisersHeld = !!frame && getComputedStyle(frame).position === 'sticky';
  const names: SceneName[] = ['hero', 'intro', 'mission', 'experience'];
  names.push(...(wisersHeld ? (['wisers'] as const) : (['wisers2024', 'wisers2025'] as const)));
  names.push('work', 'och', 'ais', 'club', 'more', 'contact');
  const out: Scene[] = [];
  for (const name of names) {
    const el = document.querySelector<HTMLElement>(BEATS[name].el);
    if (el) out.push({ name, el, beat: beatFor(BEATS[name], mode) });
  }
  return out;
}

const easeInOut = gsap.parseEase('power2.inOut');
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (v: number, a: number, b: number) => clamp01((v - a) / Math.max(1e-6, b - a));
/** 0 at the edges of a scene, 1 through its middle: highlights fade in and out. */
const plateau = (p: number, [a, b, c, d]: [number, number, number, number]) => Math.min(span(p, a, b), 1 - span(p, c, d));

/**
 * An element's top on the page as the flow puts it. Inside a sticky frame (a held section) that is
 * where the frame sits before it sticks, not where it is held right now, as ScrollTrigger measures
 * its own pinned elements.
 */
function pageTop(el: HTMLElement): number {
  let frame: HTMLElement | null = null;
  for (let a: HTMLElement | null = el; a && a !== document.body; a = a.parentElement) {
    if (getComputedStyle(a).position === 'sticky') frame = a;
  }
  if (!frame) return el.getBoundingClientRect().top + window.scrollY;
  const was = frame.style.position;
  frame.style.position = 'relative';
  const top = el.getBoundingClientRect().top + window.scrollY;
  frame.style.position = was;
  return top;
}

/**
 * The world canvas's size in CSS px. The pictures' screen anchors are shares of the canvas, which
 * is 100lvh tall: on a phone with its toolbar showing it runs below the window.
 */
function view(): { width: number; height: number } {
  const canvas = document.querySelector<HTMLElement>('[data-world]');
  return { width: canvas?.clientWidth || window.innerWidth, height: canvas?.clientHeight || window.innerHeight };
}

export interface TimelineOptions {
  motion: boolean;
  snapshot: boolean;
}

export interface Timeline {
  attach(world: World, signal: Signal | null): void;
}

export function createTimeline({ motion, snapshot }: TimelineOptions): Timeline {
  const html = document.documentElement;
  const modeNow = (): Mode => {
    const pin = pinning();
    return { layout: layoutMode(), pin, held: motion && !snapshot && pin, still: !motion && !snapshot, snapshot };
  };
  let mode = modeNow();

  // ---- Smooth scroll (motion only) ----
  // On touch, ScrollTrigger ignores the height-only resizes of the browser toolbar (its default,
  // ignoreMobileResize), so the triggers don't move while the toolbar comes and goes.
  let lenis: Lenis | null = null;
  if (motion) {
    lenis = new Lenis({ autoRaf: false, anchors: true });
    lenis.on('scroll', ScrollTrigger.update);
    gsap.ticker.add((time) => lenis?.raf(time * 1000));
    gsap.ticker.lagSmoothing(0);
    window.addEventListener('world:scroll-lock', (event) => {
      const locked = (event as CustomEvent<{ locked: boolean }>).detail?.locked;
      if (locked) lenis?.stop();
      else lenis?.start();
    });
  }

  // ---- Hero text reveals and the scroll cue ----
  // The text wipes in at 600, 950 and 1,150 ms on the same clock as the sky and the windows: it
  // starts when the world attaches, or after 1.2 s if the world isn't coming (no WebGL, slow load).
  const introEls = (['name', 'line', 'small'] as const).map((k) => document.querySelector<HTMLElement>(`[data-intro="${k}"]`));
  const introTimers: number[] = [];
  let textStarted = false;
  const startText = () => {
    if (textStarted) return;
    textStarted = true;
    [600, 950, 1150].forEach((ms, i) => introTimers.push(window.setTimeout(() => introEls[i]?.classList.add('is-in'), ms)));
  };
  const revealAll = () => {
    textStarted = true;
    introTimers.forEach((t) => window.clearTimeout(t));
    introEls.forEach((el) => el?.classList.add('is-in'));
  };
  if (html.classList.contains('js-intro')) {
    introTimers.push(window.setTimeout(startText, 1200));
  } else {
    revealAll();
  }

  const cue = document.querySelector<HTMLElement>('[data-scroll-cue]');
  let introSkipped = false;
  const listeners: (() => void)[] = [];
  const onFirstInput = () => {
    cue?.classList.add('is-gone');
    if (!introSkipped) {
      introSkipped = true;
      // Skipping means the end state now: the text snaps open instead of finishing its wipe.
      introEls.forEach((el) => {
        if (!el) return;
        el.style.transition = 'none';
        el.style.animation = 'none';
      });
      revealAll();
      listeners.forEach((fn) => fn());
    }
  };
  window.addEventListener('scroll', onFirstInput, { once: true, passive: true });
  window.addEventListener('wheel', onFirstInput, { once: true, passive: true });
  window.addEventListener('touchmove', onFirstInput, { once: true, passive: true });
  window.addEventListener('keydown', onFirstInput, { once: true });

  // ---- Scenes, holds and progress ----
  let scenes: Scene[] = [];
  let triggers: ScrollTrigger[] = [];
  /** Where a few scenes are in `scenes` (-1: not on the page), set by build(). */
  let civicIndex = -1;
  let wisersIndex = -1;
  /** The scene and share of it from which the screen agent (2025) is the picture. */
  let agentFrom = { index: -1, p: 0 };

  /**
   * Whether a project's content fits its one-screen frame. Measured from the frame's visible
   * children rather than scrollHeight, which also counts the text scrim's oversized glow.
   */
  function frameFits(frame: HTMLElement): boolean {
    const top = frame.getBoundingClientRect().top;
    const padBottom = parseFloat(getComputedStyle(frame).paddingBottom) || 0;
    let bottom = 0;
    for (const child of Array.from(frame.children)) {
      const r = child.getBoundingClientRect();
      if (r.height > 0) bottom = Math.max(bottom, r.bottom - top);
    }
    return bottom + padBottom <= window.innerHeight + 1;
  }

  /**
   * Civic Exchange's hold (Experience.astro): a sticky frame (.xp__wrap) in a taller track
   * (.xp__track), in CSS in the pin layout with motion. Like a project's, it lets go (.is-tall) while
   * an open More panel makes the block taller than the window, and takes hold again once it fits.
   * Either change moves the block on the page, so the scroll moves with it and the reader keeps
   * their place: the block stays put while it is on screen, and what follows it once it has gone
   * by. Let go, the block keeps the place it had in the frame (--civic-top), so a reader inside
   * the hold stays inside the experience scene's hold too, with the columns whole and still.
   * Opening More lets go at the click, before the panel grows, so it opens downward in the flow
   * instead of spreading both ways inside the frame.
   */
  const civicTrack = document.querySelector<HTMLElement>('.xp__track');
  const civicFrame = civicTrack?.querySelector<HTMLElement>('.xp__wrap') ?? null;
  const civicBlock = civicFrame?.querySelector<HTMLElement>('.xp__block') ?? null;
  function holdCivic(tall: boolean) {
    if (!civicTrack || !civicFrame || !civicBlock || civicTrack.classList.contains('is-tall') === tall) return;
    const box = civicBlock.getBoundingClientRect();
    if (tall) {
      // Never above the frame's own padding (a block taller than its frame overflows it upward).
      const offset = Math.max(parseFloat(getComputedStyle(civicFrame).paddingTop) || 0, box.top - civicFrame.getBoundingClientRect().top);
      civicTrack.style.setProperty('--civic-top', `${Math.round(offset)}px`);
    }
    const anchor = box.bottom > 0 && box.top < window.innerHeight ? civicBlock : box.bottom <= 0 ? (civicTrack.nextElementSibling as HTMLElement | null) : null;
    const before = anchor?.getBoundingClientRect().top ?? 0;
    civicTrack.classList.toggle('is-tall', tall);
    if (!anchor) return;
    let shift = anchor.getBoundingClientRect().top - before;
    if (Math.abs(shift) < 1) return;
    if (anchor === civicBlock && !tall) {
      // Held again, the block only moves with the page while its frame isn't stuck, so the frame
      // goes where the block is back at `before`: still coming in (block at or below its place in
      // the frame), or already going out, its bottom on the track's (block above its place).
      const track = civicTrack.getBoundingClientRect();
      const frame = civicFrame.getBoundingClientRect();
      const want = before - (civicBlock.getBoundingClientRect().top - frame.top);
      shift = track.top - (want >= 0 ? want : want - (track.height - frame.height));
    }
    const y = window.scrollY + shift;
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true });
    else window.scrollTo(0, y);
  }
  if (civicFrame) {
    document.addEventListener(
      'click',
      (event) => {
        if (!mode.held) return;
        const btn = (event.target as Element | null)?.closest?.('.xp__more [data-more-btn]');
        if (btn && btn.getAttribute('aria-expanded') !== 'true') holdCivic(true);
      },
      true,
    );
  }

  /**
   * The experience scene's length with Civic Exchange's More shut. The columns' morph and the
   * camera's arrival are shares of the scene, and an open panel makes the scene longer (it opens
   * inside it, and when held the hold lets go), so measured as is they would slide back under the
   * reader who opened it. While the panel is open the scene keeps the length it had shut at this
   * window size (after a resize, its length less the panel's height). Snapshot's layout has every
   * panel open.
   */
  const civicPanel = civicTrack?.querySelector<HTMLElement>('[data-more-panel]') ?? null;
  let civicLength = 0;
  let civicSize = '';
  ScrollTrigger.addEventListener('refresh', () => {
    const st = triggers[civicIndex];
    const next = triggers[civicIndex + 1];
    if (!st || !next) return;
    const size = `${window.innerWidth}x${window.innerHeight}:${mode.layout}`;
    const open = !snapshot && !!civicPanel?.hasAttribute('data-open');
    if (open && size === civicSize) return;
    civicLength = next.start - st.start - (open && civicPanel ? civicPanel.offsetHeight : 0);
    civicSize = size;
  });

  /** One trigger per scene, in page order, each starting where its beat says (the table above). */
  function build() {
    triggers.forEach((st) => st.kill(true));
    // Outside the pin layout nothing is held: no project or Civic Exchange frame is let go either.
    if (!mode.held) {
      civicTrack?.classList.remove('is-tall');
      document.querySelectorAll('[data-pin].is-tall').forEach((el) => el.classList.remove('is-tall'));
    }
    if (mode.held && civicFrame) holdCivic(!frameFits(civicFrame));
    scenes = sceneList(mode);
    civicIndex = scenes.findIndex((sc) => sc.name === 'experience');
    wisersIndex = scenes.findIndex((sc) => sc.name === 'wisers' || sc.name === 'wisers2024');
    agentFrom = { index: -1, p: 0 };
    scenes.forEach((sc, i) => {
      if (agentFrom.index >= 0) return;
      const m = sc.beat.morph;
      const steps = 'steps' in m ? m.steps : 'over' in m ? [m] : [];
      const g = steps.find((st) => st.to === 'G');
      // From the middle of the morph into it (snapshot: the scene's second screen, or its start).
      if (g) agentFrom = { index: i, p: snapshot ? ('steps' in m ? 0.5 : 0) : (g.over[0] + g.over[1]) / 2 };
    });
    triggers = scenes.map(({ el, beat }) => {
      if (el.hasAttribute('data-pin')) {
        // Held: the CSS holds each project's frame still for 50vh (a sticky frame in a 150vh track),
        // so nothing is pinned by script. If an open More panel makes the frame taller than the
        // window, .is-tall lets that project scroll normally instead.
        el.classList.remove('is-tall');
        const frame = el.querySelector<HTMLElement>('.stop__grid');
        if (mode.held && frame && !frameFits(frame)) el.classList.add('is-tall');
      }
      // A held section's progress runs to its bottom reaching the window's bottom (only Contact's
      // end is read; the rest end where the next scene starts).
      return ScrollTrigger.create({ trigger: el, start: beat.start, end: beat.start === 'top top' || beat.start === 'top bottom' ? 'bottom bottom' : 'bottom center' });
    });
    ScrollTrigger.refresh();
  }
  build();

  // A More toggle changes a section's height: rebuild the triggers from scratch.
  window.addEventListener('world:layout', build);
  // A new layout (a phone turned sideways, a window crossing a breakpoint) changes which sections
  // are held and where the scenes start: rebuild, once the new layout's CSS applies.
  onLayoutChange(() => {
    const next = modeNow();
    if (next.layout === mode.layout && next.pin === mode.pin) return;
    mode = next;
    build();
  });
  // A resize, or the web font arriving, can change whether Civic Exchange fits its frame.
  if (civicTrack && civicFrame) {
    let timer = 0;
    const recheck = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (!mode.held || civicTrack.classList.contains('is-tall') !== frameFits(civicFrame)) return;
        build();
      }, 200);
    };
    window.addEventListener('resize', recheck);
    document.fonts?.ready.then(recheck);
  }

  // Wisers: which summer's line is highlighted, in step with the pictures (the page styles
  // [data-beat]): 2025 from the middle of the shoe-to-screen morph, where the picture becomes the
  // screen agent (snapshot: from its second screen). Runs without WebGL.
  const wisersEl = document.querySelector<HTMLElement>(BEATS.wisers.el);
  const markWisers = () => {
    if (!wisersEl || wisersIndex < 0) return;
    const { index, p } = current();
    const beat = index < agentFrom.index || (index === agentFrom.index && p < agentFrom.p) ? '2024' : '2025';
    if (wisersEl.dataset.beat !== beat) wisersEl.dataset.beat = beat;
  };
  if (wisersEl) {
    let queued = false;
    const queue = () => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => {
        queued = false;
        markWisers();
      });
    };
    window.addEventListener('scroll', queue, { passive: true });
    window.addEventListener('world:layout', queue);
    ScrollTrigger.addEventListener('refresh', queue);
    markWisers();
  }

  // In the stack layout the hero text sits under the figure, so it fades out as it scrolls up
  // toward it, gone by the time the top of the text's box reaches the drawn figure's bottom edge
  // (the glyphs start lower still, so they never touch it while visible). Snapshot too, between
  // its poster frames.
  const heroText = document.querySelector<HTMLElement>('.hero__text');
  const heroFigure = document.querySelector<HTMLElement>('.hero__figure');
  const heroSection = document.querySelector<HTMLElement>(BEATS.hero.el);
  /** The drawn figure's bottom edge in viewport px, once the signal is attached (null: not showing). */
  let figureBottom: (() => number | null) | null = null;
  if (heroText && heroFigure && heroSection) {
    let textTop = 0;
    let boxBottom = 0;
    const measure = () => {
      textTop = heroText.getBoundingClientRect().top + window.scrollY;
      boxBottom = heroFigure.getBoundingClientRect().bottom + window.scrollY;
    };
    measure();
    const fade = (self: ScrollTrigger) => {
      if (mode.layout !== 'stack') {
        heroText.style.opacity = '';
        return;
      }
      const distance = Math.max(24, textTop - (figureBottom?.() ?? boxBottom));
      heroText.style.opacity = String((1 - clamp01((self.scroll() - self.start) / distance)) ** 2);
    };
    ScrollTrigger.create({
      trigger: heroSection,
      start: 'top top',
      end: '+=400',
      // Also on a refresh: a print laid out at a portrait page width switches to the stack layout
      // and back, and the text stayed faded on screen until the next scroll.
      onRefresh: (self) => {
        measure();
        fade(self);
      },
      onUpdate: fade,
    });
  }

  /**
   * Titles and the intro module never cross a drawn picture (spec section 3, V4 section 6). The
   * figure and the screen agent sit where the next section's first block arrives (the intro
   * module, SELECTED WORK), so they leave over a stretch of scroll measured from that block rather
   * than from the scene, and their morphs are always at least this far along. Reduced motion and
   * snapshot cut the picture late in the stretch (CLEAR_CUT), the camera with it where the next
   * scene has its own view. Selectors are tried in order and the first that matches anything
   * counts, the topmost of its matches; with none on the page, the scene's own morph takes the
   * picture away. Blocks are measured where the flow puts them (pageTop()).
   */
  const CLEAR_GAP = 24;
  const CLEAR_CUT = 0.9;
  const matching = (selectors: string[]) => selectors.map((s) => Array.from(document.querySelectorAll<HTMLElement>(s))).find((list) => list.length > 0) ?? [];
  const topOf = (blocks: HTMLElement[]) => Math.min(...blocks.map(pageTop));
  const anchorBottom = () => {
    const { width, height } = view();
    const a = usePhoneLayout(width, height) ? FIGURE_ANCHOR.phone : FIGURE_ANCHOR.desktop;
    return a.y + a.height / 2;
  };

  /** The screen agent leaves from SELECTED WORK entering the window to its reaching the agent's bottom edge, less a gap (G into A). */
  const agentClear = (() => {
    let found = false;
    let from = 0;
    let to = 1;
    const measure = () => {
      const blocks = matching(['#work-title']);
      found = blocks.length > 0;
      if (!found) return;
      const top = topOf(blocks);
      const { width, height } = view();
      from = top - window.innerHeight;
      to = Math.max(from + 1, top - wisersBox(width, height).y1 * height - CLEAR_GAP);
    };
    measure();
    ScrollTrigger.addEventListener('refresh', measure);
    return (y: number) => (found ? span(y, from, to) : 0);
  })();

  /**
   * The figure goes back into the city before the intro module arrives (B into A). Its points
   * stream down from the figure to the windows along the bottom of the hero view, through the
   * part of the window the module rises into, so the module's words are still below that view's
   * waterline when the last of them land (measured: while they streamed through the card, its
   * lines fell to 1.1:1). Before then the figure itself is gone (half way through its morph) by
   * the time the module's phone or card reaches its bottom edge. The dissolve takes up to
   * FIGURE_LEAVE of a window height of scroll, as much as the page leaves room for (on desktop it
   * starts with the first scroll); in the stack layout it waits for the hero text under the figure
   * to fade, so the points never stream through the name.
   */
  const FIGURE_LEAVE = 0.6;
  /** Room between the waterline and the words' first line when the last point lands. */
  const LAND_GAP = 8;
  const figureClear = (() => {
    // Without the module, the Mission's title (or its panel) is the first block it must clear.
    const words = ['[data-scene="intro"] [data-card] > *, [data-scene="intro"] [data-logos] p', '#mission-title', '#mission-panel'];
    const blocks = ['[data-scene="intro"] [data-phone], [data-scene="intro"] [data-intro-phone], [data-scene="intro"] [data-card]', '#mission-title', '#mission-panel'];
    let found = false;
    let from = 0;
    let to = 1;
    let stack = false;
    // With motion the leave is eased over its stretch (s). Beside the hero text (wide, short) it
    // eases in: the shoulders, which leave first, barely move while the text is still low enough
    // to be in their way down, and the figure holds longer before it breaks up. On stack the name
    // has faded before it starts and the module's phone rises under it, so it eases out: most of
    // the stream is down before the phone opens, which unfolds over clear sky.
    const ease = (s: number) => (!motion ? s : stack ? 1 - (1 - s) * (1 - s) : s * s);
    /** The share of the stretch at which the morph is half done (the figure is gone). */
    const goneAt = () => (!motion ? 1 : stack ? 1 - Math.SQRT1_2 : Math.SQRT1_2);
    const measure = () => {
      const text = matching(words);
      const any = matching(blocks);
      found = text.length > 0 && any.length > 0;
      if (!found) return;
      const { width, height: H } = view();
      const phone = usePhoneLayout(width, H);
      const waterline = (phone ? HERO_FRAMING.phone : HERO_FRAMING.desktop).horizon;
      const landed = topOf(text) - waterline * H - LAND_GAP;
      const gone = topOf(any) - anchorBottom() * H - CLEAR_GAP;
      const heroText = document.querySelector<HTMLElement>('.hero__text');
      stack = mode.layout === 'stack';
      const after = stack && heroText ? Math.max(0, pageTop(heroText) - anchorBottom() * H) : 0;
      from = Math.max(after, landed - FIGURE_LEAVE * H);
      // Gone (t 0.5) at `gone` at the latest. Cut (reduced motion, snapshot), nothing streams
      // anywhere: it only has to be gone.
      to = Math.max(from + 1, Math.min(landed, from + (gone - from) / goneAt()));
    };
    measure();
    ScrollTrigger.addEventListener('refresh', measure);
    return (y: number) => (found ? ease(span(y, from, to)) : 0);
  })();
  const clearances = { figure: figureClear, agent: agentClear };

  /**
   * The scene the viewport is in (the last one whose start we have passed) and how far through it
   * we are, measured from its start to the next scene's start (the last scene uses its own end).
   */
  function current(): { index: number; p: number; y: number } {
    // Lenis's animated position is fractional, so morphs glide smoothly to rest instead of
    // stepping one whole pixel at a time at the end of a smooth scroll.
    const y = lenis ? lenis.animatedScroll : window.scrollY;
    let index = 0;
    triggers.forEach((st, i) => {
      if (y >= st.start - 1) index = i;
    });
    const st = triggers[index];
    if (!st) return { index: 0, p: 0, y };
    const next = triggers[index + 1];
    // The last scene (Contact) runs to the bottom of the page, so its morph can complete.
    let end = next ? next.start : Math.max(st.start + 1, ScrollTrigger.maxScroll(window));
    // Civic Exchange's open More doesn't stretch the experience scene (see civicLength).
    if (index === civicIndex && civicLength > 0) end = Math.min(end, st.start + civicLength);
    return { index, p: clamp01((y - st.start) / Math.max(1, end - st.start)), y };
  }

  // ---- World half ----
  function attach(world: World, signal: Signal | null) {
    figureBottom = () => {
      const box = signal?.figureBox();
      return box ? box.y1 * view().height : null;
    };
    const keys = world.cameraKeys;
    const cutting = !motion; // reduced motion and snapshot cut to keys
    const missionPanel = document.querySelector<HTMLElement>('#mission-panel');
    /** Reduced motion: whether the Mission panel is up past the columns' tops, from the camera as it is now. */
    const columnsClear = () => {
      const box = signal?.columnsBox(true);
      return !missionPanel || !box || missionPanel.getBoundingClientRect().bottom + CLEAR_GAP <= box.y0 * view().height;
    };

    if (!motion) {
      world.setMotion(false);
      world.setFrozen(true);
    }

    // Intro: sky, windows waking, then a tenth of the lit windows streaming up into the figure.
    const intro = { sky: motion ? 0 : 1, wake: motion ? 0 : 1, lift: motion ? 0 : 1 };
    let introRunning = motion && !introSkipped && window.scrollY < 4;
    const introTl = gsap.timeline({ paused: true, onComplete: () => (introRunning = false) });
    introTl
      .to(intro, { sky: 1, duration: 0.7, ease: 'none' }, 0)
      .to(intro, { wake: 1, duration: 1.6, ease: 'power2.inOut' }, 0.3)
      .to(intro, { lift: 1, duration: 1.8, ease: 'power2.inOut' }, 1.6); // done by 3.4 s
    const finishIntro = () => {
      introTl.progress(1);
      introRunning = false;
    };
    if (introRunning) {
      startText();
      introTl.play();
    } else {
      finishIntro();
      revealAll();
    }
    listeners.push(finishIntro);

    let lightsOn = false;

    function apply() {
      const { index, p, y } = current();
      const scene = scenes[index];
      if (!scene) return;
      const { name, beat } = scene;

      // The harbour light show runs while Contact is the current scene (spec v3, 11b.9); the
      // world fades it in and out and holds it still with motion off.
      const show = name === 'contact';
      if (show !== lightsOn) {
        lightsOn = show;
        world.lightShow?.(show);
      }
      let fromKey = index > 0 ? scenes[index - 1].beat.key : beat.key;
      let toKey = beat.key;
      // The picture this scene ends on, and where it goes as it clears the next block's way.
      const next = scenes[index + 1]?.beat;
      const leaveTo = next && 'to' in next.morph ? next.morph.to : null;
      const along = beat.clear ? clearances[beat.clear](y) : 0;
      const clear = cutting ? (along >= CLEAR_CUT ? 1 : 0) : along;

      // Camera: arrive at this scene's key over its share of the scene, eased once (camera-path.ts
      // doesn't ease again).
      const [a0, a1] = beat.arrive;
      let a = a1 > 0 ? span(p, a0, a1) : 1;
      if (cutting) {
        // Cut the camera with the picture: at the first morph's midpoint, where the signal cuts, so
        // there's never a stretch with neither picture in frame. Where the picture leaves by
        // clearance into a new view (the screen agent into the top of Work), the camera cuts with it,
        // even before that next scene starts.
        const first = 'over' in beat.morph ? beat.morph : 'steps' in beat.morph ? beat.morph.steps[0] : null;
        const cutAt = first ? (first.over[0] + first.over[1]) / 2 : (a0 + a1) / 2;
        a = snapshot || p >= cutAt || name === 'experience' ? 1 : 0;
        const ownLeave = 'over' in beat.morph && !!beat.clear && beat.morph.from === LEAVING[beat.clear];
        if (ownLeave && beat.key !== fromKey) a = snapshot || clear === 1 ? 1 : 0;
        if (!ownLeave && clear === 1 && next && next.key !== beat.key) {
          fromKey = beat.key;
          toKey = next.key;
          a = 1;
        }
      }
      world.setCameraProgress(lerp(keys[fromKey], keys[toKey], easeInOut(a)));

      // Highlight for the project stops.
      const strength = beat.highlight ? (snapshot ? 1 : plateau(p, beat.light ?? LIGHT)) : 0;
      world.setHighlight(beat.highlight ?? null, strength);

      if (introRunning && name === 'hero') {
        world.setIntro({ sky: intro.sky, wake: intro.wake });
        signal?.setMorph('A', 'B', intro.lift);
        return;
      }
      world.setIntro({ sky: 1, wake: 1 });
      if ('hold' in beat.morph) {
        // The hero's figure starts leaving once the intro module is on its way up.
        if (clear > 0 && leaveTo) signal?.setMorph(beat.morph.hold, leaveTo, clear);
        else signal?.setMorph(beat.morph.hold, beat.morph.hold, 1);
      } else if ('steps' in beat.morph) {
        // Several morphs in a row: the last one that has started (or the first, before any).
        // Snapshot looks 0.4 ahead with each picture finished, so a section's first screen
        // shows its second picture (the shoe) and its second screen the last (the screen agent).
        const steps = beat.morph.steps;
        const at = snapshot ? p + 0.4 : p;
        let k = 0;
        steps.forEach((st, i) => {
          if (at >= st.over[0]) k = i;
        });
        const { from, to, over } = steps[k];
        // Past the last picture, the screen agent starts back into the city (the top of Work's
        // G into A) once SELECTED WORK is on its way up.
        if (k === steps.length - 1 && clear > 0 && leaveTo) signal?.setMorph(to, leaveTo, clear);
        else signal?.setMorph(from, to, snapshot ? 1 : span(at, over[0], over[1]));
      } else {
        const { from, to, over } = beat.morph;
        // A morph away from the leaving picture is at least as far along as its clearance; a morph
        // into it (the 2025 line's screen agent) hands over to the leave once that has begun.
        const leaving = beat.clear ? LEAVING[beat.clear] : null;
        let t = Math.max(span(p, over[0], over[1]), from === leaving ? clear : 0);
        if (snapshot || (cutting && name === 'experience')) t = 1;
        if (to === leaving && clear > 0 && leaveTo) signal?.setMorph(to, leaveTo, clear);
        else if (cutting && !snapshot && name === 'experience' && !columnsClear()) signal?.setMorph(from, 'A', 1);
        else signal?.setMorph(from, to, t);
      }
    }

    if (motion) {
      // Live world: recompute the state every frame, just before it draws.
      world.onFrame(apply);
    } else {
      // Frozen world: recompute and draw one frame when the scroll position or the size changes.
      let queued = false;
      const draw = () => {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => {
          queued = false;
          apply();
          world.requestRender();
        });
      };
      window.addEventListener('scroll', draw, { passive: true });
      window.addEventListener('resize', draw);
      ScrollTrigger.addEventListener('refresh', draw);
      draw();
    }
    apply();
    ScrollTrigger.refresh();
  }

  ScrollTrigger.refresh();
  return { attach };
}
