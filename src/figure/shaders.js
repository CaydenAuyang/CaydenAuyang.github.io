// GLSL ES 1.00 shaders. WebGL2 accepts this version too, so one set covers both.
//
// The vertex shader does all per-point work: dequantizing, the assemble from scattered points,
// rotation, perspective, the rim term and size. JavaScript only sets a handful of uniforms per frame.

export const VERT = /* glsl */ `
precision highp float;

attribute vec3 aPos;   // int16 normalized, -1..1
attribute vec2 aNrm;   // uint8 octahedral normal, 0..255
attribute float aAttr; // uint8: group in bits 0-1, weight in bits 2-7
attribute float aSeed; // uint8: assemble order, 0 first

uniform vec3 uCenter;   // dequantize: model = uCenter + aPos * uHalf
uniform vec3 uHalf;
uniform vec3 uPivot;    // model point the figure turns around
uniform float uScale;   // model units to view units (bust height becomes 2)
uniform mat3 uRot;      // yaw then pitch
uniform float uBreath;  // tiny scale change while idle
uniform float uCamDist;
uniform float uFocal;   // 1 / tan(fov / 2)
uniform vec2 uNdcScale;
uniform vec2 uNdcOffset;
uniform float uPointPx; // base sprite size in device pixels
uniform float uMaxPx;
uniform float uT;       // assemble progress, 0 scattered to 1 assembled
uniform vec3 uColPoint;
uniform vec3 uColGlow;
uniform float uGlowAmt;
uniform float uAlpha;

varying vec4 vColor;

float hash(vec3 p) {
  p = fract(p * vec3(0.1031, 0.1030, 0.0973));
  p += dot(p, p.yxz + 33.33);
  return fract((p.x + p.y) * p.z);
}

vec3 octDecode(vec2 b) {
  vec2 e = b / 255.0 * 2.0 - 1.0;
  vec3 n = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  if (n.z < 0.0) {
    vec2 s = vec2(e.x >= 0.0 ? 1.0 : -1.0, e.y >= 0.0 ? 1.0 : -1.0);
    n.xy = (1.0 - abs(n.yx)) * s;
  }
  return normalize(n);
}

void main() {
  vec3 model = uCenter + aPos * uHalf;
  vec3 P = (model - uPivot) * uScale * uBreath;
  vec3 N = octDecode(aNrm);
  float group = mod(aAttr, 4.0);
  float weight = floor(aAttr / 4.0) / 63.0;
  float order = aSeed / 255.0;

  // Assemble: each point waits for its turn (seed), then eases from a scattered spot to its place.
  vec3 q = aPos * 1731.0 + vec3(aSeed * 0.731, aAttr * 0.193, 3.1);
  float r1 = hash(q);
  float r2 = hash(q + 17.17);
  float r3 = hash(q + 41.41);
  float local = clamp((uT - order * 0.5) / 0.5, 0.0, 1.0);
  float e = 1.0 - pow(1.0 - local, 3.0);
  float th = r1 * 6.2831853;
  float cz = r2 * 2.0 - 1.0;
  float sz = sqrt(max(0.0, 1.0 - cz * cz));
  vec3 dir = vec3(sz * cos(th), cz, sz * sin(th));
  vec3 S = P * 0.3 + dir * vec3(1.15, 1.3, 0.55) * (0.55 + 0.95 * r3);
  vec3 Q = mix(S, P, e);
  float swirl = (1.0 - e) * (1.0 - e) * (0.8 + 0.9 * r2);
  float cs = cos(swirl);
  float sn = sin(swirl);
  Q.xz = mat2(cs, -sn, sn, cs) * Q.xz;

  vec3 R = uRot * Q;
  vec3 Nr = uRot * N;
  float zc = max(uCamDist - R.z, 0.05);
  vec2 ndc = R.xy * uFocal / zc;
  gl_Position = vec4(ndc * uNdcScale + uNdcOffset, 0.0, 1.0);

  // Shading: brighter and tinted where the surface turns away from the viewer (the outline),
  // dimmer where it faces away entirely (seen through the figure).
  vec3 V = normalize(vec3(0.0, 0.0, uCamDist) - R);
  float f = dot(Nr, V);
  float rim = pow(1.0 - abs(f), 1.5);
  float back = f < 0.0 ? mix(0.2, 1.0, smoothstep(-0.5, 0.0, f)) : 1.0;
  back = mix(1.0, back, e);
  float depth = mix(0.6, 1.0, smoothstep(-1.1, 0.5, R.z));
  float alpha = uAlpha * (0.32 + 0.68 * weight) * back * depth * (0.8 + 0.45 * rim);
  float glow = clamp(rim * 0.85 + (group > 2.5 ? 0.25 : 0.0) + (group > 1.5 && group < 2.5 ? 0.12 : 0.0), 0.0, 1.0);
  vec3 col = mix(uColPoint, uColGlow, glow * uGlowAmt);

  // Scattered points start faint and a little larger, then sharpen as they land.
  alpha *= smoothstep(0.0, 0.14, uT) * mix(0.35, 1.0, e);
  float size = uPointPx * (0.65 + 0.7 * weight) * (uCamDist / zc) * mix(1.35, 1.0, e);
  if (size < 1.25) {
    alpha *= (size / 1.25) * (size / 1.25);
    size = 1.25;
  }
  gl_PointSize = min(size, uMaxPx);
  vColor = vec4(col * alpha, alpha);
}
`;

export const FRAG = /* glsl */ `
precision mediump float;
varying vec4 vColor;
void main() {
  vec2 d = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(d, d);
  if (r2 > 1.0) discard;
  float a = 1.0 - smoothstep(0.2, 1.0, r2);
  gl_FragColor = vColor * a;
}
`;
