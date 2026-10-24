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
import type { SceneKey, Signal, Target, World } from './contract';

gsap.registerPlugin(ScrollTrigger);

type HighlightKey = 'och' | 'ais' | 'club';

/** What each scene does as you scroll through it (progress 0 to 1). */
interface Beat {
  /** The camera key this scene arrives at. */
  key: SceneKey;
  /** Camera moves from the previous key into this one over this share of the scene. */
  arrive: number;
  /** Signal morph shown in this scene, and the share of the scene it takes. */
  morph: { from: Target; to: Target; over: [number, number] } | { hold: Target };
  highlight?: HighlightKey;
}

const BEATS: Record<SceneKey, Beat> = {
  hero: { key: 'hero', arrive: 0, morph: { hold: 'B' } },
  question: { key: 'question', arrive: 0.9, morph: { from: 'B', to: 'C', over: [0.05, 0.75] } },
  summer: { key: 'summer', arrive: 0.8, morph: { from: 'C', to: 'D', over: [0.05, 0.7] } },
  och: { key: 'och', arrive: 0, morph: { hold: 'A' }, highlight: 'och' },
  ais: { key: 'ais', arrive: 0.45, morph: { hold: 'A' }, highlight: 'ais' },
  club: { key: 'club', arrive: 0.45, morph: { hold: 'A' }, highlight: 'club' },
  more: { key: 'more', arrive: 0.6, morph: { hold: 'A' } },
  since: { key: 'since', arrive: 0.8, morph: { from: 'A', to: 'F', over: [0.05, 0.7] } },
  people: { key: 'people', arrive: 0.6, morph: { hold: 'F' } },
  contact: { key: 'contact', arrive: 0.7, morph: { from: 'F', to: 'E', over: [0, 0.6] } },
};

/**
 * The top of Work (its headline, before the first project): the camera travels to the first stop
 * while the archive columns dissolve back into the city, so they are gone before OurCityHealth's
 * text arrives.
 */
const WORK_INTRO: Beat = { key: 'och', arrive: 1, morph: { from: 'D', to: 'A', over: [0, 0.8] } };

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
  add('summer', pick('[data-scene="summer"]'));
  add('och', pick('[data-scene="work"]'), WORK_INTRO);
  add('och', pick('[data-stop="och"]'));
  add('ais', pick('[data-stop="ais"]'));
  add('club', pick('[data-stop="club"]'));
  add('more', pick('[data-stop="more"]'));
  add('since', pick('[data-scene="since"]'));
  add('people', pick('[data-scene="people"]'));
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
  const introEls = (['name', 'line', 'small'] as const).map((k) => document.querySelector<HTMLElement>(`[data-intro="${k}"]`));
  const introTimers: number[] = [];
  const revealAll = () => {
    introTimers.forEach((t) => window.clearTimeout(t));
    introEls.forEach((el) => el?.classList.add('is-in'));
  };
  if (html.classList.contains('js-intro')) {
    [600, 950, 1150].forEach((ms, i) => introTimers.push(window.setTimeout(() => introEls[i]?.classList.add('is-in'), ms)));
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
  const pinned = motion && !snapshot && desktop.matches;

  // One trigger per scene, in page order (ScrollTrigger needs pins created in order).
  const triggers: ScrollTrigger[] = scenes.map(({ el }) =>
    pinned && el.hasAttribute('data-pin')
      ? // A pinned project holds for about 120vh of scroll (spec section 6).
        ScrollTrigger.create({ trigger: el, start: 'top top', end: '+=120%', pin: true, pinSpacing: true })
      : ScrollTrigger.create({ trigger: el, start: 'top center', end: 'bottom center' }),
  );

  // A More toggle changes the page height: measure again.
  window.addEventListener('world:layout', () => ScrollTrigger.refresh());

  /**
   * The scene the viewport is in (the last one whose start we have passed) and how far through it
   * we are, measured from its start to the next scene's start (the last scene uses its own end).
   */
  function current(): { index: number; p: number } {
    const y = window.scrollY;
    let index = 0;
    triggers.forEach((st, i) => {
      if (y >= st.start - 1) index = i;
    });
    const st = triggers[index];
    if (!st) return { index: 0, p: 0 };
    const next = triggers[index + 1];
    const end = next ? next.start : st.end;
    return { index, p: clamp01((y - st.start) / Math.max(1, end - st.start)) };
  }

  // ---- World half ----
  function attach(world: World, signal: Signal | null) {
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
      .to(intro, { lift: 1, duration: 2.0, ease: 'power2.inOut' }, 1.6);
    const finishIntro = () => {
      introTl.progress(1);
      introRunning = false;
    };
    if (introRunning) introTl.play();
    else finishIntro();
    listeners.push(finishIntro);

    function apply() {
      const { index, p } = current();
      const scene = scenes[index];
      if (!scene) return;
      const beat = scene.beat;
      const prevKey = index > 0 ? scenes[index - 1].beat.key : beat.key;

      // Camera: arrive at this scene's key over the first part of the scene.
      let a = beat.arrive > 0 ? span(p, 0, beat.arrive) : 1;
      if (cutting) a = snapshot || a >= 0.5 ? 1 : 0;
      world.setCameraProgress(lerp(keys[prevKey], keys[beat.key], easeInOut(a)));

      // Highlight for the project stops.
      const strength = beat.highlight ? (snapshot ? 1 : plateau(p)) : 0;
      world.setHighlight(beat.highlight ?? null, strength);

      if (introRunning && scene.key === 'hero') {
        world.setIntro({ sky: intro.sky, wake: intro.wake });
        signal?.setMorph('A', 'B', intro.lift);
      } else {
        world.setIntro({ sky: 1, wake: 1 });
        if ('hold' in beat.morph) {
          signal?.setMorph(beat.morph.hold, beat.morph.hold, 1);
        } else {
          const { from, to, over } = beat.morph;
          let t = span(p, over[0], over[1]);
          if (snapshot) t = 1;
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
