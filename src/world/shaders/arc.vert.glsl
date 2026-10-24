// arc.vert.glsl: the ribbon of the arc between the two lights (arc.ts). aUv.x runs 0 to 1 from
// Pomfret to Hong Kong, aUv.y -1 to 1 across the ribbon.

precision highp float;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec3 position;
in vec2 aUv;

out float vS;
out float vV;

void main() {
  vS = aUv.x;
  vV = aUv.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
