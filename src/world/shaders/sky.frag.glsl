// sky.frag: night at the top, through sky, to the glow of the city along the horizon,
// with a faint slow cloud band lit from below.
uniform vec3 uNight;
uniform vec3 uSky;
uniform vec3 uGlow;
uniform float uSkyFade;
uniform float uTime;
uniform float uMotion;
uniform vec4 uShow; // light show: pulse strength, seconds in, seconds per beat, glow strength
uniform vec2 uPulseRes; // drawing buffer, device px
uniform vec3 uWarm;
varying vec3 vDir;

float h12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(h12(i), h12(i + vec2(1.0, 0.0)), u.x), mix(h12(i + vec2(0.0, 1.0)), h12(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  vec3 d = normalize(vDir);
  float e = asin(clamp(d.y, -1.0, 1.0));
  // Azimuth from straight ahead (south, -z): the city glow is strongest that way.
  float az = atan(d.x, -d.z);
  float city = exp(-az * az * 0.9);

  // glow only in a low band (about 6 degrees), sky above it, night from about 25 degrees up
  vec3 c = mix(uGlow, uSky, smoothstep(-0.005, 0.1, e));
  c = mix(c, uNight, smoothstep(0.035, 0.43, e));
  // extra haze right on the horizon, toward the city
  c += uGlow * 0.32 * city * exp(-max(e, 0.0) / 0.045);
  // below the horizon: fade to night (hidden by the water and the Peak in practice)
  c = mix(c, uNight, smoothstep(0.0, -0.08, e));

#ifdef CLOUDS
  // A thin band of high cloud between about 5 and 24 degrees, lit by the city.
  if (e > 0.02 && e < 0.5) {
    vec2 q = d.xz / (d.y + 0.12);
    float t = uTime * uMotion * 0.004;
    q = q * vec2(0.9, 2.2) + vec2(t, t * 0.3);
    float n = vnoise(q * 1.3) * 0.55 + vnoise(q * 2.9 + 7.1) * 0.3 + vnoise(q * 6.1 + 3.7) * 0.15;
    float band = smoothstep(0.03, 0.12, e) * (1.0 - smoothstep(0.24, 0.42, e));
    float cloud = smoothstep(0.52, 0.8, n) * band;
    c = mix(c, uGlow * 1.3 + uSky * 0.2, cloud * 0.11 * (0.45 + 0.55 * city));
  }
#endif

  c *= uSkyFade;

  // Light show: a soft glow along the bottom of the frame, pulsing with the windows' beats as
  // they run across the city, so the show reads as the city lighting up below even when the
  // camera sees only sky.
  if (uShow.w > 0.0) {
    vec2 sc = gl_FragCoord.xy / uPulseRes;
    float low = exp(-sc.y / 0.17);
    vec3 gc = mix(uGlow * 2.2, uWarm, 0.45);
    // the windows' beat, broadened: one soft swell per beat running across the frame (steady
    // with motion off, when nothing pulses)
    float swell = 0.5 + 0.5 * cos(6.2831853 * (uShow.y / uShow.z - sc.x));
    float pulse = uShow.x > 0.0 ? swell * swell : 0.25;
    c += gc * low * uShow.w * (0.1 + 0.2 * pulse);
  }
  // dither so the dark gradient doesn't band
  c += (h12(gl_FragCoord.xy) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}
