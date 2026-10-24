// loop-video.ts: plays and pauses the project previews (LoopVideo.astro). Motion M9.
//
//   - Plays when 60% of the picture is on screen, pauses below 20% (in between it keeps
//     whatever it was doing, so it doesn't flicker at one edge).
//   - Plays on its own only when motion is allowed (motion.ts). Otherwise the visitor can press
//     Play. A pause the visitor makes sticks for the session (sessionStorage, in try/catch).
//   - Snapshot mode: never plays, and goes back to the poster.
//   - If play() is refused (Low Power Mode, data saver), the poster stays and the button says
//     Play; it won't try again on its own until the visitor presses it.
import { motionAllowed, isSnapshot, onMotionChange } from '../../components/ui/motion';
import { ui } from '../../data/site';

type Want = 'auto' | 'play' | 'pause';

interface Player {
  figure: HTMLElement;
  video: HTMLVideoElement;
  button: HTMLButtonElement;
  label: string;
  storeKey: string;
  inView: boolean;
  want: Want;
  refused: boolean;
}

const PLAY_AT = 0.6;
const PAUSE_BELOW = 0.2;

function readStore(key: string): string | null {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeStore(key: string, value: string | null) {
  try {
    if (value === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, value);
  } catch {
    // Storage blocked (private window, the Google Sites frame): the pause lasts for this page.
  }
}

function render(p: Player) {
  const playing = !p.video.paused;
  p.figure.dataset.state = playing ? 'playing' : 'paused';
  p.button.setAttribute('aria-label', `${playing ? ui.pause : ui.play} ${p.label}`);
}

function wantsToPlay(p: Player): boolean {
  if (isSnapshot() || !p.inView || p.want === 'pause') return false;
  if (p.want === 'play') return true;
  return motionAllowed() && !p.refused;
}

function start(p: Player) {
  const attempt = p.video.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch((error: DOMException) => {
      // AbortError only means a pause() came first (scrolled away quickly). Anything else is a
      // refusal: keep the poster, show Play.
      if (error && error.name === 'AbortError') return;
      p.refused = true;
      if (p.want === 'play') p.want = 'auto';
      p.figure.classList.remove('is-live');
      render(p);
    });
  }
}

function update(p: Player) {
  if (wantsToPlay(p)) {
    if (p.video.paused) start(p);
  } else if (!p.video.paused) {
    p.video.pause();
  }
  render(p);
}

// Back to the poster: used when motion is switched off or snapshot mode starts.
function rest(p: Player) {
  if (!p.video.paused) p.video.pause();
  p.figure.classList.remove('is-live');
  render(p);
}

const players: Player[] = [];

const io =
  'IntersectionObserver' in window
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            const p = players.find((x) => x.video === entry.target);
            if (!p) continue;
            const ratio = entry.isIntersecting ? entry.intersectionRatio : 0;
            if (ratio >= PLAY_AT) p.inView = true;
            else if (ratio < PAUSE_BELOW) p.inView = false;
            update(p);
          }
        },
        { threshold: [0, PAUSE_BELOW, PLAY_AT, 1] },
      )
    : null;

document.querySelectorAll<HTMLElement>('[data-vf]').forEach((figure) => {
  const video = figure.querySelector('video');
  const button = figure.querySelector<HTMLButtonElement>('[data-vf-btn]');
  if (!video || !button) return;
  const storeKey = `ca:preview:${figure.dataset.vf}`;
  const p: Player = {
    figure,
    video,
    button,
    label: button.dataset.label || '',
    storeKey,
    inView: !io,
    want: readStore(storeKey) === 'paused' ? 'pause' : 'auto',
    refused: false,
  };
  players.push(p);

  video.addEventListener('playing', () => {
    figure.classList.add('is-live');
    render(p);
  });
  video.addEventListener('play', () => render(p));
  video.addEventListener('pause', () => render(p));

  button.addEventListener('click', () => {
    if (!video.paused) {
      p.want = 'pause';
      writeStore(storeKey, 'paused');
      video.pause();
    } else {
      p.want = 'play';
      p.refused = false;
      p.inView = true;
      writeStore(storeKey, null);
      start(p);
    }
    render(p);
  });

  if (io) io.observe(video);
  update(p);
});

// Motion switched in the footer, the device setting changed, or snapshot mode toggled.
onMotionChange((enabled) => {
  players.forEach((p) => {
    if (isSnapshot()) {
      p.want = p.want === 'pause' ? 'pause' : 'auto';
      rest(p);
    } else if (!enabled && p.want === 'auto') {
      rest(p);
    } else {
      update(p);
    }
  });
});
