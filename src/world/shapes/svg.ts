// svg.ts: turns SVG path data into evenly spaced points (NIGHT-SIGNAL.md 5, "How F and G are
// built"). Owned by the Signal agent.
//
// Paths are authored in code as SVG path strings (M, L, H, V, C, Q, Z, absolute or relative; y
// down, as in SVG). Lines are sampled at one fixed spacing: every command (a straight edge, a
// curve) is sampled on its own with its end points included, so corners always carry a point and
// the spacing along each edge is even. Filled blocks get a regular grid, centred on the block so
// it sits symmetrically. Deterministic: no random scatter anywhere.

export type Pt = [number, number];

/** One command's stretch of a path, as a fine polyline, and whether it closes a subpath. */
interface Piece {
  pts: Pt[];
}

/** A subpath: its pieces in order, and whether it is closed. */
interface Subpath {
  pieces: Piece[];
  closed: boolean;
}

const CURVE_STEPS = 48;

/** Parses path data into subpaths of pieces (curves flattened finely; sampling comes later). */
export function parsePath(d: string): Subpath[] {
  const tokens = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e-?\d+)?/g) ?? [];
  const subs: Subpath[] = [];
  let cur: Subpath | null = null;
  let x = 0;
  let y = 0;
  let sx = 0;
  let sy = 0;
  let i = 0;
  let cmd = '';
  const num = () => Number(tokens[i++]);
  const isNum = (t: string | undefined) => t !== undefined && !/^[a-zA-Z]$/.test(t);
  const line = (nx: number, ny: number) => {
    cur!.pieces.push({ pts: [[x, y], [nx, ny]] });
    x = nx;
    y = ny;
  };
  while (i < tokens.length) {
    if (!isNum(tokens[i])) cmd = tokens[i++];
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    const ox = rel ? x : 0;
    const oy = rel ? y : 0;
    if (c === 'M') {
      x = ox + num();
      y = oy + num();
      sx = x;
      sy = y;
      cur = { pieces: [], closed: false };
      subs.push(cur);
      cmd = rel ? 'l' : 'L'; // further pairs are line-tos
    } else if (c === 'L') {
      line(ox + num(), oy + num());
    } else if (c === 'H') {
      line(ox + num(), y);
    } else if (c === 'V') {
      line(x, oy + num());
    } else if (c === 'C' || c === 'Q') {
      const p0: Pt = [x, y];
      const q = c === 'C' ? [ox + num(), oy + num(), ox + num(), oy + num(), ox + num(), oy + num()] : [ox + num(), oy + num(), ox + num(), oy + num()];
      const pts: Pt[] = [p0];
      for (let k = 1; k <= CURVE_STEPS; k++) {
        const t = k / CURVE_STEPS;
        const u = 1 - t;
        if (c === 'C') {
          pts.push([u * u * u * p0[0] + 3 * u * u * t * q[0] + 3 * u * t * t * q[2] + t * t * t * q[4], u * u * u * p0[1] + 3 * u * u * t * q[1] + 3 * u * t * t * q[3] + t * t * t * q[5]]);
        } else {
          pts.push([u * u * p0[0] + 2 * u * t * q[0] + t * t * q[2], u * u * p0[1] + 2 * u * t * q[1] + t * t * q[3]]);
        }
      }
      cur!.pieces.push({ pts });
      x = pts[pts.length - 1][0];
      y = pts[pts.length - 1][1];
    } else if (c === 'Z') {
      if (Math.hypot(x - sx, y - sy) > 1e-9) line(sx, sy);
      cur!.closed = true;
      x = sx;
      y = sy;
    } else {
      throw new Error(`svg: unsupported command ${cmd}`);
    }
  }
  return subs;
}

function polyLength(pts: Pt[]) {
  let L = 0;
  for (let k = 1; k < pts.length; k++) L += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
  return L;
}

/** The point at arc length s along a polyline. */
function along(pts: Pt[], s: number): Pt {
  let acc = 0;
  for (let k = 1; k < pts.length; k++) {
    const l = Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
    if (acc + l >= s || k === pts.length - 1) {
      const f = l > 0 ? Math.min(1, Math.max(0, (s - acc) / l)) : 0;
      return [pts[k - 1][0] + (pts[k][0] - pts[k - 1][0]) * f, pts[k - 1][1] + (pts[k][1] - pts[k - 1][1]) * f];
    }
    acc += l;
  }
  return pts[pts.length - 1];
}

/**
 * Points along a path at spacing `step`: each piece gets round(length / step) intervals (at least
 * one), its start point included and its end point left to the next piece (or included, for the
 * last piece of an open subpath). Returns the points and each one's position along the whole
 * path, 0 to 1 (for drawing a line on progressively).
 */
export function sampleLine(d: string, step: number): { pts: Pt[]; at: number[] } {
  const pts: Pt[] = [];
  const at: number[] = [];
  const subs = parsePath(d);
  let total = 0;
  for (const s of subs) for (const p of s.pieces) total += polyLength(p.pts);
  let done = 0;
  for (const s of subs) {
    s.pieces.forEach((p, k) => {
      const L = polyLength(p.pts);
      const n = Math.max(1, Math.round(L / step));
      const last = !s.closed && k === s.pieces.length - 1;
      for (let j = 0; j < n + (last ? 1 : 0); j++) {
        pts.push(along(p.pts, (j / n) * L));
        at.push(total > 0 ? (done + (j / n) * L) / total : 0);
      }
      done += L;
    });
  }
  return { pts, at };
}

/** A regular grid at spacing `step` filling a closed path (even-odd rule), centred on its bounding box. */
export function sampleFill(d: string, step: number): Pt[] {
  const rings: Pt[][] = parsePath(d).map((s) => s.pieces.flatMap((p) => p.pts));
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const ring of rings) for (const [x, y] of ring) {
    x0 = Math.min(x0, x);
    y0 = Math.min(y0, y);
    x1 = Math.max(x1, x);
    y1 = Math.max(y1, y);
  }
  const nx = Math.floor((x1 - x0) / step);
  const ny = Math.floor((y1 - y0) / step);
  const cx = (x0 + x1) / 2 - (nx * step) / 2;
  const cy = (y0 + y1) / 2 - (ny * step) / 2;
  const out: Pt[] = [];
  const cross: number[] = [];
  for (let j = 0; j <= ny; j++) {
    // Where this row crosses the outline, then the grid columns between each pair of crossings.
    const y = cy + j * step;
    cross.length = 0;
    for (const ring of rings) {
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) {
        const [xa, ya] = ring[a];
        const [xb, yb] = ring[b];
        if (ya > y !== yb > y) cross.push(((xb - xa) * (y - ya)) / (yb - ya) + xa);
      }
    }
    cross.sort((p, q) => p - q);
    for (let c = 0; c + 1 < cross.length; c += 2) {
      const k0 = Math.ceil((cross[c] - cx) / step);
      const k1 = Math.floor((cross[c + 1] - cx) / step);
      for (let k = Math.max(0, k0); k <= Math.min(nx, k1); k++) out.push([cx + k * step, y]);
    }
  }
  return out;
}

/** Path data for a rectangle with rounded corners (quarter circles as cubics). */
export function roundRect(x: number, y: number, w: number, h: number, r: number): string {
  const k = 0.5523 * r;
  return [
    `M ${x + r} ${y}`,
    `H ${x + w - r}`,
    `C ${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r}`,
    `V ${y + h - r}`,
    `C ${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h}`,
    `H ${x + r}`,
    `C ${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r}`,
    `V ${y + r}`,
    `C ${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y}`,
    'Z',
  ].join(' ');
}

/** Path data for a plain rectangle. */
export function rect(x: number, y: number, w: number, h: number): string {
  return `M ${x} ${y} H ${x + w} V ${y + h} H ${x} Z`;
}

/** Path data for a circle (four cubics). */
export function circle(cx: number, cy: number, r: number): string {
  const k = 0.5523 * r;
  return `M ${cx + r} ${cy} C ${cx + r} ${cy + k} ${cx + k} ${cy + r} ${cx} ${cy + r} C ${cx - k} ${cy + r} ${cx - r} ${cy + k} ${cx - r} ${cy} C ${cx - r} ${cy - k} ${cx - k} ${cy - r} ${cx} ${cy - r} C ${cx + k} ${cy - r} ${cx + r} ${cy - k} ${cx + r} ${cy} Z`;
}
