// tower.vert: one instance per tower segment (a unit box with its base at y = 0).
attribute vec3 aPos; // center x, base y, center z
attribute vec3 aSize; // w, h, d
attribute vec4 aTower; // seed, L, glazing, group
attribute vec4 aGrid; // colsF, colsS, floorH, floorOffset
attribute vec4 aSeg; // kind, winFloors, segment index, facade tone

varying vec3 vWorld;
varying vec2 vCell; // x in columns across the face, y in floors up from the segment base
flat varying vec4 vTower;
flat varying vec4 vGrid;
flat varying vec4 vSeg;
flat varying float vFace;
flat varying float vCols;

void main() {
  vec3 p = aPos + position * aSize;
  float face = 5.0;
  float u = 0.0;
  if (normal.z > 0.5) { face = 0.0; u = position.x + 0.5; }
  else if (normal.x > 0.5) { face = 1.0; u = 0.5 - position.z; }
  else if (normal.z < -0.5) { face = 2.0; u = 0.5 - position.x; }
  else if (normal.x < -0.5) { face = 3.0; u = position.z + 0.5; }
  else if (normal.y > 0.5) { face = 4.0; }
  float cols = (face == 0.0 || face == 2.0) ? aGrid.x : aGrid.y;
  vCols = cols;
  vCell = vec2(u * cols, position.y * aSize.y / aGrid.z);
  vFace = face;
  vTower = aTower;
  vGrid = aGrid;
  vSeg = aSeg;
  vWorld = p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
