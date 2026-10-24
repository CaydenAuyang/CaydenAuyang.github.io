// signal.vert.glsl: the signal's points. Every point carries a base position for the target it is
// leaving (position) and the one it is heading to (aTo); xyz is world space and w is a per-target
// value (brightness, or the current's phase). The shader adds each target's live motion, then
// flows between the two along a curved path with a per-point delay and curl noise that peaks
// mid-flight. Target ids: 0 A city, 1 B figure, 2 C current, 3 D archive, 4 E two lights, 5 F field.

precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec4 position;
in vec4 aTo;
in vec4 aRand; // x delay key, y size, z path, w phase (and D strays: w < uStray)
in vec4 aInfo; // x warm (1) or cool (0), y lift rank within the lifted windows (0..1), z archive column height (its share of the tallest)

uniform int uFrom;
uniform int uTo;
uniform float uT; // morph progress 0..1
uniform float uMotion; // 1 flowing, 0 cut at the midpoint and freeze live motion
uniform float uTime; // seconds of live motion
uniform float uDelaySrc; // 0 delay from aRand.x, 1 from the lift rank
uniform float uDelayFlip; // 1 reverses the delay order (so a reverse morph mirrors the forward one)
uniform float uScale; // world length of the scene (camera to the Central cluster)
uniform float uPixelRatio;
uniform float uGain;
uniform vec3 uWarm;
uniform vec3 uCool;

// Current (C): base positions sit low over the water at phase 0.5 of the flow, seen from the
// question pose (uFlowEye, uFlowFwd). Lengths scale with each point's depth from that eye, so the
// band crosses the screen at one speed and meanders at one screen size, near or far.
uniform vec3 uFlowEye;
uniform vec3 uFlowFwd;
uniform vec3 uFlowDir;
uniform float uFlowLenK; // band length per unit of depth (a bit wider than the view)
uniform vec2 uFlowScreen; // 1 / view half width and 1 / view half height, per unit of depth (waves are sized by the height, so a phone shows fewer of them)
uniform vec3 uFlowAmp; // meander size per unit of depth: across, up, along the view
uniform float uFlowSpeed; // phase per second
uniform float uWaterY;
// Archive (D): columns rise slowly and wrap.
uniform float uColBase;
uniform float uColHeight;
uniform float uRise; // rise per second, as a share of the tallest column
uniform float uStray; // share of D points drifting loose
// Two lights (E): their radius in world units.
uniform float uLightR;

out vec3 vColor;
out float vAlpha;
out float vCore;

// ---- Simplex noise with its gradient (Stefan Gustavson and Ian McEwan, webgl-noise, MIT) -------
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 105.0;
  return 105.0 * dot(m4, pdotx);
}

// Divergence-free flow: the curl of three noise fields. Roughly unit length.
vec3 curl(vec3 p) {
  vec3 g1;
  vec3 g2;
  vec3 g3;
  snoise(p, g1);
  snoise(p + vec3(31.416, -47.853, 12.793), g2);
  snoise(p + vec3(-23.719, 11.137, 59.321), g3);
  return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y) * 0.25;
}

const float TAU = 6.28318530718;

// Live position of a point in target k from its base b. alpha is its brightness there; fade is
// the part of that which hides a wrap (the current and the columns loop), so a point in flight
// toward a wrapping target can hide its jump.
vec3 live(int k, vec4 b, out float alpha, out float fade) {
  fade = 1.0;
  float t = uTime;
  if (k == 0) {
    alpha = 0.0;
    return b.xyz;
  }
  if (k == 1) {
    // Figure: a slow shimmer, and a gentle breath of brightness.
    vec3 p = b.xyz + curl(b.xyz * (9.0 / uScale) + vec3(0.0, 0.0, t * 0.05)) * uScale * 0.0016 * uMotion;
    alpha = b.w * (0.9 + 0.1 * sin(t * 1.3 + aRand.w * TAU));
    return p;
  }
  if (k == 2) {
    // Current: drift along the band, meandering through curl noise, low over the water.
    float dep = max(dot(b.xyz - uFlowEye, uFlowFwd), 1.0);
    float s = fract(b.w + t * uFlowSpeed * (0.85 + 0.3 * aRand.y));
    vec3 p = b.xyz + uFlowDir * (s - 0.5) * uFlowLenK * dep;
    vec3 q = (p - uFlowEye) / dep;
    vec3 c = curl(vec3(dot(q, uFlowDir) * uFlowScreen.y * 0.9, q.y * uFlowScreen.y * 1.8, t * 0.035 + aRand.z * 0.12));
    p += (uFlowDir * c.x * uFlowAmp.x + vec3(0.0, c.y * uFlowAmp.y, 0.0) + uFlowFwd * c.z * uFlowAmp.z) * dep;
    p.y = max(p.y, uWaterY + 0.002 * dep);
    fade = smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.9, 1.0, s));
    alpha = (0.2 + 0.5 * aRand.y) * fade;
    return p;
  }
  if (k == 3) {
    if (aRand.w < uStray) {
      // Strays drift loose around the columns.
      vec3 p = b.xyz + curl(b.xyz * (3.0 / uScale) + vec3(t * 0.03)) * uScale * 0.05;
      alpha = b.w;
      return p;
    }
    // Columns: light rises slowly, at one speed in every column, and wraps at its own column's
    // top (aInfo.z, a share of the tallest), so each column keeps an even density all the way up
    // and its top stays exact. Only a sliver at each end fades, to hide the wrap.
    float top = aInfo.z;
    float h = mod((b.y - uColBase) / uColHeight + t * uRise, top);
    vec3 p = vec3(b.x, uColBase + h * uColHeight, b.z);
    fade = smoothstep(0.0, 0.012, h) * (1.0 - smoothstep(top - 0.006, top, h));
    alpha = b.w * fade;
    return p;
  }
  if (k == 4) {
    // Two lights: a slow swirl (sized by the lights' radius, so the core stays round) and a twinkle.
    vec3 p = b.xyz + curl(b.xyz * (0.35 / uLightR) + vec3(t * 0.06)) * uLightR * 0.05 * uMotion;
    alpha = b.w * (0.8 + 0.2 * sin(t * (1.1 + 1.7 * aRand.w) + aRand.z * TAU));
    return p;
  }
  // Field: a slow drift and a twinkle.
  vec3 p = b.xyz + curl(b.xyz * (2.0 / uScale) + vec3(t * 0.02)) * uScale * 0.04;
  alpha = b.w * (0.65 + 0.35 * sin(t * (0.6 + 1.2 * aRand.w) + aRand.z * TAU));
  return p;
}

float easeInOut(float p) {
  return p < 0.5 ? 2.0 * p * p : 1.0 - 2.0 * (1.0 - p) * (1.0 - p);
}

void main() {
  // Per-point progress: a delay of up to 30% of the transition, then 70% to travel.
  float key = mix(aRand.x, aInfo.y, uDelaySrc);
  key = mix(key, 1.0 - key, uDelayFlip);
  float p = clamp((uT - 0.3 * key) / 0.7, 0.0, 1.0);
  float e = easeInOut(p);
  if (uMotion < 0.5) {
    p = step(0.5, uT);
    e = p;
  }

  float aF;
  float fF;
  float aT;
  float fT;
  vec3 P0 = live(uFrom, position, aF, fF);
  vec3 P1 = P0;
  aT = aF;
  fT = fF;
  if (uTo != uFrom) P1 = live(uTo, aTo, aT, fT);

  vec3 pos = P0;
  float flight = 0.0;
  if (e >= 1.0) {
    pos = P1;
  } else if (e > 0.0) {
    vec3 d = P1 - P0;
    float L = length(d);
    vec3 dir = d / max(L, 1e-4);
    // Bend sideways from the path. The basis shrinks smoothly to nothing for vertical paths
    // instead of flipping, so a target that moves (the current) never makes a path jump.
    vec3 s1 = cross(dir, vec3(0.0, 1.0, 0.0));
    vec3 s2 = cross(s1, dir);
    // Neighbours bend the same way (noise of where they start), with a little spread.
    vec3 gb;
    float nb = snoise(P0 * (1.4 / uScale) + vec3(5.2), gb);
    float ang = TAU * (0.5 * nb + 0.12 * aRand.z);
    vec3 ctrl = 0.5 * (P0 + P1) + (s1 * cos(ang) + s2 * sin(ang)) * L * (0.12 + 0.16 * aRand.z);
    float u = 1.0 - e;
    pos = u * u * P0 + 2.0 * u * e * ctrl + e * e * P1;
    flight = sin(3.14159265 * e);
    pos += curl(pos * (2.2 / uScale) + vec3(0.0, 0.0, uTime * 0.04 + 3.7)) * min(L, uScale * 0.6) * 0.16 * flight;
  }

  // Brightness through the flight. Leaving the city, a point brightens quickly as its window
  // dims; arriving, it fades just before it lands.
  float alpha = mix(aF, aT, e);
  if (uFrom == 0 && uTo != 0) alpha = aT * smoothstep(0.0, 0.12, p);
  if (uTo == 0 && uFrom != 0) alpha = aF * (1.0 - smoothstep(0.88, 1.0, p));
  // Hide wraps: the target's own fade applies once the point is on its way there.
  alpha *= mix(1.0, fT, smoothstep(0.0, 0.03, e)) * mix(1.0, fF, smoothstep(0.0, 0.03, 1.0 - e));
  alpha *= (1.0 + 0.35 * flight) * uGain;

  vColor = mix(uCool, uWarm, aInfo.x);
  vAlpha = alpha;
  vCore = 0.55 + 0.45 * aRand.y;

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  if (alpha < 0.002) {
    // Nothing to draw: move it outside the clip volume so it costs no fragments.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  // 1.5 to 3.5 CSS px: bigger for brighter points and for nearer ones, a little bigger in flight.
  float px = mix(1.5, 3.1, clamp(0.35 * aRand.y + 0.65 * min(alpha / max(uGain, 1e-3), 1.0), 0.0, 1.0));
  px *= clamp(uScale / max(-mv.z, 1.0), 0.75, 1.4) * (1.0 + 0.15 * flight);
  gl_PointSize = clamp(px, 1.5, 3.5) * uPixelRatio;
}
