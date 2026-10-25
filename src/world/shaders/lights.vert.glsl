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
varying float vAvi; // aviation lights: how much of the sky behind the dot it covers (0 for the rest)

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
  // the haze dims a far light; aviation red is only dimmed, not tinted, so it stays red
  float tint = (mode > 0.5 && mode < 1.5) ? 0.0 : 0.5;
  vColor = mix(aColor, uGlow, fogF * tint) * b * on * (1.0 - 0.6 * fogF);
  vAvi = (mode > 0.5 && mode < 1.5) ? b * on : 0.0;
  gl_PointSize = aInfo.x * uPixelRatio;
  // An aviation dot sits just above its roof or mast, so the roof would hide the lower half of
  // the round sprite: slide it 25 m toward the camera along the line of sight (it stays on the
  // same spot on screen, still behind the towers in front of it).
  if (mode > 0.5 && mode < 1.5) w.xyz += normalize(cameraPosition - w.xyz) * 25.0;
  gl_Position = projectionMatrix * viewMatrix * w;
}
