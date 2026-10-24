// stars.frag: a hot core with a soft halo, added on top of the sky. The core is a gaussian in
// pixels (never narrower than 0.6 px), so small stars keep their shape as they drift.
varying vec3 vColor;
varying vec3 vSz; // point size (px), core sigma (px), halo weight
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float d2 = r2 * 0.25 * vSz.x * vSz.x;
  float core = exp(-d2 / (2.0 * vSz.y * vSz.y));
  float halo = (1.0 - r2) * 0.22 * vSz.z;
  gl_FragColor = vec4(vColor * (core + halo), 1.0);
}
