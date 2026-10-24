// renderer.ts: createWorld, the Hong Kong harbour at night behind the page.
//
// One WebGLRenderer on the page's canvas, no post-processing. Draws, in order: the sky dome, the
// Peak, the towers (one instanced draw), the water, the stars and the small lights. That is six
// draw calls, leaving plenty of the 40-call budget for the signal.

import { PerspectiveCamera, Scene, Vector2, Vector3, WebGLRenderer } from 'three';
import { usePhoneLayout, type CameraPose, type Landmarks, type LitWindowSamples, type SceneKey, type World, type WorldOptions } from './contract';
import { applyPose, buildCameraPath, FOV, poseToCameraPose, type CameraPath, type KeyPose } from './camera-path';
import { generateCity } from './city';
import { buildHarbour } from './harbour';
import { PALETTE } from './palette';
import { buildLights, buildPeak } from './peak';
import { buildSky } from './sky';
import { buildSkyline } from './skyline';
import { detectTier, readGpu } from './tier';
import { litFrontWindows, sampleWindows, visibleFrom } from './windows';

export const DEFAULT_SEED = 0x1997;
const DEG = Math.PI / 180;

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
  };

  // ---- Build the city ----
  const city = generateCity(tier.towers, seed);
  const skyline = buildSkyline(city, U, tier.tier === 'phone' ? 2 : 4);
  const sky = buildSky(U, tier.stars, seed, true);
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
  // Phones and portrait tablets get the phone framing (the same rule the page's CSS uses).
  const isPhoneFrame = () => usePhoneLayout(width, height);
  path = buildCameraPath(city, width / height, isPhoneFrame());

  const wins = litFrontWindows(city);
  let frontCells = 0;
  for (const t of city.towers) for (const sg of t.segs) frontCells += sg.winFloors * sg.colsF;
  const heroPos = path.poses.hero.pos.clone();
  let vis = visibleFrom(city, wins, heroPos.x, heroPos.y, heroPos.z);
  let visFor = heroPos.clone();
  const harbour = buildHarbour(city, wins, vis, heroPos, U);

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
  const touch = window.matchMedia?.('(hover: none), (pointer: coarse)').matches ?? false;
  const par = { tx: 0, ty: 0, x: 0, y: 0 };
  const onPointer = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return;
    par.tx = (e.clientX / window.innerWidth) * 2 - 1;
    par.ty = (e.clientY / window.innerHeight) * 2 - 1;
  };
  window.addEventListener('pointermove', onPointer, { passive: true });

  const placeCamera = () => {
    path.pose(u, base);
    const on = motion && !touch;
    applyPose(camera, base, on ? par.x * 1.5 * DEG : 0, on ? -par.y * 0.8 * DEG : 0);
    sky.position.copy(camera.position);
  };

  const resize = () => {
    measure();
    const dpr = Math.min(window.devicePixelRatio || 1, tier.dprCap);
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    U.uPixelRatio.value = dpr;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    path = buildCameraPath(city, camera.aspect, isPhoneFrame());
    placeCamera();
    requestRender();
  };

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
    if (type === 1) r.set(city.xMin + (wave - 0.06) * city.width, city.xMin + (wave + 0.06) * city.width, s * 0.6, 0);
    else if (type === 2) r.set(city.clusters[0].x0, city.clusters[city.clusters.length - 1].x1, s, 0);
    else if (type === 3) r.set(city.lowBlock.x0, city.lowBlock.x1, s, 0);
    else r.set(0, 0, 0, 0);
  };

  // ---- Loop ----
  const subs = new Set<(time: number, delta: number) => void>();
  const t0 = performance.now();
  let last = t0;
  let raf = 0;
  let frozen = false;
  let disposed = false;
  let hidden = document.visibilityState === 'hidden';
  let frames = 0;

  const draw = (now: number) => {
    const time = (now - t0) / 1000;
    const delta = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (motion) U.uTime.value = time;
    // parallax eases with about a 600 ms lag (time constant 0.2 s)
    const k = 1 - Math.exp(-delta / 0.2);
    par.x += (par.tx - par.x) * k;
    par.y += (par.ty - par.y) * k;
    updateHighlight(time);
    for (const cb of subs) cb(time, delta);
    placeCamera();
    renderer.render(scene, camera);
    frames++;
  };
  const tick = (now: number) => {
    raf = 0;
    if (disposed) return;
    draw(now);
    if (!frozen && !hidden) raf = requestAnimationFrame(tick);
  };
  const start = () => {
    if (!raf && !disposed) raf = requestAnimationFrame(tick);
  };
  function requestRender() {
    start();
  }
  const onVis = () => {
    hidden = document.visibilityState === 'hidden';
    if (!hidden) {
      last = performance.now();
      start();
    }
  };
  document.addEventListener('visibilitychange', onVis);
  const onResize = () => resize();
  window.addEventListener('resize', onResize);
  const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(onResize) : null;
  ro?.observe(canvas);

  resize();
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
      u = Math.min(1, Math.max(0, next));
      placeCamera();
      if (frozen) requestRender();
    },
    getCameraPose(at: number): CameraPose {
      return poseToCameraPose(path.pose(at));
    },
    setIntro(p: { sky: number; wake: number }) {
      U.uSkyFade.value = clamp01(p.sky);
      U.uWake.value = clamp01(p.wake);
      if (frozen) requestRender();
    },
    setLift(maxRank: number, amount: number) {
      U.uLift.value.set(maxRank, clamp01(amount));
      if (frozen) requestRender();
    },
    setHighlight(key, strength) {
      hiKey = key;
      hiStrength = key ? clamp01(strength) : 0;
      if (frozen) requestRender();
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
    resize,
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', onVis);
      ro?.disconnect();
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
      visibleLitFront: vis.reduce((s, v) => s + v, 0),
      calls: renderer.info.render.calls,
      triangles: renderer.info.render.triangles,
      points: renderer.info.render.points,
      frames,
      heroDistance: Math.round(path.heroDistance),
      dpr: renderer.getPixelRatio(),
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
