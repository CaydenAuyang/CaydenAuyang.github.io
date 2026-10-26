// signal.vert.glsl: the signal's points. Every point carries a base position for the target it is
// leaving (position) and the one it is heading to (aTo); xyz is world space and w is a per-target
// value (brightness, or the current's phase). The shader adds each target's live motion, then
// flows between the two along a curved path with a per-point delay and curl noise that peaks
// mid-flight. Target ids: 0 A city, 1 B figure, 2 C current, 3 D archive, 4 E two lights, 5 F1
// feed, 6 F2 shoe, 7 G screen agent. The figure (B) places itself from its own attributes (the
// video-built point set). In the Wisers pictures (5 to 7) w packs the colour class (0 window,
// 1 cool, 2 white) and the brightness (see live()).

precision highp float;
precision highp int;

uniform mat4 modelViewMatrix;
uniform mat4 projectionMatrix;

in vec4 position;
in vec4 aTo;
in vec4 aRand; // x delay key, y size, z path, w phase (and D strays: w < uStray)
in vec4 aInfo; // x warm (1) or cool (0), y lift rank within the lifted windows (0..1), z archive column height (its share of the tallest), w archive column 1 to 12 (0: a stray)
// The figure (B), dot i of the video-built set (site-handoff/figure-video): its position in figure
// heights (y up from the bust's bottom edge, the yaw axis at x = z = 0, z toward the viewer), its
// surface normal, its own brightness and its colour hash (0..1, made on the CPU; see signal.ts).
in vec4 aShape; // the screen agent's loop (G): role (0 still, 1 box, 2 path, 3 cursor, 4 ripple) and its parameters
in vec3 aFigPos;
in vec3 aFigN;
in float aFigB;
in float aFigH;

uniform int uFrom;
uniform int uTo;
uniform float uT; // morph progress 0..1
uniform float uMotion; // 1 flowing, 0 cut at the midpoint and freeze live motion
uniform float uTime; // seconds of live motion
uniform float uDelaySrc; // 0 delay from aRand.x, 1 from the lift rank
uniform float uDelayFlip; // 1 reverses the delay order (so a reverse morph mirrors the forward one)
uniform float uScale; // world length of the scene (camera to the Central cluster)
uniform float uPixelRatio;
uniform float uGain;
uniform vec3 uWarm;
uniform vec3 uCool;

// Current (C): base positions sit low over the water at phase 0.5 of the flow, seen from the
// question pose (uFlowEye, uFlowFwd). Lengths scale with each point's depth from that eye, so the
// band crosses the screen at one speed and meanders at one screen size, near or far.
uniform vec3 uFlowEye;
uniform vec3 uFlowFwd;
uniform vec3 uFlowDir;
uniform float uFlowLenK; // band length per unit of depth (a bit wider than the view)
uniform vec2 uFlowScreen; // 1 / view half width and 1 / view half height, per unit of depth (waves are sized by the height, so a phone shows fewer of them)
uniform vec3 uFlowAmp; // meander size per unit of depth: across, up, along the view
uniform float uFlowSpeed; // phase per second
uniform float uWaterY;
// Archive (D): columns rise slowly and wrap.
uniform float uColBase;
uniform float uColHeight;
uniform float uRise; // rise per second, as a share of the tallest column
uniform float uStray; // share of D points drifting loose
uniform float uColAmt[12]; // each column's highlight, 0..1 (11b.3)
uniform float uColDim; // how far the columns that aren't highlighted dim, 0..1
// Two lights (E): their radius in world units.
uniform float uLightR;
// Figure (B): its frame in the world (the base centre, and the axes scaled to its height), the
// turn (setFigureTurn: yaw, positive turning the face to screen right; pitch, positive up), the
// heights where the neck blends the head's turn into the shoulders', how far the shoulders turn
// against the head, its dot size (CSS px), brightness, its two colours (gold and blue, display
// values) and the share of dots that are blue, and the scan (1 into the figure, crown first; -1
// out of it, shoulders first; 0 neither).
uniform vec3 uFigOrigin;
uniform mat3 uFigBasis;
uniform float uFigYaw;
uniform float uFigPitch;
uniform float uFigYChin;
uniform float uFigYNeckBase;
uniform float uFigTorsoRatio;
uniform float uFigDot;
uniform float uFigGain;
uniform vec3 uFigGold;
uniform vec3 uFigBlue;
uniform float uFigBlueShare;
uniform float uBackDot; // the backing disc's size (CSS px), wide enough to close the gaps between dots
uniform float uBackR; // the backing disc's radius in figure heights
uniform vec3 uBack; // the backing's colour (the night)
uniform float uScan;
// The Wisers pictures (F1, F2, G): the box's centre and its axes in the world (one box height
// each), the point size of each picture (CSS px), their brightness, the feed's loop (its lowest v,
// length, scroll speed in box heights a second, and the fade at the box's top and bottom), the
// screen agent's loop time (seconds into its 6 s) and the knots of the cursor's path (u, v).
uniform vec3 uPicOrigin;
uniform vec3 uPicX;
uniform vec3 uPicY;
uniform float uPicDot[3];
uniform float uPicGain;
uniform vec4 uFeed;
uniform float uAgentPhase;
uniform vec2 uAgentKnots[5];
// Brightness a point carries up from its window in flight, and how it is shared out: x the share
// of points that carry most of it, y their multiple of uCarry, z everyone else's, w how much
// larger the carriers draw in flight toward a dark target (the two lights' unlit points).
uniform float uCarry;
uniform vec4 uCarryMix;

out vec3 vColor;
out float vAlpha;
out float vCore;
out float vDot; // 1 for the figure's points (a crisp, even disc), 0 for the rest

const float SCAN = 0.3;
const float SCAN_JITTER = 0.1;
// The figure's soft key light, from the upper left (figure-video/figure-loader.ts).
const vec3 FIG_KEY = vec3(-0.3392, 0.4361, 0.8338);

// ---- Simplex noise with its gradient (Stefan Gustavson and Ian McEwan, webgl-noise, MIT) -------
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v, out vec3 gradient) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;
  vec4 m = max(0.5 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  vec4 m2 = m * m;
  vec4 m4 = m2 * m2;
  vec4 pdotx = vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3));
  vec4 temp = m2 * m * pdotx;
  gradient = -8.0 * (temp.x * x0 + temp.y * x1 + temp.z * x2 + temp.w * x3);
  gradient += m4.x * p0 + m4.y * p1 + m4.z * p2 + m4.w * p3;
  gradient *= 105.0;
  return 105.0 * dot(m4, pdotx);
}

// Divergence-free flow: the curl of three noise fields. Roughly unit length.
vec3 curl(vec3 p) {
  vec3 g1;
  vec3 g2;
  vec3 g3;
  snoise(p, g1);
  snoise(p + vec3(31.416, -47.853, 12.793), g2);
  snoise(p + vec3(-23.719, 11.137, 59.321), g3);
  return vec3(g3.y - g2.z, g1.z - g3.x, g2.x - g1.y) * 0.25;
}

const float TAU = 6.28318530718;

// The cursor's path: Catmull-Rom through the five box centres, as cubics (shapes/wisers.ts
// samples the same curve for the dotted path). u runs 0 to 4, one per segment.
vec2 knot(int i) {
  return uAgentKnots[clamp(i, 0, 4)];
}
vec2 agentPath(float u) {
  int i = int(clamp(floor(u), 0.0, 3.0));
  float t = clamp(u - float(i), 0.0, 1.0);
  vec2 p0 = knot(i - 1);
  vec2 p1 = knot(i);
  vec2 p2 = knot(i + 1);
  vec2 p3 = knot(i + 2);
  vec2 c1 = p1 + (p2 - p0) / 6.0;
  vec2 c2 = p2 - (p3 - p1) / 6.0;
  float s = 1.0 - t;
  return s * s * s * p1 + 3.0 * s * s * t * c1 + 3.0 * s * t * t * c2 + t * t * t * p2;
}
vec3 picWorld(vec2 uv) {
  return uPicOrigin + uPicX * uv.x + uPicY * uv.y;
}
vec3 classColor(float cls) {
  if (cls < 0.5) return uWarm;
  if (cls < 1.5) return uCool;
  return vec3(1.0, 0.97, 0.92);
}

// Live position of a point in target k from its base b. alpha is its brightness there; fade is
// the part of that which hides a wrap (the current and the columns loop), so a point in flight
// toward a wrapping target can hide its jump; size scales the point there.
vec3 live(int k, vec4 b, out float alpha, out float fade, out float size, out vec3 col) {
  fade = 1.0;
  size = 1.0;
  col = mix(uCool, uWarm, aInfo.x);
  float t = uTime;
  if (k == 0) {
    alpha = 0.0;
    return b.xyz;
  }
  if (k == 1) {
    // Figure (figure-video/README.md and figure-loader.ts). The head turns fully, the shoulders at
    // uFigTorsoRatio of it, and the neck blends between them; then the pitch, about (y 0.5, z 0).
    // Gold or blue, each dot's own brightness under a soft key light, and dots turning away fade.
    float headT = smoothstep(uFigYNeckBase, uFigYChin, aFigPos.y);
    float a = uFigYaw * mix(uFigTorsoRatio, 1.0, headT);
    float c = cos(a);
    float s = sin(a);
    vec3 q = vec3(aFigPos.x * c + aFigPos.z * s, aFigPos.y, -aFigPos.x * s + aFigPos.z * c);
    vec3 n = vec3(aFigN.x * c + aFigN.z * s, aFigN.y, -aFigN.x * s + aFigN.z * c);
    float cp = cos(uFigPitch);
    float sp = sin(uFigPitch);
    vec2 yz = vec2(q.y - 0.5, q.z);
    q.y = 0.5 + yz.x * cp - yz.y * sp;
    q.z = yz.x * sp + yz.y * cp;
    vec2 nyz = n.yz;
    n.y = nyz.x * cp - nyz.y * sp;
    n.z = nyz.x * sp + nyz.y * cp;
    float lam = clamp(dot(n, FIG_KEY), 0.0, 1.0);
    // Gold or blue like the lit windows: figure-loader.ts's stable hash of the dot's position
    // (aFigH, made once on the CPU so every GPU picks the same dots) makes about uFigBlueShare of
    // the dots blue (v4).
    col = (aFigH < uFigBlueShare ? uFigBlue : uFigGold) * aFigB * (0.35 + 0.65 * lam);
    alpha = smoothstep(-0.2, 0.25, n.z) * uFigGain * b.w;
    return uFigOrigin + uFigBasis * q;
  }
  if (k == 2) {
    // Current: drift along the band, meandering through curl noise, low over the water.
    float dep = max(dot(b.xyz - uFlowEye, uFlowFwd), 1.0);
    float s = fract(b.w + t * uFlowSpeed * (0.85 + 0.3 * aRand.y));
    vec3 p = b.xyz + uFlowDir * (s - 0.5) * uFlowLenK * dep;
    vec3 q = (p - uFlowEye) / dep;
    vec3 c = curl(vec3(dot(q, uFlowDir) * uFlowScreen.y * 0.9, q.y * uFlowScreen.y * 1.8, t * 0.035 + aRand.z * 0.12));
    p += (uFlowDir * c.x * uFlowAmp.x + vec3(0.0, c.y * uFlowAmp.y, 0.0) + uFlowFwd * c.z * uFlowAmp.z) * dep;
    p.y = max(p.y, uWaterY + 0.002 * dep);
    fade = smoothstep(0.0, 0.1, s) * (1.0 - smoothstep(0.9, 1.0, s));
    // The band is laid out for the question view. Seen from farther back (the camera still
    // dollying in), the water foreshortens and the band packs into a thin line that additive
    // light turns into a hot white bar; dim it by how much smaller the band's patch of water looks
    // from here than from the question view, so its light per pixel stays the same.
    vec3 eye = -transpose(mat3(modelViewMatrix)) * modelViewMatrix[3].xyz;
    float hc = max(eye.y - uWaterY, 0.5);
    float hq = max(uFlowEye.y - uWaterY, 0.5);
    vec3 dcv = p - eye;
    vec3 dqv = p - uFlowEye;
    float dc2 = dot(dcv.xz, dcv.xz);
    float dq2 = dot(dqv.xz, dqv.xz);
    float area = (hc / (dc2 + hc * hc)) / (hq / (dq2 + hq * hq)) * sqrt((dq2 + hq * hq) / (dc2 + hc * hc));
    alpha = (0.2 + 0.5 * aRand.y) * fade * clamp(area, 0.12, 1.0);
    return p;
  }
  if (k == 3) {
    // Highlight (11b.3): the hovered or tapped column brightens and the rest dim.
    int col = int(aInfo.w + 0.5) - 1;
    float hi = col >= 0 ? uColAmt[col] : 0.0;
    float light = (1.0 - 0.62 * uColDim * (1.0 - hi)) * (1.0 + hi);
    size = 1.0 + 0.2 * hi;
    if (aRand.w < uStray) {
      // Strays drift loose around the columns.
      vec3 p = b.xyz + curl(b.xyz * (3.0 / uScale) + vec3(t * 0.03)) * uScale * 0.05;
      alpha = b.w * light;
      return p;
    }
    // Columns: light rises slowly, at one speed in every column, and wraps at its own column's
    // top (aInfo.z, a share of the tallest), so each column keeps an even density all the way up
    // and its top stays exact. Only a sliver at each end fades, to hide the wrap.
    float top = aInfo.z;
    float h = mod((b.y - uColBase) / uColHeight + t * uRise, top);
    vec3 p = vec3(b.x, uColBase + h * uColHeight, b.z);
    fade = smoothstep(0.0, 0.012, h) * (1.0 - smoothstep(top - 0.006, top, h));
    alpha = b.w * fade * light;
    return p;
  }
  if (k == 4) {
    // Two lights: a slow swirl (sized by the lights' radius, so the core stays round) and a twinkle.
    vec3 p = b.xyz + curl(b.xyz * (0.35 / uLightR) + vec3(t * 0.06)) * uLightR * 0.05 * uMotion;
    alpha = b.w * (0.8 + 0.2 * sin(t * (1.1 + 1.7 * aRand.w) + aRand.z * TAU));
    return p;
  }
  {
    // The rest are the Wisers pictures (5 to 7): w is 4 * (offset + 512) + the colour class
    // (0 window, 1 cool, 2 white) + the brightness, where the offset (feed only) is the point's
    // height above its card's centre in thousandths of the box.
    float fw = floor(b.w + 1e-4);
    float cls = mod(fw, 4.0);
    col = classColor(cls);
    alpha = (b.w - fw) * uPicGain;
    vec3 p = b.xyz;
    if (k == 5) {
      // F1, the feed: it scrolls up like a feed, looping. Each card moves and fades in and out
      // as a whole by where its centre is (over a band at least half the tallest card), so no
      // card is ever cut by the box's edge and no stray edge of one floats alone.
      float v = dot(b.xyz - uPicOrigin, uPicY) / dot(uPicY, uPicY);
      float dv = (floor(fw / 4.0) - 512.0) / 1000.0;
      float vc = v - dv;
      float vc2 = uFeed.x + mod(vc + t * uFeed.z - uFeed.x, uFeed.y);
      float v2 = vc2 + dv;
      p = b.xyz + uPicY * (v2 - v);
      fade = smoothstep(-0.5, -0.5 + uFeed.w, vc2) * (1.0 - smoothstep(0.5 - uFeed.w, 0.5, vc2)) * step(-0.5, v2) * step(v2, 0.5);
      alpha *= fade;
    } else if (k == 7) {
      // G, the screen agent's 6 s loop: five boxes draw in one after another (the screen being
      // read), a dotted path through them (the plan), then the cursor travels it with a click
      // ripple at each box (the action); everything but the screen fades out at the end. Boxes in
      // cool, the path, cursor and ripples in white.
      int role = int(aShape.x + 0.5);
      float ph = uAgentPhase;
      float endFade = 1.0 - smoothstep(5.6, 5.95, ph);
      if (role == 1) {
        float pr = clamp((ph - 0.3 - 0.38 * aShape.z) / 0.35, 0.0, 1.0);
        alpha *= step(aShape.y, pr) * endFade;
      } else if (role == 2) {
        float pr = clamp((ph - 2.3) / 0.7, 0.0, 1.0);
        alpha *= step(aShape.y, pr) * endFade;
      } else if (role == 3) {
        float ct = max(ph - 3.1, 0.0);
        float seg = floor(ct / 0.55);
        float u = seg >= 4.0 ? 4.0 : seg + smoothstep(0.1, 0.75, fract(ct / 0.55));
        p = picWorld(agentPath(u) + aShape.yz);
        alpha *= smoothstep(2.85, 3.05, ph) * endFade;
      } else if (role == 4) {
        float bi = aShape.z;
        float tc = bi < 0.5 ? 3.1 : 3.1 + 0.55 * (bi - 1.0) + 0.4125;
        float age = ph - tc;
        float on = step(0.0, age) * (1.0 - smoothstep(0.35, 0.6, age));
        float r = (0.012 + 0.09 * clamp(age, 0.0, 0.6)) * (1.0 + 0.55 * aShape.w);
        p = picWorld(uAgentKnots[int(bi + 0.5)] + vec2(cos(aShape.y), sin(aShape.y)) * r);
        alpha *= on;
      }
    }
    return p;
  }
}

float easeInOut(float p) {
  return p < 0.5 ? 2.0 * p * p : 1.0 - 2.0 * (1.0 - p) * (1.0 - p);
}

void main() {
  // Per-point progress: a delay of up to 30% of the transition, then 70% to travel. Into and out
  // of the figure, a scan instead: it gathers from the crown down and leaves from the shoulders
  // up, with a little randomness.
  float key = mix(aRand.x, aInfo.y, uDelaySrc);
  key = mix(key, 1.0 - key, uDelayFlip);
  float p = clamp((uT - 0.3 * key) / 0.7, 0.0, 1.0);
  if (uScan != 0.0) {
    float fy = clamp(aFigPos.y, 0.0, 1.0);
    float delay = SCAN * (uScan > 0.0 ? 1.0 - fy : fy) + SCAN_JITTER * aRand.x;
    p = clamp((uT - delay) / (1.0 - SCAN - SCAN_JITTER), 0.0, 1.0);
  }
  float e = easeInOut(p);
  if (uMotion < 0.5) {
    p = step(0.5, uT);
    e = p;
  }
  // The current rising into the columns (or falling back): a long flight from near the camera to
  // far behind the skyline, tuned on its own below so its light stays in the window.
  bool curCols = (uFrom == 2 && uTo == 3) || (uFrom == 3 && uTo == 2);

  float aF;
  float fF;
  float sF;
  vec3 cF;
  float aT;
  float fT;
  float sT;
  vec3 cT;
  vec3 P0 = live(uFrom, position, aF, fF, sF, cF);
  vec3 P1 = P0;
  aT = aF;
  fT = fF;
  sT = sF;
  cT = cF;
  if (uTo != uFrom) P1 = live(uTo, aTo, aT, fT, sT, cT);

  vec3 pos = P0;
  float flight = 0.0;
  if (e >= 1.0) {
    pos = P1;
  } else if (e > 0.0) {
    vec3 d = P1 - P0;
    float L = length(d);
    vec3 dir = d / max(L, 1e-4);
    // Bend sideways from the path. The basis shrinks smoothly to nothing for vertical paths
    // instead of flipping, so a target that moves (the current) never makes a path jump.
    vec3 s1 = cross(dir, vec3(0.0, 1.0, 0.0));
    vec3 s2 = cross(s1, dir);
    // Neighbours bend the same way (noise of where they start), with a little spread.
    vec3 gb;
    float nb = snoise(P0 * (1.4 / uScale) + vec3(5.2), gb);
    float ang = TAU * (0.5 * nb + 0.12 * aRand.z);
    vec3 ctrl = 0.5 * (P0 + P1) + (s1 * cos(ang) + s2 * sin(ang)) * L * (0.12 + 0.16 * aRand.z);
    // The current lies on the water, nearer the camera than anything it comes from or goes to: a
    // straight path would skim the water far out and bunch every point into one bright line at
    // the horizon. So points come forward first and drop onto it from above (and leave it rising
    // first). Between the current and the columns the bend sits halfway up and nearly back at the
    // columns' depth: rising to their full height at the current's own depth, so near the camera,
    // the light went above the top of a wide window for a stretch.
    float back = curCols ? 0.95 : 0.0;
    float rise = curCols ? 0.5 : 1.0;
    if (uTo == 2 && uFrom != 2) ctrl = mix(ctrl, vec3(P1.x, mix(P1.y, P0.y, rise), mix(P1.z, P0.z, back)), 0.8);
    if (uFrom == 2 && uTo != 2) ctrl = mix(ctrl, vec3(P0.x, mix(P0.y, P1.y, rise), mix(P0.z, P1.z, back)), 0.8);
    float u = 1.0 - e;
    pos = u * u * P0 + 2.0 * u * e * ctrl + e * e * P1;
    flight = sin(3.14159265 * e);
    // Each point reads the noise a little off its neighbours' (aRand), so a long hold mid-flight
    // can't fold the cloud into a bright seam where the drifting field steepens.
    // Low into and out of the figure (20% in, 30% out), so it lands cleanly. Between the current
    // and the columns, half as strong and twice as fine: over that long flight the broad field
    // carried the whole cloud out of the top of the window or down among the towers, depending on
    // the moment, where the finer one breaks it into plumes.
    float curlK = uTo == 1 ? 0.2 : uFrom == 1 ? 0.3 : (uFrom >= 5 || uTo >= 5) ? 0.6 : curCols ? 0.5 : 1.0;
    float curlF = curCols ? 4.4 : 2.2;
    pos += curl(pos * (curlF / uScale) + vec3(0.0, 0.0, uTime * 0.04 + 3.7) + (aRand.zxw - 0.5) * 0.3) * min(L, uScale * 0.6) * 0.16 * flight * curlK;
  }

  // Brightness through the flight. Leaving the figure, a point settles to its target's brightness
  // early (so the current doesn't flare as the figure's light lands on its thin band). Between the
  // current and the columns it carries the columns' brightness for most of the way: points shrink
  // as they go back from the camera, and with the current's own dim light the cloud thinned to a
  // faint haze in the middle of the rise. (Scrolling back up plays C to D backwards; the D to C
  // line is for a morph set that way, as the lab page can.)
  float ae = e;
  if (uFrom == 1 && uTo != 1) ae = smoothstep(0.0, 0.6, e);
  if (uFrom == 2 && uTo == 3) ae = smoothstep(0.0, 0.4, e);
  if (uFrom == 3 && uTo == 2) ae = smoothstep(0.6, 1.0, e);
  float alpha = mix(aF, aT, ae);
  // Leaving the city, a point carries its window's light up through the flight (it brightens
  // quickly as its window dims) and settles to the target's own brightness near the end, so the
  // city visibly gives its light to the sky even where the target is sparse (the two lights light
  // only 30% of their points). Coming back, it gathers that light on the way down and hands it to
  // its window as it lands.
  // Some of the points carry most of it, so it rises as sparks rather than a faint haze (on
  // desktop a quarter, and the total stays the window's light: 0.25 * 3.2 + 0.75 * 0.27 = 1;
  // phones, with fewer and smaller points, send up more and brighter sparks so the spray reads).
  float carrier = step(1.0 - uCarryMix.x, aRand.w);
  float carry = uCarry * mix(uCarryMix.z, uCarryMix.y, carrier);
  float carrying = 0.0;
  // Bright targets (the figure, the columns) keep their own brightness all the way.
  if (uFrom == 0 && uTo != 0) {
    carrying = (1.0 - smoothstep(0.55, 0.95, p)) * smoothstep(0.0, 0.12, p);
    alpha = mix(max(carry, aT), aT, smoothstep(0.55, 0.95, p)) * smoothstep(0.0, 0.12, p);
  }
  if (uTo == 0 && uFrom != 0) {
    carrying = smoothstep(0.05, 0.45, p) * (1.0 - smoothstep(0.88, 1.0, p));
    alpha = mix(aF, max(carry, aF), smoothstep(0.05, 0.45, p)) * (1.0 - smoothstep(0.88, 1.0, p));
  }
  // Carriers draw a little larger while they carry, toward or from a dark end only.
  float darkEnd = 1.0 - smoothstep(0.0, 0.3, uFrom == 0 ? aT : aF);
  float carrySize = mix(1.0, uCarryMix.w, carrying * carrier * darkEnd);
  // Hide wraps: the target's own fade applies once the point is on its way there.
  alpha *= mix(1.0, fT, smoothstep(0.0, 0.03, e)) * mix(1.0, fF, smoothstep(0.0, 0.03, 1.0 - e));
  // A little brighter in flight; less between the current and the columns, which already carry
  // the columns' light (with the full lift the cloud outshone the finished columns).
  alpha *= (1.0 + (curCols ? 0.15 : 0.35) * flight) * uGain;

  vColor = mix(cF, cT, e);
  vAlpha = alpha;
  // One core for every point in the figure; elsewhere each point's own.
  float core = 0.55 + 0.45 * aRand.y;
  // The figure and the Wisers pictures are crisp, even dots: the figure with no white core, the
  // pictures with a faint one.
  bool tidyF = uFrom == 1 || uFrom >= 5;
  bool tidyT = uTo == 1 || uTo >= 5;
  vCore = mix(uFrom == 1 ? 0.0 : tidyF ? 0.3 : core, uTo == 1 ? 0.0 : tidyT ? 0.3 : core, e);
  vDot = mix(tidyF ? 1.0 : 0.0, tidyT ? 1.0 : 0.0, e);

  // The figure's backing (signal.ts): a dark disc under every figure dot, drawn before the light,
  // so the stars and the searchlight's haze behind him don't show through. Only the B end counts,
  // and only once a dot has landed (or before it leaves), so nothing dark flies.
  float onB = clamp((uTo == 1 ? smoothstep(0.8, 1.0, e) : 0.0) + (uFrom == 1 ? 1.0 - smoothstep(0.0, 0.2, e) : 0.0), 0.0, 1.0);
  onB *= step(0.5, uTo == 1 ? aTo.w : position.w);
  // Light adds to the backing under it, so a figure dot adds only what takes the backing to the
  // dot's own colour: a lone dot at full brightness and key light shows its hex exactly.
  vColor = max(vColor - uBack * onB, 0.0);

#ifdef BACKING
  vAlpha = onB;
  if (onB < 0.01) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  // Opaque discs wide enough that neighbours overlap. So the backing never spills past the
  // silhouette as a dark halo, each disc moves inward by its radius along the dot's normal as seen
  // on screen (a dot on the shoulder's top moves down, one on the cheek's edge moves in), shrinks
  // a little where the surface is seen edge on, and never reaches below the bust's cut.
  float headT = smoothstep(uFigYNeckBase, uFigYChin, aFigPos.y);
  float ya = uFigYaw * mix(uFigTorsoRatio, 1.0, headT);
  vec3 bn = vec3(aFigN.x * cos(ya) + aFigN.z * sin(ya), aFigN.y, -aFigN.x * sin(ya) + aFigN.z * cos(ya));
  bn = vec3(bn.x, bn.y * cos(uFigPitch) - bn.z * sin(uFigPitch), bn.y * sin(uFigPitch) + bn.z * cos(uFigPitch));
  float size = mix(0.55, 1.0, smoothstep(0.05, 0.3, abs(bn.z))) * clamp(aFigPos.y / uBackR, 0.3, 1.0);
  vec3 bpos = pos - uFigBasis * vec3(bn.xy * uBackR * size, 0.0);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(bpos, 1.0);
  gl_PointSize = uBackDot * size * uPixelRatio;
  return;
#endif

  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  if (alpha < 0.002) {
    // Nothing to draw: move it outside the clip volume so it costs no fragments.
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    gl_PointSize = 0.0;
    return;
  }
  gl_Position = projectionMatrix * mv;
  // 1.5 to 3.5 CSS px: bigger for brighter points and for nearer ones, a little bigger in flight.
  // The figure's dots are all one size.
  float px = mix(1.5, 3.1, clamp(0.35 * aRand.y + 0.65 * min(alpha / max(uGain, 1e-3), 1.0), 0.0, 1.0));
  px = clamp(px * clamp(uScale / max(-mv.z, 1.0), 0.75, 1.4) * (1.0 + 0.15 * flight), 1.5, 3.5);
  float pxF = uFrom == 1 ? uFigDot : uFrom >= 5 ? uPicDot[uFrom - 5] : px * sF;
  float pxT = uTo == 1 ? uFigDot : uTo >= 5 ? uPicDot[uTo - 5] : px * sT;
  gl_PointSize = mix(pxF, pxT, e) * carrySize * uPixelRatio;
}
