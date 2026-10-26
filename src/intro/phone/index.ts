// index.ts: the intro module's folding phone (V4.md 6.1, 8.5 to 8.8; V5.md section 1): its
// lifecycle, the render-on-demand loop and context loss. Intro.astro loads this chunk (three comes
// from the world's chunks, not a second copy) once the module is within 1.5 screens, and calls
// mountPhone(box, { motion, hint }) on its [data-intro-phone] box.
//
// Lifecycle:
//   - WebGL: checked by making the phone canvas's own context, so no probe context is ever left
//     alive. three r186 needs WebGL 2; without it the box keeps the still (Intro.astro's <img> of
//     the closed phone) and stays a picture (role img).
//   - Before the entrance, and before anything is drawn: the photos are fetched and decoded with
//     createImageBitmap (screens.ts), the room's reflections are built once in idle time
//     (requestIdleCallback, 1 s timeout) and the generator freed, and every material is compiled
//     and every texture uploaded, so the first frames on screen don't stall.
//   - The first frame waits until the box is on screen; then the canvas fades in over the still
//     (class is-live) and the box becomes a button (role button, aria-pressed with the fold,
//     aria-label "Open the phone" or "Close the phone", described by what its screens show) and a
//     tab stop. With motion the still stays hidden until then (it shows the closed display pose,
//     the entrance starts from another); with reduced motion it stands in until that first frame,
//     which matches it.
//   - The hint under the phone ("Click to open", "Tap to open"; Intro.astro) fades in with the
//     first frame and out after the first open, and doesn't come back this visit (sessionStorage).
//   - The entrance starts when 40% of the box is in view (an IntersectionObserver, not a scroll
//     position). From then on the canvas floats (about 4 px and 2 degrees over 6 s): a CSS
//     animation on the canvas element (Intro.astro), never a redraw, paused off screen.
//   - When the box leaves the screen the phone is put away: shut, in the closed display pose, so
//     it's always closed when you come back.
//
// Drawing (8.6): on demand only, while the entrance plays, a held phone follows its drag, its
// inertia runs, a fold plays, or it eases back to a display pose (controls.ts), and only while the
// box is on screen and the tab visible, at most 60 frames a second. Otherwise nothing at all.
// Pixel ratio (8.5): min(devicePixelRatio, 2), and lower where that would make the drawing buffer
// (the canvas, with its bleed) bigger than 1.3 megapixels.
// The canvas reaches 15% (of the box's narrower side) past the box on every side, so a turned
// corner isn't cut off; the camera frames the box, so the phone's size follows the box.
// Context loss (8.8): on webglcontextlost it calls preventDefault and shows the still; on
// webglcontextrestored it rebuilds what the GPU lost (three re-uploads the geometry and textures;
// the reflections are built again and every material recompiled) and the phone comes back as it
// was (folded or not, turned or not; an entrance cut short ends in its display pose).

import { Color, DirectionalLight, Group, Mesh, MeshBasicMaterial, NeutralToneMapping, PerspectiveCamera, PlaneGeometry, Scene, SRGBColorSpace, Vector3, WebGLRenderer, type Material, type Texture, type WebGLRenderTarget } from 'three';
import { PALETTE } from '../../world/palette';
import { createControls } from './controls';
import { buildDevice, SIZE, type Device } from './device';
import { DEG, displayPose, Entrance, Fold, qClosed, qStart, quat } from './entrance';
import { applyEnvironment, buildEnvironment, PHONE_COLORS, shadowMap } from './materials';
import { loadPhoto, photoUrls, type Photo } from './screens';

export interface PhoneOptions {
  motion: boolean;
  /** The hint under the phone ([data-phone-hint]), if any. */
  hint?: HTMLElement | null;
}

export interface Phone {
  dispose(): void;
}

/** The phone canvas's context: transparent over the page, antialiased, no stencil. */
const CONTEXT: WebGLContextAttributes = { alpha: true, antialias: true, premultipliedAlpha: true, depth: true, stencil: false, powerPreference: 'high-performance' };
/**
 * Half the box's narrower side, in mm at the phone's centre. The display pose, the entrance and
 * the fold stay inside the box (measured: nothing reaches its edge).
 */
const FIT_RADIUS = 98;
/** The canvas reaches this far past the box on each side (of its narrower side), for drags. */
const BLEED = 0.15;
const FOV = 22;
const MAX_DPR = 2;
const MAX_BUFFER = 1.3e6;
/** A frame is drawn only once this much time has passed since the last (a 60 fps cap). */
const MIN_FRAME_MS = 15;
/** How much of the box must be in view before the entrance plays. */
const ENTRANCE_AT = 0.4;
/** The contact shadow's floor, as a share of FIT_RADIUS below the phone's centre (apply()). */
const FLOOR = 0.94;
/** The hint's top sits this far (CSS px) below that floor, just under the shadow. */
const HINT_GAP = 10;
/** Remembers, for this visit, that the phone has been opened (the hint doesn't come back). */
const OPENED_KEY = 'intro-phone:opened';

/** What one WebGL context draws with; built again after a context loss. */
interface Stage {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  device: Device;
  rig: Group;
  spin: Group;
  shadow: Mesh<PlaneGeometry, MeshBasicMaterial>;
  env: WebGLRenderTarget | null;
}

/** Runs fn in idle time (within timeout ms), or soon where the browser has no idle callbacks. */
const idle = <T>(fn: () => T, timeout = 1000) =>
  new Promise<T>((resolve, reject) => {
    const run = () => {
      try {
        resolve(fn());
      } catch (error) {
        reject(error);
      }
    };
    if (typeof window.requestIdleCallback === 'function') window.requestIdleCallback(run, { timeout });
    else setTimeout(run, 1);
  });

const freePhoto = (p: Photo) => {
  if ('close' in p) p.close();
};

export function mountPhone(box: HTMLElement, opts: PhoneOptions): Phone {
  const html = document.documentElement;
  const motion = opts.motion && !html.hasAttribute('data-snapshot');
  const params = new URLSearchParams(location.search);
  const debug = params.has('debug');
  // ?debug&dpr=2: a fixed pixel ratio, past the caps (the still tool only).
  const fixedDpr = debug && params.has('dpr') ? Number(params.get('dpr')) : undefined;

  const hint = opts.hint ?? null;
  // The box is a picture (the still) until the live phone is up, then a button.
  const stillLabel = box.getAttribute('aria-label') ?? '';
  const openLabel = box.dataset.openLabel ?? 'Open the phone';
  const closeLabel = box.dataset.closeLabel ?? 'Close the phone';
  const describedBy = box.dataset.describedby;
  const opened = () => {
    try {
      return window.sessionStorage.getItem(OPENED_KEY) === '1';
    } catch {
      return false;
    }
  };
  const hideHint = (remember: boolean) => {
    if (!hint) return;
    hint.classList.remove('is-in');
    if (!remember) return;
    hint.classList.add('is-gone');
    try {
      window.sessionStorage.setItem(OPENED_KEY, '1');
    } catch {
      // Storage blocked: the hint stays gone until the page reloads.
    }
  };

  const showStill = () => {
    box.classList.remove('is-live');
    box.classList.add('is-still');
    box.setAttribute('role', 'img');
    box.setAttribute('aria-label', stillLabel);
    box.removeAttribute('aria-pressed');
    box.removeAttribute('aria-describedby');
    hideHint(false);
    // No keyboard controls any more. A box that has focus keeps it until focus moves on.
    if (document.activeElement !== box) box.removeAttribute('tabindex');
    else {
      box.tabIndex = -1;
      box.addEventListener('blur', dropTab, { once: true });
    }
  };
  function dropTab() {
    box.removeAttribute('tabindex');
  }

  const canvas = document.createElement('canvas');
  let gl: WebGL2RenderingContext | null = null;
  try {
    gl = canvas.getContext('webgl2', CONTEXT);
  } catch {
    gl = null;
  }
  if (!gl) {
    showStill();
    return { dispose() {} };
  }
  const context = gl;
  canvas.setAttribute('aria-hidden', 'true');
  box.append(canvas);

  // ---- State that outlives a context ----
  // It arrives closed, with or without motion.
  const fold = new Fold(false);
  const view = (motion ? qStart : qClosed).clone();
  const entrance = new Entrance(motion);
  let stage: Stage | null = null;
  let ready = false;
  let lost = false;
  let disposed = false;
  let dirty = true;
  let onScreen = false;
  let ratio = 0;
  let raf = 0;
  let last = 0;
  let returnTimer = 0;
  const stats = { renders: 0, builds: 0 };

  const announce = () => {
    box.dataset.phoneOpen = String(fold.open);
    if (!box.classList.contains('is-live')) return;
    box.setAttribute('aria-pressed', String(fold.open));
    box.setAttribute('aria-label', fold.open ? closeLabel : openLabel);
  };
  announce();

  // ---- Size ----
  let width = 1;
  let height = 1;
  let canvasW = 1;
  let canvasH = 1;
  let mmPerPx = 1;
  let radPerPx = 0.01;
  const resize = () => {
    width = Math.max(1, box.clientWidth);
    height = Math.max(1, box.clientHeight);
    const short = Math.min(width, height);
    const bleed = Math.round(BLEED * short);
    canvasW = width + 2 * bleed;
    canvasH = height + 2 * bleed;
    Object.assign(canvas.style, { left: `${-bleed}px`, top: `${-bleed}px`, width: `${canvasW}px`, height: `${canvasH}px` });
    // The box's narrower side spans 2 x FIT_RADIUS at the phone's centre.
    mmPerPx = FIT_RADIUS / (short / 2);
    radPerPx = Math.PI / short;
    // The hint sits under the phone's shadow, not under the box: a box taller than it is wide
    // (stack) leaves room under the phone.
    if (hint) hint.style.top = `${Math.round(box.offsetTop + height / 2 + (FLOOR * FIT_RADIUS) / mmPerPx + HINT_GAP)}px`;
    dirty = true;
    if (!stage) return;
    const dpr = fixedDpr ?? Math.min(window.devicePixelRatio || 1, MAX_DPR, Math.sqrt(MAX_BUFFER / (canvasW * canvasH)));
    stage.renderer.setPixelRatio(dpr);
    stage.renderer.setSize(canvasW, canvasH, false);
    const camera = stage.camera;
    camera.aspect = canvasW / canvasH;
    const dist = ((canvasH / 2) * mmPerPx) / Math.tan((FOV / 2) * DEG);
    camera.position.set(0, 0, dist);
    camera.near = Math.max(1, dist - 300);
    camera.far = dist + 300;
    camera.updateProjectionMatrix();
  };
  resize();

  // ---- Pose ----
  const tmp = new Vector3();
  const Z = new Vector3(0, 0, 1);
  const apply = (s: Stage) => {
    const { device } = s;
    device.setHinge(fold.hinge);
    device.center(tmp);
    device.body.position.copy(tmp).negate();
    s.spin.quaternion.setFromAxisAngle(Z, fold.roll);
    s.rig.quaternion.copy(view);
    s.rig.updateMatrixWorld(true);
    device.clip(device.body.matrixWorld);
    // The contact shadow: as wide as the phone, on an imagined floor at the bottom of the fit
    // circle, tighter and darker as the phone comes closer to it.
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    for (const p of device.bounds) {
      tmp.copy(p).applyMatrix4(device.body.matrixWorld);
      if (tmp.x < minX) minX = tmp.x;
      if (tmp.x > maxX) maxX = tmp.x;
      if (tmp.y < minY) minY = tmp.y;
    }
    const floor = -FIT_RADIUS * FLOOR;
    const near = 1 - Math.min(1, Math.max(0, minY - floor) / 60);
    const w = (maxX - minX) * (0.75 + 0.25 * (1 - near));
    s.shadow.position.set((minX + maxX) / 2, floor, -30);
    s.shadow.scale.set(w, w * 0.13, 1);
    s.shadow.material.opacity = 0.32 + 0.4 * near;
  };

  // ---- Drawing on demand ----
  const controls = createControls({
    box,
    motion,
    view,
    entrance,
    live: () => box.classList.contains('is-live'),
    radPerPx: () => radPerPx,
    isOpen: () => fold.open,
    setOpen(open) {
      if (open === fold.open) return;
      fold.set(open, motion);
      announce();
      if (open) hideHint(true);
      dirty = true;
    },
    kick,
  });
  const busy = () => dirty || entrance.state === 'playing' || fold.moving || controls.busy();
  const wanted = () => ready && !lost && !disposed && onScreen && !document.hidden && busy();

  const render = () => {
    const s = stage!;
    apply(s);
    s.renderer.render(s.scene, s.camera);
    stats.renders++;
    dirty = false;
    if (!box.classList.contains('is-live')) {
      box.classList.add('is-live');
      box.classList.remove('is-still');
      box.dataset.phoneReady = '';
      box.setAttribute('role', 'button');
      if (describedBy) box.setAttribute('aria-describedby', describedBy);
      announce();
      // A tab stop again (a still shown while the box had focus left it at -1, due to go on blur).
      box.removeEventListener('blur', dropTab);
      box.tabIndex = 0;
      if (hint && !fold.open && !opened() && !hint.classList.contains('is-gone')) {
        hint.hidden = false;
        hint.classList.add('is-in');
      }
    }
  };

  /** No frames needed now; wake up when the next ease back or auto-close is due (controls.ts). */
  const sleep = () => {
    window.clearTimeout(returnTimer);
    const due = controls.nextDue();
    if (due === null || disposed) return;
    returnTimer = window.setTimeout(
      () => {
        dirty = true;
        kick();
      },
      Math.max(0, due - performance.now()) + 20,
    );
  };

  const tick = (now: number) => {
    raf = 0;
    if (!wanted()) return sleep();
    // At most 60 frames a second, as the world (8.6): on a 120 Hz screen every other frame waits.
    if (last && now - last < MIN_FRAME_MS) {
      raf = requestAnimationFrame(tick);
      return;
    }
    // The first frame after a rest steps one frame's worth, so a drag that starts moves at once.
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 1 / 60);
    last = now;
    entrance.step(dt, view);
    fold.step(dt);
    controls.step(dt, now);
    render();
    raf = requestAnimationFrame(tick);
  };

  function kick() {
    if (raf || !wanted()) return;
    window.clearTimeout(returnTimer);
    last = 0;
    raf = requestAnimationFrame(tick);
  }

  const startEntrance = () => {
    if (!ready || ratio < ENTRANCE_AT || !entrance.start()) return;
    box.classList.add('is-floating');
    kick();
  };

  /** Off screen: shut, in the closed display pose, so it's closed when the reader comes back. */
  const putAway = () => {
    if (entrance.state === 'waiting') return;
    entrance.finish();
    if (fold.open || fold.moving) {
      fold.set(false, false);
      announce();
    }
    controls.reset(qClosed);
    dirty = true;
  };

  // ---- Visibility ----
  const io = new IntersectionObserver(
    ([entry]) => {
      onScreen = entry.isIntersecting;
      ratio = entry.intersectionRatio;
      box.classList.toggle('is-away', !onScreen);
      if (!onScreen) putAway();
      startEntrance();
      kick();
    },
    { threshold: [0, ENTRANCE_AT] },
  );
  io.observe(box);
  const ro = new ResizeObserver(() => {
    resize();
    kick();
  });
  ro.observe(box);
  const onVisibility = () => kick();
  document.addEventListener('visibilitychange', onVisibility);
  // A window dragged to a screen with another pixel density (or a page zoom) changes the ratio.
  let dprQuery: MediaQueryList | null = null;
  const watchDpr = () => {
    dprQuery?.removeEventListener('change', onDpr);
    dprQuery = window.matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`);
    dprQuery.addEventListener('change', onDpr);
  };
  function onDpr() {
    watchDpr();
    resize();
    kick();
  }
  watchDpr();

  // ---- The scene ----
  // Each step that waits has a number; a context lost (or the phone disposed) meanwhile leaves it
  // stale, and a stale step stops (and frees what it made). A context is lost the moment the GPU
  // drops it, a little before its webglcontextlost event arrives, so a step also stops on
  // isContextLost(): run in that gap, three notes the context's extensions as missing and warns
  // about one of them (KHR_parallel_shader_compile) once it is back.
  let generation = 0;
  const gone = () => disposed || lost || context.isContextLost();

  /** The renderer, the lights and the phone, with its photos on its screens. */
  const assemble = async (): Promise<Stage | null> => {
    const g = ++generation;
    const renderer = new WebGLRenderer({ canvas, context });
    renderer.setClearColor(PHONE_COLORS.black, 0);
    // The hinge cover is cut where it would show between the two screens (device.ts).
    renderer.localClippingEnabled = true;
    renderer.outputColorSpace = SRGBColorSpace;
    renderer.toneMapping = NeutralToneMapping;
    const scene = new Scene();
    const camera = new PerspectiveCamera(FOV, 1, 10, 2000);
    // Light: a faint warm rim (window) from behind on both sides, and a soft cool key in front.
    const rim = new Color().setRGB(PALETTE.window[0], PALETTE.window[1], PALETTE.window[2], SRGBColorSpace);
    const rimL = new DirectionalLight(rim, 1.6);
    rimL.position.set(-2.2, 1.1, -1.4);
    const rimR = new DirectionalLight(rim, 1.0);
    rimR.position.set(2.4, -0.7, -1.2);
    const key = new DirectionalLight(PHONE_COLORS.key, 1.5);
    key.position.set(-0.8, 1.2, 2.5);
    scene.add(rimL, rimR, key);

    const urls = photoUrls();
    const photos = await Promise.all([loadPhoto(urls.cover), loadPhoto(urls.inner)]);
    if (g !== generation || gone()) {
      photos.forEach(freePhoto);
      renderer.dispose();
      return null;
    }
    const device = buildDevice({ cover: photos[0], inner: photos[1] }, renderer.capabilities.getMaxAnisotropy());
    // The screens hold their own copies (screens.ts draws each photo into its texture).
    photos.forEach(freePhoto);

    // rig (the turn) > spin (the quarter turn) > body (shifted so it turns about its middle)
    const rig = new Group();
    const spin = new Group();
    spin.add(device.body);
    rig.add(spin);
    scene.add(rig);
    const shadow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ color: PHONE_COLORS.shadow, map: shadowMap(), transparent: true, depthWrite: false, opacity: 0.5, toneMapped: false }));
    shadow.renderOrder = -1;
    scene.add(shadow);
    const s: Stage = { renderer, scene, camera, device, rig, spin, shadow, env: null };
    stage = s;
    resize();
    return s;
  };

  /**
   * Everything the first frame needs on the GPU: the room's reflections (built once, in idle
   * time, the generator freed), every material compiled (off the main thread where the browser
   * allows) and every texture uploaded, while the box may still be below the window. Run again
   * after a lost context comes back.
   */
  const prepare = async (s: Stage): Promise<boolean> => {
    const g = ++generation;
    const stale = () => g !== generation || gone();
    const env = await idle(() => (stale() ? null : buildEnvironment(s.renderer)));
    if (!env) return false;
    if (stale()) {
      env.dispose();
      return false;
    }
    s.env = env;
    applyEnvironment(s.device.body, env.texture);
    apply(s);
    await s.renderer.compileAsync(s.scene, s.camera);
    if (stale()) return false;
    s.scene.traverse((obj) => {
      const mats = (obj as Mesh).material;
      for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
        for (const value of Object.values(m)) if ((value as Texture | null)?.isTexture) s.renderer.initTexture(value as Texture);
      }
    });
    stats.builds++;
    ready = true;
    dirty = true;
    startEntrance();
    kick();
    return true;
  };

  /** Frees the scene. lose: also release the context (only when the phone goes for good). */
  const teardown = (s: Stage | null, lose: boolean) => {
    if (!s) return;
    s.scene.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      mesh.geometry.dispose();
      for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
        for (const value of Object.values(m as Material)) if ((value as Texture | null)?.isTexture) (value as Texture).dispose();
        (m as Material).dispose();
      }
    });
    s.device.dispose();
    s.env?.dispose();
    s.renderer.dispose();
    if (lose && !context.isContextLost()) s.renderer.forceContextLoss();
  };

  const fail = (error: unknown) => {
    console.error('The intro phone failed to start', error);
    teardown(stage, false);
    stage = null;
    ready = false;
    if (!context.isContextLost()) context.getExtension('WEBGL_lose_context')?.loseContext();
    canvas.remove();
    if (!disposed) showStill();
  };

  const start = () =>
    assemble()
      .then((s) => (s ? prepare(s) : false))
      .catch(fail);

  // ---- Context loss ----
  // three's renderer handles its own side: on a restored context it starts its GPU state afresh
  // and uploads geometry and textures again as it draws (every texture keeps its canvas or data).
  // What it can't bring back is the room's prefiltered reflections, which only ever lived on the
  // GPU: prepare() builds those again, recompiles, and then the phone shows as it was.
  const onLost = (e: Event) => {
    e.preventDefault();
    lost = true;
    ready = false;
    generation++;
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    window.clearTimeout(returnTimer);
    showStill();
  };
  const onRestored = () => {
    if (disposed) return;
    lost = false;
    // An entrance cut short ends where it was going.
    if (entrance.state === 'playing') {
      entrance.finish();
      view.copy(displayPose(fold.open));
    }
    // After three's own handler (on this same event) has started its state afresh. The old
    // reflections died with the context; nothing on the GPU is left to free.
    window.setTimeout(() => {
      if (disposed || lost) return;
      if (!stage) return void start();
      stage.env = null;
      prepare(stage).catch(fail);
    }, 0);
  };
  canvas.addEventListener('webglcontextlost', onLost);
  canvas.addEventListener('webglcontextrestored', onRestored);

  start();

  if (debug) {
    // For the test scripts and the still tool: counters, a pose, a close-up, a lost context (the
    // extension is fetched now: a lost context hands out none, so it couldn't restore itself).
    const loser = context.getExtension('WEBGL_lose_context');
    (window as unknown as { __phone: unknown }).__phone = {
      stats,
      state: () => ({ open: fold.open, hinge: fold.hinge, roll: fold.roll, entrance: entrance.state, ready, lost, raf: raf !== 0, view: view.toArray(), dpr: stage?.renderer.getPixelRatio(), buffer: [canvas.width, canvas.height] }),
      pose(p: { pitch?: number; yaw?: number; roll?: number; hinge?: number; landscape?: number }) {
        if (p.yaw !== undefined) view.copy(quat({ pitch: p.pitch ?? 0, yaw: p.yaw, roll: p.roll ?? 0 }));
        fold.pose(p.hinge ?? fold.hinge, p.landscape !== undefined ? p.landscape * DEG : fold.roll);
        announce();
        entrance.finish();
        controls.stop();
        dirty = true;
        kick();
      },
      /** Zoom the camera onto a point given in the body's own millimetres (or back to the whole phone). */
      focus(point: [number, number, number] | null, zoom = 1) {
        if (!stage) return;
        const { camera, device } = stage;
        camera.clearViewOffset();
        if (point) {
          apply(stage);
          camera.updateMatrixWorld();
          tmp.set(point[0], point[1], point[2]).applyMatrix4(device.body.matrixWorld).project(camera);
          const x = (tmp.x * 0.5 + 0.5) * canvasW;
          const y = (0.5 - tmp.y * 0.5) * canvasH;
          camera.setViewOffset(canvasW, canvasH, x - canvasW / zoom / 2, y - canvasH / zoom / 2, canvasW / zoom, canvasH / zoom);
        }
        dirty = true;
        kick();
      },
      size: SIZE,
      redraw() {
        dirty = true;
        kick();
      },
      lose: () => loser?.loseContext(),
      restore: () => loser?.restoreContext(),
    };
  }

  return {
    dispose() {
      if (disposed) return;
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      window.clearTimeout(returnTimer);
      io.disconnect();
      ro.disconnect();
      dprQuery?.removeEventListener('change', onDpr);
      document.removeEventListener('visibilitychange', onVisibility);
      controls.dispose();
      canvas.removeEventListener('webglcontextlost', onLost);
      canvas.removeEventListener('webglcontextrestored', onRestored);
      teardown(stage, true);
      stage = null;
      canvas.remove();
      box.classList.remove('is-live', 'is-floating');
      showStill();
    },
  };
}
