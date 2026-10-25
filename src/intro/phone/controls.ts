// controls.ts: turning and folding the phone by hand (V4.md 6.1, 8.4).
//
//   - Trackball: a drag turns it freely, each move about the axis across the move (in view space),
//     with inertia that damps out after release.
//   - Touch and pen: the box is touch-action pan-y (Intro.astro), so the page keeps vertical
//     swipes. A press waits for its first 8 px: mostly sideways (|dx| > |dy|), it turns the phone
//     from there on, in any direction; otherwise it is the page's and never turns the phone.
//     A mouse turns it from the first px. Presses are captured to the box (setPointerCapture), so a
//     drag that leaves the box keeps turning it.
//   - Fold: a double tap (two taps within 300 ms and 24 px; a single tap does nothing) or a
//     double-click with a mouse folds or unfolds it.
//   - Idle return: 4 s after the last input it eases back to the display pose. The fold stays as
//     it was.
//   - Keyboard (the box is a tab stop while the live phone is up): arrow keys turn it, Enter or
//     Space folds or unfolds it.
//   - Reduced motion: drags and arrow keys turn it directly, with no inertia and no ease back.
// Presses land on the box, not the canvas, which reaches past the box and takes no events.

import { Quaternion, Vector3 } from 'three';
import { clamp01, easeInOut, qDisplay, type Entrance } from './entrance';

const SLOP = 8;
/** A press shorter than this that never moved past SLOP is a tap. */
const TAP_MS = 350;
const DOUBLE_TAP_MS = 300;
const DOUBLE_TAP_PX = 24;
/** Inertia: angular speed falls by e every 1 / DAMPING s. */
const DAMPING = 3.2;
const IDLE_RETURN = 4000;
const RETURN_TIME = 1.2;
const KEY_STEP = (15 * Math.PI) / 180;

export interface ControlsOptions {
  box: HTMLElement;
  motion: boolean;
  /** The phone's turn, shared with index.ts. */
  view: Quaternion;
  entrance: Entrance;
  /** Radians of turn per CSS px of drag. */
  radPerPx(): number;
  toggleFold(): void;
  /** Something changed: draw a frame. */
  kick(): void;
}

export interface Controls {
  /** Advance the inertia and the ease back. */
  step(dt: number, now: number): void;
  /** Whether it needs frames on its own (spinning, easing back). Held still, it doesn't. */
  busy(): boolean;
  /** When the ease back is due (performance.now() ms), or null while none is waiting. */
  returnDue(): number | null;
  /** Stop any spin or ease back, and hold off the ease back (debug poses). */
  stop(): void;
  dispose(): void;
}

type Lock = 'pending' | 'turn' | 'page';

export function createControls(o: ControlsOptions): Controls {
  const { box, motion, view } = o;
  const omega = new Vector3();
  const axis = new Vector3();
  const dq = new Quaternion();
  let ret: { from: Quaternion; t: number } | null = null;
  let lastInput = performance.now();
  let drag: { id: number; x0: number; y0: number; x: number; y: number; t0: number; type: string; lock: Lock; second: boolean; moves: { t: number; dx: number; dy: number }[] } | null = null;
  let lastTap: { t: number; x: number; y: number } | null = null;
  let lastPointerType = 'mouse';

  const held = () => drag !== null && drag.lock === 'turn';

  const turn = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    if (!len) return;
    view.premultiply(dq.setFromAxisAngle(axis.set(dy / len, dx / len, 0), len * o.radPerPx()));
  };
  const touched = () => {
    lastInput = performance.now();
    ret = null;
    if (o.entrance.state === 'playing') o.entrance.took = true;
  };
  /** The press starts turning the phone: it catches it (stops a spin) and holds it. */
  const grab = () => {
    drag!.lock = 'turn';
    touched();
    omega.set(0, 0, 0);
  };
  const fold = () => {
    touched();
    o.toggleFold();
    o.kick();
  };

  const onDown = (e: PointerEvent) => {
    lastPointerType = e.pointerType;
    if (e.button !== 0 || drag || !e.isPrimary) return;
    const now = performance.now();
    // The second press of a double tap: soon after a tap, near it.
    const second = !!lastTap && now - lastTap.t <= DOUBLE_TAP_MS && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) <= DOUBLE_TAP_PX;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: now, type: e.pointerType, lock: 'pending', second, moves: [] };
    try {
      box.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    // A mouse holds the phone at once (and a mouse press would otherwise start selecting text
    // around the box).
    if (e.pointerType === 'mouse') {
      grab();
      e.preventDefault();
    }
    o.kick();
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id || drag.lock === 'page') return;
    if (drag.lock === 'pending') {
      const mx = e.clientX - drag.x0;
      const my = e.clientY - drag.y0;
      if (Math.hypot(mx, my) < SLOP) return;
      // Mostly up or down: a scroll. The page takes it (pan-y) and the phone ignores this press
      // until it ends; the browser cancels it once the page moves.
      if (Math.abs(mx) <= Math.abs(my)) {
        drag.lock = 'page';
        lastTap = null;
        return;
      }
      // Mostly sideways: it turns the phone from here (the first SLOP px only decided that).
      grab();
      lastTap = null;
      drag.x = e.clientX;
      drag.y = e.clientY;
      return;
    }
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag.x = e.clientX;
    drag.y = e.clientY;
    if (!dx && !dy) return;
    touched();
    turn(dx, dy);
    const now = performance.now();
    drag.moves.push({ t: now, dx, dy });
    while (drag.moves.length && now - drag.moves[0].t > 100) drag.moves.shift();
    o.kick();
  };

  const onUp = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    const now = performance.now();
    if (drag.lock === 'pending' && drag.type !== 'mouse' && now - drag.t0 < TAP_MS) {
      // A tap. The second of two folds the phone; the first only waits for it.
      if (drag.second) {
        lastTap = null;
        fold();
      } else {
        lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    } else if (drag.lock === 'turn') {
      // Inertia from the last 100 ms of movement, if the pointer was still moving at release.
      const recent = drag.moves.filter((m) => now - m.t < 100);
      if (motion && recent.length > 1 && now - recent[recent.length - 1].t < 50) {
        const span = Math.max(16, now - recent[0].t) / 1000;
        let sx = 0;
        let sy = 0;
        for (const m of recent) {
          sx += m.dx;
          sy += m.dy;
        }
        const len = Math.hypot(sx, sy);
        if (len > 0) omega.set(sy / len, sx / len, 0).multiplyScalar(Math.min(12, (len / span) * o.radPerPx()));
      }
      touched();
    }
    if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
    drag = null;
    o.kick();
  };

  const onCancel = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    drag = null;
    o.kick();
  };

  const onDblClick = (e: MouseEvent) => {
    if (lastPointerType !== 'mouse') return;
    e.preventDefault();
    fold();
  };

  const KEYS: Record<string, [number, number]> = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== box || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) fold();
      return;
    }
    const k = KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    touched();
    axis.set(k[0], k[1], 0);
    if (motion) omega.addScaledVector(axis, KEY_STEP * DAMPING);
    else view.premultiply(dq.setFromAxisAngle(axis, KEY_STEP));
    o.kick();
  };

  box.addEventListener('pointerdown', onDown);
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', onUp);
  box.addEventListener('pointercancel', onCancel);
  box.addEventListener('dblclick', onDblClick);
  box.addEventListener('keydown', onKey);

  return {
    step(dt, now) {
      if (!held() && omega.lengthSq() > 0) {
        const speed = omega.length();
        view.premultiply(dq.setFromAxisAngle(axis.copy(omega).divideScalar(speed), speed * dt));
        omega.multiplyScalar(Math.exp(-DAMPING * dt));
        if (speed < 0.03) omega.set(0, 0, 0);
      }
      if (!motion) return;
      // Ease back to the display pose after 4 s without input.
      if (!ret && !held() && omega.lengthSq() === 0 && o.entrance.state === 'done' && now - lastInput > IDLE_RETURN && view.angleTo(qDisplay) > 0.002) {
        ret = { from: view.clone(), t: 0 };
      }
      if (ret) {
        ret.t += dt;
        const u = clamp01(ret.t / RETURN_TIME);
        view.slerpQuaternions(ret.from, qDisplay, easeInOut(u));
        if (u >= 1) ret = null;
      }
    },
    busy() {
      return omega.lengthSq() > 0 || ret !== null;
    },
    returnDue() {
      if (!motion || held() || ret || omega.lengthSq() > 0 || o.entrance.state !== 'done' || view.angleTo(qDisplay) <= 0.002) return null;
      return lastInput + IDLE_RETURN;
    },
    stop() {
      omega.set(0, 0, 0);
      ret = null;
      lastInput = performance.now() + 1e9;
    },
    dispose() {
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      box.removeEventListener('pointercancel', onCancel);
      box.removeEventListener('dblclick', onDblClick);
      box.removeEventListener('keydown', onKey);
    },
  };
}
