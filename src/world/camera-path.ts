// camera-path.ts: where the camera stands at each scene key, and the spline between them.
//
// Each key is a position plus a heading (yaw, pitch). Positions run on a centripetal Catmull-Rom
// spline; yaw and pitch run on their own cubic with Catmull-Rom tangents, limited so the heading
// never swings past a key and back. Inside each segment the parameter is eased (power2.inOut), so
// the camera settles into every key, except the moves into Since May and the first work stop,
// which the timeline eases on its own; People holds Since May's pose. No roll, ever: the camera always looks at a point with
// world up.
//
// The hero key is solved, not guessed: for the current aspect it finds the distance and pitch
// that put the tallest tower tops and the waterline exactly at HERO_FRAMING. Every other key is
// framed around its subject (the Central cluster, the three small clusters, the low block) with
// a fit to the current aspect, so phones and laptops both see the subject whole.

import { CatmullRomCurve3, PerspectiveCamera, Quaternion, Vector3 } from 'three';
import { HERO_FRAMING, SCENE_ORDER, type CameraPose, type SceneKey } from './contract';
import { PEAK_HALF, ridgeHeight, ridgeZ, type CityLayout } from './city';

export const FOV = 38;
const T = Math.tan(((FOV / 2) * Math.PI) / 180);
const DEG = Math.PI / 180;

/** Spline parameter of each key, spaced like the storyboard's scroll ranges (section 6). */
export const KEY_U: Record<SceneKey, number> = {
  hero: 0,
  question: 0.16,
  experience: 0.29,
  wisers: 0.355,
  och: 0.42,
  ais: 0.54,
  club: 0.66,
  more: 0.74,
  since: 0.83,
  people: 0.91,
  contact: 1,
};

/** The hero framing the other stops were placed from (tower tops and waterline, share of the height). */
const REF_FRAMING = { desktop: { skylineTop: 0.66, horizon: 0.86 }, phone: { skylineTop: 0.76, horizon: 0.9 } };

/** The wisers key's drift from the experience pose: sideways (share of the distance), up (m), and turns (radians). */
const WISERS_DRIFT = { side: 0.03, rise: 6, yaw: 1.5 * DEG, pitch: 7.5 * DEG, pitchPhone: 1.5 * DEG };

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
function solveHero(city: CityLayout, aspect: number, phone: boolean, framing = HERO_FRAMING): KeyPose {
  const fr = phone ? framing.phone : framing.desktop;
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

/**
 * The lowest pitch (raised from pose.pitch) at which every tower tip and the whole Peak ridge sit
 * below the bottom of the frame by at least margin (a share of the frame height, so the pointer
 * parallax can't tip them back into view).
 */
function clearOfSkyline(city: CityLayout, pose: KeyPose, aspect: number, margin: number): number {
  const pts: Vector3[] = [];
  for (const t of city.towers) pts.push(new Vector3(t.x, t.tip + 2, t.z));
  for (let x = city.centralX - PEAK_HALF; x <= city.centralX + PEAK_HALF; x += 40) pts.push(new Vector3(x, ridgeHeight(x, city), ridgeZ(x, city)));
  const cam = tmpCam;
  const v = new Vector3();
  let pitch = pose.pitch;
  for (let i = 0; i < 160; i++) {
    cam.position.copy(pose.pos);
    cam.lookAt(tmpV.copy(pose.pos).add(dirFrom(pose.yaw, pitch)));
    cam.updateMatrixWorld(true);
    let clear = true;
    for (const p of pts) {
      v.copy(p).applyMatrix4(cam.matrixWorldInverse);
      if (v.z >= -1) continue; // behind the camera
      const nx = v.x / -v.z / (T * aspect);
      const ny = v.y / -v.z / T;
      if (Math.abs(nx) <= 1.05 && (1 - ny) / 2 < 1 + margin) {
        clear = false;
        break;
      }
    }
    if (clear) break;
    pitch += 0.25 * DEG;
  }
  return pitch;
}

export interface CameraPath {
  keys: Record<SceneKey, number>;
  poses: Record<SceneKey, KeyPose>;
  heroDistance: number;
  pose(u: number, out?: { pos: Vector3; yaw: number; pitch: number }): KeyPose;
  /** Which segment of SCENE_ORDER u falls in (keys i and i + 1), and the eased share s along it. */
  segment(u: number): { i: number; s: number };
}

export function buildCameraPath(city: CityLayout, aspect: number, phone: boolean): CameraPath {
  const hero = solveHero(city, aspect, phone);
  // The later stops are placed from the distance of the earlier, closer hero framing, so moving the
  // hero (the city now a band along the bottom of the first screen) leaves every other stop as it was.
  const heroRef = solveHero(city, aspect, phone, REF_FRAMING);
  const Dh = heroRef.pos.z;
  const W = city.width;
  const fitW = (width: number, share: number) => width / share / (2 * T * aspect);

  // question: dolly forward and down toward the water; more water in frame.
  const qPos = new Vector3(heroRef.pos.x + 0.02 * Dh, 5, Dh * 0.8);
  const question: KeyPose = { pos: qPos, yaw: 0, pitch: pitchForWaterline(qPos, phone ? 0.64 : 0.6) };

  // experience: truck right and in, turning back toward the Central cluster, with sky above it for
  // the archive columns. On desktop the cluster sits left of center (x 0.3), so the columns stand
  // in the dark sky left of the Experience text, which fills the right grid columns.
  const c = new Vector3(city.central.x, city.central.y * 0.45, city.central.z);
  const sDist = Math.max(city.central.y / (0.36 * 2 * T), fitW(W * 0.16, phone ? 0.95 : 0.5));
  const sYaw = -13 * DEG;
  const sPos = new Vector3(c.x - Math.sin(sYaw) * sDist, 34, c.z + Math.cos(sYaw) * sDist);
  const experience = aimAt(sPos, c, phone ? 0.5 : 0.3, phone ? 0.74 : 0.7, aspect);

  // wisers: holds near the experience view while the Wisers pictures draw in the sky (left sky on
  // desktop, above the text on phones; WISERS_ANCHOR): a slight drift right and up, tilting up a
  // little so the skyline sinks below the pictures.
  const wDrift = new Vector3(Math.cos(experience.yaw), 0, Math.sin(experience.yaw)).multiplyScalar(sDist * WISERS_DRIFT.side);
  const wisers: KeyPose = {
    pos: experience.pos.clone().add(wDrift).add(new Vector3(0, WISERS_DRIFT.rise, 0)),
    yaw: experience.yaw + WISERS_DRIFT.yaw,
    pitch: experience.pitch + (phone ? WISERS_DRIFT.pitchPhone : WISERS_DRIFT.pitch),
  };

  // och: the first stop along the shoreline. Low and close, just left of Central, looking left
  // down the waterfront: the skyline recedes in perspective toward the low clusters (the next
  // stop) and the far end (club), and the brightness wave runs down a long line of windows.
  const oDist = Math.min(720, Math.max(320, 0.16 * W));
  const oPos = new Vector3(city.centralX - 0.03 * W, 12, oDist);
  const oSubject = new Vector3(city.centralX - 0.3 * W, 45, city.zFront - 40);
  const och = aimAt(oPos, oSubject, phone ? 0.5 : 0.46, phone ? 0.74 : 0.72, aspect);

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

  // since: tilt up from the city into the stars (no tower or ridge in the frame, so Since May's
  // and People's text both sit over sky).
  const sincePos = mPos.clone().add(new Vector3(0, 30, 0));
  const since: KeyPose = { pos: sincePos, yaw: 16 * DEG, pitch: 36 * DEG };
  // people: holds Since May's view exactly (spec: "Holds on the sky"); People is too short for a
  // move of its own. The segment between the two keys is a hold (see pose()).
  const people: KeyPose = { pos: sincePos.clone(), yaw: since.yaw, pitch: since.pitch };
  // contact: hold on the sky and pull back, pitched high enough that no tower or ridge shows
  // anywhere in the frame (the Contact text sits low; the two lights sit at y 0.30).
  const cPos = sincePos.clone().add(new Vector3(140, 60, 1400));
  const contact: KeyPose = { pos: cPos, yaw: 18 * DEG, pitch: 20 * DEG };
  contact.pitch = clearOfSkyline(city, contact, aspect, 0.05);

  const poses: Record<SceneKey, KeyPose> = { hero, question, experience, wisers, och, ais, club, more, since, people, contact };
  const order = SCENE_ORDER;
  const posCurve = new CatmullRomCurve3(order.map((k) => poses[k].pos.clone()), false, 'centripetal');
  const yawK = order.map((k) => poses[k].yaw);
  const pitchK = order.map((k) => poses[k].pitch);
  const yawM = limitedTangents(yawK);
  const pitchM = limitedTangents(pitchK);
  const us = order.map((k) => KEY_U[k]);
  const n = order.length;

  const ease = (s: number) => (s < 0.5 ? 2 * s * s : 1 - Math.pow(-2 * s + 2, 2) / 2);
  // Segments between two identical poses hold still (the spline would loop through them).
  const hold = order.map((k, i) => {
    if (i >= n - 1) return false;
    const a = poses[k];
    const b = poses[order[i + 1]];
    return a.pos.distanceTo(b.pos) < 1e-6 && a.yaw === b.yaw && a.pitch === b.pitch;
  });
  // The moves into Since May and into the first work stop are not eased or curved here: the
  // timeline eases them already, and easing them twice packed each turn into the middle of its
  // scroll (Since May about 3.4 degrees per 20 px, the 55 degree turn into Work about 9.5).
  const linear = order.map((_, i) => i < n - 1 && (order[i + 1] === 'since' || order[i + 1] === 'och'));
  const shape = (i: number, raw: number) => (linear[i] ? raw : ease(raw));

  return {
    keys: { ...KEY_U },
    poses,
    heroDistance: hero.pos.z,
    segment(u: number) {
      const uu = Math.min(1, Math.max(0, u));
      let i = 0;
      while (i < n - 2 && uu > us[i + 1]) i++;
      return { i, s: shape(i, Math.min(1, Math.max(0, (uu - us[i]) / (us[i + 1] - us[i])))) };
    },
    pose(u: number, out?: KeyPose): KeyPose {
      const uu = Math.min(1, Math.max(0, u));
      let i = 0;
      while (i < n - 2 && uu > us[i + 1]) i++;
      const s = shape(i, Math.min(1, Math.max(0, (uu - us[i]) / (us[i + 1] - us[i]))));
      const t = (i + s) / (n - 1);
      const o = out ?? { pos: new Vector3(), yaw: 0, pitch: 0 };
      if (hold[i]) {
        const k = poses[order[i]];
        o.pos.copy(k.pos);
        o.yaw = k.yaw;
        o.pitch = k.pitch;
        return o;
      }
      posCurve.getPoint(t, o.pos);
      if (linear[i]) {
        // straight from key to key: the timeline's easing alone sets the pace
        o.yaw = yawK[i] + (yawK[i + 1] - yawK[i]) * s;
        o.pitch = pitchK[i] + (pitchK[i + 1] - pitchK[i]) * s;
      } else {
        o.yaw = hermite(yawK, yawM, i, s);
        o.pitch = hermite(pitchK, pitchM, i, s);
      }
      return o;
    },
  };
}

/**
 * Tangents for a heading channel (one value per key, keys evenly spaced): Catmull-Rom tangents,
 * limited as Fritsch and Carlson do for monotone curves. Where the turn reverses at a key the
 * tangent is zero, and elsewhere it is at most three times the gentler of the two neighbouring
 * slopes, so a short segment next to a long swing doesn't overshoot its key and come back.
 */
function limitedTangents(v: number[]): number[] {
  const n = v.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push(v[i + 1] - v[i]);
  const m: number[] = [d[0]];
  for (let i = 1; i < n - 1; i++) {
    if (d[i - 1] * d[i] <= 0) {
      m.push(0);
      continue;
    }
    const cr = 0.5 * (d[i - 1] + d[i]);
    const cap = 3 * Math.min(Math.abs(d[i - 1]), Math.abs(d[i]));
    m.push(Math.sign(cr) * Math.min(Math.abs(cr), cap));
  }
  m.push(d[n - 2]);
  return m;
}

/** Cubic Hermite between keys i and i + 1 at s (0..1), with tangents m. */
function hermite(v: number[], m: number[], i: number, s: number): number {
  const s2 = s * s;
  const s3 = s2 * s;
  return (2 * s3 - 3 * s2 + 1) * v[i] + (s3 - 2 * s2 + s) * m[i] + (-2 * s3 + 3 * s2) * v[i + 1] + (s3 - s2) * m[i + 1];
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
