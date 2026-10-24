// stars.vert: points on the dome with a tiny slow rotation and a twinkle.
attribute float aSize;
attribute float aBright;
attribute float aPhase;
attribute vec3 aColor;
uniform float uTime;
uniform float uMotion;
uniform float uPixelRatio;
uniform float uSkyFade;
uniform vec3 uAxis;
varying vec3 vColor;

vec3 rotateAxis(vec3 p, vec3 a, float ang) {
  float c = cos(ang);
  float s = sin(ang);
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

void main() {
  float t = uTime * uMotion;
  vec3 p = rotateAxis(position, uAxis, t * 0.0012);
  float e = asin(clamp(normalize(p).y, -1.0, 1.0));
  // haze swallows stars near the horizon
  float haze = smoothstep(0.015, 0.32, e);
  float tw = 1.0 + uMotion * (0.3 * sin(t * (1.3 + aPhase * 2.4) + aPhase * 37.0) * sin(t * 0.37 + aPhase * 11.0));
  vColor = aColor * aBright * haze * tw * uSkyFade;
  gl_PointSize = aSize * uPixelRatio * (0.75 + 0.25 * haze);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
}
