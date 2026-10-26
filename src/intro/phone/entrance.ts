// entrance.ts: how the phone moves on its own (V4.md 6.1, V5.md 1.4): its poses, the fold (every
// fold and unfold, with the same animation), and the entrance itself.
//
// The phone arrives closed, the vertical photo on its cover screen, and stays closed until someone
// opens it (a click or a tap, controls.ts). The entrance plays once, when 40% of the phone's box is
// first in view (index.ts watches that): from the start pose (yaw -25, pitch 10, roll -6), after
// 0.6 s it turns over 1.4 s to the closed display pose (yaw -18, pitch 6, roll -4). It never
// unfolds by itself. Open, the display pose is landscape, turned toward the reader (yaw -12, pitch
// 4). The idle float that follows is CSS on the canvas (Intro.astro), not a redraw.
// Reduced motion: no entrance; closed, in the closed display pose, still, and a fold is an instant
// swap.

import { Euler, Quaternion } from 'three';

export const DEG = Math.PI / 180;
/** Poses in degrees, Euler order YXZ (yaw about the vertical, then pitch, then roll). */
export interface Pose {
  pitch: number;
  yaw: number;
  roll: number;
}
const START: Pose = { pitch: 10, yaw: -25, roll: -6 };
/** The display poses, closed and open (the open one turned into landscape by the fold's quarter turn). */
const CLOSED: Pose = { pitch: 6, yaw: -18, roll: -4 };
const OPEN: Pose = { pitch: 4, yaw: -12, roll: 0 };
/** The quarter turn into landscape, counter-clockwise as the reader sees it. */
export const LANDSCAPE = 90 * DEG;
const DELAY = 0.6;
/** The entrance's turn, and every fold and unfold. */
const TURN = 1.4;
export const UNFOLD = 1.4;

export const quat = (p: Pose) => new Quaternion().setFromEuler(new Euler(p.pitch * DEG, p.yaw * DEG, p.roll * DEG, 'YXZ'));
export const qStart = quat(START);
export const qClosed = quat(CLOSED);
export const qOpen = quat(OPEN);
/** The display pose that matches the fold: closed or open. */
export const displayPose = (open: boolean) => (open ? qOpen : qClosed);

export const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
const hump = (x: number) => {
  const s = Math.sin(Math.PI * clamp01(x));
  return s * s;
};
/** Opening: in 1.1 s to flat, a few degrees past, and back by 1.4 s. */
const openCurve = (u: number) => easeInOut(clamp01(u / 0.8)) + 0.028 * hump((u - 0.62) / 0.38);
/** Shutting: to closed by 1.15 s, a small rebound as the halves meet, settled by 1.4 s. */
const closeCurve = (u: number) => easeInOut(clamp01(u / 0.82)) - 0.02 * hump((u - 0.82) / 0.18);
/**
 * The quarter turn leads the opening (done by 0.85 s) and trails the shutting (from 0.5 s), so the
 * phone is never wide open while it stands diagonally, which would need a bigger box.
 */
const turnOpen = (u: number) => easeInOut(clamp01(u / 0.6));
const turnShut = (u: number) => easeInOut(clamp01((u - 0.35) / 0.65));

/** The fold: hinge angle (degrees) and quarter turn (radians), and an animation between open and shut. */
export class Fold {
  open: boolean;
  hinge: number;
  roll: number;
  private anim: { h0: number; h1: number; r0: number; r1: number; t: number; opening: boolean } | null = null;

  constructor(open: boolean) {
    this.open = open;
    this.hinge = open ? 180 : 0;
    this.roll = open ? LANDSCAPE : 0;
  }

  get moving() {
    return this.anim !== null;
  }

  /** Open or shut it: animated with motion, at once without. */
  set(open: boolean, motion: boolean) {
    this.open = open;
    if (!motion) {
      this.hinge = open ? 180 : 0;
      this.roll = open ? LANDSCAPE : 0;
      this.anim = null;
      return;
    }
    this.anim = { h0: this.hinge, h1: open ? 180 : 0, r0: this.roll, r1: open ? LANDSCAPE : 0, t: 0, opening: open };
  }

  step(dt: number) {
    const a = this.anim;
    if (!a) return;
    a.t += dt;
    const u = clamp01(a.t / UNFOLD);
    this.hinge = Math.max(0, a.h0 + (a.h1 - a.h0) * (a.opening ? openCurve(u) : closeCurve(u)));
    this.roll = a.r0 + (a.r1 - a.r0) * (a.opening ? turnOpen(u) : turnShut(u));
    if (u >= 1) {
      this.hinge = a.h1;
      this.roll = a.r1;
      this.anim = null;
    }
  }

  /** Jump to a pose (debug and the still tool). */
  pose(hinge: number, roll: number) {
    this.open = hinge > 90;
    this.hinge = hinge;
    this.roll = roll;
    this.anim = null;
  }
}

/** The entrance: waiting for the box to come into view, playing, or done (or never, without motion). */
export class Entrance {
  state: 'waiting' | 'playing' | 'done';
  private t = 0;
  /** Someone took the phone mid-entrance (a drag, a key, a click): the turn stops there. */
  took = false;

  constructor(motion: boolean) {
    this.state = motion ? 'waiting' : 'done';
  }

  start() {
    if (this.state !== 'waiting') return false;
    this.state = 'playing';
    this.t = 0;
    return true;
  }

  /** Advance; turns view from the start pose to the closed display pose. */
  step(dt: number, view: Quaternion) {
    if (this.state !== 'playing') return;
    this.t += dt;
    const u = clamp01((this.t - DELAY) / TURN);
    if (!this.took) view.slerpQuaternions(qStart, qClosed, easeInOut(u));
    if (u >= 1) this.state = 'done';
  }

  /** Skip it (debug poses, a rebuilt context, the box scrolled away): whatever pose it has, it stays. */
  finish() {
    this.state = 'done';
  }
}
