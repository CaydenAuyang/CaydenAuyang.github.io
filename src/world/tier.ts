// tier.ts: how much the device can take, from the GPU string, device memory and viewport.
//   high:  a capable desktop GPU (Apple M-series, discrete NVIDIA or AMD)
//   low:   integrated or software GPUs, little memory, or tablets
//   phone: small viewports and phones
// ?tier=high|low|phone in the URL overrides it, for testing.

import { PHONE_MAX_WIDTH, type Tier, type TierInfo } from './contract';

const TABLE: Record<Tier, Omit<TierInfo, 'tier'>> = {
  high: { dprCap: 1.75, stars: 12000, towers: 260, points: 60000 },
  low: { dprCap: 1.5, stars: 9000, towers: 260, points: 30000 },
  phone: { dprCap: 1.5, stars: 4000, towers: 110, points: 16000 },
};

export interface TierResult extends TierInfo {
  gpu: string;
}

/** Read the GPU string from a throwaway context, so the real renderer can pick antialias. */
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

export function detectTier(gpu: string): TierResult {
  let forced: string | null = null;
  try {
    forced = new URLSearchParams(location.search).get('tier');
  } catch {
    /* no location */
  }
  const pick = (tier: Tier): TierResult => ({ tier, ...TABLE[tier], gpu });
  if (forced === 'high' || forced === 'low' || forced === 'phone') return pick(forced);

  const w = Math.min(window.innerWidth, window.screen?.width || Infinity);
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  const shortSide = Math.min(window.screen?.width || 9999, window.screen?.height || 9999);
  if (window.innerWidth <= PHONE_MAX_WIDTH || (coarse && shortSide <= PHONE_MAX_WIDTH) || w <= PHONE_MAX_WIDTH) return pick('phone');

  const g = gpu.toLowerCase();
  const mem = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  const cores = navigator.hardwareConcurrency || 8;
  const software = /swiftshader|llvmpipe|software|basic render|softpipe/.test(g);
  const weak = /intel|mali|adreno|powervr|apple a\d|uhd graphics|hd graphics/.test(g) && !/arc\b|apple m\d/.test(g);
  if (software || weak || (mem !== undefined && mem < 4) || cores <= 4 || coarse) return pick('low');
  return pick('high');
}
