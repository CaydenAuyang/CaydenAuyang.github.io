// lights.frag: a round light with a soft edge, added on top.
varying vec3 vColor;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 5.0);
  gl_FragColor = vec4(vColor * (core + 0.15 * (1.0 - r2)), 1.0);
}
