// palette.ts: the world's colors, from the spec's palette (NIGHT-SIGNAL.md section 3).
// Shaders take these as display (sRGB) values and write them out unchanged.
import { srgb } from './random';

export const PALETTE = {
  night: srgb('#05070D'), // page ground, deepest water, top of the sky
  sky: srgb('#121838'), // sky near the horizon
  glow: srgb('#2B2140'), // light-pollution haze along the horizon, fog color
  window: srgb('#FFB65C'), // lit windows (80%)
  cool: srgb('#CFE3FF'), // lit windows (20%), stars
  neon: srgb('#FF4F8B'), // aviation lights only
  peak: srgb('#0A0F1F'), // the Peak: navy one step lighter than night
  facade: srgb('#070A14'), // tower walls
};
