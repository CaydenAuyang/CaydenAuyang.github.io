// controls.ts: turning and folding the phone by hand (V4.md 6.1, 8.4; V5.md section 1).
//
//   - Trackball: a drag turns it freely, each move about the axis across the move (in view space).
//     The drag turns a target; the drawn phone chases it with a critically damped spring (FOLLOW),
//     every frame while it is held, so it follows the pointer live and smoothly. On release it
//     coasts on from the drawn phone's own speed (the inertia damps out), so nothing jumps.
//   - Click or tap: a press that moves less than CLICK_PX and is let go within CLICK_MS folds or
//     unfolds it. The second click of a double click (or tap of a double tap) does nothing, so a
//     double click never toggles twice. A press that turned the phone never toggles.
//   - Mouse: a press turns the phone once it has moved MOUSE_SLOP px (from there; the first px only
//     decided it was a drag), so a click can happen. Touch and pen: the box is touch-action pan-y
//     (Intro.astro), so the page keeps vertical swipes. A press waits for its first TOUCH_SLOP px:
//     mostly sideways (|dx| > |dy|), it turns the phone from there on, in any direction; otherwise
//     it is the page's and never turns the phone. Presses are captured to the box
//     (setPointerCapture), so a drag that leaves the box keeps turning it.
//   - Auto-close: open, it folds shut AUTO_CLOSE after the last input (click, drag or key; any input
//     starts the wait again). index.ts also shuts it when the box leaves the screen.
//   - Idle return: IDLE_RETURN after the last input it eases back to the display pose that matches
//     the fold (entrance.ts). A fold made while the phone rests in its display pose eases it to the
//     other one along with the fold.
//   - Keyboard (the box is a tab stop, role button, while the live phone is up): arrow keys turn
//     it, Enter or Space folds or unfolds it. A click with no press before it (assistive tech
//     activating the button) folds or unfolds it too.
//   - Reduced motion: drags and arrow keys turn it directly, with no smoothing, no inertia, no ease
//     back and no auto-close (it still shuts when it leaves the screen); a fold is an instant swap.
// Presses land on the box, not the canvas, which reaches past the box and takes no events.

import { Quaternion, Vector3 } from 'three';
import { clamp01, displayPose, easeInOut, type Entrance } from './entrance';

const MOUSE_SLOP = 4;
const TOUCH_SLOP = 8;
/** A click or tap: moved less than this (CSS px) and let go within CLICK_MS. */
const CLICK_PX = 4;
const CLICK_MS = 400;
/** A click that starts this soon after the last one (ms), this near it (px), is the second of a double click. */
const DOUBLE_MS = 500;
const DOUBLE_PX = 24;
/**
 * The follow spring's time constant (s): at a steady drag the drawn phone trails the pointer by
 * this much. Critically damped, so it never overshoots; omega is 2 / FOLLOW.
 */
const FOLLOW = 0.06;
/** Inertia: angular speed falls by e every 1 / DAMPING s, from at most MAX_SPIN rad/s. */
const DAMPING = 3.2;
const MAX_SPIN = 12;
const IDLE_RETURN = 4000;
const AUTO_CLOSE = 6000;
const RETURN_TIME = 1.2;
/** Within this of its display pose (radians), the phone counts as resting there. */
const AT_REST = (3 * Math.PI) / 180;
const KEY_STEP = (15 * Math.PI) / 180;

export interface ControlsOptions {
  box: HTMLElement;
  motion: boolean;
  /** The phone's drawn turn, shared with index.ts. */
  view: Quaternion;
  entrance: Entrance;
  /** Whether the live phone is up (input is ignored while the still stands in). */
  live(): boolean;
  /** Radians of turn per CSS px of drag. */
  radPerPx(): number;
  isOpen(): boolean;
  /** Fold or unfold it (animated with motion, at once without). */
  setOpen(open: boolean): void;
  /** Something changed: draw a frame. */
  kick(): void;
}

export interface Controls {
  /** Advance the follow, the inertia, the ease back and the auto-close. */
  step(dt: number, now: number): void;
  /** Whether it needs frames on its own (following a drag, spinning, easing back). Held still, it doesn't. */
  busy(): boolean;
  /** When the next ease back or auto-close is due (performance.now() ms), or null while none is waiting. */
  nextDue(): number | null;
  /** Let go of everything (a drag, a spin, an ease back) and put the phone in this pose. */
  reset(pose: Quaternion): void;
  /** Stop any spin or ease back, and hold off the ease back and the auto-close (debug poses). */
  stop(): void;
  dispose(): void;
}

type Lock = 'pending' | 'turn' | 'page';

export function createControls(o: ControlsOptions): Controls {
  const { box, motion, view } = o;
  const omega = new Vector3();
  const axis = new Vector3();
  const dq = new Quaternion();
  // The follow spring: the target the drag turns, and the drawn phone's offset from it (as a
  // rotation vector) and that offset's speed.
  const target = new Quaternion();
  const inv = new Quaternion();
  const offset = new Vector3();
  const speed = new Vector3();
  let following = false;
  // The view was changed directly (reduced motion): one frame.
  let fresh = false;
  let ret: { from: Quaternion; to: Quaternion; t: number } | null = null;
  let lastInput = performance.now();
  // When the last press on the box ended (Infinity while one is down), so a pointer's own click
  // isn't taken for assistive tech's.
  let pressEnd = -Infinity;
  let drag: { id: number; x0: number; y0: number; x: number; y: number; t0: number; type: string; lock: Lock; far: number; moves: { t: number; dx: number; dy: number }[] } | null = null;
  let lastClick: { t: number; x: number; y: number } | null = null;

  const held = () => drag !== null && drag.lock === 'turn';
  /** Any press on the box, turning it or not yet. */
  const pressed = () => drag !== null;
  const spinning = () => omega.lengthSq() > 0;

  const turn = (dx: number, dy: number) => {
    const len = Math.hypot(dx, dy);
    if (!len) return;
    dq.setFromAxisAngle(axis.set(dy / len, dx / len, 0), len * o.radPerPx());
    if (!motion) {
      view.premultiply(dq);
      fresh = true;
      return;
    }
    target.premultiply(dq);
    following = true;
  };
  const touched = () => {
    lastInput = performance.now();
    ret = null;
    if (o.entrance.state === 'playing') o.entrance.took = true;
  };
  /** The press starts turning the phone: it catches it (stops a spin or an ease back) and holds it. */
  const grab = () => {
    drag!.lock = 'turn';
    touched();
    omega.set(0, 0, 0);
    // Still settling from the last drag, it keeps chasing the same target; otherwise it starts here.
    if (!following) {
      target.copy(view);
      speed.set(0, 0, 0);
    }
  };
  const toggle = () => {
    const open = o.isOpen();
    const rest = displayPose(open);
    // Resting in its display pose (or on its way there), it eases to the other one with the fold.
    const resting = !held() && !following && !spinning() && (o.entrance.state === 'playing' || ret?.to === rest || view.angleTo(rest) < AT_REST);
    touched();
    o.setOpen(!open);
    if (resting && motion) ret = { from: view.clone(), to: displayPose(!open), t: 0 };
    else if (resting) {
      view.copy(displayPose(!open));
      fresh = true;
    }
    o.kick();
  };
  const click = (x: number, y: number, t0: number) => {
    const now = performance.now();
    const second = !!lastClick && t0 - lastClick.t <= DOUBLE_MS && Math.hypot(x - lastClick.x, y - lastClick.y) <= DOUBLE_PX;
    // The second click of a pair does nothing, and the next one starts a new pair.
    lastClick = second ? null : { t: now, x, y };
    if (!second) toggle();
  };
  /** The press ends without a click (cancelled, capture lost, a context menu, the button let go elsewhere). */
  const endPress = () => {
    if (!drag) return;
    if (box.hasPointerCapture(drag.id)) box.releasePointerCapture(drag.id);
    const turned = drag.lock === 'turn';
    drag = null;
    pressEnd = performance.now();
    if (turned) {
      touched();
      // One frame, so the loop goes to sleep with the ease back and auto-close timers set.
      fresh = true;
    }
    o.kick();
  };

  const onDown = (e: PointerEvent) => {
    if (e.button !== 0 || drag || !e.isPrimary || !o.live()) return;
    pressEnd = Infinity;
    drag = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t0: performance.now(), type: e.pointerType, lock: 'pending', far: 0, moves: [] };
    try {
      box.setPointerCapture(e.pointerId);
    } catch {
      /* the pointer is already gone */
    }
    // A mouse press would otherwise start selecting text around the box.
    if (e.pointerType === 'mouse') e.preventDefault();
  };

  const onMove = (e: PointerEvent) => {
    if (!drag || e.pointerId !== drag.id) return;
    // A mouse whose button is no longer down (its release went somewhere else): the press is over.
    if (drag.type === 'mouse' && !(e.buttons & 1)) return endPress();
    if (drag.lock === 'page') return;
    if (drag.lock === 'pending') {
      const mx = e.clientX - drag.x0;
      const my = e.clientY - drag.y0;
      const d = Math.hypot(mx, my);
      drag.far = Math.max(drag.far, d);
      const mouse = drag.type === 'mouse';
      if (d < (mouse ? MOUSE_SLOP : TOUCH_SLOP)) return;
      // Touch, mostly up or down: a scroll. The page takes it (pan-y) and the phone ignores this
      // press until it ends; the browser cancels it once the page moves.
      if (!mouse && Math.abs(mx) <= Math.abs(my)) {
        drag.lock = 'page';
        return;
      }
      // A drag: it turns the phone from here (the first px only decided that).
      grab();
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
    const now = performance.now();
    pressEnd = now;
    if (!drag || e.pointerId !== drag.id) return;
    const d = drag;
    drag = null;
    if (box.hasPointerCapture(e.pointerId)) box.releasePointerCapture(e.pointerId);
    if (d.lock === 'pending' && d.far < CLICK_PX && now - d.t0 <= CLICK_MS) {
      click(e.clientX, e.clientY, d.t0);
    } else if (d.lock === 'turn') {
      // Still moving at release (a move in the last 50 ms): it coasts on at the drawn phone's own
      // speed. Otherwise the follow settles it where the pointer left it.
      const lastMove = d.moves[d.moves.length - 1];
      if (motion && lastMove && now - lastMove.t < 50 && speed.lengthSq() > 0) {
        omega.copy(speed);
        if (omega.length() > MAX_SPIN) omega.setLength(MAX_SPIN);
        following = false;
      }
      touched();
      // At least one frame (a phone let go while held still has nothing to draw), so the loop goes
      // to sleep with the ease back and auto-close timers set.
      fresh = true;
    }
    o.kick();
  };

  const onCancel = (e: PointerEvent) => {
    if (drag && e.pointerId === drag.id) endPress();
  };
  // A press that opens the context menu (ctrl-click on a Mac) gets no pointerup.
  const onMenu = () => endPress();

  // A click with no pointer press just before it: assistive tech activating the button (a pointer's
  // own clicks toggle on release, in onUp).
  const onClick = () => {
    if (drag || !o.live() || performance.now() - pressEnd < 1000) return;
    toggle();
  };

  const KEYS: Record<string, [number, number]> = {
    ArrowLeft: [0, -1],
    ArrowRight: [0, 1],
    ArrowUp: [-1, 0],
    ArrowDown: [1, 0],
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.target !== box || e.altKey || e.ctrlKey || e.metaKey || !o.live()) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      if (!e.repeat) toggle();
      return;
    }
    const k = KEYS[e.key];
    if (!k) return;
    e.preventDefault();
    touched();
    following = false;
    axis.set(k[0], k[1], 0);
    if (motion) omega.addScaledVector(axis, KEY_STEP * DAMPING);
    else {
      view.premultiply(dq.setFromAxisAngle(axis, KEY_STEP));
      fresh = true;
    }
    o.kick();
  };

  box.addEventListener('pointerdown', onDown);
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', onUp);
  box.addEventListener('pointercancel', onCancel);
  box.addEventListener('lostpointercapture', onCancel);
  box.addEventListener('contextmenu', onMenu);
  box.addEventListener('click', onClick);
  box.addEventListener('keydown', onKey);

  /** One step of the critically damped follow (exact for any dt): the drawn phone toward the target. */
  const follow = (dt: number) => {
    // offset = log(view * target^-1), the shorter way round.
    inv.copy(target).invert();
    dq.copy(view).multiply(inv);
    if (dq.w < 0) dq.set(-dq.x, -dq.y, -dq.z, -dq.w);
    const s = Math.sqrt(Math.max(0, 1 - dq.w * dq.w));
    const angle = 2 * Math.atan2(s, dq.w);
    if (s > 1e-9) offset.set(dq.x, dq.y, dq.z).multiplyScalar(angle / s);
    else offset.set(dq.x, dq.y, dq.z).multiplyScalar(2);
    const k = 2 / FOLLOW;
    const decay = Math.exp(-k * dt);
    // temp = (speed + k offset) dt; speed' = (speed - k temp) decay; offset' = (offset + temp) decay.
    const temp = axis.copy(offset).multiplyScalar(k).add(speed).multiplyScalar(dt);
    speed.addScaledVector(temp, -k).multiplyScalar(decay);
    offset.add(temp).multiplyScalar(decay);
    const left = offset.length();
    if (left < 1e-4 && speed.length() < 1e-3) {
      view.copy(target);
      speed.set(0, 0, 0);
      following = false;
      return;
    }
    view.copy(target).premultiply(dq.setFromAxisAngle(axis.copy(offset).divideScalar(left || 1), left));
  };

  return {
    step(dt, now) {
      fresh = false;
      if (following) follow(dt);
      else if (!held() && spinning()) {
        const w = omega.length();
        view.premultiply(dq.setFromAxisAngle(axis.copy(omega).divideScalar(w), w * dt));
        omega.multiplyScalar(Math.exp(-DAMPING * dt));
        if (w < 0.03) omega.set(0, 0, 0);
      }
      if (!motion) return;
      // Open and left alone for AUTO_CLOSE: it folds shut (and eases to the closed pose, below).
      // Never under a press.
      if (o.isOpen() && !pressed() && now - lastInput >= AUTO_CLOSE) o.setOpen(false);
      const rest = displayPose(o.isOpen());
      // The fold changed while it was easing back: it eases to the new pose from where it is.
      if (ret && ret.to !== rest) ret = { from: view.clone(), to: rest, t: 0 };
      // Ease back to the display pose after IDLE_RETURN without input.
      if (!ret && !held() && !following && !spinning() && o.entrance.state === 'done' && now - lastInput > IDLE_RETURN && view.angleTo(rest) > 0.002) {
        ret = { from: view.clone(), to: rest, t: 0 };
      }
      if (ret) {
        ret.t += dt;
        const u = clamp01(ret.t / RETURN_TIME);
        view.slerpQuaternions(ret.from, ret.to, easeInOut(u));
        if (u >= 1) ret = null;
      }
    },
    busy() {
      return fresh || following || spinning() || ret !== null;
    },
    nextDue() {
      // A press in progress sets the timers when it ends.
      if (!motion || pressed()) return null;
      const close = o.isOpen() ? lastInput + AUTO_CLOSE : Infinity;
      const back = ret || following || spinning() || o.entrance.state !== 'done' || view.angleTo(displayPose(o.isOpen())) <= 0.002 ? Infinity : lastInput + IDLE_RETURN;
      const due = Math.min(close, back);
      return Number.isFinite(due) ? due : null;
    },
    reset(pose) {
      if (drag && box.hasPointerCapture(drag.id)) box.releasePointerCapture(drag.id);
      drag = null;
      omega.set(0, 0, 0);
      speed.set(0, 0, 0);
      following = false;
      ret = null;
      view.copy(pose);
      fresh = true;
    },
    stop() {
      omega.set(0, 0, 0);
      speed.set(0, 0, 0);
      following = false;
      ret = null;
      lastInput = performance.now() + 1e9;
    },
    dispose() {
      box.removeEventListener('pointerdown', onDown);
      box.removeEventListener('pointermove', onMove);
      box.removeEventListener('pointerup', onUp);
      box.removeEventListener('pointercancel', onCancel);
      box.removeEventListener('lostpointercapture', onCancel);
      box.removeEventListener('contextmenu', onMenu);
      box.removeEventListener('click', onClick);
      box.removeEventListener('keydown', onKey);
    },
  };
}
