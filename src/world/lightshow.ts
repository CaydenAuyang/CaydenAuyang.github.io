// lightshow.ts: the harbour light show (NIGHT-SIGNAL.md 11b.9), a nod to the harbour's nightly
// show. For 12 s a few slim searchlight beams sweep the sky from the roofs of the tallest towers
// (additive, soft, one draw call), while the windows pulse in rhythm, the pulses running across
// the skyline, and a soft glow along the bottom of the frame pulses with them (sky.frag), so the
// show reads even from Contact, whose camera sees only sky: the city lighting up below. The beams
// sweep through whatever sky is in view: each one aims at a point that moves through the frame.
// lightShow(false) stops it at once. It only ever runs with motion on.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4, type IUniform, type PerspectiveCamera } from 'three';
import type { CityLayout } from './city';

const DURATION = 12;
const BEAMS = 6;
/** How far ahead of the camera the beams' aim points sit (m), and how far past them a beam runs. */
const AIM_DIST = 4200;
const OVERSHOOT = 1.35;
/** One beat of the window pulses, in seconds (100 bpm). */
const BEAT = 0.6;

export interface ShowUniforms {
  /** x: strength 0..1 (0 when no show), y: seconds into the show, z: seconds per beat. */
  uShow: IUniform<Vector4>;
}

export function showUniforms(): ShowUniforms {
  return { uShow: { value: new Vector4(0, 0, BEAT, 0) } };
}

/**
 * The window pulse at a point across the skyline (0 left, 1 right), 0..1: sharp beats running left
 * to right, two per sweep of the city. Needs uShow declared before it.
 */
export const SHOW_GLSL = /* glsl */ `
float nsShowBeat(float across) {
  if (uShow.x <= 0.0) return 0.0;
  float ph = uShow.y / uShow.z - across * 2.0;
  float beat = pow(0.5 + 0.5 * cos(6.2831853 * ph), 6.0);
  return uShow.x * beat;
}
`;

const vert = /* glsl */ `
attribute float aBeam;
attribute float aAlong; // 0 at the roof, 1 at the far end
attribute float aSide; // -1 or 1 across the beam
uniform vec3 uBase[${BEAMS}];
uniform vec3 uDir[${BEAMS}]; // direction times length
varying float vAlong;
varying float vSide;
varying float vBeam;
void main() {
  int i = int(aBeam + 0.5);
  vec3 base = uBase[i];
  vec3 dir = uDir[i];
  float len = length(dir);
  vec3 p = base + dir * aAlong;
  dir /= len;
  // face the camera: widen across the view direction
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam));
  float w = 4.0 + aAlong * len * 0.03;
  p += side * aSide * w;
  vAlong = aAlong;
  vSide = aSide;
  vBeam = aBeam;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}
`;

const frag = /* glsl */ `
uniform float uAlpha;
uniform vec3 uCool;
varying float vAlong;
varying float vSide;
varying float vBeam;
void main() {
  float across = exp(-vSide * vSide * 4.0);
  // bright all the way up, fading only over the last third (past the aim point)
  float along = (1.0 - 0.45 * vAlong) * (1.0 - smoothstep(0.7, 1.0, vAlong)) * smoothstep(0.0, 0.015, vAlong);
  // a brighter knot where the beam leaves the roof
  float knot = exp(-vAlong * 60.0) * 1.5;
  vec3 c = mix(uCool, vec3(1.0), 0.5 + 0.5 * fract(vBeam * 0.37));
  gl_FragColor = vec4(c * (along * 0.28 + knot * 0.4) * across * uAlpha, 1.0);
}
`;

export interface LightShow {
  mesh: Mesh;
  readonly on: boolean;
  set(on: boolean): void;
  update(now: number, motion: boolean): void;
}

export function buildLightShow(city: CityLayout, U: ShowUniforms, cool: [number, number, number], camera: PerspectiveCamera): LightShow {
  // Sources: the roofs of the tallest towers, at least 4% of the city apart, so the beams spread.
  const tall = [...city.towers].sort((a, b) => b.roof - a.roof);
  const picked: typeof tall = [];
  for (const t of tall) {
    if (picked.length >= BEAMS) break;
    if (picked.every((p) => Math.abs(p.x - t.x) > city.width * 0.04)) picked.push(t);
  }
  // left to right, so each beam's lane in the frame is on its own side
  picked.sort((a, b) => a.x - b.x);
  const bases = picked.map((t) => new Vector3(t.x, t.roof + 2, t.z));
  while (bases.length < BEAMS) bases.push(bases[bases.length - 1].clone());

  const per = 4;
  const aBeam = new Float32Array(BEAMS * per);
  const aAlong = new Float32Array(BEAMS * per);
  const aSide = new Float32Array(BEAMS * per);
  const idx: number[] = [];
  for (let b = 0; b < BEAMS; b++) {
    const o = b * per;
    [
      [0, -1],
      [0, 1],
      [1, -1],
      [1, 1],
    ].forEach(([al, sd], k) => {
      aBeam[o + k] = b;
      aAlong[o + k] = al;
      aSide[o + k] = sd;
    });
    idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
  }
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(BEAMS * per * 3), 3));
  g.setAttribute('aBeam', new BufferAttribute(aBeam, 1));
  g.setAttribute('aAlong', new BufferAttribute(aAlong, 1));
  g.setAttribute('aSide', new BufferAttribute(aSide, 1));
  g.setIndex(idx);
  const dirs = bases.map(() => new Vector3(0, 1, 0));
  const mat = new ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uBase: { value: bases },
      uDir: { value: dirs },
      uAlpha: { value: 0 },
      uCool: { value: new Vector3(...cool) },
    },
    blending: AdditiveBlending,
    depthWrite: false,
    transparent: true,
  });
  const mesh = new Mesh(g, mat);
  mesh.frustumCulled = false;
  mesh.visible = false;
  mesh.name = 'light-show';

  let start = -1;
  let on = false;

  /**
   * Where beam b points at time t (s): at a point in the sky in view that sweeps through the frame,
   * each beam in its own lane, the lanes swinging wide enough that neighbours cross.
   */
  const target = new Vector3();
  const aim = (b: number, t: number, out: Vector3) => {
    const lane = ((b + 0.5) / BEAMS) * 2 - 1;
    const x = lane * 0.75 + 0.38 * Math.sin(t * 0.85 + b * 1.3);
    const y = 0.42 + 0.32 * Math.sin(t * 0.55 + b * 0.9);
    target.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize().multiplyScalar(AIM_DIST).add(camera.position);
    // never aim below the roof: the beams always rise
    if (target.y < bases[b].y + 200) target.y = bases[b].y + 200;
    return out.subVectors(target, bases[b]).multiplyScalar(OVERSHOOT);
  };

  return {
    mesh,
    get on() {
      return on;
    },
    set(next) {
      if (next) {
        on = true;
        start = -1; // starts on the next frame
      } else {
        on = false;
        start = -1;
        U.uShow.value.x = 0;
        (mat.uniforms.uAlpha as IUniform<number>).value = 0;
        mesh.visible = false;
      }
    },
    update(now, motion) {
      if (!on || !motion) {
        if (on && !motion) on = false;
        U.uShow.value.x = 0;
        mesh.visible = false;
        return;
      }
      if (start < 0) start = now;
      const t = (now - start) / 1000;
      if (t >= DURATION) {
        on = false;
        start = -1;
        U.uShow.value.x = 0;
        mesh.visible = false;
        return;
      }
      // in over 0.8 s, out over the last 1.2 s
      const env = Math.min(1, t / 0.8) * Math.min(1, (DURATION - t) / 1.2);
      U.uShow.value.set(env, t, BEAT, 0);
      (mat.uniforms.uAlpha as IUniform<number>).value = env;
      camera.updateMatrixWorld();
      for (let b = 0; b < BEAMS; b++) aim(b, t, dirs[b]);
      mesh.visible = true;
    },
  };
}
