// sky.vert: a dome that follows the camera, so the sky sits at infinity.
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
