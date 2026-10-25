// contract.ts: the agreement between the three parts of the night scene.
//
//   - the world (renderer, camera path, sky, Peak, skyline, harbour, tiering): src/world/*.ts
//   - the signal (the particle system that moves between the city and the pictures): signal.ts
//   - the timeline (scroll, intro, pins, snapshot): timeline.ts and main.ts
//
// Each part only talks to the others through the types and constants in this file. Owned by the
// lead: change it only by agreement, and keep every implementation in step when it changes.
// Spec: site-handoff/NIGHT-SIGNAL.md (sections 4 to 6).

import type * as THREE from 'three';
import { archive } from '../data/content';

// ---- Scenes and camera ----------------------------------------------------------------------

/** One key per place the camera stops, in page order. */
export type SceneKey =
  | 'hero' // wide on the skyline from the Kowloon side, about 12 m above the water
  | 'question' // dollied forward and down toward the water
  | 'experience' // panned right toward the tallest (Central) cluster
  | 'wisers' // holding near the experience view, drifting slightly, while the Wisers pictures draw
  | 'och' // work stop 1: OurCityHealth
  | 'ais' // work stop 2: AI Simply
  | 'club' // work stop 3: Civic AI Club (the compact low-rise block at the far left)
  | 'more' // the More work cards
  | 'since' // tilted up from the city into the stars
  | 'people' // holding on the sky
  | 'contact'; // holding on the sky, pulled back slightly

export const SCENE_ORDER: SceneKey[] = ['hero', 'question', 'experience', 'wisers', 'och', 'ais', 'club', 'more', 'since', 'people', 'contact'];

export interface CameraPose {
  position: THREE.Vector3;
  quaternion: THREE.Quaternion;
  fov: number;
}

/**
 * The twelve Civic Exchange notebooks and their real document counts (content.md, Experience),
 * left to right. Target D's columns are sized by these, so they are an honest bar chart.
 */
export const ARCHIVE: readonly { topic: string; count: number }[] = archive.columns;

// ---- Tiers ----------------------------------------------------------------------------------

export type Tier = 'high' | 'low' | 'phone';

export interface TierInfo {
  tier: Tier;
  dprCap: number; // 1.75 desktop, 1.5 phone
  stars: number; // about 12,000 desktop, 4,000 phone
  towers: number; // about 260 desktop, 110 phone
  points: number; // 60,000 high, 30,000 low, 16,000 phone
}

// ---- Screen anchors -------------------------------------------------------------------------
// Where pictures sit on screen, as fractions of the viewport (x from the left, y from the top),
// so the HTML can lay text out around them. The signal builds its targets from these through the
// camera pose of the matching scene key.

/**
 * The figure (target B) at the hero key: its center, and its height as a share of viewport height.
 * Desktop puts it in the right half of the sky, as before v3 (spec v3 item 12), so the hero text
 * sits in a column to its left, ending above the tower tops; phones stack the figure above the text.
 */
export const FIGURE_ANCHOR = {
  desktop: { x: 0.64, y: 0.36, height: 0.5 },
  phone: { x: 0.5, y: 0.22, height: 0.26 },
};

/**
 * Hero framing the world's camera must hit at the hero key: the tallest tower tops sit at
 * skylineTop and the waterline at horizon (fractions of viewport height from the top). Hero text
 * stays above skylineTop, over dark sky, with the skyline and harbour as a band along the bottom.
 */
export const HERO_FRAMING = {
  desktop: { skylineTop: 0.82, horizon: 0.92 },
  phone: { skylineTop: 0.83, horizon: 0.92 },
};

/** Phones use the phone anchors and framing below this width (CSS px). */
export const PHONE_MAX_WIDTH = 767;

/**
 * Whether a viewport uses the phone anchors and framing: phones, and portrait screens under
 * 1024px wide (portrait tablets, square counting as portrait, as in CSS), where the desktop
 * layout would put the figure under the name.
 * CSS twin: @media (max-width: 767px), (max-width: 1023px) and (orientation: portrait).
 */
export function usePhoneLayout(width: number, height: number): boolean {
  return width <= PHONE_MAX_WIDTH || (width < 1024 && height >= width);
}

/**
 * The Wisers pictures (targets F1 feed, F2 shoe, G screen agent) at the wisers key: the box they
 * fit in, as viewport fractions (center and size). Desktop draws them in the sky left of the text
 * (where the archive columns stand); phones above the text. The page keeps its text clear of it.
 */
export const WISERS_ANCHOR = {
  desktop: { x: 0.3, y: 0.4, width: 0.4, height: 0.56 },
  phone: { x: 0.5, y: 0.3, width: 0.84, height: 0.36 },
  /** Phones shorter than SHORT_PHONE_HEIGHT, where the held Wisers text needs more of the screen. */
  phoneShort: { x: 0.5, y: 0.26, width: 0.84, height: 0.28 },
};
/** Below this window height (CSS px) phones use WISERS_ANCHOR.phoneShort. */
export const SHORT_PHONE_HEIGHT = 800;

/** The Wisers box for a window size, as a ScreenBox (viewport fractions). */
export function wisersBox(width: number, height: number): ScreenBox {
  const a = !usePhoneLayout(width, height) ? WISERS_ANCHOR.desktop : height < SHORT_PHONE_HEIGHT ? WISERS_ANCHOR.phoneShort : WISERS_ANCHOR.phone;
  return { x0: a.x - a.width / 2, y0: a.y - a.height / 2, x1: a.x + a.width / 2, y1: a.y + a.height / 2 };
}

/** The two lights (target E) at the contact key. Pomfret is west, so it sits on the left. */
export const LIGHT_ANCHORS = {
  pomfret: { x: 0.14, y: 0.3 },
  hongKong: { x: 0.86, y: 0.3 },
};

// ---- Screen positions -----------------------------------------------------------------------

/** A point on screen in normalized device coordinates: x -1 (left) to 1 (right), y -1 (bottom) to 1 (top). */
export interface Ndc {
  x: number;
  y: number;
}

/** A box on screen as fractions of the viewport (x from the left, y from the top). */
export interface ScreenBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** An RGB color, each channel 0 to 1. */
export type Rgb = [number, number, number];

// ---- The world ------------------------------------------------------------------------------

/** Lit-window samples on the towers' front faces, for the signal's city state (target A). */
export interface LitWindowSamples {
  count: number;
  /** World-space centers of lit window cells, xyz interleaved. */
  positions: Float32Array;
  /** Each window's lift rank in [0, 1): the exact value the skyline shader uses for dimming. */
  rank: Float32Array;
  /** Each window's x across the whole skyline, 0 at the far left and 1 at the far right. */
  across: Float32Array;
  /** 1 for warm (window color) and 0 for cool, so a lifted point keeps its window's color. */
  warm: Float32Array;
}

/** Places in the city other parts need. World space. */
export interface Landmarks {
  centralCluster: THREE.Vector3; // the tallest cluster, left of center (archive columns rise above it)
  lowBlockLeft: THREE.Vector3; // the compact low-rise block at the far left (Civic AI Club)
  smallClusters: THREE.Vector3[]; // three small low clusters (AI Simply)
  skylineTop: number; // y of the tallest tower top
  waterY: number; // y of the water plane
}

export interface WorldOptions {
  canvas: HTMLCanvasElement;
  motion: boolean; // false under reduced motion or snapshot: no twinkle, ripple drift, flicker
  seed?: number; // fixed by default, so the city looks the same on every visit
}

export interface World {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene: THREE.Scene;
  readonly camera: THREE.PerspectiveCamera;
  readonly tier: TierInfo;
  readonly landmarks: Landmarks;

  /** Spline parameter (0 to 1) of each scene key. */
  readonly cameraKeys: Record<SceneKey, number>;
  /** Move the camera along the spline. Pointer parallax is added on top by the world. */
  setCameraProgress(u: number): void;
  /** The camera pose at a spline parameter, without parallax (the signal uses it to place targets). */
  getCameraPose(u: number): CameraPose;

  /** Intro: sky 0..1 fades the sky and stars in from black; wake 0..1 switches the windows on left to right. */
  setIntro(p: { sky: number; wake: number }): void;
  /** Windows whose lift rank is below maxRank dim by amount (0 to 1). The signal calls this. */
  setLift(maxRank: number, amount: number): void;
  /** Project highlight in the city, strength 0..1. null clears it. */
  setHighlight(key: 'och' | 'ais' | 'club' | null, strength: number): void;
  /** Lit windows with lift rank below maxRank, front faces only, up to count (fewer if the city has fewer). */
  sampleLitWindows(count: number, maxRank: number): LitWindowSamples;

  // ---- Interactions (NIGHT-SIGNAL.md section 11b). The lead's interact.ts decides when a pointer
  // event belongs to the world (never on text or controls) and calls these. With motion off they
  // are instant state changes: no rings, waves, sweeps or streaks, and the world draws on demand.

  /** 11b.1 Spotlight: windows near the skyline point under the pointer brighten up to 60% and warm, fading over 800 ms after it moves on. null: pointer gone (or touch). */
  setPointer(ndc: Ndc | null): void;
  /**
   * 11b.1 Pulse: a ring spreads across the harbour from the point under ndc (sky taps project
   * onto the water below them), windows switch on in a wave by distance, and stars near the tap
   * glint. At most 3 at once, 400 ms cooldown. Light must start on the next frame. Returns false
   * if refused (cooldown or limit).
   */
  pulse(ndc: Ndc): boolean;
  /** 11b.4 Spill: a playing video's average color, mixed into the harbour reflections and the windows nearest the video on screen at up to 20% (strength 0 to 1). null clears it. center: the video's center on screen. */
  setSpill(color: Rgb | null, strength: number, center?: Ndc): void;
  /** 11b.8 Shooting star: true if a bright star sits near ndc (and fires one from it). Without ndc, fires one now. */
  shootingStar(ndc?: Ndc): boolean;
  /**
   * 11b.9 (v3) Harbour light show: while on, searchlight beams sweep from rooftops and the windows
   * pulse in rhythm, looping gently; off fades it out over 1 s. The timeline turns it on while
   * Contact is the current scene. With motion off the beams hold still and nothing pulses.
   */
  lightShow(on: boolean): void;
  /** Whether a light show is running (or still fading out). */
  readonly lightShowOn: boolean;
  /**
   * 4.7 Screen boxes (viewport fractions) the searchlight beams fade out inside, feathered, so the
   * figure and the Wisers pictures are never lit or sliced by a beam. The lead sets them every
   * frame: the figure's box while it shows, the Wisers box while Wisers is on screen. [] clears.
   */
  setBeamKeepOut(boxes: ScreenBox[]): void;

  /** Called every rendered frame before drawing. Returns an unsubscribe function. */
  onFrame(cb: (time: number, delta: number) => void): () => void;
  /** Live motion on or off (reduced motion, Motion switch, snapshot). */
  setMotion(enabled: boolean): void;
  /** Frozen: no continuous loop; draws only when requestRender() is called. */
  setFrozen(frozen: boolean): void;
  requestRender(): void;
  resize(): void;
  dispose(): void;
}

// ---- The signal -----------------------------------------------------------------------------

/**
 * A city (points sit on lit windows, invisible), B figure (built from Cayden's video, spec v3),
 * C current over the water, D archive (twelve columns of light above Central), E two lights
 * (Pomfret left, Hong Kong right), F1 and F2 the Wisers 2024 pictures (a social feed, then a
 * running shoe), G the Wisers 2025 picture (a screen agent reading and clicking), and S the
 * sparse drifting field among the stars for Since May and People (it was F before v3; the spec
 * calls it "A lifts into a sparse drifting field").
 */
export type Target = 'A' | 'B' | 'C' | 'D' | 'E' | 'F1' | 'F2' | 'G' | 'S';

export interface SignalOptions {
  world: World;
  motion: boolean; // false: morphs cut at their midpoint instead of flowing
  figureUrl: string; // the folder holding the video-built figure (figure-{hi|lo|phone}.json and .bin); the signal picks the file by tier
}

export interface Signal {
  readonly count: number;
  /** Show the morph from one target to another, t 0..1. Also updates the world's window dimming. */
  setMorph(from: Target, to: Target, t: number): void;
  setMotion(enabled: boolean): void;

  /**
   * 5.1 The figure's turn, in radians, about its own center. yaw: positive turns the face toward
   * the viewer's right (screen right), up to +-30 degrees. pitch: positive tilts the face up, up
   * to +-5 degrees. The lead's interact.ts runs the spring, drag and idle sway and calls this
   * every frame; the signal applies it in the shader (no per-point CPU work).
   */
  setFigureTurn(yaw: number, pitch: number): void;
  /** Where the figure is on screen right now (its outline's box, as viewport fractions), or null when it isn't showing (morph away from B). For drag hit tests. */
  figureBox(): ScreenBox | null;

  /** 11b.3 Archive: which column (0 to 11, in ARCHIVE order) is under ndc, or -1. Only while the columns are showing (state D). */
  columnAt(ndc: Ndc): number;
  /** 11b.3 Brighten column i and dim the rest (-1: none). */
  setColumnHighlight(i: number): void;
  /** 11b.3 Where column i's top is on screen (viewport fractions), for its label, or null when the columns aren't showing. */
  columnTop(i: number): { x: number; y: number } | null;

  /** 11b.7 Two cities: send an extra light along the arc between the two lights (the email was hovered or focused). The regular one runs by itself about every 6 s while the lights show. */
  sendArc(): void;

  dispose(): void;
}

// Implementations export:
//   renderer.ts: export function createWorld(opts: WorldOptions): Promise<World>
//   signal.ts:   export function createSignal(opts: SignalOptions): Promise<Signal>
