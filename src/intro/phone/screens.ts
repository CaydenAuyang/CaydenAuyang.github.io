// screens.ts: the phone's two displays (V4.md 6.1): the photos, cover-cropped into each screen's
// rounded active area, the punch-hole cameras, and the inner screen's crease.
//
//   photoUrls()      which files to fetch: the smaller pair on the phone tier (8.5: phones, short
//                    side under 700px), the larger elsewhere (public/intro/photos/).
//   loadPhoto()      fetches a photo and decodes it with createImageBitmap, off the main thread.
//   screenMap()      a display face: black glass, the photo in its active area, the punch hole, and
//                    on the inner screen the crease as a faint line.
//   creaseNormal()   the crease as a shallow dip in the glass (clear coat normals), so reflections
//                    bend as they cross it.
//   screenMaterial() the photo glows (emissive, not tone mapped, so its colours stay true); the
//                    glass over it only reflects, through an anti-reflective coat.

import { CanvasTexture, ClampToEdgeWrapping, DataTexture, LinearFilter, LinearMipmapLinearFilter, MeshPhysicalMaterial, RGBAFormat, Vector2, type Texture } from 'three';
import { alpha, canvas2d, PHONE_COLORS as C, srgb } from './materials';

const PHOTOS = '/intro/photos';

/** The cover photo (closed) and the inner photo (open), for this device. ?tier=phone forces the phone pair. */
export function photoUrls(): { cover: string; inner: string } {
  const forced = new URLSearchParams(location.search).get('tier');
  const shortSide = Math.min(window.screen?.width || Infinity, window.screen?.height || Infinity, window.innerWidth <= 767 ? window.innerWidth : Infinity);
  const phone = forced ? forced === 'phone' : shortSide < 700;
  return phone
    ? { cover: `${PHOTOS}/cayden-vertical-768.webp`, inner: `${PHOTOS}/club-landscape-1200.webp` }
    : { cover: `${PHOTOS}/cayden-vertical-1024.webp`, inner: `${PHOTOS}/club-landscape-1600.webp` };
}

export type Photo = ImageBitmap | HTMLImageElement;

/** A photo, decoded off the main thread where the browser can (an <img> where it can't). */
export async function loadPhoto(url: string): Promise<Photo> {
  if ('createImageBitmap' in window) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${url}: ${res.status}`);
    return createImageBitmap(await res.blob());
  }
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

export interface ScreenLayout {
  /** The face the texture covers, in the texture's own mm (x right, y up). */
  width: number;
  height: number;
  /** The active (lit) area: left, bottom, width, height, corner radius, all mm. */
  area: { x: number; y: number; w: number; h: number; r: number };
  /** Rotate the photo a quarter turn clockwise (its up becomes the texture's +x). */
  rotate: boolean;
  /** The punch-hole camera's centre and diameter, mm. */
  hole: { x: number; y: number; d: number };
  /** Draw the crease at this x (mm). */
  crease?: number;
  /** Pixels per mm. */
  density: number;
}

/** A display face: black glass with the photo cover-cropped into its rounded active area. */
export function screenMap(photo: Photo, l: ScreenLayout): Texture {
  const k = l.density;
  const W = Math.round(l.width * k);
  const H = Math.round(l.height * k);
  const [c, ctx] = canvas2d(W, H);
  ctx.fillStyle = C.screen;
  ctx.fillRect(0, 0, W, H);
  // mm (x right, y up) to px (x right, y down).
  const px = (x: number) => x * k;
  const py = (y: number) => H - y * k;
  const a = l.area;
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(px(a.x), py(a.y + a.h), a.w * k, a.h * k, a.r * k);
  ctx.clip();
  // Cover crop: scale the photo to fill the area (in the photo's own orientation), centred.
  const aw = (l.rotate ? a.h : a.w) * k;
  const ah = (l.rotate ? a.w : a.h) * k;
  const scale = Math.max(aw / photo.width, ah / photo.height);
  const dw = photo.width * scale;
  const dh = photo.height * scale;
  ctx.translate(px(a.x + a.w / 2), py(a.y + a.h / 2));
  if (l.rotate) ctx.rotate(Math.PI / 2);
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(photo, -dw / 2, -dh / 2, dw, dh);
  ctx.restore();

  if (l.crease !== undefined) {
    // A faint line down the fold: a soft shade about 3 mm wide, a hairline at its middle and a
    // thin catch of light along one side, as the bent glass shows it.
    const cx = px(l.crease);
    const top = py(a.y + a.h);
    const band = (half: number, stops: [number, string][]) => {
      const g = ctx.createLinearGradient(cx - half * k, 0, cx + half * k, 0);
      for (const [at, color] of stops) g.addColorStop(at, color);
      ctx.fillStyle = g;
      ctx.fillRect(cx - half * k, top, 2 * half * k, a.h * k);
    };
    band(1.6, [
      [0, alpha(C.black, 0)],
      [0.5, alpha(C.black, 0.12)],
      [1, alpha(C.black, 0)],
    ]);
    band(0.3, [
      [0, alpha(C.black, 0)],
      [0.5, alpha(C.black, 0.22)],
      [1, alpha(C.black, 0)],
    ]);
    ctx.fillStyle = alpha(C.white, 0.07);
    ctx.fillRect(cx + 0.45 * k, top, Math.max(1, 0.2 * k), a.h * k);
  }

  // The punch hole: black, a faint ring where the glass is cut, the lens just visible inside.
  const hx = px(l.hole.x);
  const hy = py(l.hole.y);
  const hr = (l.hole.d / 2) * k;
  ctx.fillStyle = C.black;
  ctx.beginPath();
  ctx.arc(hx, hy, hr * 1.18, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = alpha(C.punchRing, 0.7);
  ctx.lineWidth = Math.max(1, 0.1 * k);
  ctx.beginPath();
  ctx.arc(hx, hy, hr, 0, Math.PI * 2);
  ctx.stroke();
  const lens = ctx.createRadialGradient(hx - hr * 0.2, hy - hr * 0.25, 0, hx, hy, hr * 0.6);
  lens.addColorStop(0, alpha(C.punchLens[0], 0.9));
  lens.addColorStop(0.5, C.punchLens[1]);
  lens.addColorStop(1, C.black);
  ctx.fillStyle = lens;
  ctx.beginPath();
  ctx.arc(hx, hy, hr * 0.6, 0, Math.PI * 2);
  ctx.fill();

  const t = srgb(new CanvasTexture(c));
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  return t;
}

/**
 * The crease as a normal map across the whole inner screen (u 0 to 1 over widthMm): a shallow dip
 * at u = 0.5, about 3 mm wide.
 */
export function creaseNormal(widthMm: number): DataTexture {
  const W = 1024;
  const H = 4;
  const data = new Uint8Array(W * H * 4);
  const sigma = 1.1;
  for (let i = 0; i < W; i++) {
    const x = ((i + 0.5) / W - 0.5) * widthMm;
    // Height h(x) = -depth * exp(-x^2 / 2 sigma^2); the normal leans against its slope.
    const slope = ((0.2 * x) / (sigma * sigma)) * Math.exp(-(x * x) / (2 * sigma * sigma));
    const nx = -slope;
    const nz = 1 / Math.hypot(nx, 1);
    for (let j = 0; j < H; j++) {
      const o = (j * W + i) * 4;
      data[o] = Math.round((nx * nz * 0.5 + 0.5) * 255);
      data[o + 1] = 128;
      data[o + 2] = Math.round((nz * 0.5 + 0.5) * 255);
      data[o + 3] = 255;
    }
  }
  const t = new DataTexture(data, W, H, RGBAFormat);
  t.wrapS = t.wrapT = ClampToEdgeWrapping;
  t.magFilter = LinearFilter;
  t.minFilter = LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  return t;
}

/** A screen: the photo as light, under glass with a clear coat (and the crease, if given). */
export function screenMaterial(map: Texture, crease?: Texture): MeshPhysicalMaterial {
  const mat = new MeshPhysicalMaterial({
    color: C.screen,
    roughness: 1,
    metalness: 0,
    specularIntensity: 0,
    emissive: C.white,
    emissiveMap: map,
    emissiveIntensity: 1.04,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    clearcoatNormalMap: crease ?? null,
    clearcoatNormalScale: new Vector2(1, 1),
    toneMapped: false,
  });
  // Displays have an anti-reflective coat: reflections stay faint, the black border black.
  mat.userData.envScale = 0.15;
  return mat;
}
