// stars.vert: points on the dome with a tiny slow rotation, a twinkle and the odd flash.
attribute vec4 aStar; // size (px), peak brightness, twinkle rate (cycles per second), phase
attribute vec2 aFlash; // seconds between flashes (0: never flashes), schedule seed
attribute vec3 aColor;
uniform float uTime;
uniform float uMotion;
uniform float uPixelRatio;
uniform float uSkyFade;
uniform vec3 uAxis;
uniform float uDrift;
varying vec3 vColor;

vec3 rotateAxis(vec3 p, vec3 a, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

void main() {
  float t = uTime * uMotion;
  vec3 p = rotateAxis(position, uAxis, t * uDrift);
  float e = asin(clamp(normalize(p).y, -1.0, 1.0));
  // haze swallows stars near the horizon
  float haze = smoothstep(0.015, 0.32, e);

  float ph = aStar.w * 6.2831853;
  float tw;
  float flash = 0.0;
  if (uMotion > 0.5) {
    // Twinkle between 40% and 100% of the star's brightness, one cycle every 1.5 to 4 s, with
    // a slight wobble in the rhythm so no two cycles are quite alike.
    float a = 6.2831853 * aStar.z * t + ph;
    a += 0.6 * sin(a * 0.37 + ph * 1.7);
    tw = 0.4 + 0.3 * (1.0 + sin(a));
    if (aFlash.x > 0.0) {
      // Each flasher flashes once per period, at a different point of each period (stepping by
      // the golden angle), so the flashes never fall into a rhythm. A 60 ms rise, a quick fall.
      float x = t / aFlash.x + aFlash.y;
      float cyc = floor(x);
      float at = 0.35 + 0.35 * sin(cyc * 2.39996 + aFlash.y);
      float s = (x - cyc - at) * aFlash.x;
      flash = s < 0.0 ? 0.0 : s < 0.06 ? s / 0.06 : exp(-(s - 0.06) / 0.15);
    }
  } else {
    // Motion off: held still at a representative brightness, still a little different per star.
    tw = 0.7 + 0.15 * sin(ph);
  }

  float b = aStar.y * tw + flash * (1.3 + 0.5 * aStar.y);
  float size = aStar.x * uPixelRatio * (0.75 + 0.25 * haze) * (1.0 + 1.4 * flash);
  // Points under about 2.4 device pixels shimmer as they drift across the pixel grid; draw them
  // at 2.4 and dim them to keep about the same light (a little more, so faint stars still read on
  // phones, whose canvas runs at a lower pixel ratio).
  float px = max(size, 2.4);
  b *= size / px;
  vColor = aColor * b * haze * uSkyFade;
  gl_PointSize = px;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
