// lights.vert: every small light in one draw: homes and roads on the Peak, the promenade along
// the shore, red aviation lights on the 20 tallest towers, and one slow ferry.
attribute vec3 aColor;
attribute vec4 aInfo; // size (px), mode (0 static, 1 aviation, 2 ferry), phase, wake position
uniform float uTime;
uniform float uMotion;
uniform float uPixelRatio;
uniform float uWake;
uniform vec3 uFerry; // x start, x span, seconds per crossing
uniform vec3 uGlow;
uniform vec3 uFog;
varying vec3 vColor;

void main() {
  vec3 p = position;
  float mode = aInfo.y;
  float b = 1.0;
  float t = uTime * uMotion;
  if (mode > 1.5) {
    // the ferry moves right to left (west), so its green starboard light faces us
    float s = fract(t / uFerry.z + 0.35);
    p.x = uFerry.x + uFerry.y * (1.0 - s) + p.x;
    b = smoothstep(0.0, 0.04, s) * (1.0 - smoothstep(0.96, 1.0, s));
  } else if (mode > 0.5) {
    // aviation: 1 s period, random phase; steady when motion is off
    float s = fract(t + aInfo.z);
    float blink = smoothstep(0.0, 0.06, s) * (1.0 - smoothstep(0.32, 0.5, s));
    b = mix(1.0, 0.06 + 0.94 * blink, uMotion);
  }
  float on = smoothstep(aInfo.w - 0.02, aInfo.w + 0.02, uWake * 1.06 - 0.02);
  vec4 w = modelMatrix * vec4(p, 1.0);
  float behind = max(0.0, -w.z);
  float dist = length(w.xyz - cameraPosition);
  float fogF = 1.0 - exp(-(behind * uFog.x + max(0.0, dist - uFog.z) * uFog.y));
  vColor = mix(aColor, uGlow, fogF * 0.5) * b * on * (1.0 - 0.6 * fogF);
  gl_PointSize = aInfo.x * uPixelRatio;
  gl_Position = projectionMatrix * viewMatrix * w;
}
