// Reads a CSS color in any syntax the browser understands (hex, rgb(), hsl(), oklch(), names)
// by painting it into a 1x1 canvas. Returns [r, g, b, a] in 0..1, or the fallback.

let ctx = null;

export function parseCssColor(value, fallback) {
  const str = (value || '').trim();
  if (!str) return fallback;
  try {
    if (!ctx) {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      ctx = c.getContext('2d', { willReadFrequently: true });
    }
    if (!ctx) return fallback;
    // An invalid color leaves fillStyle unchanged, so set a sentinel first and compare.
    ctx.fillStyle = '#010203';
    const sentinel = ctx.fillStyle;
    ctx.fillStyle = str;
    if (ctx.fillStyle === sentinel && !/^#?010203$/i.test(str)) return fallback;
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return [d[0] / 255, d[1] / 255, d[2] / 255, d[3] / 255];
  } catch {
    return fallback;
  }
}
