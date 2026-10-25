// materials.ts: what the folding phone is made of (V4.md 6.1), and the room it reflects.
//
// Everything is drawn in code; the only image files are the two photos (screens.ts). Canvas
// textures are drawn in millimetres where it matters, so a round hole stays round.
//
//   bodyGlass()       the back glass: dark blue under a clear coat, with a metallic flake (a sparse
//                     field of tilted texels as a normal map, so it sparkles finely as it turns).
//   frameMaterial()   the frame (side band): satin dark blue anodised metal, with the antenna bands,
//                     button cut-outs, USB-C port, speaker and mic holes drawn into its maps.
//   lensMaterial(), flashMaterial(), sensorMaterial(), ringMetal(), buttonMaterial(),
//   powerMaterial(), hingeMaterial(), coreMaterial()   the small parts.
//   shadowMap()       the soft contact shadow: one baked blurred texture (8.6), not a shadow map.
//   buildEnvironment()   three's studio room, dimmed to a room at night and prefiltered once
//                     (index.ts runs it in idle time and disposes the generator right after).
//
// Every colour the phone is drawn with lives in PHONE_COLORS below (V4.md 9: one place for each
// thing): 6.1's body and frame, the small parts, what the canvas textures paint, the key light.
// The one colour from outside is the warm rim light, the window colour of the world's palette
// (index.ts).

import {
  CanvasTexture,
  ClampToEdgeWrapping,
  DataTexture,
  Euler,
  LinearFilter,
  LinearMipmapLinearFilter,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PMREMGenerator,
  RepeatWrapping,
  RGBAFormat,
  SRGBColorSpace,
  Vector2,
  type MeshLambertMaterial,
  type Mesh,
  type Object3D,
  type PointLight,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

/** The phone's colours (the phone's own palette; the world's is src/world/palette.ts). */
export const PHONE_COLORS = {
  /** Body and back glass, and frame (V4.md 6.1). */
  glass: '#1b2340',
  frame: '#24305a',
  /** Antenna bands (plastic), and the dark gaps around buttons, port and holes. */
  band: '#151a2e',
  gap: '#070912',
  /** The USB-C port: its bright lip, the opening (lighter toward its lower edge), the tongue. */
  portLip: '#5d6a98',
  portOpening: '#020306',
  portDepth: '#1e222e',
  portTongue: '#262a36',
  /** Speaker and mic holes. */
  holeLip: '#56628e',
  hole: '#010204',
  /** The small parts. */
  ring: '#7a84a6',
  power: '#1f2a4f',
  hinge: '#273258',
  core: '#06070d',
  sensor: '#05060a',
  /** A rear lens: the barrel wall (inside to out), its machined rings, the coated front element
      (centre to edge: violet, blue, green, near black), the iris and its blade edges, two glints. */
  lensWall: ['#07080b', '#14161c', '#050608'],
  lensRing: '#464c5c',
  lensCoat: ['#281e46', '#161a34', '#0c1e20', '#040508'],
  iris: '#020204',
  irisEdge: '#5a6082',
  irisBlade: '#3c4260',
  glintCool: '#c8d2ff',
  glintGreen: '#8cffc8',
  /** The flash's diffuser (centre to rim) and its dimples. */
  flash: ['#f3e6c4', '#d9d2bf', '#a9a69d', '#3a3d48'],
  flashDimple: '#787060',
  /** The displays: black glass, the ring where a punch hole is cut, the lens inside it. */
  screen: '#000000',
  punchRing: '#464c60',
  punchLens: ['#3c4078', '#0e1022'],
  /** The soft cool key light in front (index.ts). */
  key: '#e4ebff',
  /** The contact shadow: dark blue, never a grey slab. */
  shadow: '#04081c',
  /** Neutrals: white under a map that carries the colour, and for glints and masks; black for shade. */
  white: '#ffffff',
  black: '#000000',
};

/** A colour from the table at an opacity, for the canvas textures: rgba(r, g, b, a). */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** How strongly materials reflect the room; screens take a fraction of it (userData.envScale). */
export const ENV_INTENSITY = 0.75;
/** The studio room at night: its light panels and its walls (lit by one lamp), scaled down. */
const ROOM_PANELS = 0.15;
const ROOM_WALLS = 0.6;
/** The room is turned so that no panel sits straight behind the reader. */
export const ENV_ROTATION = new Euler(0.4, 2.6, 0);

export function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function canvas2d(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

export function srgb<T extends Texture>(t: T): T {
  t.colorSpace = SRGBColorSpace;
  return t;
}

/**
 * Reflections: three's neutral studio room, prefiltered once, dimmed to a room at night: its walls
 * (lit by one lamp) to 0.6, so metal at a grazing angle doesn't turn silver, and its light panels
 * (emissive boxes, 17 to 100 bright) to 0.15, so glass shows them as soft gradients, not white
 * sheets or milky lenses. The generator and the room are freed before this returns.
 */
export function buildEnvironment(renderer: WebGLRenderer): WebGLRenderTarget {
  const pmrem = new PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  room.traverse((obj) => {
    const mat = (obj as Mesh).material as MeshLambertMaterial | undefined;
    if (mat?.isMeshLambertMaterial) mat.emissiveIntensity *= ROOM_PANELS;
    if ((obj as PointLight).isPointLight) (obj as PointLight).intensity *= ROOM_WALLS;
  });
  const env = pmrem.fromScene(room, 0.04);
  room.dispose();
  pmrem.dispose();
  return env;
}

/** Put the room on every lit material under root (each at its own strength, not scene.environment). */
export function applyEnvironment(root: Object3D, env: Texture | null) {
  root.traverse((obj) => {
    const mats = (obj as Mesh).material;
    for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
      const mat = m as MeshStandardMaterial;
      if (!mat.isMeshStandardMaterial) continue;
      mat.envMap = env;
      mat.envMapIntensity = ENV_INTENSITY * ((mat.userData.envScale as number | undefined) ?? 1);
      mat.envMapRotation.copy(ENV_ROTATION);
      mat.needsUpdate = true;
    }
  });
}

/** Flakes: about one texel in seven tilts up to about 25 degrees; the rest lie flat. */
function flakeNormal(): DataTexture {
  const size = 256;
  const data = new Uint8Array(size * size * 4);
  const rand = rng(0x1b2340); // a fixed seed: the same flakes on every visit
  for (let i = 0; i < size * size; i++) {
    let x = 0;
    let y = 0;
    if (rand() < 0.14) {
      const a = rand() * Math.PI * 2;
      const tilt = 0.12 + rand() * 0.3;
      x = Math.cos(a) * tilt;
      y = Math.sin(a) * tilt;
    }
    const z = Math.sqrt(Math.max(0, 1 - x * x - y * y));
    data[i * 4] = Math.round((x * 0.5 + 0.5) * 255);
    data[i * 4 + 1] = Math.round((y * 0.5 + 0.5) * 255);
    data[i * 4 + 2] = Math.round((z * 0.5 + 0.5) * 255);
    data[i * 4 + 3] = 255;
  }
  const t = new DataTexture(data, size, size, RGBAFormat);
  t.wrapS = t.wrapT = RepeatWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** The back glass: the glass on top does the reflecting; the paint under it only sparkles. */
export function bodyGlass(maxAnisotropy: number): MeshPhysicalMaterial {
  const flake = flakeNormal();
  flake.anisotropy = maxAnisotropy;
  return new MeshPhysicalMaterial({
    color: PHONE_COLORS.glass,
    metalness: 0.25,
    roughness: 0.42,
    specularIntensity: 0.5,
    normalMap: flake,
    normalScale: new Vector2(0.35, 0.35),
    clearcoat: 1,
    clearcoatRoughness: 0.03,
  });
}

export type FrameFeature =
  /** An antenna band across the whole side, at u, width in mm. */
  | { kind: 'band'; u: number; width: number }
  /** A button's cut-out: a dark gap around a footprint (u0 to u1, z0 to z1 in mm from the back). */
  | { kind: 'cutout'; u0: number; u1: number; z0: number; z1: number }
  /** The USB-C port, centred at u and height z (mm from the back). */
  | { kind: 'port'; u: number; z: number }
  /** A row of round holes centred at u and z: count, spacing and diameter in mm. */
  | { kind: 'holes'; u: number; z: number; count: number; spacing: number; diameter: number };

/** A texel of a metal-roughness map: roughness in green, metalness in blue (0 to 255), as three reads them. */
const mrTexel = (roughness: number, metalness: number) => `rgb(0, ${roughness}, ${metalness})`;

/**
 * The frame's maps for one half. u runs along the outline (perimeter mm long), v up the side
 * (thickness mm). Colour is satin dark blue metal; bands and holes are plastic or shadow.
 */
function frameMaps(perimeter: number, thickness: number, features: FrameFeature[]): { map: Texture; mr: Texture } {
  const W = 4096;
  const H = 64;
  const sx = W / perimeter; // px per mm along the outline
  const sy = H / thickness; // px per mm up the side
  const [cMap, map] = canvas2d(W, H);
  const [cMr, mr] = canvas2d(W, H);
  map.fillStyle = PHONE_COLORS.frame;
  map.fillRect(0, 0, W, H);
  const MR_METAL = mrTexel(112, 255);
  const MR_PLASTIC = mrTexel(150, 0);
  const MR_HOLE = mrTexel(235, 0);
  mr.fillStyle = MR_METAL;
  mr.fillRect(0, 0, W, H);
  // A faint brushed grain along the band, so the satin isn't perfectly flat.
  const rand = rng(0x24305a); // a fixed seed
  for (let i = 0; i < 2400; i++) {
    const y = rand() * H;
    const g = 106 + Math.round(rand() * 12);
    mr.fillStyle = mrTexel(g, 255);
    mr.fillRect(rand() * W, y, 40 + rand() * 300, 1);
  }

  // Canvas y runs down; v runs up (flipY), so a height z from the back is at H - z * sy.
  const X = (u: number) => u * W;
  const Y = (z: number) => H - z * sy;
  const both = (fn: (ctx: CanvasRenderingContext2D, isMr: boolean) => void) => {
    fn(map, false);
    fn(mr, true);
  };
  const ellipse = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number) => {
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.fill();
  };
  // In mm, drawn with the px scales: a rounded rectangle whose ends are half-circles.
  const stadium = (ctx: CanvasRenderingContext2D, cx: number, cy: number, w: number, h: number) => {
    const r = h / 2;
    ctx.beginPath();
    ctx.ellipse(cx - (w / 2 - r) * sx, cy, r * sx, r * sy, 0, Math.PI / 2, (3 * Math.PI) / 2);
    ctx.ellipse(cx + (w / 2 - r) * sx, cy, r * sx, r * sy, 0, -Math.PI / 2, Math.PI / 2);
    ctx.closePath();
    ctx.fill();
  };

  for (const f of features) {
    if (f.kind === 'band') {
      both((ctx, isMr) => {
        ctx.fillStyle = isMr ? MR_PLASTIC : PHONE_COLORS.band;
        ctx.fillRect(X(f.u) - (f.width / 2) * sx, 0, f.width * sx, H);
      });
    } else if (f.kind === 'cutout') {
      const gap = 0.22;
      both((ctx, isMr) => {
        ctx.fillStyle = isMr ? MR_HOLE : PHONE_COLORS.gap;
        ctx.fillRect(X(f.u0) - gap * sx, Y(f.z1 + gap), (f.u1 - f.u0) * W + 2 * gap * sx, (f.z1 - f.z0 + 2 * gap) * sy);
      });
    } else if (f.kind === 'port') {
      const cx = X(f.u);
      const cy = Y(f.z);
      both((ctx, isMr) => {
        // A bright lip (the chamfer into the port), the dark opening, the tongue inside.
        ctx.fillStyle = isMr ? mrTexel(70, 255) : PHONE_COLORS.portLip;
        stadium(ctx, cx, cy, 9.0, 3.2);
        ctx.fillStyle = isMr ? MR_HOLE : PHONE_COLORS.portOpening;
        stadium(ctx, cx, cy, 8.4, 2.6);
        if (!isMr) {
          // Depth: the opening is darkest at its top edge, where the lip shades it.
          const g = ctx.createLinearGradient(0, cy - 1.3 * sy, 0, cy + 1.3 * sy);
          g.addColorStop(0, alpha(PHONE_COLORS.black, 0.9));
          g.addColorStop(1, alpha(PHONE_COLORS.portDepth, 0.35));
          ctx.fillStyle = g;
          stadium(ctx, cx, cy, 8.4, 2.6);
        }
        ctx.fillStyle = isMr ? mrTexel(160, 30) : PHONE_COLORS.portTongue;
        ctx.fillRect(cx - 3.3 * sx, cy - 0.32 * sy, 6.6 * sx, 0.64 * sy);
      });
    } else {
      const first = -((f.count - 1) / 2) * f.spacing;
      for (let i = 0; i < f.count; i++) {
        const cx = X(f.u) + (first + i * f.spacing) * sx;
        const cy = Y(f.z);
        both((ctx, isMr) => {
          ctx.fillStyle = isMr ? mrTexel(80, 255) : PHONE_COLORS.holeLip;
          ellipse(ctx, cx, cy, (f.diameter / 2 + 0.12) * sx, (f.diameter / 2 + 0.12) * sy);
          ctx.fillStyle = isMr ? MR_HOLE : PHONE_COLORS.hole;
          ellipse(ctx, cx, cy, (f.diameter / 2) * sx, (f.diameter / 2) * sy);
        });
      }
    }
  }
  const tMap = srgb(new CanvasTexture(cMap));
  const tMr = new CanvasTexture(cMr);
  for (const t of [tMap, tMr]) {
    t.wrapS = RepeatWrapping;
    t.wrapT = ClampToEdgeWrapping;
  }
  return { map: tMap, mr: tMr };
}

/** The frame for one half: anodised aluminium, a thin clear oxide over the dyed metal, so highlights stay near white. */
export function frameMaterial(perimeter: number, thickness: number, features: FrameFeature[], maxAnisotropy: number): MeshPhysicalMaterial {
  const maps = frameMaps(perimeter, thickness, features);
  maps.map.anisotropy = maps.mr.anisotropy = maxAnisotropy;
  const mat = new MeshPhysicalMaterial({
    color: PHONE_COLORS.white,
    map: maps.map,
    roughnessMap: maps.mr,
    metalnessMap: maps.mr,
    roughness: 1,
    metalness: 0.72,
    clearcoat: 0.5,
    clearcoatRoughness: 0.28,
  });
  mat.userData.envScale = 0.7;
  return mat;
}

/** A lens behind its glass, 512 px across the glass: barrel, coating, iris, pupil. */
function lensMap(): Texture {
  const S = 512;
  const [c, ctx] = canvas2d(S, S);
  const m = S / 2;
  const C = PHONE_COLORS;
  ctx.fillStyle = C.black;
  ctx.fillRect(0, 0, S, S);
  const ring = (r0: number, r1: number, color: string) => {
    ctx.beginPath();
    ctx.arc(m, m, r1 * m, 0, Math.PI * 2);
    ctx.arc(m, m, r0 * m, 0, Math.PI * 2, true);
    ctx.fillStyle = color;
    ctx.fill();
  };
  // The barrel: a dark wall with fine machined rings.
  const wall = ctx.createRadialGradient(m, m, 0.62 * m, m, m, m);
  wall.addColorStop(0, C.lensWall[0]);
  wall.addColorStop(0.7, C.lensWall[1]);
  wall.addColorStop(1, C.lensWall[2]);
  ctx.fillStyle = wall;
  ctx.beginPath();
  ctx.arc(m, m, m, 0, Math.PI * 2);
  ctx.fill();
  for (let r = 0.66; r < 0.98; r += 0.045) ring(r, r + 0.008, alpha(C.lensRing, 0.35));
  // The front element with its coating: a violet and green sheen.
  const coat = ctx.createRadialGradient(m * 0.85, m * 0.8, 0.05 * m, m, m, 0.62 * m);
  coat.addColorStop(0, C.lensCoat[0]);
  coat.addColorStop(0.45, C.lensCoat[1]);
  coat.addColorStop(0.8, C.lensCoat[2]);
  coat.addColorStop(1, C.lensCoat[3]);
  ctx.fillStyle = coat;
  ctx.beginPath();
  ctx.arc(m, m, 0.62 * m, 0, Math.PI * 2);
  ctx.fill();
  // The iris: six blades as a hexagon, with their edges just catching light.
  ctx.save();
  ctx.translate(m, m);
  ctx.rotate(0.3);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    const x = Math.cos(a) * 0.34 * m;
    const y = Math.sin(a) * 0.34 * m;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fillStyle = C.iris;
  ctx.fill();
  ctx.strokeStyle = alpha(C.irisEdge, 0.55);
  ctx.lineWidth = 2;
  ctx.stroke();
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * 0.34 * m, Math.sin(a) * 0.34 * m);
    ctx.lineTo(Math.cos(a + 0.9) * 0.55 * m, Math.sin(a + 0.9) * 0.55 * m);
    ctx.strokeStyle = alpha(C.irisBlade, 0.35);
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
  // The pupil, and two small internal reflections.
  ctx.fillStyle = C.black;
  ctx.beginPath();
  ctx.arc(m, m, 0.2 * m, 0, Math.PI * 2);
  ctx.fill();
  const glint = (x: number, y: number, r: number, a: number, color: string) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, alpha(color, a));
    g.addColorStop(1, alpha(color, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  };
  glint(m * 0.78, m * 0.74, 0.07 * m, 0.55, C.glintCool);
  glint(m * 1.16, m * 1.2, 0.05 * m, 0.25, C.glintGreen);
  return srgb(new CanvasTexture(c));
}

/**
 * The cover glass over each lens is anti-reflection coated: a weaker clear coat and half the
 * room, so a light panel shows as a soft sheen, not a milky disc over the iris.
 */
export function lensMaterial(): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({ color: PHONE_COLORS.white, map: lensMap(), roughness: 0.45, metalness: 0, specularIntensity: 0.15, clearcoat: 0.35, clearcoatRoughness: 0.015 });
  mat.userData.envScale = 0.5;
  return mat;
}

/** The flash: a pale warm diffuser with a fine dimple pattern. */
export function flashMaterial(): MeshPhysicalMaterial {
  const S = 256;
  const [c, ctx] = canvas2d(S, S);
  const m = S / 2;
  const g = ctx.createRadialGradient(m, m, 0, m, m, m);
  const { flash, flashDimple } = PHONE_COLORS;
  g.addColorStop(0, flash[0]);
  g.addColorStop(0.6, flash[1]);
  g.addColorStop(0.92, flash[2]);
  g.addColorStop(1, flash[3]);
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  ctx.fillStyle = alpha(flashDimple, 0.28);
  const step = 14;
  for (let y = step / 2; y < S; y += step) {
    for (let x = step / 2 + ((y / step) % 2) * (step / 2); x < S; x += step) {
      if (Math.hypot(x - m, y - m) > m * 0.86) continue;
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  return new MeshPhysicalMaterial({ color: PHONE_COLORS.white, map: srgb(new CanvasTexture(c)), roughness: 0.6, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.05 });
}

export const sensorMaterial = () => new MeshPhysicalMaterial({ color: PHONE_COLORS.sensor, roughness: 0.2, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.02 });
export const ringMetal = () => new MeshStandardMaterial({ color: PHONE_COLORS.ring, metalness: 1, roughness: 0.26 });
export const buttonMaterial = () => new MeshPhysicalMaterial({ color: PHONE_COLORS.frame, metalness: 0.72, roughness: 0.36, clearcoat: 0.5, clearcoatRoughness: 0.25 });
export const powerMaterial = () => new MeshPhysicalMaterial({ color: PHONE_COLORS.power, metalness: 0.55, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.5 });
export const hingeMaterial = () => new MeshPhysicalMaterial({ color: PHONE_COLORS.hinge, metalness: 0.72, roughness: 0.42, clearcoat: 0.45, clearcoatRoughness: 0.3 });
export const coreMaterial = () => new MeshStandardMaterial({ color: PHONE_COLORS.core, metalness: 0.4, roughness: 0.7 });

/** A soft round falloff (white, alpha from 1 at the centre to 0 at the edge), baked once. */
export function shadowMap(): Texture {
  const S = 128;
  const [c, ctx] = canvas2d(S, S);
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, alpha(PHONE_COLORS.white, 1));
  g.addColorStop(0.45, alpha(PHONE_COLORS.white, 0.55));
  g.addColorStop(1, alpha(PHONE_COLORS.white, 0));
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  return new CanvasTexture(c);
}
