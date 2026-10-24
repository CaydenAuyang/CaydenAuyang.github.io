// peak.frag: a dark navy silhouette, with city-lit haze on its lower slopes.
uniform vec3 uPeak;
uniform vec3 uGlow;
uniform float uSkyFade;
uniform vec3 uFog;
varying vec3 vWorld;
void main() {
  float lowHaze = 1.0 - smoothstep(0.0, 300.0, vWorld.y);
  vec3 c = mix(uPeak, uGlow * 0.9, 0.28 * lowHaze);
  float dist = length(vWorld - cameraPosition);
  float fogF = 1.0 - exp(-max(0.0, dist - uFog.z) * uFog.y * 1.4);
  c = mix(c, uGlow, fogF * 0.35);
  gl_FragColor = vec4(c * mix(0.4, 1.0, uSkyFade), 1.0);
}
