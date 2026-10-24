// city.ts: the layout of the procedural Hong Kong Island skyline, as plain data.
//
// World units are meters. The camera sits on the Kowloon side at positive z and looks south (-z).
// The shoreline is the line z = 0 and the water is y = 0. The city runs along x, in three depth
// rows behind the shore. Towers are generic: stacked boxes with setbacks, slim crowns or spires,
// a few low wide blocks, never copies of real buildings.
//
// Every tower is made of segments (boxes). The skyline mesh draws one instance per segment, and the
// window rule (windows.ts) lights each window cell of each segment's faces.

import { between, clamp, fbm1, mulberry32, pick, type Rng } from './random';
import { hashU32 } from './windows';

export const SEG_WINDOWS = 0; // a block with window cells
export const SEG_CROWN = 1; // a lit crown band
export const SEG_MECH = 2; // a dark plant floor, no windows
export const SEG_SOLID = 3; // a spire or mast, no windows

export const GROUP_NONE = 0;
export const GROUP_LOW_BLOCK = 4; // the compact low-rise block at the far left (Civic AI Club)
// groups 1, 2, 3 are the three small low clusters (AI Simply)

export interface Segment {
  /** Center x, base y, center z, and size. */
  x: number;
  y0: number;
  z: number;
  w: number;
  h: number;
  d: number;
  kind: number;
  /** Index of the segment in its tower (0 is the base). */
  seg: number;
  /** Floor index (tower-wide) of this segment's first floor. */
  floorOffset: number;
  /** Floors in this segment, and how many of them carry windows (the top one may be plant). */
  floors: number;
  winFloors: number;
  /** Window columns on the front and back faces, and on the side faces. */
  colsF: number;
  colsS: number;
  /** Lit byte (0 to 255): the segment's base chance that a window is lit, out of 256. */
  L: number;
}

export interface Tower {
  id: number;
  row: number;
  x: number;
  z: number;
  w: number;
  d: number;
  /** Height of the top of the building mass (roof or crown), and of the tip (spire included). */
  roof: number;
  tip: number;
  /** 24-bit seed for the window hashes. */
  seed: number;
  glazing: number;
  facade: number;
  floorH: number;
  colW: number;
  group: number;
  form: number;
  segs: Segment[];
}

export interface CityLayout {
  towers: Tower[];
  xMin: number;
  xMax: number;
  width: number;
  /** z of the frontmost face, roughly where window samples sit. */
  zFront: number;
  zBack: number;
  /** x of the tallest cluster's center. */
  centralX: number;
  central: { x: number; y: number; z: number };
  lowBlock: { x: number; y: number; z: number; x0: number; x1: number };
  clusters: { x: number; y: number; z: number; x0: number; x1: number }[];
  /** Highest building mass (spires excluded). */
  skylineTop: number;
  /** Highest tip (spires included). */
  maxTip: number;
  seed: number;
}

// Tower forms
const F_SLAB = 0;
const F_SETBACK = 1;
const F_CROWN = 2;
const F_SPIRE = 3;
const F_SLIM = 4;
const F_WIDE = 5;
const F_PODIUM = 6;
const F_LOW = 7; // members of the low groups

interface RowDef {
  z: number;
  zJitter: number;
  share: number;
  heightScale: number;
}

const ROWS: RowDef[] = [
  { z: -48, zJitter: 16, share: 0.39, heightScale: 0.86 },
  { z: -205, zJitter: 28, share: 0.34, heightScale: 1.0 },
  { z: -375, zJitter: 40, share: 0.27, heightScale: 1.06 },
];

/**
 * Build the city. towers is the target count (about 260 desktop, 110 phone); width scales with it
 * so density stays the same.
 */
export function generateCity(towerCount: number, seed: number): CityLayout {
  const r = mulberry32(seed);
  const width = Math.round(4400 * Math.min(1, Math.max(0.42, towerCount / 260)));
  const xMin = -width / 2;
  const xMax = width / 2;
  const at = (f: number) => xMin + f * width;

  const centralX = at(0.42);
  const secondX = at(0.63);
  const lowBlockX = at(0.055);
  const clusterXs = [at(0.17), at(0.245), at(0.32)];

  const towers: Tower[] = [];
  let id = 0;

  // ---- The low groups first, in the front row ----
  const reserved: [number, number][] = [];
  const lowBlockW = clamp(width * 0.04, 110, 175);
  reserved.push([lowBlockX - lowBlockW / 2 - 6, lowBlockX + lowBlockW / 2 + 6]);
  const lowBlockTowers = placeGroup(r, lowBlockX, lowBlockW, GROUP_LOW_BLOCK, 6, [16, 34]);
  const clusterW = clamp(width * 0.022, 60, 96);
  const clusterGroups: Tower[][] = [];
  clusterXs.forEach((cx, i) => {
    reserved.push([cx - clusterW / 2 - 6, cx + clusterW / 2 + 6]);
    clusterGroups.push(placeGroup(r, cx, clusterW, i + 1, i === 1 ? 4 : 3, [22, 52]));
  });

  function placeGroup(r: Rng, cx: number, w: number, group: number, n: number, hRange: [number, number]): Tower[] {
    const out: Tower[] = [];
    const slot = w / n;
    let prevH = 0;
    for (let i = 0; i < n; i++) {
      const bw = slot * between(r, 0.78, 0.96);
      const x = cx - w / 2 + slot * (i + 0.5) + (r() - 0.5) * slot * 0.08;
      let h = between(r, hRange[0], hRange[1]);
      if (Math.abs(h - prevH) < h * 0.14) h = h * (r() < 0.5 ? 0.8 : 1.22);
      prevH = h;
      const t = makeTower(r, {
        id: id++,
        row: 0,
        x,
        z: ROWS[0].z + 14 + (r() - 0.5) * 8,
        w: bw,
        d: between(r, 22, 34),
        h,
        form: F_LOW,
        group,
      });
      out.push(t);
      towers.push(t);
    }
    return out;
  }

  // ---- The rows ----
  const groupCount = towers.length;
  const regular = Math.max(30, towerCount - groupCount);
  ROWS.forEach((row, ri) => {
    const n = Math.round(regular * row.share);
    const spacing = width / n;
    let prev: { h: number; form: number; w: number } | null = null;
    for (let i = 0; i < n; i++) {
      const x = xMin + (i + 0.5) * spacing + (r() - 0.5) * spacing * 0.3;
      if (ri === 0 && reserved.some(([a, b]) => x > a - spacing * 0.4 && x < b + spacing * 0.4)) continue;
      const f = (x - xMin) / width;

      // Heights: most 60 to 180 m, a long tail of 250 to 480 m clustered left of center (Central),
      // a smaller tall group to the right (Admiralty and Wan Chai), and lower towards both ends.
      const cw = Math.exp(-(((x - centralX) / (width * 0.085)) ** 2));
      const sw = Math.exp(-(((x - secondX) / (width * 0.06)) ** 2));
      const edge = smooth01(f / 0.07) * smooth01((1 - f) / 0.06);
      // Behind the low groups the city steps down too, so they read.
      const nearLow = Math.exp(-(((x - lowBlockX) / 160) ** 2)) * (ri === 0 ? 1 : 0.6);
      let h = 62 + 118 * Math.pow(r(), 1.4);
      const tallChance = 0.018 + 0.62 * cw + 0.3 * sw;
      if (r() < tallChance) h = 245 + (120 + 120 * cw + 25 * sw) * Math.pow(r(), 0.9);
      h *= row.heightScale * (0.7 + 0.3 * edge) * (1 - 0.45 * nearLow);
      h = clamp(h, 34, 480);

      let form: number;
      if (h > 240) form = [F_SETBACK, F_SPIRE, F_CROWN][pick(r, [0.4, 0.3, 0.3])];
      else if (h > 120) form = [F_SLAB, F_SETBACK, F_CROWN, F_SLIM, F_SPIRE, F_PODIUM][pick(r, [0.28, 0.2, 0.18, 0.16, 0.06, ri === 0 ? 0.14 : 0.04])];
      else form = [F_SLAB, F_SLIM, F_WIDE, F_PODIUM, F_CROWN][pick(r, [0.32, 0.22, 0.14, ri === 0 ? 0.18 : 0.06, 0.14])];

      let w = clamp(spacing * (ri === 0 ? between(r, 0.6, 0.94) : between(r, 0.72, 1.08)), 15, 66);
      let d = between(r, 18, 40);
      if (form === F_SLIM) {
        w = between(r, 14, 22);
        d = between(r, 14, 22);
        h *= 1.08;
      } else if (form === F_WIDE) {
        w = clamp(spacing * between(r, 1.15, 1.6), 40, 92);
        d = between(r, 30, 52);
        h = between(r, 38, 82) * (0.7 + 0.3 * edge);
      }

      // No two neighbours alike: a different form, and a clearly different height or width.
      if (prev) {
        let tries = 0;
        while (form === prev.form && tries++ < 6) {
          form = [F_SLAB, F_SETBACK, F_CROWN, F_SLIM, F_PODIUM][Math.floor(r() * 5)];
        }
        if (Math.abs(h - prev.h) < Math.max(h, prev.h) * 0.13) h *= r() < 0.5 ? 0.8 : 1.24;
        if (Math.abs(w - prev.w) < 4) w += r() < 0.5 ? -6 : 6;
        h = clamp(h, 30, 480);
      }
      prev = { h, form, w };

      towers.push(
        makeTower(r, {
          id: id++,
          row: ri,
          x,
          z: row.z + (r() - 0.5) * 2 * row.zJitter,
          w,
          d,
          h,
          form,
          group: GROUP_NONE,
        }),
      );
    }
  });

  // ---- Fill: low and mid-rise blocks between the rows, so no gap shows sky or Peak at street
  // level and the whole width reads dense ----
  const fillRows = [
    { z: -128, zJitter: 18, n: Math.round(towerCount * 0.24) },
    { z: -292, zJitter: 24, n: Math.round(towerCount * 0.2) },
  ];
  for (const fr of fillRows) {
    const spacing = width / fr.n;
    let prevH = 0;
    let prevForm = -1;
    let prevW = 0;
    for (let i = 0; i < fr.n; i++) {
      const x = xMin + (i + 0.5) * spacing + (r() - 0.5) * spacing * 0.4;
      const f = (x - xMin) / width;
      const edge = smooth01(f / 0.05) * smooth01((1 - f) / 0.05);
      const nearLow = Math.exp(-(((x - lowBlockX) / 180) ** 2));
      let h = (28 + 70 * Math.pow(r(), 1.2)) * (0.75 + 0.25 * edge) * (1 - 0.5 * nearLow);
      if (Math.abs(h - prevH) < h * 0.15) h *= r() < 0.5 ? 0.78 : 1.25;
      prevH = h;
      let form = [F_SLAB, F_WIDE, F_PODIUM][pick(r, [0.55, 0.28, 0.17])];
      if (form === prevForm) form = form === F_SLAB ? F_PODIUM : F_SLAB;
      prevForm = form;
      let fw = clamp(spacing * between(r, 0.75, 1.1), 18, 70);
      if (Math.abs(fw - prevW) < 4) fw += fw > 40 ? -7 : 7;
      prevW = fw;
      towers.push(
        makeTower(r, {
          id: id++,
          row: fr === fillRows[0] ? 1 : 2,
          x,
          z: fr.z + (r() - 0.5) * 2 * fr.zJitter,
          w: fw,
          d: between(r, 20, 40),
          h: Math.max(22, h),
          form: form === F_WIDE ? F_LOW : form,
        }),
      );
    }
  }

  // ---- Hero towers: a few deliberate peaks so the Central cluster has a clear crown ----
  const promote = (row: number, nearX: number, h: number, form: number) => {
    let best: Tower | null = null;
    for (const t of towers) {
      if (t.row !== row || t.group) continue;
      if (!best || Math.abs(t.x - nearX) < Math.abs(best.x - nearX)) best = t;
    }
    if (!best) return;
    const i = towers.indexOf(best);
    towers[i] = makeTower(r, { id: best.id, row, x: best.x, z: best.z, w: clamp(best.w, 42, 60), d: clamp(best.d, 34, 46), h, form });
  };
  promote(1, centralX - width * 0.012, 468, F_SPIRE);
  promote(0, centralX + width * 0.03, 404, F_SETBACK);
  promote(2, centralX - width * 0.05, 372, F_CROWN);
  promote(1, secondX, 352, F_SETBACK);
  promote(2, centralX + width * 0.075, 318, F_SPIRE);

  // ---- Landmarks ----
  let skylineTop = 0;
  let maxTip = 0;
  let zFront = -Infinity;
  let zBack = Infinity;
  for (const t of towers) {
    skylineTop = Math.max(skylineTop, t.roof);
    maxTip = Math.max(maxTip, t.tip);
    zFront = Math.max(zFront, t.z + t.d / 2);
    zBack = Math.min(zBack, t.z - t.d / 2);
  }
  const tall = towers
    .filter((t) => Math.abs(t.x - centralX) < width * 0.12)
    .sort((a, b) => b.roof - a.roof)
    .slice(0, 8);
  const central = {
    x: tall.reduce((s, t) => s + t.x, 0) / tall.length,
    y: tall[0].roof,
    z: tall.reduce((s, t) => s + t.z, 0) / tall.length,
  };
  const groupBox = (ts: Tower[]) => {
    const x0 = Math.min(...ts.map((t) => t.x - t.w / 2));
    const x1 = Math.max(...ts.map((t) => t.x + t.w / 2));
    return {
      x: (x0 + x1) / 2,
      y: Math.max(...ts.map((t) => t.roof)),
      z: ts.reduce((s, t) => s + t.z, 0) / ts.length,
      x0,
      x1,
    };
  };

  // Rows sorted by x keep neighbours together for anything that walks the city.
  towers.sort((a, b) => a.row - b.row || a.x - b.x);

  return {
    towers,
    xMin,
    xMax,
    width,
    zFront,
    zBack,
    centralX,
    central,
    lowBlock: groupBox(lowBlockTowers),
    clusters: clusterGroups.map(groupBox),
    skylineTop,
    maxTip,
    seed,
  };
}

function smooth01(x: number) {
  const t = clamp(x, 0, 1);
  return t * t * (3 - 2 * t);
}

interface TowerSpec {
  id: number;
  row: number;
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  form: number;
  group?: number;
}

function makeTower(r: Rng, s: TowerSpec): Tower {
  const seed = hashU32(Math.imul(s.id + 1, 0x9e3779b1) ^ 0x5bd1e995) >>> 8;
  const floorH = between(r, 3.2, 3.9);
  const colW = between(r, 2.7, 3.5);
  const group = s.group ?? GROUP_NONE;
  // Glazing: 0 punched, 1 ribbon, 2 curtain wall, 3 narrow, 4 square.
  const glazing = s.form === F_SLIM ? [0, 3, 4][Math.floor(r() * 3)] : s.h > 220 ? [1, 2, 2, 4][Math.floor(r() * 4)] : Math.floor(r() * 5);
  // Offices (ribbon, curtain) run a little brighter than homes; every tower differs.
  const office = glazing === 1 || glazing === 2;
  let L = Math.round(between(r, office ? 88 : 74, office ? 160 : 148));
  if (r() < 0.12) L = Math.round(between(r, 30, 60)); // a few mostly dark towers
  if (group) L = Math.round(between(r, 70, 120));

  const t: Tower = {
    id: s.id,
    row: s.row,
    x: s.x,
    z: s.z,
    w: s.w,
    d: s.d,
    roof: 0,
    tip: 0,
    seed,
    glazing,
    facade: r(),
    floorH,
    colW,
    group,
    form: s.form,
    segs: [],
  };

  let floorCursor = 0;
  let y = 0;
  const addBlock = (w: number, d: number, floors: number, offX: number, kind = SEG_WINDOWS, segL = L, topPlant = false) => {
    floors = Math.max(1, Math.round(floors));
    const h = floors * floorH;
    const seg: Segment = {
      x: s.x + offX,
      y0: y,
      z: s.z,
      w,
      d,
      h,
      kind,
      seg: t.segs.length,
      floorOffset: floorCursor,
      floors,
      winFloors: kind === SEG_WINDOWS ? Math.max(0, floors - (topPlant ? 1 : 0)) : kind === SEG_CROWN ? floors : 0,
      colsF: Math.max(1, Math.round(w / colW)),
      colsS: Math.max(1, Math.round(d / colW)),
      L: clamp(segL, 0, 255),
    };
    t.segs.push(seg);
    floorCursor += floors;
    y += h;
    return seg;
  };
  const addSolid = (w: number, d: number, h: number, kind: number) => {
    const seg: Segment = { x: s.x, y0: y, z: s.z, w, d, h, kind, seg: t.segs.length, floorOffset: floorCursor, floors: 0, winFloors: 0, colsF: 1, colsS: 1, L: 0 };
    t.segs.push(seg);
    y += h;
    return seg;
  };

  const totalFloors = Math.max(4, Math.round(s.h / floorH));
  const plant = r() < 0.6;
  switch (s.form) {
    case F_SETBACK: {
      const steps = s.h > 260 ? 3 : 2;
      const shares = steps === 3 ? [0.5, 0.3, 0.2] : [0.64, 0.36];
      const side = r() < 0.35 ? (r() < 0.5 ? -1 : 1) : 0; // some step back on one side only
      let w = s.w;
      let d = s.d;
      let off = 0;
      for (let i = 0; i < steps; i++) {
        addBlock(w, d, totalFloors * shares[i], off, SEG_WINDOWS, L, i === steps - 1 && plant);
        const nw = w * between(r, 0.7, 0.84);
        off += side * (w - nw) * 0.5;
        w = nw;
        d *= between(r, 0.76, 0.9);
      }
      if (s.h > 300 && r() < 0.5) addSolid(between(r, 2.5, 4), between(r, 2.5, 4), s.h * between(r, 0.06, 0.12), SEG_SOLID);
      break;
    }
    case F_CROWN: {
      addBlock(s.w, s.d, totalFloors * 0.93, 0, SEG_WINDOWS, L, false);
      const lit = r() < 0.6;
      addBlock(s.w * between(r, 0.6, 0.85), s.d * between(r, 0.6, 0.85), Math.max(2, totalFloors * 0.07), 0, lit ? SEG_CROWN : SEG_MECH);
      if (r() < 0.3) addSolid(between(r, 2, 3), between(r, 2, 3), between(r, 10, 26), SEG_SOLID);
      break;
    }
    case F_SPIRE: {
      if (s.h > 200) {
        addBlock(s.w, s.d, totalFloors * 0.72, 0, SEG_WINDOWS, L, false);
        addBlock(s.w * 0.78, s.d * 0.8, totalFloors * 0.28, 0, SEG_WINDOWS, L, plant);
      } else {
        addBlock(s.w, s.d, totalFloors, 0, SEG_WINDOWS, L, plant);
      }
      addSolid(between(r, 2.5, 4.5), between(r, 2.5, 4.5), s.h * between(r, 0.13, 0.24), SEG_SOLID);
      break;
    }
    case F_PODIUM: {
      const pod = Math.round(between(r, 3, 6));
      addBlock(s.w * between(r, 1.25, 1.5), s.d * between(r, 1.15, 1.35), pod, 0, SEG_WINDOWS, clamp(L + 70, 0, 230), false);
      addBlock(s.w, s.d, totalFloors - pod, 0, SEG_WINDOWS, L, plant);
      break;
    }
    case F_LOW: {
      addBlock(s.w, s.d, totalFloors, 0, SEG_WINDOWS, L, false);
      break;
    }
    default: {
      addBlock(s.w, s.d, totalFloors, 0, SEG_WINDOWS, L, plant);
      if (s.form === F_SLAB && r() < 0.25) addBlock(s.w * 0.5, s.d * 0.5, 1, (r() - 0.5) * s.w * 0.3, SEG_MECH);
    }
  }

  t.tip = y;
  t.roof = 0;
  for (const g of t.segs) if (g.kind !== SEG_SOLID) t.roof = Math.max(t.roof, g.y0 + g.h);
  return t;
}

/** The Peak's ridge stands this far behind the shoreline, and runs this far each side of Central. */
export const PEAK_Z = -2700;
export const PEAK_HALF = 13000;

/**
 * z of the ridge at x. It bends gently toward the camera, and beyond about 7 km either side of
 * Central it wraps round toward the camera's side of the harbour (hills ringing the water), so
 * no framing ever sees past its end.
 */
export function ridgeZ(x: number, city: CityLayout): number {
  const d = Math.abs(x - city.centralX);
  const wrap = Math.max(0, d - 7000) / 6000;
  return PEAK_Z + Math.pow(d / 9000, 2) * 1800 + 4200 * wrap * wrap;
}

/** The Peak's ridge height at x (meters above the water), shared by the Peak mesh and its lights. */
export function ridgeHeight(x: number, city: CityLayout): number {
  // Hills keep their real size on every tier (a narrower phone city just sees less of them).
  const s = 1;
  const c = city.centralX;
  const seed = city.seed;
  // Summits: the Peak behind Central, lower hills east and west, joined by saddles.
  const bump = (cx: number, h: number, wid: number) => h * Math.exp(-Math.pow(Math.abs(x - cx) / wid, 1.6));
  let y = 140 + 120 * fbm1(x / 1100 + 3.1, seed ^ 0x77, 3);
  y = Math.max(y, bump(c - 180 * s, 540, 820 * s));
  y = Math.max(y, bump(c + 1150 * s, 420, 700 * s));
  y = Math.max(y, bump(c + 2100 * s, 385, 760 * s));
  y = Math.max(y, bump(c - 1400 * s, 330, 620 * s));
  // Ridged noise for spurs and gullies, then fine roughness for trees and rock.
  const ridged = 1 - Math.abs(fbm1(x / 420, seed ^ 0x99, 4) * 2 - 1);
  y += 70 * (ridged - 0.55);
  y += 26 * (fbm1(x / 110, seed ^ 0x3c, 3) - 0.5);
  y += 7 * (fbm1(x / 28, seed ^ 0x5e, 2) - 0.5);
  // the far ends (behind every framing) slope down to the water instead of stopping
  const d = Math.abs(x - c);
  const t = Math.min(1, Math.max(0, (PEAK_HALF - d) / 2500));
  return y * t * t * (3 - 2 * t);
}
