// timeline.ts: scroll drives the night scene. Owned by the lead.
//
// One timeline over the whole page (NIGHT-SIGNAL.md section 6). Each section (and each project
// stop inside Work) gets a ScrollTrigger; every frame we read which one the viewport's center is
// in and how far through it we are, then set the camera, the signal's morph and the project
// highlight from that. Smooth scrolling is Lenis, driven by GSAP's ticker.
//
// The HTML half (smooth scroll, the hero text reveals, the scroll cue, pins) starts right away in
// createTimeline(). The world half starts in attach(), once the world and signal exist.
//
// Modes:
//   - motion on: Lenis, pins on desktop, the intro sequence, flowing camera and morphs.
//   - reduced motion: no Lenis, no pins, no intro; camera and signal cut to each scene's key.
//   - snapshot (?snapshot): as reduced motion, and every scene shows its best frame.

import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import Lenis from 'lenis';
import { FIGURE_ANCHOR, usePhoneLayout, wisersBox, type SceneKey, type Signal, type Target, type World } from './contract';

gsap.registerPlugin(ScrollTrigger);

type HighlightKey = 'och' | 'ais' | 'club';

/** What each scene does as you scroll through it (progress 0 to 1). */
interface Beat {
  /** The camera key this scene arrives at. */
  key: SceneKey;
  /** Camera moves from the previous key into this one over this share of the scene. */
  arrive: number;
  /**
   * Signal morph shown in this scene and the share of the scene it takes; or several morphs in a
   * row (steps), holding each picture between them. Snapshot shows each step's picture finished.
   */
  morph: Morph | { hold: Target } | { steps: Morph[] };
  highlight?: HighlightKey;
}

interface Morph {
  from: Target;
  to: Target;
  over: [number, number];
}

const BEATS: Record<SceneKey, Beat> = {
  hero: { key: 'hero', arrive: 0, morph: { hold: 'B' } },
  question: { key: 'question', arrive: 0.9, morph: { from: 'B', to: 'C', over: [0.05, 0.75] } },
  // The twelve columns are whole by the time EXPERIENCE nears the top of the window (V4 section 1),
  // and the camera has arrived with them, so they stand still while Civic Exchange is held
  // (desktop) or read (phones).
  experience: { key: 'experience', arrive: 0.25, morph: { from: 'C', to: 'D', over: [0, 0.25] } },
  // Wisers is held on screen: the columns become the 2024 feed, the feed folds into the shoe, then
  // the shoe becomes the 2025 screen agent, each picture held a while before the next (V4 section
  // 1). The feed starts once the Wisers frame is held. Summer 2024 is the highlighted line until
  // the middle of the last morph, Summer 2025 after it (data-beat on the section).
  wisers: {
    key: 'wisers',
    arrive: 0.3,
    morph: {
      steps: [
        { from: 'D', to: 'F1', over: [0.08, 0.2] },
        { from: 'F1', to: 'F2', over: [0.32, 0.46] },
        { from: 'F2', to: 'G', over: [0.6, 0.72] },
      ],
    },
  },
  och: { key: 'och', arrive: 0, morph: { hold: 'A' }, highlight: 'och' },
  ais: { key: 'ais', arrive: 0.45, morph: { hold: 'A' }, highlight: 'ais' },
  club: { key: 'club', arrive: 0.45, morph: { hold: 'A' }, highlight: 'club' },
  more: { key: 'more', arrive: 0.7, morph: { hold: 'A' } },
  // Straight from Work to Contact (V4 section 2): Contact starts as it enters the window, after the
  // open sky below More work, and the city's lights gather into the two lights while the camera
  // rises. The harbour light show runs while Contact is the current scene (spec v3, 11b.9).
  contact: { key: 'contact', arrive: 0.5, morph: { from: 'A', to: 'E', over: [0.35, 0.9] } },
};

/**
 * The top of Work (its headline, before the first project): the camera travels to the first stop
 * while the screen agent dissolves back into the city, so it is gone before OurCityHealth's text
 * arrives.
 */
const WORK_INTRO: Beat = { key: 'och', arrive: 1, morph: { from: 'G', to: 'A', over: [0, 0.8] } };

interface Scene {
  key: SceneKey;
  beat: Beat;
  el: HTMLElement;
}

/** Where on the page each scene lives, in page order. Work's projects are their own scenes. */
function sceneElements(): Scene[] {
  const out: Scene[] = [];
  const pick = (selector: string) => document.querySelector<HTMLElement>(selector);
  const add = (key: SceneKey, el: HTMLElement | null, beat: Beat = BEATS[key]) => el && out.push({ key, el, beat });
  add('hero', pick('[data-scene="hero"]'));
  add('question', pick('[data-scene="question"]'));
  add('experience', pick('[data-scene="experience"]'));
  add('wisers', pick('[data-scene="wisers"]'));
  add('och', pick('[data-scene="work"]'), WORK_INTRO);
  add('och', pick('[data-stop="och"]'));
  add('ais', pick('[data-stop="ais"]'));
  add('club', pick('[data-stop="club"]'));
  add('more', pick('[data-stop="more"]'));
  add('contact', pick('[data-scene="contact"]'));
  return out;
}

const easeInOut = gsap.parseEase('power2.inOut');
const clamp01 = (v: number) => Math.min(1, Math.max(0, v));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (v: number, a: number, b: number) => clamp01((v - a) / Math.max(1e-6, b - a));
/** 0 at the edges of a scene, 1 through its middle: highlights fade in and out. */
const plateau = (p: number) => Math.min(span(p, 0.05, 0.3), 1 - span(p, 0.75, 0.97));

export interface TimelineOptions {
  motion: boolean;
  snapshot: boolean;
}

export interface Timeline {
  attach(world: World, signal: Signal | null): void;
}

export function createTimeline({ motion, snapshot }: TimelineOptions): Timeline {
  const html = document.documentElement;
  const desktop = window.matchMedia('(min-width: 1024px)');

  // ---- Smooth scroll (motion only) ----
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

  // ---- Scenes, pins and progress ----
  const scenes = sceneElements();
  const pinning = motion && !snapshot && desktop.matches;
  let triggers: ScrollTrigger[] = [];

  /**
   * One trigger per scene, in page order (ScrollTrigger needs pins created in order).
   *   - Project stops start when their top reaches the top of the window, so the top of Work (the
   *     archive columns dissolving back into the city) gets real scroll length on phones too. On
   *     desktop the CSS holds each one still for about 120vh (spec section 6), unless an opened
   *     More panel makes it taller than the window: then it scrolls normally so nothing is cut off.
   *   - Civic Exchange, at the top of Experience, is held the same way on desktop (V4 section 1):
   *     its frame stays still for about 70vh once the columns stand, inside the experience scene,
   *     whose progress runs through the hold (see holdCivic()).
   *   - Contact starts as soon as it enters the window, so the two lights have room to gather.
   *   - Everything else starts when its top reaches the middle of the window.
   */
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
   * (.xp__track), in CSS on desktop with motion. Like a project's, it lets go (.is-tall) while an
   * open More panel makes the block taller than the window, and takes hold again once it fits.
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
  if (pinning && civicFrame) {
    document.addEventListener(
      'click',
      (event) => {
        const btn = (event.target as Element | null)?.closest?.('.xp__more [data-more-btn]');
        if (btn && btn.getAttribute('aria-expanded') !== 'true') holdCivic(true);
      },
      true,
    );
  }

  /**
   * The experience scene's length with Civic Exchange's More shut. The columns' morph and the
   * camera's arrival are shares of the scene (both done at 0.25), and an open panel makes the scene
   * longer (it opens inside it, and on desktop the hold lets go), so measured as is they would
   * slide back under the reader who opened it. While the panel is open the scene keeps the length
   * it had shut at this window size (after a resize, its length less the panel's height).
   * Snapshot's layout has every panel open.
   */
  const civicIndex = scenes.findIndex((sc) => sc.key === 'experience');
  const civicPanel = civicTrack?.querySelector<HTMLElement>('[data-more-panel]') ?? null;
  let civicLength = 0;
  let civicSize = '';
  ScrollTrigger.addEventListener('refresh', () => {
    const st = triggers[civicIndex];
    const next = triggers[civicIndex + 1];
    if (!st || !next) return;
    const size = `${window.innerWidth}x${window.innerHeight}`;
    const open = !snapshot && !!civicPanel?.hasAttribute('data-open');
    if (open && size === civicSize) return;
    civicLength = next.start - st.start - (open && civicPanel ? civicPanel.offsetHeight : 0);
    civicSize = size;
  });

  function build() {
    triggers.forEach((st) => st.kill(true));
    if (pinning && civicFrame) holdCivic(!frameFits(civicFrame));
    triggers = scenes.map(({ key, el }) => {
      if (el.hasAttribute('data-pin')) {
        // Desktop with motion: the CSS holds each project's frame still for 120vh (a sticky frame
        // in a 220vh track), so nothing is pinned by script. If an open More panel makes the frame
        // taller than the window, .is-tall lets that project scroll normally instead.
        el.classList.remove('is-tall');
        const frame = el.querySelector<HTMLElement>('.stop__grid');
        if (pinning && frame && !frameFits(frame)) el.classList.add('is-tall');
        // Phones (and reduced motion, snapshot): the first project takes over at the top of the
        // window, giving the archive's dissolve its scroll; the next two take over a little
        // earlier, so the city never shows the last project under the next video.
        const start = pinning || key === 'och' ? 'top top' : 'top 35%';
        return ScrollTrigger.create({ trigger: el, start, end: 'bottom top' });
      }
      if (key === 'wisers') {
        // Held on screen while its pictures draw (a tall section with a sticky frame in CSS), so
        // its progress runs from its top reaching the top of the window.
        return ScrollTrigger.create({ trigger: el, start: 'top top', end: 'bottom bottom' });
      }
      if (key === 'experience' && !motion && !snapshot) {
        // Reduced motion cuts the current to the columns as soon as EXPERIENCE enters the window
        // (see apply()), so the Civic Exchange header never rises through the current, which sat
        // right behind its meta lines (2.2 to 1).
        return ScrollTrigger.create({ trigger: el, start: 'top 90%', end: 'bottom center' });
      }
      if (key === 'contact') {
        // Snapshot freezes More work on the city and Contact on the two lights, and its screens
        // follow straight on, so Contact starts at the middle of the window there; live, it starts
        // as soon as it enters.
        return ScrollTrigger.create({ trigger: el, start: snapshot ? 'top center' : 'top bottom', end: 'bottom bottom' });
      }
      return ScrollTrigger.create({ trigger: el, start: 'top center', end: 'bottom center' });
    });
    ScrollTrigger.refresh();
  }
  build();

  // A More toggle changes a section's height: rebuild the triggers from scratch.
  window.addEventListener('world:layout', build);
  // A resize, or the web font arriving, can change whether Civic Exchange fits its frame.
  if (pinning && civicTrack && civicFrame) {
    let timer = 0;
    const recheck = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        if (civicTrack.classList.contains('is-tall') !== frameFits(civicFrame)) return;
        build();
      }, 200);
    };
    window.addEventListener('resize', recheck);
    document.fonts?.ready.then(recheck);
  }

  // Wisers: which summer's line is highlighted, in step with the pictures (the page styles
  // [data-beat]): 2025 from the middle of the shoe-to-screen morph, where the picture becomes the
  // screen agent (snapshot: from its second screen). Runs without WebGL.
  const wisersIndex = scenes.findIndex((sc) => sc.key === 'wisers');
  const wisersEl = wisersIndex >= 0 ? scenes[wisersIndex].el : null;
  const wisersMorph = BEATS.wisers.morph;
  const lastStep = 'steps' in wisersMorph ? wisersMorph.steps[wisersMorph.steps.length - 1] : null;
  const wisers2025 = snapshot || !lastStep ? 0.5 : (lastStep.over[0] + lastStep.over[1]) / 2;
  const markWisers = () => {
    if (!wisersEl) return;
    const { index, p } = current();
    const beat = index < wisersIndex || (index === wisersIndex && p < wisers2025) ? '2024' : '2025';
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
    markWisers();
  }

  // On phones (and portrait tablets) the hero text sits under the figure, so it fades out as it
  // scrolls up toward it, gone by the time the top of the text's box reaches the drawn figure's
  // bottom edge (the glyphs start lower still, so they never touch it while visible). Snapshot
  // too, between its poster frames.
  const heroText = document.querySelector<HTMLElement>('.hero__text');
  const heroFigure = document.querySelector<HTMLElement>('.hero__figure');
  const heroSection = document.querySelector<HTMLElement>('[data-scene="hero"]');
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
    ScrollTrigger.create({
      trigger: heroSection,
      start: 'top top',
      end: '+=400',
      onRefresh: measure,
      onUpdate: (self) => {
        if (!usePhoneLayout(window.innerWidth, window.innerHeight)) {
          heroText.style.opacity = '';
          return;
        }
        const distance = Math.max(24, textTop - (figureBottom?.() ?? boxBottom));
        heroText.style.opacity = String((1 - clamp01((self.scroll() - self.start) / distance)) ** 2);
      },
    });
  }

  /**
   * Titles never cross a drawn picture (spec section 3). The figure and the screen agent sit where
   * the next section's title arrives, so they leave over a stretch of scroll measured from that
   * title rather than from the scene: from the title's top entering the window to its reaching
   * the picture's bottom edge, less a small gap. Their morphs are always at least this far along.
   * Reduced motion and snapshot cut picture and camera together late in the stretch (CLEAR_CUT),
   * once the hero text has risen clear of the Mission view's skyline.
   *
   * `reach` is how far along the morph must be when the title arrives. The figure is gone by the
   * middle of its morph, so its stretch runs on past the title (FIGURE_REACH): the camera's dolly
   * to the Mission view, which moves with it, gets twice the scroll.
   */
  const CLEAR_GAP = 24;
  const CLEAR_CUT = 0.9;
  const FIGURE_REACH = 0.5;
  function clearance(selector: string, pictureBottom: () => number, reach = 1): (y: number) => number {
    const title = document.querySelector<HTMLElement>(selector);
    let from = 0;
    let to = 1;
    const measure = () => {
      if (!title) return;
      const top = title.getBoundingClientRect().top + window.scrollY;
      from = top - window.innerHeight;
      to = Math.max(from + 1, from + (top - pictureBottom() * window.innerHeight - CLEAR_GAP - from) / reach);
    };
    measure();
    ScrollTrigger.addEventListener('refresh', measure);
    return (y) => (title ? span(y, from, to) : 0);
  }
  /** The figure leaves as THE MISSION rises toward it (B into C). */
  const figureClear = clearance('#mission-title', () => {
    const a = usePhoneLayout(window.innerWidth, window.innerHeight) ? FIGURE_ANCHOR.phone : FIGURE_ANCHOR.desktop;
    return a.y + a.height / 2;
  }, FIGURE_REACH);
  /** The screen agent leaves as SELECTED WORK rises toward it (G into A). */
  const agentClear = clearance('#work-title', () => wisersBox(window.innerWidth, window.innerHeight).y1);

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
      return box ? box.y1 * window.innerHeight : null;
    };
    const keys = world.cameraKeys;
    const cutting = !motion; // reduced motion and snapshot cut to keys

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

      // The harbour light show runs while Contact is the current scene (spec v3, 11b.9); the
      // world fades it in and out and holds it still with motion off.
      const show = scene.key === 'contact';
      if (show !== lightsOn) {
        lightsOn = show;
        world.lightShow?.(show);
      }
      const beat = scene.beat;
      const prevKey = index > 0 ? scenes[index - 1].beat.key : beat.key;
      // How far the picture in the next title's way must have left (see clearance()).
      const figureLeaving = scene.key === 'hero' || scene.key === 'question';
      const agentLeaving = scene.key === 'wisers' || beat === WORK_INTRO;
      const along = figureLeaving ? figureClear(y) : agentLeaving ? agentClear(y) : 0;
      const clear = cutting ? (along >= CLEAR_CUT * (figureLeaving ? FIGURE_REACH : 1) ? 1 : 0) : along;

      // Camera: arrive at this scene's key over the first part of the scene.
      let a = beat.arrive > 0 ? span(p, 0, beat.arrive) : 1;
      let toKey = beat.key;
      // The figure's points land in the current, which is placed for the Mission view, so the
      // camera moves there with them: seen from the hero's view, the current is a far pile of
      // points on the horizon that drew no more than a dot and cost over 20 ms a frame to blend.
      if (!cutting && figureLeaving && clear > 0) {
        a = Math.max(scene.key === 'hero' ? 0 : a, clear);
        toKey = 'question';
      }
      if (cutting) {
        // Cut the camera with the picture: at the morph's midpoint, where the signal cuts, so
        // there's never a stretch with neither picture in frame.
        const first = 'over' in beat.morph ? beat.morph : 'steps' in beat.morph ? beat.morph.steps[0] : null;
        const cutAt = first ? (first.over[0] + first.over[1]) / 2 : beat.arrive / 2;
        a = snapshot || p >= cutAt || scene.key === 'experience' ? 1 : 0;
        if (scene.key === 'question' || beat === WORK_INTRO) a = snapshot || clear === 1 ? 1 : 0;
        // The figure can cut away before the Mission scene starts: the camera goes with it.
        if (scene.key === 'hero' && clear === 1) {
          a = 1;
          toKey = 'question';
        }
      }
      world.setCameraProgress(lerp(keys[prevKey], keys[toKey], easeInOut(a)));

      // Highlight for the project stops.
      const strength = beat.highlight ? (snapshot ? 1 : plateau(p)) : 0;
      world.setHighlight(beat.highlight ?? null, strength);

      if (introRunning && scene.key === 'hero') {
        world.setIntro({ sky: intro.sky, wake: intro.wake });
        signal?.setMorph('A', 'B', intro.lift);
      } else {
        world.setIntro({ sky: 1, wake: 1 });
        if ('hold' in beat.morph) {
          // The hero's figure starts leaving once the Mission panel is on its way up.
          if (scene.key === 'hero' && clear > 0) signal?.setMorph('B', 'C', clear);
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
          // Past the last picture, the screen agent starts back into the city (WORK_INTRO's G
          // into A) once SELECTED WORK is on its way up.
          if (k === steps.length - 1 && clear > 0) signal?.setMorph(to, 'A', clear);
          else signal?.setMorph(from, to, snapshot ? 1 : span(at, over[0], over[1]));
        } else {
          const { from, to, over } = beat.morph;
          let t = Math.max(span(p, over[0], over[1]), clear);
          if (snapshot || (cutting && scene.key === 'experience')) t = 1;
          signal?.setMorph(from, to, t);
        }
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
      draw();
    }
    apply();
    ScrollTrigger.refresh();
  }

  ScrollTrigger.refresh();
  return { attach };
}
