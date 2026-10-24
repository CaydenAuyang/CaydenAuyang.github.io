// lightshow.ts: the harbour light show (NIGHT-SIGNAL.md 11b.9), a nod to the harbour's nightly
// show. For 12 s a few slim searchlight beams sweep the sky from the roofs of the tallest towers
// (additive, soft, one draw call), while the windows pulse in rhythm, the pulses running across
// the skyline. lightShow(false) stops it at once. It only ever runs with motion on.

import { AdditiveBlending, BufferAttribute, BufferGeometry, Mesh, ShaderMaterial, Vector3, Vector4, type IUniform } from 'three';
import type { CityLayout } from './city';

const DURATION = 12;
const BEAMS = 6;
const LENGTH = 3200; // meters
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
uniform vec3 uDir[${BEAMS}];
uniform float uLength;
varying float vAlong;
varying float vSide;
varying float vBeam;
void main() {
  int i = int(aBeam + 0.5);
  vec3 base = uBase[i];
  vec3 dir = uDir[i];
  vec3 p = base + dir * (aAlong * uLength);
  // face the camera: widen across the view direction
  vec3 toCam = normalize(cameraPosition - p);
  vec3 side = normalize(cross(dir, toCam));
  float w = 4.0 + aAlong * uLength * 0.045;
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
  float along = pow(1.0 - vAlong, 1.6) * smoothstep(0.0, 0.015, vAlong);
  // a brighter knot where the beam leaves the roof
  float knot = exp(-vAlong * 60.0) * 1.5;
  vec3 c = mix(uCool, vec3(1.0), 0.5 + 0.5 * fract(vBeam * 0.37));
  gl_FragColor = vec4(c * (along * 0.22 + knot * 0.4) * across * uAlpha, 1.0);
}
`;

export interface LightShow {
  mesh: Mesh;
  readonly on: boolean;
  set(on: boolean): void;
  update(now: number, motion: boolean): void;
}

export function buildLightShow(city: CityLayout, U: ShowUniforms, cool: [number, number, number]): LightShow {
  // Sources: the roofs of the tallest towers, at least 4% of the city apart, so the beams spread.
  const tall = [...city.towers].sort((a, b) => b.roof - a.roof);
  const picked: typeof tall = [];
  for (const t of tall) {
    if (picked.length >= BEAMS) break;
    if (picked.every((p) => Math.abs(p.x - t.x) > city.width * 0.04)) picked.push(t);
  }
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
      uLength: { value: LENGTH },
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

  /** Where beam b points at time t (s): a slow sweep, the beams in pairs that cross and part. */
  const aim = (b: number, t: number, out: Vector3) => {
    const side = b % 2 === 0 ? 1 : -1;
    const ph = b * 0.9;
    const az = side * (0.35 + 0.45 * Math.sin(t * 0.55 + ph)) + 0.12 * Math.sin(t * 1.3 + ph * 2.0);
    const el = 1.05 + 0.25 * Math.sin(t * 0.8 + ph * 1.7);
    const ce = Math.cos(el);
    // az 0 points straight up-and-toward the harbour slightly, so beams lean over the water
    return out.set(Math.sin(az) * ce, Math.sin(el), Math.cos(az) * ce * 0.35).normalize();
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
      for (let b = 0; b < BEAMS; b++) aim(b, t, dirs[b]);
      mesh.visible = true;
    },
  };
}
