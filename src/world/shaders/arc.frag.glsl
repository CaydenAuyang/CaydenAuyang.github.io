// arc.frag.glsl: a thin line of light with pulses traveling along it. Each pulse is a bright head
// with a tail fading behind it; the line itself is faint (with motion off it is the whole arc,
// still, and lights up briefly on sendArc). The ends fade out inside the two lights.

precision highp float;

uniform float uHeads[3]; // each pulse's head along the arc (0..1.12), or below -1 when free
uniform float uDirs[3]; // each pulse's direction: 1 from Pomfret to Hong Kong, -1 back
uniform float uBase; // the still line's brightness
uniform float uFlash; // motion off: the line lit up after sendArc, 0..1
uniform float uPresence; // how much the two lights show, 0..1
uniform float uFadeEnd; // share of the arc inside each light, where it fades out
uniform vec3 uColor;

in float vS;
in float vV;

out vec4 fragColor;

void main() {
  float glow = exp(-vV * vV * 9.0);
  float core = exp(-vV * vV * 40.0);
  float ends = smoothstep(0.0, uFadeEnd * 1.6, vS) * (1.0 - smoothstep(1.0 - uFadeEnd * 1.6, 1.0, vS));
  float pulse = 0.0;
  for (int j = 0; j < 3; j++) {
    float d = uHeads[j] - (uDirs[j] > 0.0 ? vS : 1.0 - vS); // positive behind the head
    if (d > -0.03 && d < 0.45) {
      float tail = d >= 0.0 ? exp(-d / 0.055) : exp(-(d * d) / 0.00004);
      pulse = max(pulse, tail);
    }
  }
  float line = uBase + 0.55 * uFlash;
  float light = (line * glow + pulse * (0.5 * glow + 1.1 * core)) * ends * uPresence;
  vec3 color = mix(uColor, vec3(1.0, 0.97, 0.92), clamp(pulse * core, 0.0, 1.0));
  fragColor = vec4(color, light);
}
