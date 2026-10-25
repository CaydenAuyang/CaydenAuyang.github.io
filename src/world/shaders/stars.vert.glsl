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
uniform vec4 uPulse[PULSES]; // .w: pulse age in s (< 0: none)
uniform vec4 uPulseTap[PULSES]; // .xy: the tap in NDC
uniform float uPulseOn;
uniform vec3 uBeamBase[BEAMS]; // searchlights: lamp (world), direction times length, brightness and radius
uniform vec3 uBeamDir[BEAMS];
uniform vec4 uBeamK[BEAMS];
uniform vec4 uKeep[KEEP_OUT]; // keep-out boxes (viewport fractions from the top left): no beam light there
uniform float uKeepN;
uniform float uKeepW[KEEP_OUT]; // how far each box has faded in
varying vec3 vColor;
varying vec3 vSz; // point size (px), core sigma (px), halo weight

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

  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);

  // Pulse: stars near the tap glint, a ripple of sparkles running out from it (held lit, without
  // the ripple, while motion is off).
  if (uPulseOn > 0.0 && gl_Position.w > 0.0) {
    vec2 ndc = gl_Position.xy / gl_Position.w;
    float aspect = projectionMatrix[1][1] / projectionMatrix[0][0];
    for (int i = 0; i < PULSES; i++) {
      float age = uPulse[i].w;
      if (age < 0.0) continue;
      // distance in half viewport heights; the glint reaches about a fifth of the screen height
      float dn = length((ndc - uPulseTap[i].xy) * vec2(aspect, 1.0)) / 0.4;
      if (dn > 1.0) continue;
      float g = 1.0;
      if (uMotion > 0.5) {
        float a = age - dn * 0.35;
        g = a < 0.0 ? 0.0 : a < 0.06 ? a / 0.06 : exp(-(a - 0.06) / 0.25);
      } else {
        g = 0.6;
      }
      flash = max(flash, 0.75 * g * (1.0 - dn * dn));
    }
  }

  float b = aStar.y * tw + flash * (1.3 + 0.5 * aStar.y);

  // Stars seen through a searchlight's beam brighten a little: the line of sight to the star (from
  // the camera) passes through the cone. Not inside the keep-out boxes, where the beam is cut.
  vec3 sd = normalize(p);
  vec2 sf = vec2(0.5 + 0.5 * gl_Position.x / gl_Position.w, 0.5 - 0.5 * gl_Position.y / gl_Position.w);
  float keepS = 1.0;
  for (int i = 0; i < KEEP_OUT; i++) {
    if (float(i) >= uKeepN) break;
    vec4 bx = uKeep[i];
    if (sf.x > bx.x - 0.04 && sf.x < bx.z + 0.04 && sf.y > bx.y - 0.04 && sf.y < bx.w + 0.04) keepS = min(keepS, 1.0 - uKeepW[i]);
  }
  for (int i = 0; i < BEAMS; i++) {
    if (keepS <= 0.0) break;
    vec4 K = uBeamK[i];
    if (K.x <= 0.0) continue;
    vec3 D = uBeamDir[i];
    float L = length(D);
    D /= L;
    vec3 w0 = cameraPosition - uBeamBase[i];
    float bb = dot(sd, D);
    float den = max(1.0 - bb * bb, 1e-4);
    float dd = dot(sd, w0);
    float ee = dot(D, w0);
    float uc = clamp((ee - bb * dd) / den, 0.0, L);
    float sc = max(0.0, bb * uc - dd);
    vec3 q = w0 + sd * sc - D * uc;
    float r = K.y + uc * K.z;
    float inside = exp(-dot(q, q) / (r * r) * 2.2) * (1.0 - uc / L);
    b *= 1.0 + min(0.5, 2.5 * K.x) * inside * keepS;
  }
  float size = aStar.x * uPixelRatio * (0.75 + 0.25 * haze) * (1.0 + 1.4 * flash);
  // A core narrower than a pixel changes shape as the star drifts across the pixel grid, so the
  // core never gets narrower than 0.6 px (sigma), the point grows to hold it, and the light is
  // spread rather than added (a little extra kept, so faint stars still read).
  float sig0 = size / 7.48;
  float sig = max(sig0, 0.6);
  b *= sig0 / sig;
  float px = max(size, sig * 6.0);
  vColor = aColor * b * haze * uSkyFade;
  vSz = vec3(px, sig, (size * size) / (px * px));
  gl_PointSize = px;
}
