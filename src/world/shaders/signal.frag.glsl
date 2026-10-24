// signal.frag.glsl: one point of light. A hot white core fading to the window color at the edge
// (the figure's and the Wisers pictures' dots: a crisp, even disc).
// Drawn with additive blending, so dense parts of a picture (the figure's outline, the hair) glow.

precision highp float;

in vec3 vColor;
in float vAlpha;
in float vCore;
in float vDot;

out vec4 fragColor;

void main() {
  vec2 c = gl_PointCoord * 2.0 - 1.0;
  float r2 = dot(c, c);
  if (r2 > 1.0) discard;
  float core = exp(-r2 * 7.0) * vCore;
  float body = (1.0 - r2) * (1.0 - r2);
  // The hot core is white at the point's own brightness (the figure has none).
  vec3 color = mix(vColor, vec3(1.0, 0.97, 0.92) * max(vColor.r, max(vColor.g, vColor.b)), core);
  // The figure's and the pictures' dots are crisp, even discs.
  float disc = 1.0 - smoothstep(0.35, 1.0, r2);
  fragColor = vec4(color, vAlpha * mix(0.5 * body + 0.7 * core, disc, vDot));
}
