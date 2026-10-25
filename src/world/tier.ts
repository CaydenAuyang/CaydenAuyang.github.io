// tier.ts: how much the device can take (V4.md 8.5).
//   phone: phones, a touch screen whose short side is under 700 px (and narrow desktop windows)
//   low:   tablets (touch, short side 700 px or more), and integrated or software GPUs, little
//          memory or few cores on laptops and desktops
//   high:  a capable desktop GPU (Apple M-series, discrete NVIDIA or AMD)
// The particle count and figure file follow the tier (16,000 figure-phone, 30,000 figure-lo,
// 60,000 figure-hi) and never change after load. ?tier=high|low|phone in the URL overrides it,
// for testing.

import { PHONE_MAX_WIDTH, type Tier, type TierInfo } from './contract';
import { TOUCH } from './layout';

// Phones get 6,500 stars, not the spec's 4,000: their narrow view holds few of them, and 6,500
// makes the phone hero's sky as dense per screen area as the laptop's.
const TABLE: Record<Tier, Omit<TierInfo, 'tier'>> = {
  high: { dprCap: 1.75, stars: 12000, towers: 260, points: 60000 },
  low: { dprCap: 1.5, stars: 9000, towers: 260, points: 30000 },
  phone: { dprCap: 1.5, stars: 6500, towers: 110, points: 16000 },
};

/** A touch screen whose short side (CSS px) is under this is a phone; at or over it, a tablet. */
const TABLET_SHORT_SIDE = 700;

export interface TierResult extends TierInfo {
  gpu: string;
}

/** Read the GPU string from a throwaway context, released at once (V4.md 8.8: at most two contexts on the page). */
export function readGpu(): string {
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl2') || c.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const s = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return s;
  } catch {
    return '';
  }
}

/**
 * Whether the main input is touch: the layout's touch query, or an iPad asking for the desktop
 * site (Safari on iPadOS says Macintosh and hovers when a trackpad is attached, but has touch
 * points; a Mac has none).
 */
function touchDevice(): boolean {
  const ipad = navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent);
  return (window.matchMedia?.(TOUCH).matches ?? false) || ipad;
}

export function detectTier(gpu: string): TierResult {
  let forced: string | null = null;
  try {
    forced = new URLSearchParams(location.search).get('tier');
  } catch {
    /* no location */
  }
  const pick = (tier: Tier): TierResult => ({ tier, ...TABLE[tier], gpu });
  if (forced === 'high' || forced === 'low' || forced === 'phone') return pick(forced);

  // Phones and tablets by the screen's short side, which stays the same when the device turns.
  if (touchDevice()) {
    const shortSide = Math.min(window.screen?.width || window.innerWidth, window.screen?.height || window.innerHeight);
    return pick(shortSide < TABLET_SHORT_SIDE ? 'phone' : 'low');
  }

  // Laptops and desktops: a narrow window gets the phone tier, otherwise the GPU decides.
  const w = Math.min(window.innerWidth, window.screen?.width || Infinity);
  if (w <= PHONE_MAX_WIDTH) return pick('phone');
  const g = gpu.toLowerCase();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency || 8;
  const software = /swiftshader|llvmpipe|software|basic render|softpipe/.test(g);
  const weak = /intel|mali|adreno|powervr|apple a\d|uhd graphics|hd graphics/.test(g) && !/arc\b|apple m\d/.test(g);
  if (software || weak || (mem !== undefined && mem < 4) || cores <= 4) return pick('low');
  return pick('high');
}
