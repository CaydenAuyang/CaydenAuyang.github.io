// tower.frag: facades, window grids and the lit rule, with haze toward the horizon glow.
// The window rule itself (nsHash and friends) is injected from windows.ts at NS_WINDOWS.

uniform float uTime;
uniform float uMotion;
uniform float uWake;
uniform vec2 uLift; // maxRank, amount
uniform vec3 uHi; // type (0 none, 1 och, 2 ais, 3 club), strength, wave position
uniform vec2 uCityX; // xMin, width
uniform vec3 uFog; // per meter behind the shore, per meter of distance, distance where it starts
uniform vec3 uGlow;
uniform vec3 uWarm;
uniform vec3 uCool;
uniform vec3 uFacade;
uniform vec3 uSpot[SPOTS]; // pointer spotlight trail: device px from the bottom left, strength
uniform float uSpotR; // spotlight radius, device px
uniform float uSpotOn;
uniform vec4 uPulse[PULSES]; // pulse wave origin (world), age in s (< 0: none)
uniform vec4 uPulseB[PULSES]; // ring center x, z; meters across the screen at the pulse
uniform float uPulseOn;
uniform vec4 uSpill; // video spill color, amount (0..0.2)
uniform vec3 uSpillAt; // video center (device px), falloff radius (px)

varying vec3 vWorld;
varying vec2 vCell;
flat varying vec4 vTower;
flat varying vec4 vGrid;
flat varying vec4 vSeg;
flat varying float vFace;
flat varying float vCols;

//#NS_WINDOWS
//#NS_PULSE
//#NS_SPILL

// The pulse wave at this fragment (0..1), set once in main before the window taps.
float gWave = 0.0;

const vec3 GLAZE[5] = vec3[5](
  vec3(0.19, 0.22, 0.78),
  vec3(0.03, 0.28, 0.76),
  vec3(0.12, 0.12, 0.90),
  vec3(0.28, 0.18, 0.84),
  vec3(0.14, 0.20, 0.82)
);

float cover1(float x, float a, float b, float w) {
  float lo = x - 0.5 * w;
  float hi = x + 0.5 * w;
  return clamp((min(hi, b) - max(lo, a)) / max(w, 1e-4), 0.0, 1.0);
}

// Project highlight: returns a brightness factor and widens the lit threshold T.
float highlight(int group, float across, inout int T) {
  if (uHi.y <= 0.0) return 1.0;
  if (uHi.x < 1.5) {
    float band = exp(-pow((across - uHi.z) / 0.055, 2.0));
    T += int(120.0 * band * uHi.y);
    return 1.0 + uHi.y * (0.18 + 0.9 * band);
  }
  bool mine = (uHi.x < 2.5) ? (group >= 1 && group <= 3) : (group == 4);
  if (mine) {
    T += int(105.0 * uHi.y);
    return 1.0 + 0.55 * uHi.y;
  }
  return 1.0 - 0.3 * uHi.y;
}

// Light from the window cell at c (columns, floors), box-filtered over a footprint fw.
// rgb is the light, a is the glass coverage.
vec4 windowAt(vec2 c, vec2 fw, float across, uint seed, uint faceSeg, int L, int group, vec3 g) {
  vec2 cell = floor(c);
  if (cell.x < 0.0 || cell.x >= vCols || cell.y < 0.0 || cell.y >= vSeg.y) return vec4(0.0);
  vec2 f = c - cell;
  float cover = cover1(f.x, g.x, 1.0 - g.x, fw.x) * cover1(f.y, g.y, g.z, fw.y);
  if (cover <= 0.0) return vec4(0.0);

  uint fl = uint(vGrid.w + 0.5) + uint(cell.y);
  uint col = uint(cell.x);
  uint wh = nsWindowHash(seed, faceSeg, fl, col);
  int T = nsFloorThreshold(seed, fl, L);
  float b = nsBright(wh);

  // Project highlights and pulses widen the lit set for a while; the base rule stays the same.
  int T2 = T + int(130.0 * gWave);
  b *= highlight(group, across, T2) * (1.0 + 0.6 * gWave);
  float state = nsLit(wh, T2) ? 1.0 : 0.0;

  if (uMotion > 0.5 && nsFlickers(wh)) {
    float per = 4.0 + float((wh >> 5u) & 7u);
    float s = fract(uTime / per + float(wh & 1023u) / 1023.0);
    float flick = smoothstep(0.5, 0.56, s) * (1.0 - smoothstep(0.94, 1.0, s));
    state = abs(state - flick);
  }
  if (state <= 0.0) return vec4(0.0, 0.0, 0.0, cover);

  if (uLift.y > 0.0 && vFace < 0.5 && nsRank(wh) < uLift.x) b *= 1.0 - uLift.y;

  // Wake: windows switch on left to right, with a little per-window noise.
  float wn = float((wh >> 4u) & 255u) / 255.0;
  float wakeT = across * 0.86 + wn * 0.12;
  float on = smoothstep(wakeT - 0.015, wakeT + 0.015, uWake * 1.06 - 0.02);

  vec3 lc = nsWarm(wh, T) ? uWarm : uCool;
  // Small differences between rooms: a slightly warmer or paler bulb, and blinds half drawn
  // in some windows (their light only fills the lower part of the glass).
  float tint = float((wh >> 20u) & 15u) / 15.0 - 0.5;
  lc = clamp(lc + vec3(0.04, 0.0, -0.06) * tint, 0.0, 1.0);
  if (((wh >> 12u) & 7u) == 0u) {
    float yb = g.y + (g.z - g.y) * 0.55;
    cover *= cover1(f.y, g.y, yb, fw.y) / max(cover1(f.y, g.y, g.z, fw.y), 1e-3);
  }
  return vec4(lc * (b * state * on * cover), cover);
}

void main() {
  float face = vFace;
  float kind = vSeg.x;
  float tone = 0.82 + 0.36 * vSeg.w;
  float sideShade = face < 0.5 ? 1.0 : (face < 1.5 || face > 2.5) ? 0.78 : 0.62;
  vec3 wall = uFacade * tone * sideShade;
  vec3 light = vec3(0.0);
  float across = (vWorld.x - uCityX.x) / uCityX.y;
  if (uPulseOn > 0.0) gWave = nsPulseWave(vWorld);

  if (face > 3.5) {
    wall = uFacade * 0.7;
  } else if (kind > 2.5) {
    // spire or mast: a slightly lighter steel catching the city glow
    wall = uFacade * 1.5 + uGlow * 0.12;
  } else if (kind > 1.5) {
    // plant floors: dark, with faint louvers
    float lv = step(0.5, fract(vCell.y * 3.0));
    wall *= 0.85 + 0.15 * lv;
  } else if (kind > 0.5) {
    // lit crown: vertical fins of light washed upward, cool on most, warm on some
    uint h = nsHash(uint(vTower.x + 0.5) ^ 0xc2b2ae35u);
    vec3 cc = (h & 3u) == 0u ? uWarm : uCool;
    float fx = abs(fract(vCell.x * 0.5) - 0.5) * 2.0;
    float fw2 = fwidth(vCell.x * 0.5) * 2.0 + 1e-3;
    float fin = 1.0 - smoothstep(0.3 - fw2, 0.3 + fw2, fx);
    fin = mix(fin, 0.3, smoothstep(0.5, 1.5, fw2));
    float hfrac = clamp(vCell.y / max(1.0, vSeg.y), 0.0, 1.0);
    float wash = 0.25 + 0.75 * hfrac * hfrac;
    float wakeT = across * 0.86 + 0.06;
    float on = smoothstep(wakeT - 0.02, wakeT + 0.02, uWake * 1.06 - 0.02);
    light = cc * 0.5 * fin * wash * on * (1.0 + 0.6 * gWave);
  } else {
    vec3 g = GLAZE[int(vTower.z + 0.5)];
    uint seed = uint(vTower.x + 0.5);
    uint faceSeg = uint(face + 0.5) + 8u * uint(vSeg.z + 0.5);
    int L = int(vTower.y + 0.5);
    int group = int(vTower.w + 0.5);
    vec2 dx = dFdx(vCell);
    vec2 dy = dFdy(vCell);
    vec2 fw = abs(dx) + abs(dy);
    vec4 acc = vec4(0.0);
#if TAPS == 4
    acc += windowAt(vCell + dx * -0.125 + dy * -0.375, fw * 0.5, across, seed, faceSeg, L, group, g);
    acc += windowAt(vCell + dx * 0.375 + dy * -0.125, fw * 0.5, across, seed, faceSeg, L, group, g);
    acc += windowAt(vCell + dx * 0.125 + dy * 0.375, fw * 0.5, across, seed, faceSeg, L, group, g);
    acc += windowAt(vCell + dx * -0.375 + dy * 0.125, fw * 0.5, across, seed, faceSeg, L, group, g);
    acc *= 0.25;
#else
    acc += windowAt(vCell + dx * -0.25 + dy * -0.25, fw * 0.7, across, seed, faceSeg, L, group, g);
    acc += windowAt(vCell + dx * 0.25 + dy * 0.25, fw * 0.7, across, seed, faceSeg, L, group, g);
    acc *= 0.5;
#endif
    // Far away a cell is smaller than a pixel. Across a floor, fade to that floor's average
    // light (so dark floors stay dark bands and office floors stay bright bands); when the
    // floors themselves get smaller than a pixel, fade to the segment's average.
    float miniX = smoothstep(0.8, 2.0, fw.x);
    float miniY = smoothstep(0.9, 2.2, fw.y);
    float mini = max(miniX, miniY);
    if (mini > 0.0) {
      float area = (1.0 - 2.0 * g.x) * (g.z - g.y);
      float wakeT = across * 0.86 + 0.06;
      float on = smoothstep(wakeT - 0.02, wakeT + 0.02, uWake * 1.06 - 0.02);
      float cy = floor(vCell.y);
      vec3 floorMean = vec3(0.0);
      if (cy >= 0.0 && cy < vSeg.y) {
        uint fl = uint(vGrid.w + 0.5) + uint(cy);
        int Tf = nsFloorThreshold(seed, fl, L) + int(130.0 * gWave);
        float hb = highlight(group, across, Tf) * (1.0 + 0.6 * gWave);
        vec3 fc = Tf >= 256 ? mix(uCool, uWarm, 0.35) : mix(uCool, uWarm, 0.8);
        float yin = cover1(fract(vCell.y), g.y, g.z, fw.y) / max(g.z - g.y, 1e-3);
        floorMean = fc * (0.92 * hb * clamp(float(Tf) / 256.0, 0.0, 1.0) * area * yin);
      }
      int Ts = L + int(130.0 * gWave);
      float hs = highlight(group, across, Ts) * (1.0 + 0.6 * gWave);
      float segShare = clamp(float(Ts) / 256.0, 0.0, 1.0) * 0.76 + 0.06;
      vec3 segMean = (uWarm * 0.8 + uCool * 0.2) * (0.92 * hs * segShare * area);
      vec3 mean = mix(floorMean, segMean, miniY) * on;
      if (uLift.y > 0.0 && face < 0.5) mean *= 1.0 - uLift.y * uLift.x;
      acc.rgb = mix(acc.rgb, mean, mini);
      acc.a = mix(acc.a, area, mini);
    }
    light = acc.rgb;
    // unlit glass is a little lighter and bluer than the wall
    wall = mix(wall, wall * 1.35 + uGlow * 0.05, acc.a);
    // street glow on the lowest floors of the front faces
    wall += uWarm * 0.025 * exp(-vWorld.y / 22.0) * step(face, 0.5);
  }

  // Spotlight: windows near the pointer's point on the skyline brighten (up to 60%) and warm,
  // cool ones shifting toward window amber.
  if (uSpotOn > 0.0) {
    float spot = 0.0;
    float k = 3.0 / (uSpotR * uSpotR);
    for (int i = 0; i < SPOTS; i++) {
      vec2 dd = gl_FragCoord.xy - uSpot[i].xy;
      spot = max(spot, uSpot[i].z * exp(-k * dot(dd, dd)));
    }
    float lum = dot(light, vec3(0.299, 0.587, 0.114));
    vec3 warmL = uWarm * (lum / dot(uWarm, vec3(0.299, 0.587, 0.114)));
    light = mix(light, warmL, 0.6 * spot) * (1.0 + 0.6 * spot);
  }
  // Video spill: the windows nearest the playing video take on a little of its color.
  if (uSpill.w > 0.0) light = nsSpill(light, nsSpillNear(gl_FragCoord.xy));

  float behind = max(0.0, -vWorld.z);
  float dist = length(vWorld - cameraPosition);
  float haze = behind * uFog.x + max(0.0, dist - uFog.z) * uFog.y;
  haze += 0.18 * (1.0 - smoothstep(0.0, 140.0, vWorld.y)) * smoothstep(60.0, 300.0, behind);
  float fogF = 1.0 - exp(-haze);
  vec3 color = mix(wall, uGlow, fogF) + light * (1.0 - 0.72 * fogF);
  gl_FragColor = vec4(color, 1.0);
}
