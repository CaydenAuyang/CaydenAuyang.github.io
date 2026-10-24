// water.frag: dark moving water. Each lit column of the skyline comes back as a thin vertical
// streak running toward the camera, about 1.5 times as long as its tower is tall, broken by
// scrolling ripples (thin and frequent near the shore, stretched near the camera), fading with
// distance from the shore. Most of the water stays dark. Not a mirror, not a glossy floor.
uniform sampler2D uProfile; // 2048 x PROFILE_ROWS: per camera stop, a light row (rgb) and a height row (r lit top, g roof)
uniform vec3 uBake; // slot a, slot b, blend
uniform vec4 uProfRange; // x0, x span, height span, z of the projection plane
uniform float uProfGain;
uniform vec3 uNight;
uniform vec3 uSky;
uniform vec3 uGlow;
uniform float uTime;
uniform float uMotion;
uniform float uSkyFade;
uniform float uWake;
uniform vec4 uHiRange; // x0, x1, strength in that range, boost everywhere
uniform vec2 uCityX;
uniform vec3 uFog;
varying vec3 vWorld;

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
  vec3 C = cameraPosition;
  float dist = length(vWorld - C);
  float fogF = 1.0 - exp(-max(0.0, dist - uFog.z) * uFog.y);

  if (vWorld.z < 0.0) {
    // land under the city: dark, with a little haze
    vec3 land = mix(uNight * 1.3, uGlow, 0.25 + 0.5 * fogF);
    gl_FragColor = vec4(land * mix(0.5, 1.0, uSkyFade), 1.0);
    return;
  }

  float t = uTime * uMotion;
  float zp = uProfRange.w;
  float k = (C.z - zp) / max(C.z - vWorld.z, 0.5);
  // Where this bit of water's reflected ray meets the skyline plane: across (xs) and up (ym).
  // ym is 0 at the shore and grows toward the camera.
  float xs = C.x + (vWorld.x - C.x) * k;
  float ym = max(0.0, C.y * (k - 1.0));
  float fx = fwidth(xs) + 1e-3;

  // Sideways wobble, growing toward the camera.
  float warp = vnoise(vec2(xs * 0.006, ym * 0.02 - t * 0.1));
  float wob = vnoise(vec2(xs * 0.02, sqrt(ym) * 0.8 - t * 0.3)) - 0.5;
  float zig = sin(ym * 0.21 + warp * 9.0 - t * 1.2) * (0.8 + ym * 0.008);
  // A finer wiggle on the streak edges, so close-up streaks never have straight sides; it fades
  // where it would alias.
  float wq2 = ym * 0.55 - t * 0.9;
  float edgeAA = 1.0 - smoothstep(0.3, 0.7, fwidth(wq2));
  float wob2 = (vnoise(vec2(xs * 0.06, wq2)) - 0.5) * 3.2 * edgeAA;
  float xw = xs + wob * (2.0 + ym * 0.03) + zig + wob2;
  float u = (xw - uProfRange.x) / uProfRange.y;
  // The two camera stops either side of the camera, blended.
  float ra = uBake.x * 2.0;
  float rb = uBake.y * 2.0;
  vec3 L = mix(texture2D(uProfile, vec2(u, (ra + 0.5) / PROFILE_ROWS)).rgb, texture2D(uProfile, vec2(u, (rb + 0.5) / PROFILE_ROWS)).rgb, uBake.z);
  vec2 H = mix(texture2D(uProfile, vec2(u, (ra + 1.5) / PROFILE_ROWS)).rg, texture2D(uProfile, vec2(u, (rb + 1.5) / PROFILE_ROWS)).rg, uBake.z) * uProfRange.z;

  // Length: each streak reaches about 1.5 times its lights' height toward the camera.
  // Each streak ends at its own ragged length, so no straight line forms where tall and low
  // towers meet.
  float rag = 0.75 + 0.5 * vnoise(vec2(xs * 0.045, 7.3));
  // Rough water stretches reflections toward the viewer, so even low buildings throw streaks
  // well out from the shore.
  float len = 1.0 - smoothstep(H.x * 0.35 * rag + 20.0, (H.x * 1.4 + 85.0) * rag, ym);
  // Fade with distance from the shore.
  float fall = exp(-ym / 300.0);
  // Thin streaks: only part of each lit column catches the light. Where the pattern would
  // be smaller than a pixel, use its average instead.
  float sN = vnoise(vec2(xw * 0.16 + warp * 2.0, ym * 0.004));
  float sAA = smoothstep(0.25, 0.6, fx * 0.16);
  // Close up (the streak pattern spans many pixels) streaks get wider and brighter: a nearby
  // waterfront throws more light on the water than a distant skyline. The hero is far enough
  // that this stays off.
  float near = 1.0 - smoothstep(0.06, 0.16, fx * 0.16);
  float stri = mix(smoothstep(mix(0.52, 0.38, near), 0.88, sN), 0.34, sAA);
  // a finer octave of striation where it resolves (close views), so streaks stay thin
  float sN2 = vnoise(vec2(xw * 0.55 + 3.3, ym * 0.012));
  float s2AA = smoothstep(0.25, 0.6, fx * 0.55);
  stri *= mix(0.45 + 1.2 * smoothstep(0.35, 0.75, sN2), 1.0, s2AA);
  // Ripple breaks: thin and frequent near the shore, stretched near the camera.
  float ry = sqrt(ym + 4.0) * 2.6;
  float dN = vnoise(vec2(xs * 0.05 + warp * 3.0, ry - t * 0.5));
  float dN2 = vnoise(vec2(xs * 0.11 + 3.7, ry * 2.3 - t * 0.9));
  float dAA = smoothstep(0.3, 0.7, fwidth(ry * 2.3));
  float dash = smoothstep(mix(0.38, 0.28, near), 0.68, dN) * mix(smoothstep(mix(0.25, 0.15, near), 0.6, dN2), 0.8, dAA);
  vec3 refl = L * uProfGain * len * fall * stri * dash * mix(2.0, 2.8, near);
  // A very faint wash under the lit city, so streaks sit in a little haze of light.
  refl += L * uProfGain * len * fall * 0.025;

  float across = (xs - uCityX.x) / uCityX.y;
  float wakeT = clamp(across, 0.0, 1.0) * 0.86 + 0.06;
  refl *= smoothstep(wakeT - 0.03, wakeT + 0.03, uWake * 1.06 - 0.02);
  float inHi = smoothstep(uHiRange.x - 40.0, uHiRange.x, xs) * (1.0 - smoothstep(uHiRange.y, uHiRange.y + 40.0, xs));
  refl *= (1.0 + uHiRange.w) * (1.0 + uHiRange.z * 0.8 * inHi);

  // The horizon's faint glow on the water near the shore.
  vec3 skyRefl = uGlow * 0.16 * exp(-ym / 140.0);
  skyRefl += uSky * 0.08 * exp(-ym / 900.0);

  // Near the camera: faint ripples catching the glow, so the foreground water moves too.
  vec2 wq = vWorld.xz * vec2(0.05, 0.09) + vec2(t * 0.05, -t * 0.22);
  float sheenAA = 1.0 - smoothstep(0.05, 1.2, max(fwidth(wq.x), fwidth(wq.y)));
  float sheen = pow(vnoise(wq) * vnoise(wq * 2.3 + 1.7), 1.5) * sheenAA * exp(-dist / 500.0);
  skyRefl += uGlow * 0.12 * sheen;

  vec3 col = uNight + skyRefl * uSkyFade + refl;
  col = mix(col, uGlow * 0.8, fogF * 0.3);
  gl_FragColor = vec4(col, 1.0);
}
