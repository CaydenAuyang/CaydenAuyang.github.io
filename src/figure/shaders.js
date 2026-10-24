// GLSL ES 1.00 shaders. WebGL2 accepts this version too, so one set covers both.
//
// The vertex shader does all per-point work: dequantizing, rotation, perspective, depth shading
// and the M1 assembly (two streams of points flying quadratic arcs from the Pomfret and Hong Kong
// ticks to their places). JavaScript only sets a handful of uniforms per frame.

export const VERT = /* glsl */ `
precision highp float;

attribute vec3 aPos;   // int16 normalized, -1..1
attribute vec2 aNrm;   // uint8 octahedral normal, 0..255
attribute float aAttr; // uint8: group in bits 0-1, weight in bits 2-7
attribute float aSeed; // uint8: assemble order, 0 first (outline first, face interior last)

uniform vec3 uCenter;     // dequantize: model = uCenter + aPos * uHalf
uniform vec3 uHalf;
uniform vec3 uPivot;      // model point the figure turns around
uniform float uScale;     // model units to view units
uniform mat3 uRot;        // yaw then pitch
uniform float uCamDist;
uniform float uFocal;     // 1 / tan(fov / 2)
uniform vec2 uNdcScale;
uniform vec2 uNdcOffset;
uniform vec2 uZRange;     // view space z of the farthest and nearest points
uniform float uSize;      // point diameter in device pixels at middle depth
uniform float uMaxPx;
uniform float uTime;      // ms since the assembly started; large once settled
uniform vec2 uOriginA;    // stream origins in NDC (Pomfret, left edge)
uniform vec2 uOriginB;    // (Hong Kong, right edge)
uniform float uAspect;    // canvas width / height
uniform vec3 uInk;
uniform vec3 uOrange;
uniform float uInkAlpha;
uniform float uAlphaFloor;

varying vec4 vColor;
varying float vSize;

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

// cubic-bezier(0.16, 1, 0.3, 1), the site's "settle" curve: solve x(u) = t, return y(u).
float settle(float t) {
  float u = t;
  for (int i = 0; i < 6; i++) {
    float iu = 1.0 - u;
    float x = 3.0 * iu * iu * u * 0.16 + 3.0 * iu * u * u * 0.3 + u * u * u;
    float dx = 3.0 * iu * iu * 0.16 + 6.0 * iu * u * (0.3 - 0.16) + 3.0 * u * u * (1.0 - 0.3);
    u = clamp(u - (x - t) / max(dx, 1e-4), 0.0, 1.0);
  }
  float iu = 1.0 - u;
  return 1.0 - iu * iu * iu;
}

void main() {
  vec3 model = uCenter + aPos * uHalf;
  vec3 R = uRot * ((model - uPivot) * uScale);
  float zc = max(uCamDist - R.z, 0.05);
  vec2 target = R.xy * uFocal / zc * uNdcScale + uNdcOffset;
  float near = clamp((R.z - uZRange.x) / max(uZRange.y - uZRange.x, 1e-4), 0.0, 1.0);
  // Surfaces facing away from the camera are hidden (fading in over -0.15..0.05), so the back of
  // the head does not show through the sparse face.
  vec3 V = normalize(vec3(0.0, 0.0, uCamDist) - R);
  float facing = smoothstep(-0.15, 0.05, dot(uRot * octDecode(aNrm), V));
  float weight = floor(aAttr / 4.0) / 63.0;

  // M1: split about 50/50 by a hash of the position (the seed byte carries timing, not stream).
  vec3 q = aPos * 1731.0 + vec3(aSeed * 0.731, aAttr * 0.193, 3.1);
  bool streamB = hash(q + 7.7) > 0.5;
  float delay = aSeed / 255.0 * 450.0;
  float dur = 1000.0 + 300.0 * hash(q + 17.17);
  float t = clamp((uTime - delay) / dur, 0.0, 1.0);
  float e = settle(t);

  // Quadratic arc in aspect-correct space, from a small cluster at the origin tick.
  vec2 asp = vec2(uAspect, 1.0);
  vec2 jitter = (vec2(hash(q + 41.41), hash(q + 53.9)) * 2.0 - 1.0) * 0.03;
  vec2 S = (streamB ? uOriginB : uOriginA) * asp + jitter;
  vec2 T = target * asp;
  vec2 d = T - S;
  float hb = hash(q + 29.3);
  float side = streamB ? -1.0 : 1.0; // both streams bow upward
  if (hb < 0.18) side = -side;
  vec2 C = (S + T) * 0.5 + vec2(-d.y, d.x) * side * (0.12 + 0.22 * hb);
  float ie = 1.0 - e;
  vec2 pos = t >= 1.0 ? target : (ie * ie * S + 2.0 * ie * e * C + e * e * T) / asp;
  // Points still waiting for their turn are parked outside the clip box (no fill cost).
  // Culled points too, since they would only vanish on landing.
  gl_Position = (t <= 0.0 || facing <= 0.0) ? vec4(2.0, 2.0, 2.0, 1.0) : vec4(pos, 0.0, 1.0);

  // Color: the Hong Kong stream starts orange and turns to ink over the last 25% of its flight;
  // 3% of its points stay orange.
  vec3 col = uInk;
  if (streamB) {
    float keep = hash(q + 67.1) < 0.03 ? 1.0 : 1.0 - smoothstep(0.75, 1.0, t);
    col = mix(uInk, uOrange, keep);
  }

  // Depth: far points lighter and smaller, near points darker and larger.
  float alpha = mix(uAlphaFloor, 0.95, near) * uInkAlpha * smoothstep(0.0, 0.06, t) * facing;
  float size = uSize * mix(0.75, 1.25, near) * (0.92 + 0.16 * weight);
  size = min(size, uMaxPx - 1.0);
  vSize = size;
  gl_PointSize = size + 1.0; // one extra pixel for the anti-aliased edge
  vColor = vec4(col * alpha, alpha);
}
`;

// Round disc with a crisp edge and a 1px anti-aliased ramp. Output is premultiplied.
export const FRAG = /* glsl */ `
precision mediump float;
varying vec4 vColor;
varying float vSize;
void main() {
  float dist = length(gl_PointCoord - 0.5) * (vSize + 1.0);
  float a = clamp(vSize * 0.5 - dist + 0.5, 0.0, 1.0);
  if (a <= 0.0) discard;
  gl_FragColor = vColor * a;
}
`;
