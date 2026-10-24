// stars.frag: a hot core with a soft halo, added on top of the sky.
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 7.0);
  float halo = (1.0 - r2) * 0.22;
  gl_FragColor = vec4(vColor * (core + halo), 1.0);
}
