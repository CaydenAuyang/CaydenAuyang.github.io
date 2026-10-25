// renderer.ts: createWorld, the Hong Kong harbour at night behind the page.
//
// One WebGLRenderer on the page's canvas, no post-processing. Draws, in order: the sky dome, the
// Peak, the towers (one instanced draw), the water, the stars and the small lights. That is six
// draw calls, leaving plenty of the 40-call budget for the signal.
//
// Phones and tablets (V4.md 8.3 to 8.8):
//   - Size: the drawing buffer follows the canvas (100lvh, so the browser toolbar never moves it);
//     the view (camera path, reflections, the signal's targets) is rebuilt once the size settles,
//     only for a width change, a turn or, on touch, a height change of 25% or more.
//   - Pacing: at most 60 fps on 90 and 120 Hz screens, 30 on touch once nothing has moved for
//     2 s, and nothing while the tab is hidden.
//   - Step-down: while scrolling, if the 90th percentile frame time over 2 s is over 22 ms, one
//     step at a time, 2 s apart: pixel ratio down 0.25 to 1, two beams instead of five, the
//     harbour at half resolution, half the stars. Never back up in a visit, except after a turn.
//   - Context loss: the still shows (html.world-lost) until the context is back, then the world
//     rebuilds.

import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { SCENE_ORDER, usePhoneLayout, type CameraPose, type Landmarks, type LitWindowSamples, type SceneKey, type World, type WorldOptions } from './contract';
import { applyPose, buildCameraPath, FOV, poseToCameraPose, type CameraPath, type KeyPose } from './camera-path';
import { generateCity } from './city';
import { BAKE_SLOTS, buildHarbour, type WindowSet } from './harbour';
import { PALETTE } from './palette';
import { buildLights, buildPeak } from './peak';
import { createInteractions, pulseUniforms } from './pulse';
import { createSpill, spillUniforms } from './spill';
import { BEAMS, buildBeams, showUniforms } from './lightshow';
import { hasMouse, onLayoutChange } from './layout';
import { buildShooting } from './shooting';
import { buildSky, STAR_AXIS, STAR_DRIFT, starsInView } from './sky';
import { buildSkyline } from './skyline';
import { detectTier, readGpu } from './tier';
import { litFrontWindows, litSideWindows, sampleWindows, visibleFrom, type FrontWindow } from './windows';

export const DEFAULT_SEED = 0x1997;
const DEG = Math.PI / 180;

/** Resize (8.3): ms the size must hold before the view rebuilds, and on touch the height change (share) below which it never does (the browser toolbar; ScrollTrigger's rule). */
const SETTLE_MS = 150;
const TOOLBAR_SHARE = 0.25;
/**
 * Pacing (8.6): frames keep a 60 fps schedule, slots FRAME ms apart (IDLE_FRAME on touch once
 * nothing has moved for IDLE_AFTER ms: 30 fps). A display tick draws only when the next slot is
 * due, within SLACK ms. Slots move on by whole frames, so a 75 or 90 Hz screen still averages 60;
 * a frame more than a whole slot late starts the schedule again instead of catching up.
 */
const FRAME = 1000 / 60;
const IDLE_FRAME = 1000 / 30;
const IDLE_AFTER = 2000;
const SLACK = 2;
/**
 * Step-down (8.5): the intervals between display ticks over the last WINDOW ms of scrolling (a
 * tick counts as scrolling up to SCROLL_HOLD ms after a scroll event), checked every CHECK ms once
 * there are at least MIN of them; if their 90th percentile is over SLOW ms, one step, at least GAP
 * ms after the last. Ticks the pacing skips count too, so a 75, 90 or 120 Hz screen is judged by
 * its own interval, not by the gaps the 60 fps cap leaves.
 *
 * The cadence is how fast the page ticks when the world draws nothing: the shortest gap after a
 * skipped tick that another gap within FRESH ms of it agrees with (to 15%). When it is slower than
 * 45 fps (Low Power Mode, Energy Saver, or other work on the page), a lighter world can't help, so
 * only gaps over 1.5 of it count as slow, for TRUST ms after it was measured. Before a step, if it
 * is unknown or more than FRESH ms old, the next PROBE ticks skip drawing to measure it (at most
 * once per GAP), and the next check decides.
 */
const STEP = { window: 2000, check: 500, min: 30, slow: 22, gap: 2000, scrollHold: 300, fresh: 5000, trust: 20000, probe: 3 };
const DPR_STEP = 0.25;
const DPR_FLOOR = 1;
const BEAMS_LOW = 2;

export async function createWorld(opts: WorldOptions): Promise<World> {
  const { canvas } = opts;
  const seed = opts.seed ?? DEFAULT_SEED;
  const gpu = readGpu();
  const tierInfo = detectTier(gpu);
  const tier = { tier: tierInfo.tier, dprCap: tierInfo.dprCap, stars: tierInfo.stars, towers: tierInfo.towers, points: tierInfo.points };

  const renderer = new WebGLRenderer({
    canvas,
    alpha: false,
    antialias: tier.tier !== 'phone',
    powerPreference: 'high-performance',
    stencil: false,
  });
  renderer.setClearColor(rgbHex(PALETTE.night), 1);
  renderer.info.autoReset = true;

  const scene = new Scene();
  const camera = new PerspectiveCamera(FOV, 1, 1, 30000);

  // Shared uniforms: one object per value, passed by reference into every material.
  const U = {
    uTime: { value: 0 },
    uMotion: { value: opts.motion ? 1 : 0 },
    uSkyFade: { value: 1 },
    uWake: { value: 1 },
    uPixelRatio: { value: 1 },
    uLift: { value: new Vector2(0, 0) },
    uHi: { value: new Vector3(0, 0, 0.5) },
    ...pulseUniforms(),
    ...spillUniforms(),
    ...showUniforms(),
  };

  // ---- Build the city ----
  const city = generateCity(tier.towers, seed);
  const skyline = buildSkyline(city, U, tier.tier === 'phone' ? 2 : 4);
  // Phones see a narrow slice of sky, so their stars crowd where the phone camera looks (about
  // 66 degrees left of south to 33 right), and there are more of them than the spec's 4,000
  // (tier.ts), so the phone hero's sky is as dense per screen area as the laptop's. They flash a
  // little more often, to keep one or two flashing in view.
  const phoneTier = tier.tier === 'phone';
  const skyParts = buildSky(U, {
    stars: tier.stars,
    seed,
    clouds: true,
    flashEvery: phoneTier ? [2.4, 4.4] : [5, 9],
    core: phoneTier ? [-66 * DEG, 33 * DEG, 0.8] : undefined,
  });
  const sky = skyParts.group;
  const peak = buildPeak(city, U);
  const lights = buildLights(city, U, tier.tier === 'phone' ? 0.55 : 1);

  // Size first: the hero pose depends on the aspect.
  let width = 1;
  let height = 1;
  let path: CameraPath;
  const measure = () => {
    width = Math.max(1, canvas.clientWidth || window.innerWidth);
    height = Math.max(1, canvas.clientHeight || window.innerHeight);
  };
  measure();
  // The stack layout (phones and iPads upright) gets the phone framing, as in the page's CSS.
  const isPhoneFrame = () => usePhoneLayout(width, height);
  path = buildCameraPath(city, width / height, isPhoneFrame());

  const wins = litFrontWindows(city);
  let frontCells = 0;
  for (const t of city.towers) for (const sg of t.segs) frontCells += sg.winFloors * sg.colsF;
  const heroPos = path.poses.hero.pos.clone();
  let vis = visibleFrom(city, wins, heroPos.x, heroPos.y, heroPos.z);
  let visFor = heroPos.clone();
  const harbour = buildHarbour(city, U);
  const FRONT: [number, number] = [0, 1];
  harbour.bake(0, heroPos, [{ wins, vis, normal: FRONT }]);
  for (let k = 1; k < BAKE_SLOTS; k++) harbour.copy(0, k);
  // Reflection profiles per camera stop: the hero now, the others in idle time, a step at a
  // time (front faces, then side faces, then the bake), so oblique stops reflect the towers and
  // faces they actually see. Side faces only matter at the oblique stops.
  const SLOT: Record<SceneKey, number> = { hero: 0, question: 1, experience: 2, wisers: 2, och: 3, ais: 4, club: 5, more: 6, contact: 6 };
  const SLOT_KEYS: SceneKey[] = ['hero', 'question', 'experience', 'och', 'ais', 'club', 'more'];
  const OBLIQUE = new Set([2, 3, 4, 5]);
  let sideRight: FrontWindow[] | null = null;
  let sideLeft: FrontWindow[] | null = null;
  let bakeGen = 0;
  let bakesDone = 1;
  const idle = (cb: () => void) => {
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(cb, { timeout: 2000 });
    else setTimeout(cb, 60);
  };
  const scheduleBakes = () => {
    const gen = ++bakeGen;
    type Task = { slot: number; step: 'front' | 'sides' | 'bake' };
    const tasks: Task[] = [];
    for (let i = 0; i < SLOT_KEYS.length; i++) {
      tasks.push({ slot: i, step: 'front' });
      if (OBLIQUE.has(i)) tasks.push({ slot: i, step: 'sides' });
      tasks.push({ slot: i, step: 'bake' });
    }
    const sets = new Map<number, WindowSet[]>();
    const run = () => {
      if (gen !== bakeGen || disposed) return;
      const task = tasks.shift();
      if (!task) return;
      const { slot } = task;
      const p = path.poses[SLOT_KEYS[slot]].pos;
      if (task.step === 'front') {
        if (slot === 0) {
          if (p.distanceTo(visFor) > 1) {
            vis = visibleFrom(city, wins, p.x, p.y, p.z);
            visFor = p.clone();
            sets.set(0, [{ wins, vis, normal: FRONT }]);
          }
        } else {
          sets.set(slot, [{ wins, vis: visibleFrom(city, wins, p.x, p.y, p.z), normal: FRONT }]);
        }
      } else if (task.step === 'sides') {
        sideRight ??= litSideWindows(city, 1);
        sideLeft ??= litSideWindows(city, 3);
        const right = sideRight.filter((w) => p.x > w.x);
        const left = sideLeft.filter((w) => p.x < w.x);
        sets.get(slot)?.push(
          { wins: right, vis: visibleFrom(city, right, p.x, p.y, p.z), normal: [1, 0] },
          { wins: left, vis: visibleFrom(city, left, p.x, p.y, p.z), normal: [-1, 0] },
        );
      } else {
        const s = sets.get(slot);
        if (s) {
          harbour.bake(slot, p, s);
          bakesDone++;
          if (frozen) requestRender();
        }
      }
      if (tasks.length) idle(run);
    };
    idle(run);
  };
  scene.add(sky, peak, skyline, harbour.mesh, lights.points);

  const landmarks: Landmarks = {
    centralCluster: new Vector3(city.central.x, city.central.y, city.central.z),
    lowBlockLeft: new Vector3(city.lowBlock.x, city.lowBlock.y, city.lowBlock.z),
    smallClusters: city.clusters.map((c) => new Vector3(c.x, c.y, c.z)),
    skylineTop: city.skylineTop,
    waterY: 0,
  };

  // ---- Camera state ----
  let u = 0;
  const base: KeyPose = { pos: new Vector3(), yaw: 0, pitch: 0 };
  let motion = opts.motion;
  // Mouse or touch (8.1): touch has no parallax, and drops to 30 fps when nothing moves.
  let touch = !hasMouse();
  const offLayout = onLayoutChange(() => (touch = !hasMouse()));
  const par = { tx: 0, ty: 0, x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    par.tx = (e.clientX / window.innerWidth) * 2 - 1;
    par.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const placeCamera = () => {
    path.pose(u, base);
    const seg = path.segment(u);
    harbour.setBlend(SLOT[SCENE_ORDER[seg.i]], SLOT[SCENE_ORDER[seg.i + 1]], seg.s);
    const on = motion && !touch;
    applyPose(camera, base, on ? par.x * 1.5 * DEG : 0, on ? -par.y * 0.8 * DEG : 0);
    sky.position.copy(camera.position);
  };

  // ---- Size (8.3) ----
  // fit() matches the drawing buffer and the projection to the canvas: cheap. rebuild() solves the
  // camera path for the new shape, rebakes the reflections and has the signal rebuild its targets
  // (onRebuild): expensive, so it waits until the size has held for SETTLE_MS, and runs only for a
  // width change, a turn or (on touch) a height change of TOOLBAR_SHARE or more.
  /** The step-down's pixel ratio limit (none until it steps). */
  let dprLimit = Infinity;
  const pixelRatio = () => Math.min(window.devicePixelRatio || 1, tier.dprCap, dprLimit);
  let rebuilds = 0;
  let fits = 0;
  const built = { w: 0, h: 0 };
  const rebuildSubs = new Set<() => void>();
  const fit = () => {
    measure();
    const dpr = pixelRatio();
    const same = dpr === renderer.getPixelRatio() && canvas.width === Math.floor(width * dpr) && canvas.height === Math.floor(height * dpr);
    if (same && camera.aspect === width / height) return;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    U.uPixelRatio.value = dpr;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    fits++;
    placeCamera();
    requestRender();
  };
  const rebuild = (count = true) => {
    fit();
    built.w = width;
    built.h = height;
    path = buildCameraPath(city, camera.aspect, isPhoneFrame());
    // Distance haze starts a kilometre short of the hero camera, so the city band along the bottom
    // of the first screen keeps the clarity it had when the hero stood closer.
    const fogStart = Math.max(city.width * 0.55, path.heroDistance - 1000);
    for (const m of [skyline.material, harbour.water, peak.material, lights.points.material]) {
      const f = (m as { uniforms?: { uFog?: { value: Vector3 } } }).uniforms?.uFog?.value;
      if (f) f.z = fogStart;
    }
    placeCamera();
    scheduleBakes();
    if (count) {
      rebuilds++;
      for (const cb of rebuildSubs) cb();
    }
    requestRender();
  };
  let settleTimer = 0;
  let fitQueued = false;
  const settle = () => {
    settleTimer = 0;
    if (disposed || lost) return;
    measure();
    const turned = height >= width !== built.h >= built.w;
    if (turned) resetQuality();
    const toolbar = touch && !turned && width === built.w && Math.abs(height - built.h) < TOOLBAR_SHARE * built.h;
    if ((width === built.w && height === built.h) || toolbar) fit();
    else rebuild();
  };
  const onResize = () => {
    // With a mouse the buffer follows a window being dragged; on touch everything waits for the
    // size to settle (a turn passes through sizes in between).
    if (!touch && !fitQueued) {
      fitQueued = true;
      requestAnimationFrame(() => {
        fitQueued = false;
        if (!disposed && !lost) fit();
      });
    }
    window.clearTimeout(settleTimer);
    settleTimer = window.setTimeout(settle, SETTLE_MS);
  };

  // ---- Spotlight and pulse (11b.1) ----
  const interactions = createInteractions({
    city,
    camera,
    uniforms: U,
    buffer: () => ({ w: canvas.width, h: canvas.height }),
    motion: () => motion,
    requestRender: () => requestRender(),
  });

  // ---- Shooting stars (11b.8): one streak on the sky dome, drawn only while it runs ----
  const shooting = buildShooting(skyParts, camera, U, { axis: STAR_AXIS, rate: STAR_DRIFT }, () => motion);
  sky.add(shooting.mesh);

  // ---- Searchlights (4.7) and the Contact light show (11b.9): one draw for every beam ----
  const beams = buildBeams(
    city,
    U,
    PALETTE.cool,
    camera,
    () => ({ w: canvas.width, h: canvas.height }),
    () => requestRender(),
    () => ({ w: width, h: height }),
  );
  scene.add(beams.mesh);

  // ---- Video light spill (11b.4) ----
  const spill = createSpill(U, () => motion, () => requestRender());

  // ---- Highlights ----
  let hiKey: 'och' | 'ais' | 'club' | null = null;
  let hiStrength = 0;
  const updateHighlight = (time: number) => {
    const type = hiKey === 'och' ? 1 : hiKey === 'ais' ? 2 : hiKey === 'club' ? 3 : 0;
    const s = type ? hiStrength : 0;
    // och: the wave crosses the whole city every 9 s; frozen at 45% with motion off.
    const wave = motion ? ((time / 9) % 1) * 1.3 - 0.15 : 0.45;
    U.uHi.value.set(type, s, wave);
    const r = harbour.hiRange;
    // och lifts every window a little, so it lifts every reflection a little too
    if (type === 1) r.set(city.xMin + (wave - 0.06) * city.width, city.xMin + (wave + 0.06) * city.width, s * 0.6, s * 0.35);
    else if (type === 2) r.set(city.clusters[0].x0, city.clusters[city.clusters.length - 1].x1, s, 0);
    else if (type === 3) r.set(city.lowBlock.x0, city.lowBlock.x1, s, 0);
    else r.set(0, 0, 0, 0);
  };

  // ---- Step-down (8.5) ----
  type Step = { at: number; step: string; p90?: number };
  const steps: Step[] = [];
  let starsHalf = false;
  const setStarsHalf = (on: boolean) => {
    starsHalf = on;
    skyParts.stars.geometry.setDrawRange(0, on ? Math.ceil(skyParts.count / 2) : Infinity);
  };
  // Tick intervals while scrolling: a ring of the latest, with when each tick came.
  const RING = 256;
  const ring = { t: new Float64Array(RING), gap: new Float32Array(RING), head: 0, n: 0 };
  const recent: number[] = [];
  let checkAt = 0;
  let stepAt = -Infinity;
  let lastP90 = 0;
  // The cadence: gaps after ticks that drew nothing, with when each came.
  const GAPS_RING = 16;
  const gaps = { t: new Float64Array(GAPS_RING), gap: new Float32Array(GAPS_RING), head: 0, n: 0 };
  const fresh: number[] = [];
  const noteIdle = (now: number, gap: number) => {
    gaps.t[gaps.head] = now;
    gaps.gap[gaps.head] = gap;
    gaps.head = (gaps.head + 1) % GAPS_RING;
    gaps.n = Math.min(GAPS_RING, gaps.n + 1);
  };
  /** When the latest gap after a skipped tick came (-Infinity before any). */
  const cadenceAt = () => (gaps.n ? gaps.t[(gaps.head - 1 + GAPS_RING) % GAPS_RING] : -Infinity);
  /** The cadence in ms, or 0 while no two gaps agree. */
  const cadence = () => {
    const at = cadenceAt();
    fresh.length = 0;
    for (let k = 0; k < gaps.n; k++) {
      const i = (gaps.head - 1 - k + GAPS_RING) % GAPS_RING;
      if (at - gaps.t[i] > STEP.fresh) break;
      fresh.push(gaps.gap[i]);
    }
    fresh.sort((a, b) => a - b);
    for (let i = 0; i + 1 < fresh.length; i++) if (fresh[i + 1] <= fresh[i] * 1.15) return fresh[i];
    return 0;
  };
  /** Ticks still to skip for a cadence probe, when the last began, and how many there have been. */
  let probe = 0;
  let probedAt = -Infinity;
  let probes = 0;
  const stepDown = (now: number, p90: number) => {
    let step: string;
    if (renderer.getPixelRatio() > DPR_FLOOR + 1e-3) {
      dprLimit = Math.max(DPR_FLOOR, renderer.getPixelRatio() - DPR_STEP);
      fit();
      step = `pixel ratio ${renderer.getPixelRatio()}`;
    } else if (beams.maxBeams > BEAMS_LOW) {
      beams.setMaxBeams(BEAMS_LOW);
      step = `${BEAMS_LOW} beams`;
    } else if (!harbour.half) {
      harbour.setHalf(true);
      step = 'harbour at half resolution';
    } else if (!starsHalf) {
      setStarsHalf(true);
      step = 'half the stars';
    } else {
      return;
    }
    steps.push({ at: Math.round(now - t0), step, p90: Math.round(p90 * 10) / 10 });
    stepAt = now;
    ring.n = 0;
  };
  const sample = (now: number, gap: number) => {
    ring.t[ring.head] = now;
    ring.gap[ring.head] = gap;
    ring.head = (ring.head + 1) % RING;
    ring.n = Math.min(RING, ring.n + 1);
    if (now < checkAt || now - stepAt < STEP.gap) return;
    checkAt = now + STEP.check;
    recent.length = 0;
    let oldest = now;
    for (let k = 0; k < ring.n; k++) {
      const i = (ring.head - 1 - k + RING) % RING;
      if (now - ring.t[i] > STEP.window) break;
      recent.push(ring.gap[i]);
      oldest = ring.t[i];
    }
    if (recent.length < STEP.min || now - oldest < STEP.window * 0.75) return;
    recent.sort((a, b) => a - b);
    lastP90 = recent[Math.floor(recent.length * 0.9)];
    if (lastP90 <= STEP.slow) return;
    // The page ticks this slowly even when the world draws nothing: not the world's doing.
    const c = cadence();
    const age = now - cadenceAt();
    if (c > 1000 / 45 && lastP90 <= c * 1.5 && age <= STEP.trust) return;
    if ((!c || age > STEP.fresh) && now - probedAt > STEP.gap) {
      // Measure the cadence first; the next check decides.
      probe = STEP.probe;
      probedAt = now;
      probes++;
      return;
    }
    stepDown(now, lastP90);
  };
  /** Back to full quality after a turn (the only time it steps back up). */
  const resetQuality = () => {
    if (dprLimit === Infinity && beams.maxBeams === BEAMS && !harbour.half && !starsHalf) return;
    dprLimit = Infinity;
    beams.setMaxBeams(BEAMS);
    harbour.setHalf(false);
    setStarsHalf(false);
    steps.push({ at: Math.round(performance.now() - t0), step: 'full quality after a turn' });
    ring.n = 0;
  };

  // ---- Loop (8.6) ----
  const subs = new Set<(time: number, delta: number) => void>();
  const t0 = performance.now();
  let last = t0;
  /** The pacing slot the last drawn frame filled. */
  let slot = -Infinity;
  /** The last display tick (NaN after the loop stops), and whether it drew. */
  let prevTick = NaN;
  let prevDrew = true;
  let raf = 0;
  let frozen = false;
  let disposed = false;
  let lost = false;
  let hidden = document.visibilityState === 'hidden';
  let frames = 0;
  /** The last scroll, input, intro step, morph or interaction (keepAwake), and the last scroll. */
  let activeAt = t0;
  let scrollAt = -Infinity;
  /** Whether frames come at the resting rate (30 fps on touch with nothing moving). */
  let resting = false;
  const keepAwake = () => {
    activeAt = performance.now();
  };

  const draw = (now: number) => {
    const time = (now - t0) / 1000;
    const gap = now - last;
    const delta = Math.min(0.1, gap / 1000);
    last = now;
    if (motion) U.uTime.value = time;
    // parallax eases with about a 600 ms lag (time constant 0.2 s)
    const k = 1 - Math.exp(-delta / 0.2);
    par.x += (par.tx - par.x) * k;
    par.y += (par.ty - par.y) * k;
    updateHighlight(time);
    for (const cb of subs) cb(time, delta);
    placeCamera();
    interactions.update(now);
    spill.update(delta, canvas.width, canvas.height);
    shooting.update(now, { w: canvas.width, h: canvas.height });
    beams.update(now, delta, motion, U.uWake.value);
    harbour.prerender(renderer, camera);
    renderer.render(scene, camera);
    frames++;
  };
  // One loop, at most one pending frame. A requestRender() while a frame is drawing (from an
  // onFrame callback, say) does nothing: the frame being drawn already carries the change, and the
  // loop schedules the next one itself unless the world is frozen.
  let drawing = false;
  const tick = (now: number) => {
    raf = 0;
    if (disposed || lost) return;
    resting = touch && motion && !frozen && now - activeAt > IDLE_AFTER;
    // The interval since the last tick: after a tick that drew nothing (with the loop running) it
    // is the cadence; while scrolling at the full rate it is what the step-down judges.
    const gap = now - prevTick;
    prevTick = now;
    if (gap > 0) {
      if (!prevDrew && !frozen) noteIdle(now, gap);
      if (motion && !frozen && !resting && frames > 0 && now - scrollAt < STEP.scrollHold) sample(now, gap);
    }
    const frame = resting ? IDLE_FRAME : FRAME;
    if (probe > 0 || now < slot + frame - SLACK) {
      if (probe > 0) probe--;
      prevDrew = false;
      start();
      return;
    }
    slot = now - (slot + frame) > frame ? now : slot + frame;
    prevDrew = true;
    drawing = true;
    try {
      draw(now);
    } finally {
      drawing = false;
    }
    if (!frozen && !hidden) start();
    else prevTick = NaN;
  };
  const start = () => {
    if (!raf && !drawing && !disposed && !lost) raf = requestAnimationFrame(tick);
  };
  function requestRender() {
    start();
  }
  const onVis = () => {
    hidden = document.visibilityState === 'hidden';
    prevTick = NaN;
    if (!hidden) {
      last = performance.now();
      keepAwake();
      start();
    }
  };
  document.addEventListener('visibilitychange', onVis);
  window.addEventListener('resize', onResize);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  ro?.observe(canvas);
  // Scrolling and any input keep the full frame rate (and scrolling is when the step-down measures).
  const onScroll = () => {
    scrollAt = performance.now();
    activeAt = scrollAt;
  };
  const AWAKE: (keyof WindowEventMap)[] = ['pointerdown', 'pointermove', 'touchstart', 'touchmove', 'wheel', 'keydown'];
  window.addEventListener('scroll', onScroll, { passive: true });
  for (const type of AWAKE) window.addEventListener(type, keepAwake, { passive: true });

  // ---- Context loss (8.8) ----
  // iOS drops WebGL contexts when memory is tight or the tab has been in the background. While the
  // context is gone the page shows the still (html.world-lost, styled like no-webgl). three.js
  // re-creates its GPU state from the copies it keeps when the context comes back (its listener
  // runs before this one); then the view is rebuilt and every program compiled again.
  let losses = 0;
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    losses++;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    prevTick = NaN;
    document.documentElement.classList.add('world-lost');
  };
  const onRestored = () => {
    lost = false;
    rebuild();
    renderer.compile(scene, camera);
    document.documentElement.classList.remove('world-lost');
    last = performance.now();
    keepAwake();
    start();
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  rebuild(false);
  // Compile every program now, so the first scroll doesn't stall.
  renderer.compile(scene, camera);
  start();

  const world: World & { city: typeof city; path: () => CameraPath; stats: () => Record<string, unknown> } = {
    renderer,
    scene,
    camera,
    tier,
    landmarks,
    get cameraKeys() {
      return path.keys;
    },
    setCameraProgress(next: number) {
      const v = Math.min(1, Math.max(0, next));
      if (v !== u) keepAwake();
      u = v;
      placeCamera();
      if (frozen) requestRender();
    },
    getCameraPose(at: number): CameraPose {
      return poseToCameraPose(path.pose(at));
    },
    setIntro(p: { sky: number; wake: number }) {
      const sky = clamp01(p.sky);
      const wake = clamp01(p.wake);
      if (sky !== U.uSkyFade.value || wake !== U.uWake.value) keepAwake();
      U.uSkyFade.value = sky;
      U.uWake.value = wake;
      if (frozen) requestRender();
    },
    setLift(maxRank: number, amount: number) {
      const a = clamp01(amount);
      if (maxRank !== U.uLift.value.x || a !== U.uLift.value.y) keepAwake();
      U.uLift.value.set(maxRank, a);
      if (frozen) requestRender();
    },
    setHighlight(key, strength) {
      hiKey = key;
      hiStrength = key ? clamp01(strength) : 0;
      if (frozen) requestRender();
    },
    setPointer(ndc) {
      interactions.setPointer(ndc);
    },
    pulse(ndc) {
      keepAwake();
      return interactions.pulse(ndc);
    },
    setSpill(color, strength, center) {
      spill.set(color, strength, center);
    },
    shootingStar(ndc) {
      keepAwake();
      return shooting.fire(ndc);
    },
    lightShow(on: boolean) {
      beams.setShow(on);
    },
    setBeamKeepOut(boxes) {
      beams.setKeepOut(boxes);
    },
    get lightShowOn() {
      return beams.showOn;
    },
    sampleLitWindows(count: number, maxRank: number): LitWindowSamples {
      const hp = path.poses.hero.pos;
      if (hp.distanceTo(visFor) > 1) {
        vis = visibleFrom(city, wins, hp.x, hp.y, hp.z);
        visFor = hp.clone();
      }
      return sampleWindows(city, wins, vis, count, maxRank);
    },
    onFrame(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    onRebuild(cb) {
      rebuildSubs.add(cb);
      return () => rebuildSubs.delete(cb);
    },
    keepAwake,
    viewSize() {
      return { width, height };
    },
    setMotion(enabled: boolean) {
      motion = enabled;
      U.uMotion.value = enabled ? 1 : 0;
      if (!enabled) U.uTime.value = 0;
      if (frozen) requestRender();
    },
    setFrozen(f: boolean) {
      frozen = f;
      if (!f) {
        last = performance.now();
        start();
      }
    },
    requestRender,
    resize() {
      rebuild();
    },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(settleTimer);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      window.removeEventListener('scroll', onScroll);
      for (const type of AWAKE) window.removeEventListener(type, keepAwake);
      document.removeEventListener('visibilitychange', onVis);
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      ro?.disconnect();
      offLayout();
      rebuildSubs.clear();
      harbour.dispose();
      scene.traverse((o) => {
        const m = o as unknown as { geometry?: { dispose(): void }; material?: { dispose(): void; uniforms?: Record<string, { value: unknown }> } };
        m.geometry?.dispose();
        if (m.material) {
          for (const k in m.material.uniforms ?? {}) {
            const v = m.material.uniforms![k].value as { isTexture?: boolean; dispose?: () => void };
            if (v && v.isTexture) v.dispose?.();
          }
          m.material.dispose();
        }
      });
      subs.clear();
      renderer.dispose();
    },
    // Not in the contract: handy for the lab page.
    city,
    path: () => path,
    stats: () => ({
      tier: tier.tier,
      gpu,
      towers: city.towers.length,
      segments: city.towers.reduce((s, t) => s + t.segs.length, 0),
      litFrontWindows: wins.length,
      litShareFront: (wins.length / frontCells).toFixed(3),
      reflectionBakes: bakesDone,
      reflectionStats: JSON.stringify(harbour.stats),
      visibleLitFront: vis.reduce((s, v) => s + v, 0),
      stars: skyParts.count,
      starsInView: starsInView(skyParts, camera),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      frames,
      heroDistance: Math.round(path.heroDistance),
      dpr: renderer.getPixelRatio(),
      // 8.3 to 8.8, for scripts/devices.mjs and scripts/perf.mjs
      rebuilds,
      fits,
      steps: steps.map((st) => ({ ...st })),
      quality: { dpr: renderer.getPixelRatio(), beams: beams.maxBeams, harbourHalf: harbour.half, starsHalf },
      lastP90: Math.round(lastP90 * 10) / 10,
      cadence: Math.round(cadence() * 10) / 10,
      probes,
      resting,
      touch,
      contextLosses: losses,
    }),
  };
  return world;
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}
function rgbHex(c: [number, number, number]) {
  return (Math.round(c[0] * 255) << 16) | (Math.round(c[1] * 255) << 8) | Math.round(c[2] * 255);
}
