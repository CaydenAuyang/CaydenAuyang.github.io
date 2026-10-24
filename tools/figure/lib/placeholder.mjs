// A procedural bust in meters: head with ears, hair volume with a center part, neck, shoulders.
// It uses the same model shape as the photo build, so the site works before real data exists.

import { clamp, pchip, smoothstep } from './math.mjs';
import { makeRows, partLine, rowAt } from './model.mjs';

const P = (pts) => pchip(pts);

export function placeholderModel() {
  const hw = P([
    [0.6, 0.0], [0.5985, 0.02], [0.595, 0.034], [0.588, 0.05], [0.578, 0.064], [0.565, 0.075],
    [0.548, 0.084], [0.528, 0.089], [0.508, 0.091], [0.488, 0.09], [0.468, 0.087], [0.448, 0.081],
    [0.428, 0.077], [0.41, 0.073], [0.395, 0.067], [0.383, 0.06], [0.372, 0.0565], [0.355, 0.056],
    [0.338, 0.0575], [0.325, 0.062], [0.316, 0.075], [0.309, 0.098], [0.302, 0.128], [0.294, 0.155],
    [0.285, 0.176], [0.274, 0.192], [0.26, 0.204], [0.24, 0.212], [0.21, 0.216], [0.15, 0.214], [0.0, 0.205],
  ]);
  const zf = P([
    [0.6, -0.006], [0.5985, 0.012], [0.595, 0.026], [0.588, 0.044], [0.575, 0.064], [0.558, 0.08],
    [0.538, 0.09], [0.515, 0.096], [0.495, 0.098], [0.475, 0.097], [0.455, 0.093], [0.435, 0.092],
    [0.415, 0.09], [0.4, 0.088], [0.388, 0.085], [0.378, 0.08], [0.37, 0.07], [0.362, 0.055],
    [0.352, 0.045], [0.335, 0.043], [0.32, 0.05], [0.305, 0.068], [0.29, 0.086], [0.27, 0.1],
    [0.24, 0.112], [0.18, 0.118], [0.0, 0.118],
  ]);
  const zb = P([
    [0.6, -0.006], [0.5985, -0.03], [0.595, -0.045], [0.588, -0.062], [0.575, -0.08], [0.558, -0.093],
    [0.538, -0.102], [0.515, -0.107], [0.495, -0.108], [0.47, -0.105], [0.445, -0.097], [0.42, -0.086],
    [0.4, -0.074], [0.385, -0.064], [0.37, -0.058], [0.35, -0.056], [0.33, -0.06], [0.315, -0.068],
    [0.3, -0.08], [0.285, -0.09], [0.26, -0.098], [0.22, -0.102], [0.0, -0.1],
  ]);
  const nf = P([[0.6, 2.4], [0.4, 2.6], [0.37, 2.2], [0.32, 2.1], [0.28, 2.6], [0.0, 2.8]]);
  const nb = P([[0.6, 2.2], [0.4, 2.2], [0.37, 2.1], [0.32, 2.1], [0.28, 2.5], [0.0, 2.6]]);
  const tf = P([[0.6, 0], [0.48, 0], [0.45, 0.1], [0.41, 0.2], [0.395, 0.25], [0.378, 0.45], [0.368, 0.5], [0.355, 0.15], [0.34, 0]]);
  const cf = P([[0.6, 0.45], [0.38, 0.45], [0.34, 0.5], [0.0, 0.5]]);
  const rows = makeRows(420, 0.6, 0.0, { hw, zf, zb, nf, nb, tf, cf });

  // Face relief added to the front surface (meters).
  const g2 = (x, y, cx, cy, sx, sy) => Math.exp(-((x - cx) ** 2) / (2 * sx * sx) - ((y - cy) ** 2) / (2 * sy * sy));
  const noseH = P([[0.475, 0], [0.468, 0.006], [0.455, 0.011], [0.44, 0.018], [0.432, 0.022], [0.426, 0.016], [0.42, 0.004], [0.416, 0]]);
  const noseW = P([[0.475, 0.006], [0.44, 0.008], [0.428, 0.011], [0.416, 0.012]]);
  const relief = (x, y) => {
    if (y < 0.365 || y > 0.5) return 0;
    let d = noseH(y) * Math.exp(-(x * x) / (2 * noseW(y) ** 2));
    d += 0.006 * (g2(x, y, 0.016, 0.425, 0.006, 0.005) + g2(x, y, -0.016, 0.425, 0.006, 0.005));
    d += 0.004 * (g2(x, y, 0.03, 0.482, 0.02, 0.005) + g2(x, y, -0.03, 0.482, 0.02, 0.005));
    d -= 0.009 * (g2(x, y, 0.032, 0.462, 0.013, 0.008) + g2(x, y, -0.032, 0.462, 0.013, 0.008));
    d += 0.004 * (g2(x, y, 0.05, 0.445, 0.014, 0.014) + g2(x, y, -0.05, 0.445, 0.014, 0.014));
    d += 0.005 * g2(x, y, 0, 0.41, 0.017, 0.004) + 0.005 * g2(x, y, 0, 0.399, 0.015, 0.004);
    d -= 0.002 * g2(x, y, 0, 0.4045, 0.02, 0.0015);
    d += 0.006 * g2(x, y, 0, 0.381, 0.013, 0.007);
    return d;
  };
  const front = (x, y, z) => ({ z: z + relief(x, y), w: 1 });

  const czAt = (y) => {
    const r = rowAt(rows, y);
    return r.zb + (r.zf - r.zb) * r.cf;
  };
  const ears = [-1, 1].map((side) => ({
    side,
    y0: 0.416,
    y1: 0.472,
    base: (y) => hw(y) * 0.95,
    out: (y) => {
      const t = clamp((y - 0.416) / 0.056, 0, 1);
      return hw(y) + 0.018 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.8)), 0.7);
    },
    z: (y) => czAt(y) - 0.012,
    angle: 0.38,
    thick: 0.004,
  }));

  // Hairline height around the head (angle 0 = front, pi = back).
  const hairline = P([
    [0, 0.528], [0.3, 0.526], [0.55, 0.512], [0.8, 0.49], [1.05, 0.462], [1.2, 0.448], [1.35, 0.46],
    [1.55, 0.474], [1.8, 0.455], [2.1, 0.41], [2.5, 0.378], [3.15, 0.372],
  ]);
  const classify = (p, n, vtag) => {
    if (vtag === 1) return { hair: 0, skin: 1 };
    const [x, y, z] = p;
    if (y < 0.36) {
      const neck = y > 0.312 && Math.abs(x) < 0.07 ? 1 : 0;
      return { hair: 0, skin: neck };
    }
    const a = Math.abs(Math.atan2(x, z - czAt(y)));
    const hl = hairline(a);
    const hair = smoothstep(hl - 0.002, hl + 0.002, y);
    return { hair, skin: 1 - hair };
  };

  // Faint gather lines in the face: brows, nose edges, lip line.
  const segs = [
    [[-0.055, 0.481], [-0.012, 0.485]], [[0.012, 0.485], [0.055, 0.481]],
    [[-0.009, 0.462], [-0.016, 0.428]], [[0.009, 0.462], [0.016, 0.428]],
    [[-0.022, 0.424], [0.022, 0.424]],
    [[-0.022, 0.4045], [0.022, 0.4045]],
  ];
  const faceFeature = (p) => featureFromSegments(segs, p[0], p[1], 0.0025);

  const headCenter = [0, 0.49, czAt(0.49)];
  const part = { cx: 0, line: partLine(rows, { headCenter, hairlineFront: [0, 0.528, zf(0.528)], crownAngle: 0.95 }) };

  return {
    rows,
    front,
    ears,
    classify,
    faceFeature,
    part,
    meta: {
      units: 'm',
      source: 'placeholder',
      yTop: 0.6,
      yBottom: 0.0,
      headH: 0.222,
      crownY: 0.6,
      eyeY: 0.462,
      chinY: 0.378,
      neckY: 0.355,
      shoulderY: 0.27,
      shoulderHalfWidth: 0.216,
      centerX: 0,
    },
  };
}

export function featureFromSegments(segs, x, y, sigma) {
  let best = Infinity;
  for (const [a, b] of segs) {
    const abx = b[0] - a[0];
    const aby = b[1] - a[1];
    const t = clamp(((x - a[0]) * abx + (y - a[1]) * aby) / (abx * abx + aby * aby || 1e-12), 0, 1);
    const d = Math.hypot(x - a[0] - abx * t, y - a[1] - aby * t);
    if (d < best) best = d;
  }
  return Math.exp(-(best * best) / (2 * sigma * sigma));
}
