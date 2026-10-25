// device.ts: the folding phone itself (V4.md 6.1), built in code at real size (millimetres):
// body, frame, hinge, buttons, ports and cameras. Its materials are in materials.ts, its screens
// in screens.ts.
//
// A book-style foldable of our own design (no brand, no copied layout): closed about 74 x 156 x 11,
// open 146 x 156, two halves 5.5 thick that meet on the spine.
//
//   The body frame: the spine runs along y at x = 0, the inner screen faces +z at z = 0. The fixed
//   half spans x 0 to 73 and carries the rear cameras on its back. The folding half spans x -73 to 0
//   and turns about the spine (rotation.y = 180 - hinge), so at hinge 0 it lies on the fixed half,
//   its back (the cover screen) facing +z. Its outer edge carries the buttons.
//   The hinge cover: a segmented half-cylinder that turns by half the hinge angle, so it fills the
//   rounded spine when closed and sits in the valley between the two backs when open. Part way
//   open its flat side would cross the gap between the two screens, so a pair of clipping planes
//   (the two screen planes) cuts away whatever of it lies in front of both screens.
//   The cover screen is on only while the phone is shut, like a real foldable's: it goes dark as
//   the phone opens (by 60 degrees) and lights again as it closes.
//
// The shapes:
//   slab()     one half of the phone (or the camera plateau): a rounded rectangle with its own
//              edge profile, lofted ring by ring. The back edge has a round whose radius can
//              change along the outline (large on the hinge side, so two closed halves make a
//              rounded spine), the front edge a small hard chamfer that catches light, and each
//              corner can be rounder at the back than at the front. Three material groups:
//              front face, back face, sides (the frame).
//   revolve()  a profile turned around the z axis (lens rings, the flash bezel), with hard
//              edges where asked.
//   dome()     a slightly domed disc with flat (planar) UVs (lens glass, flash, sensor).

import { BufferGeometry, CylinderGeometry, Float32BufferAttribute, Group, Mesh, Plane, ShapeUtils, Vector2, Vector3, type Matrix4 } from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import {
  bodyGlass,
  buttonMaterial,
  coreMaterial,
  flashMaterial,
  frameMaterial,
  hingeMaterial,
  lensMaterial,
  powerMaterial,
  ringMetal,
  sensorMaterial,
  type FrameFeature,
} from './materials';
import { creaseNormal, screenMap, screenMaterial, type Photo } from './screens';

/** Real proportions (mm). */
export const SIZE = {
  height: 156,
  half: 73,
  thickness: 5.5,
};
const H = SIZE.height;
const W = SIZE.half;
const T = SIZE.thickness;
const Y0 = -H / 2;
const Y1 = H / 2;
/** The back round on the spine side: two closed halves make a rounded spine of this radius. */
const SPINE_ROUND = 4.9;
const EDGE_ROUND = 0.75;
const CHAMFER = 0.45;
const OUTER_CORNER = 10;
/** Spine-side corners: round at the back (for the spine), almost square at the front (so the inner screen runs straight across the fold). */
const SPINE_CORNER_BACK = 5.2;
const SPINE_CORNER_FRONT = 1;
const COVER_R = 5.45;
/** Pixels per mm in the screen textures: enough for DPR 2 at the largest size the module shows. */
const SCREEN_DENSITY = 7;

export interface Device {
  /** The body: halves and hinge. Its origin is the spine at the screen plane. */
  body: Group;
  /** Hinge angle in degrees: 0 shut, 180 flat open (a few degrees past for the overshoot). */
  setHinge(deg: number): void;
  /** The middle of the body at the current hinge angle, for turning it about its middle. */
  center(out: Vector3): Vector3;
  /** Place the hinge cover's clipping planes for the body's world matrix (after setHinge, every frame). */
  clip(bodyWorld: Matrix4): void;
  /** Points that bound the body at its current hinge angle (local to body), for the shadow. */
  bounds: Vector3[];
  dispose(): void;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

// ---- The shapes ----------------------------------------------------------------------------

interface SlabOptions {
  /** Outline extent (x0 < x1, y0 < y1). */
  x0: number;
  x1: number;
  y0: number;
  y1: number;
  /** Corner radii at the back and at the front, in the order x0y0, x1y0, x1y1, x0y1. */
  backRadii: [number, number, number, number];
  frontRadii: [number, number, number, number];
  /** The back face sits at z0, the front face at z1. */
  z0: number;
  z1: number;
  /** The round between the back face and the side at an outline point (from its nominal x, y). */
  backRound: (x: number, y: number) => number;
  /** The hard chamfer between the side and the front face, at an outline point (nominal x, y). */
  chamfer: (x: number, y: number) => number;
  /** UVs for the two faces, from the final (mirrored, if asked) x and y. */
  uvFront: (x: number, y: number) => [number, number];
  uvBack: (x: number, y: number) => [number, number];
  /** Mirror in x (the folding half), keeping faces outward. */
  mirror?: boolean;
  /** Segments per corner arc, and the longest straight segment. */
  cornerSegments?: number;
  maxEdge?: number;
}

interface OutlinePoint {
  /** Corner index (0 to 3) or -1 on a straight edge. */
  corner: number;
  /** On a corner: the angle; on an edge: the edge index and fraction along it. */
  angle: number;
  edge: number;
  t: number;
  /** Outward normal (constant across rings). */
  nx: number;
  ny: number;
}

const BACK_ARC = 7; // segments in the back round

/**
 * The side wall's UVs: u is the arc length along the front outline, normalised, starting where
 * the x0 edge meets the x0y0 corner and running counter-clockwise seen from the front (bottom
 * edge, x1 edge, top edge, x0 edge, before any mirror); v is the height, 0 at the back face and 1
 * at the front. userData.uAt(x, y) gives u for a point on the outline (final coordinates), so
 * the frame texture can place ports and bands.
 */
function slab(o: SlabOptions): BufferGeometry {
  const segC = o.cornerSegments ?? 12;
  const maxEdge = o.maxEdge ?? 2;
  const { x0, x1, y0, y1, z0, z1 } = o;
  const sx = [-1, 1, 1, -1];
  const sy = [-1, -1, 1, 1];
  // Corner angles: bottom-left 180..270, bottom-right 270..360, top-right 0..90, top-left 90..180.
  const startAngle = [Math.PI, 1.5 * Math.PI, 0, 0.5 * Math.PI];

  // ---- The outline topology (shared by every ring) ----
  const pts: OutlinePoint[] = [];
  // Edges, after each corner: 0 bottom (after corner 0), 1 right, 2 top, 3 left.
  const edgeLen = [x1 - x0, y1 - y0, x1 - x0, y1 - y0];
  for (const c of [0, 1, 2, 3]) {
    for (let k = 0; k < segC; k++) {
      const a = startAngle[c] + (k / segC) * 0.5 * Math.PI;
      pts.push({ corner: c, angle: a, edge: -1, t: 0, nx: Math.cos(a), ny: Math.sin(a) });
    }
    const e = c; // the edge leaving corner c
    const n = Math.max(1, Math.ceil(edgeLen[e] / maxEdge));
    const normal = [
      [0, -1],
      [1, 0],
      [0, 1],
      [-1, 0],
    ][e];
    for (let k = 0; k < n; k++) pts.push({ corner: -1, angle: 0, edge: e, t: k / n, nx: normal[0], ny: normal[1] });
  }
  const N = pts.length;

  // A point of the outline at corner radii r[], inset by d along its normal (never past a corner's
  // own centre, so a big inset on a small corner can't fold the outline over itself).
  const at = (p: OutlinePoint, r: number[], d: number): [number, number] => {
    if (p.corner >= 0) {
      const c = p.corner;
      const rc = r[c];
      const cx = (sx[c] < 0 ? x0 : x1) - sx[c] * rc;
      const cy = (sy[c] < 0 ? y0 : y1) - sy[c] * rc;
      const k = Math.max(0, rc - d);
      return [cx + p.nx * k, cy + p.ny * k];
    }
    // Edge e runs from the end of corner e's arc to the start of corner (e + 1)'s arc.
    const e = p.edge;
    const c0 = e;
    const c1 = (e + 1) % 4;
    let ax: number, ay: number, bx: number, by: number;
    if (e === 0) {
      ax = x0 + r[c0];
      bx = x1 - r[c1];
      ay = by = y0;
    } else if (e === 1) {
      ay = y0 + r[c0];
      by = y1 - r[c1];
      ax = bx = x1;
    } else if (e === 2) {
      ax = x1 - r[c0];
      bx = x0 + r[c1];
      ay = by = y1;
    } else {
      ay = y1 - r[c0];
      by = y0 + r[c1];
      ax = bx = x0;
    }
    return [ax + (bx - ax) * p.t - p.nx * d, ay + (by - ay) * p.t - p.ny * d];
  };

  // ---- Rings: from the back face's edge, round the back, up the side, over the chamfer ----
  // Each ring: inset d, height z, and the profile normal (h outward, v along z), for one point.
  type Ring = { d: number; z: number; h: number; v: number; tau: number };
  const ringsFor = (rb: number, c: number): Ring[] => {
    const rings: Ring[] = [];
    for (let k = 0; k <= BACK_ARC; k++) {
      const a = (k / BACK_ARC) * 0.5 * Math.PI;
      rings.push({ d: rb * (1 - Math.sin(a)), z: z0 + rb * (1 - Math.cos(a)), h: Math.sin(a), v: -Math.cos(a), tau: (0.6 * k) / BACK_ARC });
    }
    rings.push({ d: 0, z: z1 - c, h: 1, v: 0, tau: 0.85 });
    const s = Math.SQRT1_2;
    rings.push({ d: 0, z: z1 - c, h: s, v: s, tau: 0.85 });
    rings.push({ d: c, z: z1, h: s, v: s, tau: 1 });
    return rings;
  };
  const R = BACK_ARC + 4;

  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const mirror = o.mirror ? -1 : 1;
  const push = (x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, v: number) => {
    positions.push(x * mirror, y, z);
    normals.push(nx * mirror, ny, nz);
    uvs.push(u, v);
  };

  // Arc length along the front outline, for the side UVs.
  const frontR = o.frontRadii;
  const frontPts = pts.map((p) => at(p, frontR, 0));
  const s: number[] = [0];
  for (let i = 1; i <= N; i++) {
    const a = frontPts[i - 1];
    const b = frontPts[i % N];
    s.push(s[i - 1] + Math.hypot(b[0] - a[0], b[1] - a[1]));
  }
  const perimeter = s[N];

  const radiiAt = (tau: number): number[] => {
    const w = tau * tau * (3 - 2 * tau);
    return o.backRadii.map((rb, c) => rb + (frontR[c] - rb) * w);
  };

  // Side vertices: (N + 1) columns (the seam is duplicated for the UVs) by R rings.
  const thickness = z1 - z0;
  const rbOf: number[] = [];
  const chOf: number[] = [];
  for (const p of pts) {
    const [x, y] = at(p, radiiAt(0.5), 0);
    rbOf.push(o.backRound(x, y));
    chOf.push(o.chamfer(x, y));
  }
  for (let i = 0; i <= N; i++) {
    const p = pts[i % N];
    const rings = ringsFor(rbOf[i % N], chOf[i % N]);
    for (const ring of rings) {
      const [x, y] = at(p, radiiAt(ring.tau), ring.d);
      push(x, y, ring.z, p.nx * ring.h, p.ny * ring.h, ring.v, s[i] / perimeter, (ring.z - z0) / thickness);
    }
  }
  const sideIdx: number[] = [];
  for (let i = 0; i < N; i++) {
    for (let k = 0; k < R - 1; k++) {
      // Skip the zero-height quad at the chamfer's hard edge.
      if (k === BACK_ARC + 1) continue;
      const a = i * R + k;
      const b = (i + 1) * R + k;
      sideIdx.push(a, b, b + 1, a, b + 1, a + 1);
    }
  }

  // ---- Faces: earcut on the outermost ring of each face ----
  const face = (ringIndex: number, front: boolean): number[] => {
    const contour: Vector2[] = [];
    const base = positions.length / 3;
    for (let i = 0; i < N; i++) {
      const ring = ringsFor(rbOf[i], chOf[i])[ringIndex];
      const [x, y] = at(pts[i], radiiAt(ring.tau), ring.d);
      contour.push(new Vector2(x, y));
    }
    // Drop points that collapsed onto their neighbour (a small corner inset to its centre).
    const keep: number[] = [];
    for (let i = 0; i < N; i++) {
      const prev = contour[keep.length ? keep[keep.length - 1] : N - 1];
      if (keep.length && prev.distanceToSquared(contour[i]) < 1e-6) continue;
      keep.push(i);
    }
    const ring = keep.map((i) => contour[i]);
    const z = front ? z1 : z0;
    for (const v of ring) {
      const fx = v.x * mirror;
      const [u, w] = front ? o.uvFront(fx, v.y) : o.uvBack(fx, v.y);
      push(v.x, v.y, z, 0, 0, front ? 1 : -1, u, w);
    }
    const idx: number[] = [];
    for (const [a, b, c] of ShapeUtils.triangulateShape(ring, [])) {
      const area = (ring[b].x - ring[a].x) * (ring[c].y - ring[a].y) - (ring[c].x - ring[a].x) * (ring[b].y - ring[a].y);
      // Counter-clockwise seen from the face's side.
      if (area > 0 === front) idx.push(base + a, base + b, base + c);
      else idx.push(base + a, base + c, base + b);
    }
    return idx;
  };
  const frontIdx = face(R - 1, true);
  const backIdx = face(0, false);

  let index = [...frontIdx, ...backIdx, ...sideIdx];
  if (o.mirror) {
    // A mirror turns every triangle inside out; swap two corners of each.
    const flipped: number[] = [];
    for (let i = 0; i < index.length; i += 3) flipped.push(index[i], index[i + 2], index[i + 1]);
    index = flipped;
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  g.addGroup(0, frontIdx.length, 0);
  g.addGroup(frontIdx.length, backIdx.length, 1);
  g.addGroup(frontIdx.length + backIdx.length, sideIdx.length, 2);
  g.userData.uAt = (fx: number, fy: number): number => {
    const x = fx * mirror;
    let best = Infinity;
    let u = 0;
    for (let i = 0; i < N; i++) {
      const [ax, ay] = frontPts[i];
      const [bx, by] = frontPts[(i + 1) % N];
      const dx = bx - ax;
      const dy = by - ay;
      const l2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * dx + (fy - ay) * dy) / l2));
      const d = Math.hypot(ax + dx * t - x, ay + dy * t - fy);
      if (d < best) {
        best = d;
        u = (s[i] + t * (s[i + 1] - s[i])) / perimeter;
      }
    }
    return u;
  };
  g.userData.perimeter = perimeter;
  return g;
}

interface ProfilePoint {
  r: number;
  z: number;
  /** A hard edge: the faces either side get their own normals. */
  hard?: boolean;
}

/** A profile (from the outside in, or bottom to top) turned around the z axis. */
function revolve(profile: ProfilePoint[], segments = 48): BufferGeometry {
  // Expand hard points into two, so each run of segments has its own smooth normals.
  type P = { r: number; z: number; nr: number; nz: number };
  const segNormal = (a: ProfilePoint, b: ProfilePoint) => {
    const dr = b.r - a.r;
    const dz = b.z - a.z;
    const l = Math.hypot(dr, dz) || 1;
    // Outward/up when the profile runs from outside in at the top (dr < 0 with dz >= 0).
    return [dz / l, -dr / l];
  };
  const pts: P[] = [];
  for (let i = 0; i < profile.length; i++) {
    const prev = i > 0 ? segNormal(profile[i - 1], profile[i]) : null;
    const next = i < profile.length - 1 ? segNormal(profile[i], profile[i + 1]) : null;
    const p = profile[i];
    if (p.hard && prev && next) {
      pts.push({ r: p.r, z: p.z, nr: prev[0], nz: prev[1] });
      pts.push({ r: p.r, z: p.z, nr: next[0], nz: next[1] });
    } else {
      const n = prev && next ? [prev[0] + next[0], prev[1] + next[1]] : (prev ?? next)!;
      const l = Math.hypot(n[0], n[1]) || 1;
      pts.push({ r: p.r, z: p.z, nr: n[0] / l, nz: n[1] / l });
    }
  }
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  for (let j = 0; j <= segments; j++) {
    const a = (j / segments) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    pts.forEach((p, i) => {
      positions.push(p.r * c, p.r * s, p.z);
      normals.push(p.nr * c, p.nr * s, p.nz);
      uvs.push(j / segments, i / (pts.length - 1));
    });
  }
  const index: number[] = [];
  const M = pts.length;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < M - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      if (a.r === b.r && a.z === b.z) continue;
      const p = j * M + i;
      const q = (j + 1) * M + i;
      index.push(p, q, p + 1, q, q + 1, p + 1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

/** A disc of radius r, domed up by h at its centre, facing +z, with flat UVs (0 to 1 across). */
function dome(r: number, h: number, rings = 8, segments = 48): BufferGeometry {
  const positions: number[] = [0, 0, h];
  const normals: number[] = [0, 0, 1];
  const uvs: number[] = [0.5, 0.5];
  for (let i = 1; i <= rings; i++) {
    const rr = (i / rings) * r;
    const z = h * (1 - (rr * rr) / (r * r));
    const slope = (2 * h * rr) / (r * r);
    const l = Math.hypot(slope, 1);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      positions.push(rr * c, rr * s, z);
      normals.push((slope * c) / l, (slope * s) / l, 1 / l);
      uvs.push(0.5 + (rr * c) / (2 * r), 0.5 + (rr * s) / (2 * r));
    }
  }
  const index: number[] = [];
  for (let j = 0; j < segments; j++) index.push(0, 1 + j, 1 + ((j + 1) % segments));
  for (let i = 1; i < rings; i++) {
    const a0 = 1 + (i - 1) * segments;
    const b0 = 1 + i * segments;
    for (let j = 0; j < segments; j++) {
      const j1 = (j + 1) % segments;
      index.push(a0 + j, b0 + j, b0 + j1, a0 + j, b0 + j1, a0 + j1);
    }
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(positions, 3));
  g.setAttribute('normal', new Float32BufferAttribute(normals, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uvs, 2));
  g.setIndex(index);
  return g;
}

// ---- The device ----------------------------------------------------------------------------

export function buildDevice(photos: { cover: Photo; inner: Photo }, maxAnisotropy: number): Device {
  const disposables: { dispose(): void }[] = [];
  const keep = <D extends { dispose(): void }>(x: D): D => {
    disposables.push(x);
    return x;
  };

  // ---- The two halves ----
  const halfOptions = (mirror: boolean): SlabOptions => ({
    x0: 0,
    x1: W,
    y0: Y0,
    y1: Y1,
    backRadii: [SPINE_CORNER_BACK, OUTER_CORNER, OUTER_CORNER, SPINE_CORNER_BACK],
    frontRadii: [SPINE_CORNER_FRONT, OUTER_CORNER, OUTER_CORNER, SPINE_CORNER_FRONT],
    z0: -T,
    z1: 0,
    // Large on the spine side, fading out over the first 7 mm of the top and bottom edges.
    backRound: (x) => EDGE_ROUND + (SPINE_ROUND - EDGE_ROUND) * (1 - smooth(0, 7, x)),
    // None along the spine itself, so the inner screen runs on across the fold without a groove.
    chamfer: (x) => CHAMFER * smooth(0, 2.5, x),
    // The inner screen: one texture across both halves, x -73 to 73.
    uvFront: (x, y) => [(x + W) / (2 * W), (y - Y0) / H],
    // Fixed half: flake tiling; folding half: the cover screen, which reads left to right when
    // shut (shut, its x runs the other way: x -73 shows at the right).
    uvBack: mirror ? (x, y) => [-x / W, (y - Y0) / H] : (x, y) => [x / 40, y / 40],
    mirror,
    maxEdge: 3,
  });
  const fixedGeo = keep(slab(halfOptions(false)));
  const foldGeo = keep(slab(halfOptions(true)));
  const perimeter = fixedGeo.userData.perimeter as number;

  // ---- Frame decals: antenna bands, buttons' cut-outs, port, holes ----
  // Heights are from the back face. Buttons sit on the folding half's outer edge (x = -73).
  const BUTTON_Z = 2.6; // centre height from the back
  const BUTTON_DEPTH = 2.2;
  const buttons = [
    { y0: 46, y1: 57, protrude: 0.62, power: false }, // volume up
    { y0: 33, y1: 44, protrude: 0.62, power: false }, // volume down
    { y0: 8, y1: 26, protrude: 0.42, power: true }, // side key (also the fingerprint sensor)
  ];
  const uFix = fixedGeo.userData.uAt as (x: number, y: number) => number;
  const uFold = foldGeo.userData.uAt as (x: number, y: number) => number;
  const bands = (uAt: (x: number, y: number) => number, sx: number): FrameFeature[] => [
    { kind: 'band', u: uAt(sx * W, Y1 - 17), width: 1 },
    { kind: 'band', u: uAt(sx * W, Y0 + 17), width: 1 },
    { kind: 'band', u: uAt(sx * 30, Y1), width: 1 },
    { kind: 'band', u: uAt(sx * 46, Y0), width: 1 },
  ];
  const fixedFeatures: FrameFeature[] = [
    ...bands(uFix, 1),
    { kind: 'port', u: uFix(W / 2, Y0), z: T / 2 },
    { kind: 'holes', u: uFix(W / 2 + 14, Y0), z: T / 2, count: 6, spacing: 1.7, diameter: 0.9 },
    { kind: 'holes', u: uFix(W / 2 - 11, Y0), z: T / 2, count: 1, spacing: 0, diameter: 0.8 },
    { kind: 'holes', u: uFix(W / 2 + 8, Y1), z: T / 2, count: 1, spacing: 0, diameter: 0.8 },
  ];
  const foldFeatures: FrameFeature[] = [
    ...bands(uFold, -1),
    { kind: 'holes', u: uFold(-W / 2 - 12, Y0), z: T / 2, count: 6, spacing: 1.7, diameter: 0.9 },
    { kind: 'holes', u: uFold(-W / 2 + 6, Y1), z: T / 2, count: 1, spacing: 0, diameter: 0.8 },
    ...buttons.map((b): FrameFeature => {
      const ua = uFold(-W, b.y0);
      const ub = uFold(-W, b.y1);
      return { kind: 'cutout', u0: Math.min(ua, ub), u1: Math.max(ua, ub), z0: BUTTON_Z - BUTTON_DEPTH / 2, z1: BUTTON_Z + BUTTON_DEPTH / 2 };
    }),
  ];
  const fixedFrame = keep(frameMaterial(perimeter, T, fixedFeatures, maxAnisotropy));
  const foldFrame = keep(frameMaterial(perimeter, T, foldFeatures, maxAnisotropy));

  // ---- Glass and screens ----
  const backGlass = keep(bodyGlass(maxAnisotropy));
  // Cover screen: the folding half's back, flat between x 4.9 and 72.25 (texture x = -x).
  const coverTex = keep(
    screenMap(photos.cover, {
      width: W,
      height: H,
      area: { x: 6.5, y: 2.4, w: 64.3, h: H - 4.8, r: 7 },
      rotate: false,
      hole: { x: 6.5 + 64.3 / 2, y: H - 2.4 - 5.2, d: 2.5 },
      density: SCREEN_DENSITY,
    }),
  );
  coverTex.anisotropy = maxAnisotropy;
  // Inner screen: x -73 to 73 maps to texture x 0 to 146. The photo turns a quarter clockwise, so
  // after the phone's quarter turn counter-clockwise into landscape it stands upright.
  const border = 2.9;
  const innerTex = keep(
    screenMap(photos.inner, {
      width: 2 * W,
      height: H,
      area: { x: CHAMFER + border, y: CHAMFER + border, w: 2 * W - 2 * (CHAMFER + border), h: H - 2 * (CHAMFER + border), r: 6.5 },
      rotate: true,
      hole: { x: W + W / 2, y: H - CHAMFER - border - 4.4, d: 2.5 },
      crease: W,
      density: SCREEN_DENSITY,
    }),
  );
  innerTex.anisotropy = maxAnisotropy;
  const innerMat = keep(screenMaterial(innerTex, keep(creaseNormal(2 * W))));
  const coverMat = keep(screenMaterial(coverTex));
  const COVER_GLOW = coverMat.emissiveIntensity;

  const fixedHalf = new Mesh(fixedGeo, [innerMat, backGlass, fixedFrame]);
  const foldHalf = new Mesh(foldGeo, [innerMat, coverMat, foldFrame]);
  const foldPivot = new Group();
  foldPivot.add(foldHalf);

  // ---- Rear cameras (fixed half, back, top, outer side) ----
  const back = new Group();
  // Built facing +z, then turned to face the back (-z) about y, which mirrors x.
  back.rotation.y = Math.PI;
  back.position.z = -T;
  const toBack = (x: number) => -x; // body x to the turned group's x
  const rings = keep(ringMetal());
  const plateauGeo = keep(
    slab({
      x0: -12.5,
      x1: 12.5,
      y0: -25,
      y1: 25,
      backRadii: [10, 10, 10, 10],
      frontRadii: [10, 10, 10, 10],
      z0: 0,
      z1: 1.15,
      backRound: () => 0.05,
      chamfer: () => 0.38,
      uvFront: (x, y) => [x / 40, y / 40],
      uvBack: (x, y) => [x / 40, y / 40],
      cornerSegments: 16,
    }),
  );
  const plateau = new Mesh(plateauGeo, [backGlass, backGlass, rings]);
  const PLATEAU = { x: 54.5, y: 45 };
  plateau.position.set(toBack(PLATEAU.x), PLATEAU.y, 0);
  back.add(plateau);

  // Lenses: a metal ring (outer wall, chamfer, flat, inner chamfer) around domed dark glass.
  const ringProfile = [
    { r: 5.8, z: 0, hard: true },
    { r: 5.8, z: 0.5, hard: true },
    { r: 5.42, z: 0.88, hard: true },
    { r: 4.78, z: 0.88, hard: true },
    { r: 4.46, z: 0.58, hard: true },
    { r: 4.46, z: 0.3 },
  ];
  const lensTop = 1.15; // on the plateau
  const lensYs = [PLATEAU.y + 15.5, PLATEAU.y, PLATEAU.y - 15.5];
  const ringGeos: BufferGeometry[] = [];
  const glassGeos: BufferGeometry[] = [];
  for (const y of lensYs) {
    ringGeos.push(revolve(ringProfile, 64).translate(toBack(PLATEAU.x), y, lensTop));
    glassGeos.push(dome(4.46, 0.16, 10, 64).translate(toBack(PLATEAU.x), y, lensTop + 0.3));
  }
  // The flash and the sensor sit on the glass beside the plateau.
  const FLASH = { x: 36.5, y: 62 };
  const SENSOR = { x: 36.5, y: 54.5 };
  ringGeos.push(
    revolve(
      [
        { r: 3.0, z: 0, hard: true },
        { r: 3.0, z: 0.28, hard: true },
        { r: 2.7, z: 0.42, hard: true },
        { r: 2.25, z: 0.42, hard: true },
        { r: 2.25, z: 0.2 },
      ],
      48,
    ).translate(toBack(FLASH.x), FLASH.y, 0),
  );
  const ringMesh = new Mesh(keep(mergeGeometries(ringGeos)), rings);
  ringGeos.forEach((g) => g.dispose());
  const lenses = new Mesh(keep(mergeGeometries(glassGeos)), keep(lensMaterial()));
  glassGeos.forEach((g) => g.dispose());
  const flash = new Mesh(keep(dome(2.25, 0.08, 6, 48).translate(toBack(FLASH.x), FLASH.y, 0.2)), keep(flashMaterial()));
  const sensor = new Mesh(keep(dome(1.05, 0.05, 4, 32).translate(toBack(SENSOR.x), SENSOR.y, 0.04)), keep(sensorMaterial()));
  back.add(ringMesh, lenses, flash, sensor);

  // ---- Buttons on the folding half's outer edge ----
  const buttonGeos: BufferGeometry[] = [];
  const powerGeos: BufferGeometry[] = [];
  for (const b of buttons) {
    const embed = 0.9;
    const wx = b.protrude + embed;
    const len = b.y1 - b.y0;
    const g = new RoundedBoxGeometry(wx, len, BUTTON_DEPTH, 3, 0.42);
    g.translate(-W - b.protrude + wx / 2, (b.y0 + b.y1) / 2, -T + BUTTON_Z);
    (b.power ? powerGeos : buttonGeos).push(g);
  }
  const buttonMesh = new Mesh(keep(mergeGeometries(buttonGeos)), keep(buttonMaterial()));
  const powerMesh = new Mesh(keep(mergeGeometries(powerGeos)), keep(powerMaterial()));
  buttonGeos.concat(powerGeos).forEach((g) => g.dispose());
  foldHalf.add(buttonMesh, powerMesh);

  // ---- Hinge cover: seven segments with dark gaps, over a dark core ----
  const segments = 7;
  const coverLen = H - 3;
  const gap = 0.5;
  const segLen = (coverLen - gap * (segments - 1)) / segments;
  const segGeos: BufferGeometry[] = [];
  for (let i = 0; i < segments; i++) {
    const y = -coverLen / 2 + segLen / 2 + i * (segLen + gap);
    // Theta pi to 2 pi: the half facing -x.
    segGeos.push(new CylinderGeometry(COVER_R, COVER_R, segLen, 48, 1, false, Math.PI, Math.PI).translate(0, y, 0));
  }
  const hingeMat = keep(hingeMaterial());
  const coreMat = keep(coreMaterial());
  // The clipping planes face into the halves (each screen plane, its normal pointing behind the
  // screen), and only what is in front of both is cut (clipIntersection): the open gap between
  // the screens, nothing at the back. Set in body space by setHinge, in world space by clip().
  const clipLocal = [new Plane(new Vector3(0, 0, -1), 0), new Plane()];
  const clipPlanes = [new Plane(), new Plane()];
  for (const m of [hingeMat, coreMat]) {
    m.clippingPlanes = clipPlanes;
    m.clipIntersection = true;
  }
  const hinge = new Group();
  hinge.add(new Mesh(keep(mergeGeometries(segGeos)), hingeMat));
  segGeos.forEach((g) => g.dispose());
  hinge.add(new Mesh(keep(new CylinderGeometry(COVER_R - 0.35, COVER_R - 0.35, coverLen - 0.2, 32, 1, false, Math.PI, Math.PI)), coreMat));

  fixedHalf.add(back);
  const body = new Group();
  body.add(fixedHalf, foldPivot, hinge);

  // Bounding points (local to each part) for the shadow: the corners of each half's box.
  const corners = (x0: number, x1: number) => {
    const out: Vector3[] = [];
    for (const x of [x0, x1]) for (const y of [Y0, Y1]) for (const z of [-T, 0]) out.push(new Vector3(x, y, z));
    return out;
  };
  const fixedCorners = corners(0, W);
  const foldCorners = corners(-W, 0);
  const bounds = [...fixedCorners.map((v) => v.clone()), ...foldCorners.map((v) => v.clone())];

  const setHinge = (deg: number) => {
    const theta = (deg * Math.PI) / 180;
    foldPivot.rotation.y = Math.PI - theta;
    const half = Math.min(Math.PI / 2, theta / 2);
    hinge.rotation.y = -theta / 2;
    hinge.position.x = 4.95 * Math.cos(half);
    // Past flat (the overshoot) the screens make a shallow roof; the cover drops back so its flat
    // side spans the roof under both screens instead of poking through them.
    hinge.position.z = theta > Math.PI ? -COVER_R * Math.sin((theta - Math.PI) / 2) : 0;
    // The folding screen's plane, facing behind it: its screen faces (sin, 0, -cos) of the angle.
    clipLocal[1].normal.set(-Math.sin(theta), 0, Math.cos(theta));
    coverMat.emissiveIntensity = COVER_GLOW * (1 - smooth(20, 60, deg));
    // Keep the bound points up to date (fixed half's never move).
    foldPivot.updateMatrix();
    for (let i = 0; i < foldCorners.length; i++) bounds[fixedCorners.length + i].copy(foldCorners[i]).applyMatrix4(foldPivot.matrix);
    // Shut, the screens face each other: skip drawing the inner screen faces.
    innerMat.visible = deg > 0.5;
  };

  // The middle of the two halves' box (across and in depth) at the current hinge angle, so the
  // phone turns about its middle and stays centred while the folding half swings out.
  const center = (out: Vector3) => {
    let x0 = Infinity;
    let x1 = -Infinity;
    let z0 = Infinity;
    let z1 = -Infinity;
    for (const p of bounds) {
      x0 = Math.min(x0, p.x);
      x1 = Math.max(x1, p.x);
      z0 = Math.min(z0, p.z);
      z1 = Math.max(z1, p.z);
    }
    return out.set((x0 + x1) / 2, 0, (z0 + z1) / 2);
  };

  const clip = (bodyWorld: Matrix4) => {
    for (let i = 0; i < 2; i++) clipPlanes[i].copy(clipLocal[i]).applyMatrix4(bodyWorld);
  };

  setHinge(180);

  return {
    body,
    setHinge,
    center,
    clip,
    bounds,
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
