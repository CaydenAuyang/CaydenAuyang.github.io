// The point figure renderer (Datum design).
//
//   import { mountFigure } from './figure/index.js';
//   const figure = mountFigure(canvas, { srcHi, srcLo, fallbackImg, motionAllowed, isSnapshot, onMotionChange });
//
// Draws Cayden's figure as a dark-on-light stipple of round points with WebGL2 (WebGL1 if that is
// all there is), on a transparent canvas inside the hero's vellum plate.
//   M1  On load (and on replay) the points fly in as two streams: from the Pomfret tick on the
//       plate's left edge (ink) and the Hong Kong tick on its right edge (orange, turning to ink as
//       it lands; 3% stay orange). Quadratic arcs, 1000 to 1300 ms each after a 0 to 450 ms delay
//       taken from the seed byte; all done by 1.8 s. Driven by one time uniform.
//   M2  A fine pointer over the hero turns it up to 5 degrees of yaw and 3 of pitch, smoothed over
//       about 500 ms, easing back when the pointer leaves.
//   M3  As the plate scrolls out of view it turns up to 6 degrees and drifts up to 24 px.
//   M4  With no WebGL, a lost context, or data later than 2.5 s, it cross-fades (240 ms) to the
//       still image. Late data or a restored context cross-fades back.
// The render loop only runs while something moves and the canvas is on screen.
// Reduced motion, Motion: Off and snapshot mode draw one settled still frame; replay() does nothing.
//
// CSS custom properties read from the canvas (inherited from the page's tokens):
//   --figure-point        ink color of the points (and the Pomfret stream)
//   --figure-origin-b     color of the Hong Kong stream and the orange speckle
//   --figure-alpha-floor  alpha of the farthest points (0.55; snapshot 0.8). Nearest are 0.95.
//   --figure-point-scale  point size multiplier (1; snapshot 1.25)
// Changing data-motion, data-snapshot, data-theme, class or style on <html>, or dispatching
// "figure:theme", makes the renderer read them again.
//
// Events: "figure:ready" (bubbles, on the wrapper) when the figure is first drawn, with
// detail.count = points drawn. "figure:replay" on the wrapper reruns M1. "figure:fallback"
// (bubbles) when the still image takes over.

import { loadFigure } from './data.js';
import { parseCssColor } from './color.js';
import { VERT, FRAG } from './shaders.js';

const DEG = Math.PI / 180;
const ASSEMBLE_MS = 1800;
const INK = [0x13 / 255, 0x21 / 255, 0x2d / 255, 1];
const ORANGE = [0xcc / 255, 0x52 / 255, 0x16 / 255, 1];

const DEFAULTS = {
  srcHi: '/figure/figure-hi.bin',
  srcLo: '/figure/figure-lo.bin',
  srcMeta: null, // figure.json with landmarks; defaults to figure.json next to srcHi
  fallbackImg: null,
  descEl: null,
  wrapper: null, // gets data-state; defaults to the closest [data-figure-mount] or the parent
  pointerTarget: null, // element whose hover turns the figure; defaults to the hero section
  device: 'auto', // 'auto' | 'phone' | 'laptop'
  count: 0, // points to draw; 0 = by device (phone 18k or 15k, laptop 60k or 40k)
  still: false, // one settled frame, never animate (used by the fallback renderer)
  yaw: 0, // degrees, base pose
  pitch: 0,
  maxYaw: 5,
  maxPitch: 3,
  scrollYaw: 6,
  scrollDrift: 24, // CSS px
  smoothMs: 170, // time constant of the pointer smoothing (about 500 ms to settle)
  originA: null, // { x, y } in plate fractions (x right, y down); default left edge at data-origin-a-y
  originB: null, // default right edge at data-origin-b-y
  framing: { crown: 0.1, eye: 0.38, shoulder: 0.97 }, // crown and eye as fractions from the top; shoulder = share of width
  fov: 22,
  slowMs: 2500, // cross-fade to the still image if the data is not drawn by then
  fadeMs: 240,
  colors: null, // { point, originB } CSS colors overriding the custom properties
  alphaFloor: null, // number overriding --figure-alpha-floor
  pointScale: null, // number overriding --figure-point-scale
  // Motion rules. Pass the site's helpers from src/components/ui/motion.ts; without them the
  // renderer applies the same rules itself.
  motionAllowed: null,
  isSnapshot: null,
  onMotionChange: null,
  forceWebGL1: false, // testing only
  onReady: null,
  onFallback: null,
};

const html = () => document.documentElement;

function ownIsSnapshot() {
  return html().hasAttribute('data-snapshot');
}
function ownMotionAllowed() {
  let reduce = false;
  try {
    reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    reduce = false;
  }
  return !reduce && html().getAttribute('data-motion') !== 'off' && !ownIsSnapshot();
}

function detectPhone() {
  try {
    const coarse = matchMedia('(pointer: coarse)').matches;
    const minScreen = Math.min(screen.width, screen.height);
    return (coarse && minScreen < 600) || window.innerWidth < 640;
  } catch {
    return window.innerWidth < 640;
  }
}

function num(value, fallback) {
  const n = parseFloat(value);
  return Number.isFinite(n) ? n : fallback;
}

export function mountFigure(canvas, options = {}) {
  const opts = { ...DEFAULTS, ...options, framing: { ...DEFAULTS.framing, ...(options.framing || {}) } };
  const wrapper = opts.wrapper || canvas.closest('[data-figure-mount]') || canvas.parentElement;
  const isSnapshot = typeof opts.isSnapshot === 'function' ? opts.isSnapshot : ownIsSnapshot;
  const motionAllowed = typeof opts.motionAllowed === 'function' ? opts.motionAllowed : ownMotionAllowed;
  const cleanups = [];
  const listen = (target, type, fn, o) => {
    if (!target) return;
    target.addEventListener(type, fn, o);
    cleanups.push(() => target.removeEventListener(type, fn, o));
  };
  const setState = (s) => wrapper && wrapper.setAttribute('data-state', s);
  const emit = (type, detail) => {
    try {
      (wrapper || canvas).dispatchEvent(new CustomEvent(type, { bubbles: true, detail }));
    } catch {
      // Old browsers without CustomEvent: nothing listens there anyway.
    }
  };

  const phone = opts.device === 'phone' || (opts.device === 'auto' && detectPhone());
  const nav = navigator;
  const wantCount =
    opts.count > 0
      ? opts.count
      : phone
        ? nav.deviceMemory && nav.deviceMemory <= 4 ? 15000 : 18000
        : nav.hardwareConcurrency && nav.hardwareConcurrency <= 4 ? 40000 : 60000;
  const maxDpr = phone ? 1.5 : 2;
  const baseCssSize = phone ? 2.0 : 1.6;

  const stats = { device: phone ? 'phone' : 'laptop', file: null, count: 0, webgl: 0, frameMs: 0, fps: 0, frames: 0, assembled: false, state: 'loading', reason: null };
  let destroyed = false;
  let failed = false;
  let gl = null;
  let prog = null;
  let buffer = null;
  let loc = {};
  let data = null;
  let landmarks = null;
  let drawCount = 0;
  let maxPointPx = 64;
  let raf = 0;
  let inView = true;
  let pageVisible = !document.hidden;
  let motion = !opts.still && motionAllowed();
  let clock = 0; // ms of M1 played
  let assembling = motion;
  let lastFrame = 0;
  let lastDraw = 0;
  let readyFired = false;
  let fallbackShown = false;
  let theme = null;
  let width = 0;
  let height = 0;
  let cssW = 0;
  let cssH = 0;
  let dpr = 1;
  const pose = { yaw: 0, pitch: 0, drift: 0, pYaw: 0, pPitch: 0, sYaw: 0, sDrift: 0 };
  const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;

  // ---- M4: fallback cross-fade -----------------------------------------------------------------

  function showFallback(reason) {
    if (fallbackShown || destroyed) return;
    fallbackShown = true;
    stats.reason = String(reason && reason.message ? reason.message : reason);
    const img = opts.fallbackImg;
    if (wrapper) wrapper.setAttribute('data-fallback-shown', '');
    const fade = () => requestAnimationFrame(() => requestAnimationFrame(() => fallbackShown && setState('fallback')));
    if (img) {
      img.hidden = false;
      img.loading = 'eager';
      const wait = img.decode ? img.decode().catch(() => {}) : Promise.resolve();
      Promise.race([wait, new Promise((r) => setTimeout(r, 1500))]).then(fade);
    } else fade();
    if (opts.descEl) opts.descEl.hidden = true;
    if (typeof opts.onFallback === 'function') opts.onFallback(stats.reason);
    emit('figure:fallback', { reason: stats.reason });
  }

  function hideFallback() {
    if (!fallbackShown || failed) return;
    fallbackShown = false;
    setState('ready');
    if (opts.descEl) opts.descEl.hidden = false;
  }

  function fail(reason) {
    if (failed || destroyed) return;
    stop();
    showFallback(reason);
    failed = true;
    stats.state = 'fallback';
  }

  // ---- WebGL setup -----------------------------------------------------------------------------

  function createContext() {
    const attrs = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      // Kept so printing and screenshots capture the last frame. The loop stops when idle,
      // so the extra copy only costs while something moves.
      preserveDrawingBuffer: true,
      powerPreference: 'default',
    };
    let ctx = null;
    try {
      ctx = opts.forceWebGL1 ? null : canvas.getContext('webgl2', attrs);
      stats.webgl = ctx ? 2 : 0;
      if (!ctx) {
        ctx = canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
        stats.webgl = ctx ? 1 : 0;
      }
    } catch {
      ctx = null;
    }
    return ctx;
  }

  function compile(type, src) {
    const sh = gl.createShader(type);
    gl.shaderSource(sh, src);
    gl.compileShader(sh);
    if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(sh);
      gl.deleteShader(sh);
      throw new Error('figure: shader error ' + log);
    }
    return sh;
  }

  function initGL() {
    const vs = compile(gl.VERTEX_SHADER, VERT);
    const fs = compile(gl.FRAGMENT_SHADER, FRAG);
    prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.bindAttribLocation(prog, 0, 'aPos');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
      throw new Error('figure: link error ' + gl.getProgramInfoLog(prog));
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    gl.useProgram(prog);
    loc = {};
    for (const name of ['aPos', 'aNrm', 'aAttr', 'aSeed']) loc[name] = gl.getAttribLocation(prog, name);
    for (const name of [
      'uCenter', 'uHalf', 'uPivot', 'uScale', 'uRot', 'uCamDist', 'uFocal', 'uNdcScale', 'uNdcOffset',
      'uZRange', 'uSize', 'uMaxPx', 'uTime', 'uOriginA', 'uOriginB', 'uAspect', 'uInk', 'uOrange',
      'uInkAlpha', 'uAlphaFloor',
    ]) loc[name] = gl.getUniformLocation(prog, name);
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    maxPointPx = range ? Math.min(64, range[1]) : 64;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); // normal blending, premultiplied
  }

  function uploadData() {
    if (!data) return;
    buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, data.body, gl.STATIC_DRAW);
    const o = data.offsets;
    const bind = (name, size, type, normalized, offset) => {
      const l = loc[name];
      if (l < 0) return;
      gl.enableVertexAttribArray(l);
      gl.vertexAttribPointer(l, size, type, normalized, 0, offset);
    };
    bind('aPos', 3, gl.SHORT, true, o.pos);
    bind('aNrm', 2, gl.UNSIGNED_BYTE, false, o.nrm);
    bind('aAttr', 1, gl.UNSIGNED_BYTE, false, o.attr);
    bind('aSeed', 1, gl.UNSIGNED_BYTE, false, o.seed);
  }

  // ---- Theme, origins, landmarks ---------------------------------------------------------------

  function readTheme() {
    const cs = getComputedStyle(canvas);
    const c = opts.colors || {};
    theme = {
      ink: parseCssColor(c.point || cs.getPropertyValue('--figure-point'), INK),
      orange: parseCssColor(c.originB || cs.getPropertyValue('--figure-origin-b'), ORANGE),
      floor: opts.alphaFloor != null ? opts.alphaFloor : num(cs.getPropertyValue('--figure-alpha-floor'), 0.55),
      scale: opts.pointScale != null ? opts.pointScale : num(cs.getPropertyValue('--figure-point-scale'), 1),
    };
    // Snapshot mode: darker, slightly larger points even if the page's tokens do not say so.
    if (isSnapshot()) {
      theme.floor = Math.max(theme.floor, 0.8);
      theme.scale = Math.max(theme.scale, 1.25);
    }
  }

  // Stream origins in plate fractions: data-origin-a-y / -b-y on the closest [data-figure] (or any
  // ancestor that has them), else the inherited --origin-a-y / --origin-b-y, else 0.20 / 0.69.
  function readOrigins() {
    const holder = canvas.closest('[data-figure][data-origin-a-y]') || canvas.closest('[data-origin-a-y]');
    const cs = getComputedStyle(canvas);
    const ay = num(holder && holder.getAttribute('data-origin-a-y'), num(cs.getPropertyValue('--origin-a-y'), 0.2));
    const by = num(holder && holder.getAttribute('data-origin-b-y'), num(cs.getPropertyValue('--origin-b-y'), 0.69));
    return { a: opts.originA || { x: 0, y: ay }, b: opts.originB || { x: 1, y: by } };
  }

  function boundsLandmarks() {
    const h = data.max[1] - data.min[1];
    return {
      crownY: data.max[1],
      eyeY: data.max[1] - 0.23 * h,
      neckY: data.max[1] - 0.41 * h,
      shoulderHalfWidth: (data.max[0] - data.min[0]) / 2,
      centerX: data.center[0],
    };
  }

  // ---- Size and framing ------------------------------------------------------------------------

  function resize() {
    cssW = canvas.clientWidth || (wrapper && wrapper.clientWidth) || 300;
    cssH = canvas.clientHeight || (wrapper && wrapper.clientHeight) || 333;
    dpr = Math.min(window.devicePixelRatio || 1, maxDpr);
    const w = Math.max(1, Math.round(cssW * dpr));
    const h = Math.max(1, Math.round(cssH * dpr));
    if (w !== width || h !== height) {
      width = w;
      height = h;
      canvas.width = w;
      canvas.height = h;
      return true;
    }
    return false;
  }

  // Framing inside the plate: crown about 10% below the top edge, eyeline near 38% down, the
  // shoulders crossing the bottom edge and nearly touching both sides. s is NDC per model unit.
  function frame() {
    const lm = landmarks || boundsLandmarks();
    const f = opts.framing;
    const aspect = width / height;
    const crownNdc = 1 - 2 * f.crown;
    const sEye = (2 * (f.eye - f.crown)) / Math.max(1e-6, lm.crownY - lm.eyeY);
    const sShoulder = (f.shoulder * aspect) / Math.max(1e-6, lm.shoulderHalfWidth);
    const sBottom = (crownNdc + 1) / Math.max(1e-6, lm.crownY - data.min[1]); // bust reaches the bottom edge
    const s = Math.max(Math.min(sEye, sShoulder), sBottom);
    const pivot = [lm.centerX, lm.neckY != null ? lm.neckY : data.center[1], data.center[2]];
    const viewScale = 2 / Math.max(1e-9, data.max[1] - data.min[1]);
    const focal = 1 / Math.tan((opts.fov * DEG) / 2);
    const camDist = 1.35 * focal;
    const k = focal / camDist;
    const ny = s / (viewScale * k);
    return {
      pivot,
      viewScale,
      focal,
      camDist,
      ndcScale: [ny / aspect, ny],
      offset: [0, crownNdc - (lm.crownY - pivot[1]) * s],
      zRange: [(data.min[2] - pivot[2]) * viewScale, (data.max[2] - pivot[2]) * viewScale],
      aspect,
    };
  }

  // ---- Drawing ---------------------------------------------------------------------------------

  function rotation(yaw, pitch) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    return new Float32Array([c, sp * s, -cp * s, 0, cp, sp, s, -sp * c, cp * c]); // Rx * Ry, column major
  }

  function draw(settled) {
    if (!gl || !data || failed || gl.isContextLost()) return;
    const t0 = performance.now();
    const f = frame();
    const origins = readOriginsCached();
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(prog);
    gl.uniform3fv(loc.uCenter, data.center);
    gl.uniform3fv(loc.uHalf, data.half);
    gl.uniform3fv(loc.uPivot, f.pivot);
    gl.uniform1f(loc.uScale, f.viewScale);
    gl.uniformMatrix3fv(loc.uRot, false, rotation(opts.yaw * DEG + pose.yaw, opts.pitch * DEG + pose.pitch));
    gl.uniform1f(loc.uCamDist, f.camDist);
    gl.uniform1f(loc.uFocal, f.focal);
    gl.uniform2f(loc.uNdcScale, f.ndcScale[0], f.ndcScale[1]);
    gl.uniform2f(loc.uNdcOffset, f.offset[0], f.offset[1] - (pose.drift * 2) / Math.max(1, cssH));
    gl.uniform2f(loc.uZRange, f.zRange[0], f.zRange[1]);
    gl.uniform1f(loc.uSize, baseCssSize * theme.scale * dpr);
    gl.uniform1f(loc.uMaxPx, maxPointPx);
    gl.uniform1f(loc.uTime, settled ? 1e7 : clock);
    gl.uniform2f(loc.uOriginA, origins.a.x * 2 - 1, 1 - origins.a.y * 2);
    gl.uniform2f(loc.uOriginB, origins.b.x * 2 - 1, 1 - origins.b.y * 2);
    gl.uniform1f(loc.uAspect, f.aspect);
    gl.uniform3f(loc.uInk, theme.ink[0], theme.ink[1], theme.ink[2]);
    gl.uniform3f(loc.uOrange, theme.orange[0], theme.orange[1], theme.orange[2]);
    gl.uniform1f(loc.uInkAlpha, theme.ink[3]);
    gl.uniform1f(loc.uAlphaFloor, theme.floor);
    gl.drawArrays(gl.POINTS, 0, drawCount);
    const now = performance.now();
    const ms = now - t0;
    stats.frameMs = stats.frames ? stats.frameMs * 0.9 + ms * 0.1 : ms;
    if (lastDraw && now - lastDraw < 500) {
      const inst = 1000 / Math.max(1, now - lastDraw);
      stats.fps = stats.fps ? stats.fps * 0.9 + inst * 0.1 : inst;
    }
    lastDraw = now;
    stats.frames++;
    if (stats.state !== 'ready') {
      stats.state = 'ready';
      if (!fallbackShown) setState('ready');
    }
    if (!readyFired) {
      readyFired = true;
      if (typeof opts.onReady === 'function') opts.onReady(stats);
      emit('figure:ready', { count: drawCount });
    }
  }

  let originCache = null;
  function readOriginsCached() {
    if (!originCache) originCache = readOrigins();
    return originCache;
  }

  function drawStill() {
    pose.yaw = pose.pitch = pose.drift = 0;
    pose.pYaw = pose.pPitch = pose.sYaw = pose.sDrift = 0;
    assembling = false;
    stats.assembled = true;
    resize();
    draw(true);
  }

  // ---- Loop ------------------------------------------------------------------------------------

  function step(dt) {
    const k = 1 - Math.exp(-dt / opts.smoothMs);
    const tYaw = pose.pYaw + pose.sYaw;
    const tPitch = pose.pPitch;
    pose.yaw += (tYaw - pose.yaw) * k;
    pose.pitch += (tPitch - pose.pitch) * k;
    pose.drift += (pose.sDrift - pose.drift) * k;
    const moving = Math.abs(tYaw - pose.yaw) > 0.00005 || Math.abs(tPitch - pose.pitch) > 0.00005 || Math.abs(pose.sDrift - pose.drift) > 0.05;
    if (!moving) {
      pose.yaw = tYaw;
      pose.pitch = tPitch;
      pose.drift = pose.sDrift;
    }
    return moving;
  }

  function frameTick(now) {
    raf = 0;
    if (!active()) return;
    if (!motion) {
      drawStill();
      return;
    }
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    const resized = resize();
    if (assembling) {
      clock += dt;
      if (clock >= ASSEMBLE_MS) {
        assembling = false;
        stats.assembled = true;
      }
    }
    const moving = step(dt);
    draw(!assembling && clock >= ASSEMBLE_MS);
    if (assembling || moving || resized) raf = requestAnimationFrame(frameTick);
    else lastFrame = 0; // settled and idle: the loop stops until something changes
  }

  function active() {
    return !destroyed && !failed && data && gl && inView && pageVisible;
  }

  function schedule() {
    if (raf || !active()) return;
    if (!motion) {
      drawStill();
      return;
    }
    raf = requestAnimationFrame(frameTick);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = 0;
  }

  // ---- M2 and M3 -------------------------------------------------------------------------------

  const fine = (() => {
    try {
      return matchMedia('(pointer: fine)').matches;
    } catch {
      return false;
    }
  })();
  const hoverEl = opts.pointerTarget || canvas.closest('section') || canvas.closest('[data-figure]') || wrapper;

  function onPointerMove(e) {
    if (!motion || !fine || e.pointerType === 'touch') return;
    const r = canvas.getBoundingClientRect();
    const hr = hoverEl.getBoundingClientRect();
    const nx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / Math.max(1, hr.width / 2)));
    const ny = Math.max(-1, Math.min(1, (e.clientY - (r.top + r.height / 2)) / Math.max(1, hr.height / 2)));
    pose.pYaw = nx * opts.maxYaw * DEG;
    pose.pPitch = ny * opts.maxPitch * DEG;
    schedule();
  }

  function onPointerLeave() {
    pose.pYaw = 0;
    pose.pPitch = 0;
    schedule();
  }

  function onScroll() {
    if (!motion) return;
    const r = canvas.getBoundingClientRect();
    // 0 while the plate is fully below its top edge in view, 1 once it has scrolled out the top.
    const out = Math.max(0, Math.min(1, -r.top / Math.max(1, r.height)));
    pose.sYaw = out * opts.scrollYaw * DEG;
    pose.sDrift = out * opts.scrollDrift;
    schedule();
  }

  // ---- Motion and theme switches -----------------------------------------------------------------

  function setMotion(on) {
    const next = !opts.still && !!on;
    if (next === motion) return;
    motion = next;
    stop();
    if (!motion) {
      if (data && gl) drawStill();
    } else {
      assembling = false; // no replay when motion comes back; just the quiet response
      clock = ASSEMBLE_MS;
      onScroll();
      schedule();
    }
  }

  function syncMotion() {
    setMotion(motionAllowed());
  }

  function refreshTheme() {
    readTheme();
    originCache = null;
    if (!data || !gl || failed) return;
    if (motion) schedule();
    else drawStill();
  }

  function replay() {
    if (!motion || failed || !data) return false;
    clock = 0;
    assembling = true;
    stats.assembled = false;
    stop();
    schedule();
    return true;
  }

  // ---- Start -----------------------------------------------------------------------------------

  gl = createContext();
  if (!gl) {
    fail('no-webgl');
    return controller();
  }
  setState('loading');
  try {
    initGL();
    readTheme();
  } catch (err) {
    fail(err);
    return controller();
  }

  listen(canvas, 'webglcontextlost', (e) => {
    e.preventDefault();
    stop();
    showFallback('context-lost');
  });
  listen(canvas, 'webglcontextrestored', () => {
    try {
      initGL();
      uploadData();
      assembling = false;
      clock = ASSEMBLE_MS;
      drawStillOrSchedule();
      hideFallback();
    } catch (err) {
      fail(err);
    }
  });

  if ('IntersectionObserver' in window) {
    const io = new IntersectionObserver((entries) => {
      for (const entry of entries) inView = entry.isIntersecting;
      if (inView) schedule();
      else stop();
    });
    io.observe(canvas);
    cleanups.push(() => io.disconnect());
  }
  listen(document, 'visibilitychange', () => {
    pageVisible = !document.hidden;
    if (pageVisible) schedule();
    else stop();
  });
  if ('ResizeObserver' in window) {
    const ro = new ResizeObserver(() => data && !failed && (motion ? schedule() : drawStill()));
    ro.observe(canvas);
    cleanups.push(() => ro.disconnect());
  } else listen(window, 'resize', () => data && (motion ? schedule() : drawStill()));
  listen(hoverEl, 'pointermove', onPointerMove, { passive: true });
  listen(hoverEl, 'pointerleave', onPointerLeave);
  listen(window, 'scroll', onScroll, { passive: true });
  listen(wrapper, 'figure:replay', () => replay());
  for (const target of [window, document]) {
    listen(target, 'figure:theme', refreshTheme);
    listen(target, 'figure:motion', syncMotion);
  }
  if (typeof opts.onMotionChange === 'function') opts.onMotionChange(() => syncMotion());
  else listen(document, 'ca:motion', syncMotion);
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (mq.addEventListener) {
      mq.addEventListener('change', syncMotion);
      cleanups.push(() => mq.removeEventListener('change', syncMotion));
    }
  } catch {
    // The attribute and event paths still work.
  }
  if ('MutationObserver' in window) {
    const mo = new MutationObserver(() => {
      syncMotion();
      refreshTheme();
    });
    mo.observe(html(), { attributes: true, attributeFilter: ['data-motion', 'data-snapshot', 'data-theme', 'class', 'style'] });
    cleanups.push(() => mo.disconnect());
  }
  // Print: draw the settled still so the page prints the figure, not a frame of the assembly.
  listen(window, 'beforeprint', () => {
    readTheme();
    if (data && gl && !failed) {
      stop();
      drawStill();
    }
  });
  listen(window, 'afterprint', () => refreshTheme());

  function drawStillOrSchedule() {
    if (motion) {
      resize();
      draw(!assembling);
      schedule();
    } else drawStill();
  }

  // M4: data later than 2.5 s cross-fades to the still image.
  const slowTimer = opts.slowMs > 0 && !opts.still ? setTimeout(() => !data && showFallback('slow-data'), opts.slowMs) : 0;

  const file = phone ? opts.srcLo : opts.srcHi;
  stats.file = phone ? 'lo' : 'hi';
  const metaUrl = opts.srcMeta || new URL('figure.json', new URL(opts.srcHi, location.href)).href;
  const metaPromise = fetch(metaUrl, { signal: abort && abort.signal })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  loadFigure(file, abort && abort.signal)
    .catch((err) => {
      if (destroyed || phone) throw err;
      stats.file = 'lo';
      return loadFigure(opts.srcLo, abort && abort.signal);
    })
    .then(async (d) => {
      const meta = await metaPromise;
      if (destroyed) return;
      data = d;
      landmarks = meta && meta.landmarks && Number.isFinite(meta.landmarks.crownY) ? meta.landmarks : null;
      drawCount = Math.min(wantCount, d.count);
      stats.count = drawCount;
      uploadData();
      onScroll();
      if (fallbackShown) {
        // Late data: draw the settled figure behind the still image, then cross-fade back.
        clearTimeout(slowTimer);
        assembling = false;
        clock = ASSEMBLE_MS;
        stats.assembled = true;
        inView = true;
        resize();
        draw(true);
        hideFallback();
        schedule();
        return;
      }
      clearTimeout(slowTimer);
      if (motion) {
        clock = 0;
        assembling = true;
        schedule();
      } else drawStill();
    })
    .catch((err) => {
      clearTimeout(slowTimer);
      if (!destroyed) fail(err);
    });

  return controller();

  function controller() {
    return {
      stats,
      replay,
      setMotion,
      refreshTheme,
      redraw: () => (motion ? schedule() : drawStill()),
      // Draws n settled frames back to back, waiting for the GPU each time; returns average ms.
      benchmark(n = 30) {
        if (!gl || !data || failed) return null;
        resize();
        const px = new Uint8Array(4);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          draw(true);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        }
        return (performance.now() - t0) / n;
      },
      destroy() {
        destroyed = true;
        stop();
        clearTimeout(slowTimer);
        if (abort) abort.abort();
        for (const fn of cleanups.splice(0)) fn();
        if (gl && !gl.isContextLost()) {
          if (buffer) gl.deleteBuffer(buffer);
          if (prog) gl.deleteProgram(prog);
        }
      },
    };
  }
}
