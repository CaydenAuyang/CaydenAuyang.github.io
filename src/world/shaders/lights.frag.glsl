// lights.frag: a round light with a soft edge, added on top. Aviation lights are a small solid red
// dot drawn over the sky behind them instead (premultiplied alpha, see peak.ts): red light added
// onto the blue-violet horizon haze reads rose, so the dot replaces the haze under it. It has no
// soft glow, since a faint red glow added onto the haze would ring the dot in violet.
varying vec3 vColor;
varying float vAvi;
void main() {
  vec2 q = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(q, q);
  if (r2 > 1.0) discard;
  if (vAvi > 0.0) {
    float d = 1.0 - smoothstep(0.38, 0.52, sqrt(r2));
    if (d <= 0.0) discard;
    // a slightly brighter centre, so the dot reads as a lamp and its peak sits in the middle
    gl_FragColor = vec4(vColor * d * (0.82 + 0.18 * exp(-r2 * 30.0)), pow(d, 0.2) * vAvi);
    return;
  }
  float core = exp(-r2 * 5.0);
  // alpha 0: added on top (the blending is premultiplied over, which adds when alpha is 0)
  gl_FragColor = vec4(vColor * (core + 0.15 * (1.0 - r2)), 0.0);
}
