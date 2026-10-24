// The point figure renderer.
//
//   import { mountFigure } from './figure/index.js';
//   const figure = mountFigure(canvas, { srcHi, srcLo, fallbackImg, descEl });
//
// Draws Cayden's figure as soft points with WebGL2 (WebGL1 if that is all there is). On load the
// points assemble once from a scattered state; afterwards the figure turns a little toward the
// pointer (laptops) or with scroll and a slow idle drift (touch screens). With reduced motion it
// draws one still, assembled frame. With no WebGL, or on any error, it hides the canvas and shows
// the fallback image instead.
//
// Colors come from CSS custom properties on the canvas (inherited from the page):
//   --figure-point  the point color (its alpha scales the whole figure)
//   --figure-glow   the tint of outline points (its alpha is how strong the tint is)
//   --figure-blend  optional: "add" for additive blending on dark pages; default is normal
// Dispatch a "figure:theme" event (on window or document) after changing them, or change
// data-theme or class on <html>; both make the renderer read them again.
//
// Motion is off when the device asks for reduced motion or <html data-motion="off">. The
// "figure:motion" and "ca:motion" events, and changes to that attribute, switch it live.

import { loadFigure } from './data.js';
import { parseCssColor } from './color.js';
import { VERT, FRAG } from './shaders.js';

const DEG = Math.PI / 180;
const DEFAULTS = {
  srcHi: '/figure/figure-hi.bin',
  srcLo: '/figure/figure-lo.bin',
  fallbackImg: null,
  descEl: null,
  wrapper: null, // element that gets data-state; defaults to the canvas's parent
  level: 'auto', // 'auto' | 'hi' | 'lo'
  still: false, // draw one assembled frame and never animate (used by the fallback renderer)
  transparent: true, // clear to transparent; the page shows through
  yaw: 0, // degrees, base pose
  pitch: 0,
  maxYaw: 12, // degrees each way
  maxPitch: 5,
  assembleMs: 2300,
  fov: 26, // degrees, vertical
  topMargin: 0.05, // fraction of the frame kept free above the head
  widthFill: 1.0, // shoulders' share of the frame width when the frame is narrow
  pointScale: 1, // multiply the automatic point size
  slowMs: 6000, // show the fallback image if the data has not arrived by then
  maxDpr: 2,
  maxBackingPixels: 2600 * 2600,
  colors: null, // { point, glow } CSS colors that override the custom properties
  forceWebGL1: false, // testing only: skip WebGL2
  onReady: null,
  onFallback: null,
};

const DEFAULT_POINT = [0.545, 0.576, 0.639, 1]; // #8b93a3
const DEFAULT_GLOW = [0.788, 0.808, 0.847, 0.6]; // #c9ced8

function prefersReduced() {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function motionAllowed() {
  return !prefersReduced() && document.documentElement.getAttribute('data-motion') !== 'off';
}

function pickLevel(canvas, level) {
  if (level === 'hi' || level === 'lo') return level;
  try {
    const nav = navigator;
    const coarse = matchMedia('(pointer: coarse)').matches;
    const smallScreen = Math.min(screen.width, screen.height) < 768;
    const saveData = nav.connection && nav.connection.saveData;
    const lowMemory = nav.deviceMemory && nav.deviceMemory <= 4;
    const lowCores = nav.hardwareConcurrency && nav.hardwareConcurrency <= 4;
    const cssArea = (canvas.clientWidth || 300) * (canvas.clientHeight || 300);
    if (saveData || (coarse && smallScreen) || window.innerWidth < 640 || lowMemory || lowCores) return 'lo';
    if (cssArea < 320 * 400) return 'lo';
  } catch {
    // Fall through to hi.
  }
  return 'hi';
}

export function mountFigure(canvas, options = {}) {
  const opts = { ...DEFAULTS, ...options };
  const wrapper = opts.wrapper || canvas.closest('[data-figure-mount]') || canvas.parentElement;
  const html = document.documentElement;
  const cleanups = [];
  const listen = (target, type, fn, o) => {
    target.addEventListener(type, fn, o);
    cleanups.push(() => target.removeEventListener(type, fn, o));
  };
  const setState = (s) => {
    if (wrapper) wrapper.setAttribute('data-state', s);
  };

  const stats = { level: null, count: 0, webgl: 0, frameMs: 0, fps: 0, frames: 0, assembled: false, state: 'loading' };
  let destroyed = false;
  let failed = false;
  let gl = null;
  let prog = null;
  let buffer = null;
  let loc = {};
  let data = null;
  let maxPointPx = 64;
  let raf = 0;
  let inView = true;
  let pageVisible = !document.hidden;
  let motion = !opts.still && motionAllowed();
  let assembleClock = 0; // ms of assemble played so far
  let assembled = opts.still || !motion;
  let lastFrame = 0;
  let lastDraw = 0;
  let idleTime = 0;
  let lastInputAt = 0;
  let colors = null;
  let blendAdd = false;
  let width = 0;
  let height = 0;
  const pose = { yaw: 0, pitch: 0, drift: 0, tYaw: 0, tPitch: 0, tDrift: 0, pointerYaw: 0, pointerPitch: 0, scrollYaw: 0 };
  const coarse = (() => {
    try {
      return matchMedia('(hover: none), (pointer: coarse)').matches;
    } catch {
      return false;
    }
  })();
  const abort = typeof AbortController !== 'undefined' ? new AbortController() : null;

  function fail(reason) {
    if (failed || destroyed) return;
    failed = true;
    stats.state = 'fallback';
    stats.reason = String(reason && reason.message ? reason.message : reason);
    cancelAnimationFrame(raf);
    canvas.hidden = true;
    canvas.style.display = 'none';
    setState('fallback');
    if (opts.fallbackImg) {
      opts.fallbackImg.loading = 'eager';
      opts.fallbackImg.hidden = false;
    }
    if (opts.descEl) opts.descEl.hidden = true;
    if (typeof opts.onFallback === 'function') opts.onFallback(stats.reason);
    try {
      (wrapper || canvas).dispatchEvent(new CustomEvent('figure:fallback', { bubbles: true, detail: { reason: stats.reason } }));
    } catch {
      // Ignore.
    }
  }

  // ---- WebGL setup ---------------------------------------------------------------------------

  function createContext() {
    const attrs = {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      preserveDrawingBuffer: !!opts.still,
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
      'uCenter', 'uHalf', 'uPivot', 'uScale', 'uRot', 'uBreath', 'uCamDist', 'uFocal', 'uNdcScale',
      'uNdcOffset', 'uPointPx', 'uMaxPx', 'uT', 'uColPoint', 'uColGlow', 'uGlowAmt', 'uAlpha',
    ]) loc[name] = gl.getUniformLocation(prog, name);
    const range = gl.getParameter(gl.ALIASED_POINT_SIZE_RANGE);
    maxPointPx = range ? Math.min(64, range[1]) : 64;
    gl.disable(gl.DEPTH_TEST);
    gl.enable(gl.BLEND);
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
    gl.uniform3fv(loc.uCenter, data.center);
    gl.uniform3fv(loc.uHalf, data.half);
    // Turn around the middle of the bust, at its own depth.
    gl.uniform3f(loc.uPivot, data.center[0], data.center[1], data.center[2]);
    gl.uniform1f(loc.uScale, 2 / Math.max(1e-9, data.max[1] - data.min[1]));
  }

  // ---- Theme ---------------------------------------------------------------------------------

  function readTheme() {
    const cs = getComputedStyle(canvas);
    const pointStr = (opts.colors && opts.colors.point) || cs.getPropertyValue('--figure-point');
    const glowStr = (opts.colors && opts.colors.glow) || cs.getPropertyValue('--figure-glow');
    const blend = (cs.getPropertyValue('--figure-blend') || '').trim().toLowerCase();
    colors = {
      point: parseCssColor(pointStr, DEFAULT_POINT),
      glow: parseCssColor(glowStr, DEFAULT_GLOW),
    };
    blendAdd = blend === 'add' || blend === 'additive' || blend === 'lighter' || blend === 'screen';
  }

  // ---- Size and fit --------------------------------------------------------------------------

  function resize() {
    const cssW = canvas.clientWidth || (wrapper && wrapper.clientWidth) || 300;
    const cssH = canvas.clientHeight || (wrapper && wrapper.clientHeight) || 375;
    let dpr = Math.min(window.devicePixelRatio || 1, opts.maxDpr);
    if (cssW * cssH * dpr * dpr > opts.maxBackingPixels) dpr = Math.sqrt(opts.maxBackingPixels / (cssW * cssH));
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

  // Projection: the bust is scaled so its height is 2 view units (y from -1 to 1), seen from a
  // camera on +z. Then the image is zoomed to fit: height first, with the chest cut on the bottom
  // edge; if the frame is too narrow for the shoulders, the width decides and the shoulders
  // fill it instead.
  function fit() {
    const focal = 1 / Math.tan((opts.fov * DEG) / 2);
    const scale = 2 / Math.max(1e-9, data.max[1] - data.min[1]);
    const halfW = ((data.max[0] - data.min[0]) / 2) * scale;
    const camDist = 1.35 * focal; // the bust fills about 74% of the field of view vertically
    const k = focal / camDist; // view units to NDC at the pivot depth
    const aspect = width / height;
    const zoomH = (1 - opts.topMargin) / k;
    const zoomW = (aspect * opts.widthFill) / (halfW * k);
    const zoom = Math.min(zoomH, zoomW);
    return {
      focal,
      camDist,
      zoom,
      ndcScale: [zoom / aspect, zoom],
      offsetY: -1 + k * zoom, // y = -1 (the chest cut) lands on the bottom edge
      figurePx: k * zoom * height, // bust height in device pixels
    };
  }

  // ---- Frame ---------------------------------------------------------------------------------

  function rotation(yaw, pitch) {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    const cp = Math.cos(pitch);
    const sp = Math.sin(pitch);
    // Rx(pitch) * Ry(yaw), column major.
    return new Float32Array([c, sp * s, -cp * s, 0, cp, sp, s, -sp * c, cp * c]);
  }

  function draw(tAssemble, breath) {
    if (!gl || !data || failed || gl.isContextLost()) return;
    const t0 = performance.now();
    const f = fit();
    gl.viewport(0, 0, width, height);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (blendAdd) gl.blendFunc(gl.ONE, gl.ONE);
    else gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(prog);
    gl.uniformMatrix3fv(loc.uRot, false, rotation((opts.yaw * DEG) + pose.yaw, (opts.pitch * DEG) + pose.pitch));
    gl.uniform1f(loc.uBreath, breath);
    gl.uniform1f(loc.uCamDist, f.camDist);
    gl.uniform1f(loc.uFocal, f.focal);
    gl.uniform2f(loc.uNdcScale, f.ndcScale[0], f.ndcScale[1]);
    gl.uniform2f(loc.uNdcOffset, 0, f.offsetY + pose.drift);
    // Point size follows how big the bust is on screen and how many points share it.
    const px = (0.62 * f.figurePx) / Math.sqrt(data.count) * opts.pointScale;
    gl.uniform1f(loc.uPointPx, Math.max(1, px));
    gl.uniform1f(loc.uMaxPx, maxPointPx);
    gl.uniform1f(loc.uT, tAssemble);
    const p = colors.point;
    const g = colors.glow;
    gl.uniform3f(loc.uColPoint, p[0], p[1], p[2]);
    gl.uniform3f(loc.uColGlow, g[0], g[1], g[2]);
    gl.uniform1f(loc.uGlowAmt, g[3]);
    gl.uniform1f(loc.uAlpha, p[3] * (blendAdd ? 0.5 : 0.78));
    gl.drawArrays(gl.POINTS, 0, data.count);
    const ms = performance.now() - t0;
    stats.frameMs = stats.frames ? stats.frameMs * 0.9 + ms * 0.1 : ms;
    stats.frames++;
    const nowMs = performance.now();
    if (lastDraw && nowMs - lastDraw < 500) {
      const inst = 1000 / Math.max(1, nowMs - lastDraw);
      stats.fps = stats.fps ? stats.fps * 0.9 + inst * 0.1 : inst; // draws per second
    }
    lastDraw = nowMs;
    if (stats.state !== 'ready') {
      stats.state = 'ready';
      setState('ready');
      if (opts.fallbackImg) opts.fallbackImg.hidden = true;
      if (typeof opts.onReady === 'function') opts.onReady(stats);
      try {
        (wrapper || canvas).dispatchEvent(new CustomEvent('figure:ready', { bubbles: true }));
      } catch {
        // Ignore.
      }
    }
  }

  function drawStill() {
    pose.yaw = 0;
    pose.pitch = 0;
    pose.drift = 0;
    resize();
    draw(1, 1);
  }

  function updatePose(dt, now) {
    const maxYaw = opts.maxYaw * DEG;
    const maxPitch = opts.maxPitch * DEG;
    let idleYaw = 0;
    let idlePitch = 0;
    if (coarse) {
      // Time based drift, the same on every device, so touch screens still feel alive.
      idleYaw = 4 * DEG * Math.sin(now * 0.00031);
      idlePitch = 1.2 * DEG * Math.sin(now * 0.00021 + 1.3);
    }
    pose.tYaw = Math.max(-maxYaw, Math.min(maxYaw, pose.pointerYaw + pose.scrollYaw + idleYaw));
    pose.tPitch = Math.max(-maxPitch, Math.min(maxPitch, pose.pointerPitch + idlePitch));
    const k = 1 - Math.exp(-dt * 0.0035);
    pose.yaw += (pose.tYaw - pose.yaw) * k;
    pose.pitch += (pose.tPitch - pose.pitch) * k;
    pose.drift += (pose.tDrift - pose.drift) * k;
    return (
      Math.abs(pose.tYaw - pose.yaw) > 0.0002 ||
      Math.abs(pose.tPitch - pose.pitch) > 0.0002 ||
      Math.abs(pose.tDrift - pose.drift) > 0.0002
    );
  }

  function frame(now) {
    raf = 0;
    if (destroyed || failed || !data) return;
    const dt = lastFrame ? Math.min(64, now - lastFrame) : 16;
    lastFrame = now;
    if (!motion) {
      drawStill();
      return;
    }
    const resized = resize();
    let t = 1;
    if (!assembled) {
      assembleClock += dt;
      t = Math.min(1, assembleClock / opts.assembleMs);
      if (t >= 1) {
        assembled = true;
        stats.assembled = true;
      }
    }
    const moving = updatePose(dt, now);
    idleTime += dt;
    const breath = 1 + 0.0035 * Math.sin(idleTime * 0.0011);
    // Idle (assembled, no input for a moment): 30 frames a second is plenty for the drift.
    const onlyDrift = assembled && !resized && (!moving || now - lastInputAt > 800);
    if (!onlyDrift || now - lastDraw > 31) draw(t, breath);
    schedule();
  }

  function active() {
    return !destroyed && !failed && data && gl && inView && pageVisible;
  }

  function schedule() {
    if (raf || !active()) return;
    if (!motion) {
      raf = requestAnimationFrame(frame);
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function stop() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    lastFrame = 0;
  }

  // ---- Input ---------------------------------------------------------------------------------

  function onPointer(e) {
    if (!motion || coarse || e.pointerType === 'touch') return;
    const rect = canvas.getBoundingClientRect();
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    const nx = Math.max(-1, Math.min(1, (e.clientX - cx) / (window.innerWidth * 0.5)));
    const ny = Math.max(-1, Math.min(1, (e.clientY - cy) / (window.innerHeight * 0.5)));
    pose.pointerYaw = nx * opts.maxYaw * 0.85 * DEG;
    pose.pointerPitch = ny * opts.maxPitch * DEG;
    lastInputAt = performance.now();
    schedule();
  }

  function onPointerLeave() {
    pose.pointerYaw = 0;
    pose.pointerPitch = 0;
    schedule();
  }

  function onScroll() {
    if (!motion) return;
    const rect = canvas.getBoundingClientRect();
    const vh = window.innerHeight || 1;
    // 0 while the figure sits where it starts, growing as it scrolls up and away.
    const progress = Math.max(-1, Math.min(1.5, (vh * 0.5 - (rect.top + rect.height / 2)) / vh));
    pose.scrollYaw = progress * 9 * DEG;
    pose.tDrift = -progress * 0.06;
    lastInputAt = performance.now();
    schedule();
  }

  // ---- Motion and theme switches ---------------------------------------------------------------

  function setMotion(on) {
    const next = !opts.still && !!on && !prefersReduced();
    if (next === motion) return;
    motion = next;
    if (!motion) {
      stop();
      assembled = true;
      stats.assembled = true;
      if (data && gl) drawStill();
    } else {
      // Motion turned on later: no assemble replay, just the quiet response.
      assembled = true;
      lastFrame = 0;
      onScroll();
      schedule();
    }
  }

  function syncMotion() {
    setMotion(motionAllowed());
  }

  function refreshTheme() {
    readTheme();
    if (!data || !gl || failed) return;
    if (motion) schedule();
    else drawStill();
  }

  // ---- Start ---------------------------------------------------------------------------------

  gl = createContext();
  if (!gl) {
    fail('no-webgl');
    return controller();
  }
  stats.state = 'loading';
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
    const timer = setTimeout(() => fail('context-lost'), 3000);
    const restored = () => {
      clearTimeout(timer);
      try {
        initGL();
        uploadData();
        assembled = true;
        if (motion) schedule();
        else drawStill();
      } catch (err) {
        fail(err);
      }
    };
    canvas.addEventListener('webglcontextrestored', restored, { once: true });
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
    const ro = new ResizeObserver(() => {
      if (!data || failed) return;
      if (motion) schedule();
      else drawStill();
    });
    ro.observe(canvas);
    cleanups.push(() => ro.disconnect());
  } else {
    listen(window, 'resize', () => (motion ? schedule() : drawStill()));
  }
  listen(window, 'pointermove', onPointer, { passive: true });
  listen(document, 'pointerleave', onPointerLeave);
  listen(window, 'blur', onPointerLeave);
  listen(window, 'scroll', onScroll, { passive: true });

  const onMotionEvent = (e) => {
    const d = e && e.detail;
    if (d && typeof d.enabled === 'boolean') setMotion(d.enabled && motionAllowed());
    else if (d && typeof d.motion === 'string') setMotion(d.motion !== 'off' && motionAllowed());
    else syncMotion();
  };
  for (const target of [window, document]) {
    listen(target, 'figure:motion', onMotionEvent);
    listen(target, 'ca:motion', onMotionEvent);
    listen(target, 'figure:theme', refreshTheme);
  }
  try {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onMq = () => syncMotion();
    if (mq.addEventListener) mq.addEventListener('change', onMq);
    else mq.addListener(onMq);
    cleanups.push(() => (mq.removeEventListener ? mq.removeEventListener('change', onMq) : mq.removeListener(onMq)));
  } catch {
    // Old browsers: the event and attribute paths still work.
  }
  if ('MutationObserver' in window) {
    const mo = new MutationObserver((records) => {
      let theme = false;
      for (const r of records) {
        if (r.attributeName === 'data-motion') syncMotion();
        else theme = true;
      }
      if (theme) refreshTheme();
    });
    mo.observe(html, { attributes: true, attributeFilter: ['data-motion', 'data-theme', 'class', 'style'] });
    cleanups.push(() => mo.disconnect());
  }

  const level = pickLevel(canvas, opts.level);
  stats.level = level;
  let slow = false;
  const slowTimer = opts.slowMs > 0 && !opts.still ? setTimeout(() => {
    // Slow network: show the still image meanwhile; when the data lands, swap in place.
    slow = true;
    setState('fallback');
    if (opts.fallbackImg) {
      opts.fallbackImg.loading = 'eager';
      opts.fallbackImg.hidden = false;
    }
  }, opts.slowMs) : 0;

  const first = level === 'lo' ? opts.srcLo : opts.srcHi;
  const second = level === 'lo' ? null : opts.srcLo;
  loadFigure(first, abort && abort.signal)
    .catch((err) => {
      if (destroyed) throw err;
      if (second) {
        stats.level = 'lo';
        return loadFigure(second, abort && abort.signal);
      }
      throw err;
    })
    .then((d) => {
      if (destroyed) return;
      clearTimeout(slowTimer);
      data = d;
      stats.count = d.count;
      uploadData();
      onScroll();
      if (slow) {
        // The still image is up and the canvas is hidden (so it also counts as offscreen). Swap
        // them and draw the assembled figure in this same task, so nothing flashes; no assemble.
        assembled = true;
        stats.assembled = true;
        inView = true;
        setState('loading');
        resize();
        draw(1, 1);
        if (motion) schedule();
        return;
      }
      if (motion) schedule();
      else drawStill();
    })
    .catch((err) => {
      clearTimeout(slowTimer);
      if (!destroyed) fail(err);
    });

  return controller();

  function controller() {
    return {
      stats,
      setMotion,
      refreshTheme,
      redraw: () => (motion ? schedule() : drawStill()),
      // Draws n frames back to back, waiting for the GPU each time; returns the average ms.
      benchmark(n = 30) {
        if (!gl || !data || failed) return null;
        resize();
        const px = new Uint8Array(4);
        const t0 = performance.now();
        for (let i = 0; i < n; i++) {
          draw(1, 1);
          gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); // forces the GPU to finish
        }
        return (performance.now() - t0) / n;
      },
      destroy() {
        destroyed = true;
        stop();
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
