// camera-path.ts: where the camera stands at each scene key, and the spline between them.
//
// Each key is a position plus a heading (yaw, pitch). Positions run on a centripetal Catmull-Rom
// spline; yaw and pitch run on their own Catmull-Rom curve. Inside each segment the parameter is
// eased (power2.inOut), so the camera settles into every key. No roll, ever: the camera always
// looks at a point with world up.
//
// The hero key is solved, not guessed: for the current aspect it finds the distance and pitch
// that put the tallest tower tops and the waterline exactly at HERO_FRAMING. Every other key is
// framed around its subject (the Central cluster, the three small clusters, the low block) with
// a fit to the current aspect, so phones and laptops both see the subject whole.

import { CatmullRomCurve3, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { HERO_FRAMING, SCENE_ORDER, type CameraPose, type SceneKey } from './contract';
import type { CityLayout } from './city';

export const FOV = 38;
const T = Math.tan(((FOV / 2) * Math.PI) / 180);
const DEG = Math.PI / 180;

/** Spline parameter of each key, spaced like the storyboard's scroll ranges (section 6). */
export const KEY_U: Record<SceneKey, number> = {
  hero: 0,
  question: 0.16,
  summer: 0.29,
  och: 0.42,
  ais: 0.54,
  club: 0.66,
  more: 0.74,
  since: 0.83,
  people: 0.91,
  contact: 1,
};

export interface KeyPose {
  pos: Vector3;
  yaw: number; // radians, 0 looks south (-z), positive turns right (+x)
  pitch: number; // radians, positive looks up
}

export function dirFrom(yaw: number, pitch: number, out = new Vector3()): Vector3 {
  const c = Math.cos(pitch);
  return out.set(Math.sin(yaw) * c, Math.sin(pitch), -Math.cos(yaw) * c);
}

const tmpCam = new PerspectiveCamera(FOV, 1, 1, 30000);
const tmpV = new Vector3();

/** Screen position (x from the left, y from the top, 0..1) of a world point. */
export function projectFrac(pose: KeyPose, aspect: number, p: Vector3): [number, number] {
  tmpCam.aspect = aspect;
  tmpCam.updateProjectionMatrix();
  tmpCam.position.copy(pose.pos);
  tmpCam.lookAt(tmpV.copy(pose.pos).add(dirFrom(pose.yaw, pose.pitch)));
  tmpCam.updateMatrixWorld(true);
  const v = p.clone().project(tmpCam);
  return [(v.x + 1) / 2, (1 - v.y) / 2];
}

/** Aim from pos so that point p lands at screen (sx, sy). A few corrective steps, no roll. */
function aimAt(pos: Vector3, p: Vector3, sx: number, sy: number, aspect: number): KeyPose {
  const d = p.clone().sub(pos);
  const pose: KeyPose = {
    pos: pos.clone(),
    yaw: Math.atan2(d.x, -d.z),
    pitch: Math.atan2(d.y, Math.hypot(d.x, d.z)),
  };
  for (let i = 0; i < 6; i++) {
    const [fx, fy] = projectFrac(pose, aspect, p);
    // move the view so the point slides toward its target spot
    pose.yaw += Math.atan((fx - sx) * 2 * T * aspect) * 0.9;
    pose.pitch += Math.atan((sy - fy) * 2 * T) * 0.9;
  }
  return pose;
}

/** Hero: distance and pitch so the tallest tops and the waterline sit at HERO_FRAMING. */
function solveHero(city: CityLayout, aspect: number, phone: boolean): KeyPose {
  const fr = phone ? HERO_FRAMING.phone : HERO_FRAMING.desktop;
  const h = 12;
  const nW = 1 - 2 * fr.horizon;
  const nTop = 1 - 2 * fr.skylineTop;
  const pitchFor = (cz: number) => Math.atan((-h - nW * T * cz) / (cz + nW * T * -h));
  const topNdc = (cz: number) => {
    const p = pitchFor(cz);
    const sp = Math.sin(p);
    const cp = Math.cos(p);
    let best = -Infinity;
    for (const t of city.towers) {
      const hh = t.roof - h;
      const f = cz - t.z;
      const ndc = (hh * cp - f * sp) / ((hh * sp + f * cp) * T);
      if (ndc > best) best = ndc;
    }
    return best;
  };
  let lo = 300;
  let hi = 40000;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (topNdc(mid) > nTop) lo = mid;
    else hi = mid;
  }
  const cz = (lo + hi) / 2;
  const pitch = pitchFor(cz);
  // Across: the tallest cluster sits left of center (the figure takes the right on desktop).
  const sx = phone ? 0.46 : 0.4;
  const c = city.central;
  const depth = (c.y * 0.5 - h) * Math.sin(pitch) + (cz - c.z) * Math.cos(pitch);
  const cx = c.x - (2 * sx - 1) * depth * T * aspect;
  return { pos: new Vector3(cx, h, cz), yaw: 0, pitch };
}

/** Pitch that puts the waterline (z = 0 straight ahead) at screen y fraction fy, from pos. */
function pitchForWaterline(pos: Vector3, fy: number): number {
  const n = 1 - 2 * fy;
  const hgt = -pos.y;
  const f = pos.z;
  return Math.atan((hgt - n * T * f) / (f + n * T * hgt));
}

export interface CameraPath {
  keys: Record<SceneKey, number>;
  poses: Record<SceneKey, KeyPose>;
  heroDistance: number;
  pose(u: number, out?: { pos: Vector3; yaw: number; pitch: number }): KeyPose;
}

export function buildCameraPath(city: CityLayout, aspect: number, phone: boolean): CameraPath {
  const hero = solveHero(city, aspect, phone);
  const Dh = hero.pos.z;
  const W = city.width;
  const fitW = (width: number, share: number) => width / share / (2 * T * aspect);

  // question: dolly forward and down toward the water; more water in frame.
  const qPos = new Vector3(hero.pos.x + 0.02 * Dh, 5, Dh * 0.8);
  const question: KeyPose = { pos: qPos, yaw: 0, pitch: pitchForWaterline(qPos, phone ? 0.64 : 0.6) };

  // summer: truck right and in, turning back toward the Central cluster, with sky above it for
  // the archive columns.
  const c = new Vector3(city.central.x, city.central.y * 0.45, city.central.z);
  const sDist = Math.max(city.central.y / (0.36 * 2 * T), fitW(W * 0.16, phone ? 0.95 : 0.5));
  const sYaw = -13 * DEG;
  const sPos = new Vector3(c.x - Math.sin(sYaw) * sDist, 34, c.z + Math.cos(sYaw) * sDist);
  const summer = aimAt(sPos, c, phone ? 0.5 : 0.62, phone ? 0.74 : 0.7, aspect);

  // och: a wide look along the city so the brightness wave crosses every window.
  const oSubject = new Vector3(city.xMin + 0.4 * W, 90, -150);
  const oDist = Math.max(Dh * 0.78, 600);
  const oPos = new Vector3(oSubject.x + 0.04 * oDist, 22, oDist);
  const och: KeyPose = { pos: oPos, yaw: 2 * DEG, pitch: pitchForWaterline(oPos, phone ? 0.84 : 0.82) };

  // ais: the three small low clusters, spread across the middle of the frame.
  const cl = city.clusters;
  const span = cl[cl.length - 1].x1 - cl[0].x0;
  const aSubject = new Vector3((cl[0].x0 + cl[cl.length - 1].x1) / 2, 18, cl[1].z);
  const aDist = Math.max(450, fitW(span, phone ? 0.86 : 0.52));
  const aPos = new Vector3(aSubject.x + 0.05 * aDist, 10, aSubject.z + aDist);
  const ais = aimAt(aPos, aSubject, 0.5, phone ? 0.8 : 0.78, aspect);

  // club: close on the compact low-rise block at the far left.
  const lb = city.lowBlock;
  const lSubject = new Vector3(lb.x, lb.y * 0.4, lb.z);
  const lDist = Math.max(380, fitW(lb.x1 - lb.x0, phone ? 0.62 : 0.3));
  const lYaw = 8 * DEG;
  const lPos = new Vector3(lSubject.x - Math.sin(-lYaw) * lDist, 8, lSubject.z + Math.cos(lYaw) * lDist);
  const club = aimAt(lPos, lSubject, 0.5, phone ? 0.8 : 0.76, aspect);

  // more: pull back and rise, the city sinking toward the bottom of the frame.
  const mPos = new Vector3(lb.x + 0.18 * Dh, 48, lDist + 0.35 * Dh);
  const more: KeyPose = { pos: mPos, yaw: 10 * DEG, pitch: pitchForWaterline(mPos, phone ? 0.9 : 0.88) + 1 * DEG };

  // since: tilt up from the city into the stars.
  const sincePos = mPos.clone().add(new Vector3(0, 30, 0));
  const since: KeyPose = { pos: sincePos, yaw: 16 * DEG, pitch: 36 * DEG };
  // people: hold on the sky, drifting a touch further.
  const people: KeyPose = { pos: sincePos.clone().add(new Vector3(40, 10, 0)), yaw: 20 * DEG, pitch: 42 * DEG };
  // contact: hold on the sky and pull back slightly, so the tops of the towers just show below.
  const cPos = sincePos.clone().add(new Vector3(140, 40, 520));
  const contact: KeyPose = { pos: cPos, yaw: 18 * DEG, pitch: 23 * DEG };

  const poses: Record<SceneKey, KeyPose> = { hero, question, summer, och, ais, club, more, since, people, contact };
  const order = SCENE_ORDER;
  const posCurve = new CatmullRomCurve3(order.map((k) => poses[k].pos.clone()), false, 'centripetal');
  const angCurve = new CatmullRomCurve3(order.map((k) => new Vector3(poses[k].yaw, poses[k].pitch, 0)), false, 'catmullrom', 0.5);
  const us = order.map((k) => KEY_U[k]);
  const n = order.length;
  const ang = new Vector3();

  const ease = (s: number) => (s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2);

  return {
    keys: { ...KEY_U },
    poses,
    heroDistance: Dh,
    pose(u: number, out?: KeyPose): KeyPose {
      const uu = Math.min(1, Math.max(0, u));
      let i = 0;
      while (i < n - 2 && uu > us[i + 1]) i++;
      const s = ease(Math.min(1, Math.max(0, (uu - us[i]) / (us[i + 1] - us[i]))));
      const t = (i + s) / (n - 1);
      const o = out ?? { pos: new Vector3(), yaw: 0, pitch: 0 };
      posCurve.getPoint(t, o.pos);
      angCurve.getPoint(t, ang);
      o.yaw = ang.x;
      o.pitch = ang.y;
      return o;
    },
  };
}

const look = new Vector3();
/** Put a camera at a pose, with optional extra yaw and pitch (parallax). Never rolls. */
export function applyPose(cam: PerspectiveCamera, p: KeyPose, dYaw = 0, dPitch = 0) {
  cam.position.copy(p.pos);
  cam.lookAt(look.copy(p.pos).add(dirFrom(p.yaw + dYaw, p.pitch + dPitch)));
}

export function poseToCameraPose(p: KeyPose): CameraPose {
  const cam = tmpCam;
  cam.position.copy(p.pos);
  cam.lookAt(look.copy(p.pos).add(dirFrom(p.yaw, p.pitch)));
  return { position: p.pos.clone(), quaternion: new Quaternion().copy(cam.quaternion), fov: FOV };
}
