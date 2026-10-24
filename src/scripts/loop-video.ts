// loop-video.ts: plays and pauses the project previews (LoopVideo.astro).
//
//   - Loading: preload="none" until the video is within one viewport of the screen, then
//     "auto", so the first frames are ready by the time it is in view.
//   - Plays while at least half of it is visible, pauses otherwise.
//   - Plays on its own only when motion is allowed. Under reduced motion the visitor presses
//     Play. A pause the visitor makes sticks until they press Play again.
//   - Snapshot mode: never plays; the poster stays.
//   - If play() is refused (Low Power Mode, data saver), the poster stays and the button says
//     Play; it won't try again on its own until the visitor presses it.
import { ui } from '../data/site';

type Want = 'auto' | 'play' | 'pause';

interface Player {
  figure: HTMLElement;
  video: HTMLVideoElement;
  button: HTMLButtonElement;
  label: string;
  inView: boolean;
  want: Want;
  refused: boolean;
}

const html = document.documentElement;
const snapshot = html.hasAttribute('data-snapshot');
const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionAllowed = () => !snapshot && !reduceQuery.matches;

const players: Player[] = [];

function render(p: Player) {
  const playing = !p.video.paused;
  p.figure.dataset.state = playing ? 'playing' : 'paused';
  p.button.setAttribute('aria-label', `${playing ? ui.pause : ui.play} ${p.label}`);
}

function wantsToPlay(p: Player): boolean {
  if (snapshot || !p.inView || p.want === 'pause') return false;
  if (p.want === 'play') return true;
  return motionAllowed() && !p.refused;
}

function warm(video: HTMLVideoElement) {
  if (video.preload === 'auto') return;
  video.preload = 'auto';
  // Nothing has loaded yet under preload="none"; ask again now that loading is allowed.
  if (video.readyState === 0 && video.paused) video.load();
}

function start(p: Player) {
  warm(p.video);
  const attempt = p.video.play();
  if (attempt && typeof attempt.catch === 'function') {
    attempt.catch((error: DOMException) => {
      // AbortError only means a pause() came first (scrolled away quickly). Anything else is a
      // refusal: keep the poster, show Play.
      if (error && error.name === 'AbortError') return;
      p.refused = true;
      if (p.want === 'play') p.want = 'auto';
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

const canObserve = 'IntersectionObserver' in window;

// Half visible: play. Less: pause.
const playObserver = canObserve
  ? new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const p = players.find((x) => x.video === entry.target);
          if (!p) continue;
          p.inView = entry.isIntersecting && entry.intersectionRatio >= 0.5;
          update(p);
        }
      },
      { threshold: [0, 0.5, 1] },
    )
  : null;

// Within one viewport: allow loading.
const nearObserver =
  canObserve && !snapshot
    ? new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            warm(entry.target as HTMLVideoElement);
            nearObserver?.unobserve(entry.target);
          }
        },
        { rootMargin: '100% 0px 100% 0px' },
      )
    : null;

document.querySelectorAll<HTMLElement>('[data-vf]').forEach((figure) => {
  const video = figure.querySelector('video');
  const button = figure.querySelector<HTMLButtonElement>('[data-vf-btn]');
  if (!video || !button) return;
  const p: Player = {
    figure,
    video,
    button,
    label: button.dataset.label || '',
    inView: !canObserve,
    want: 'auto',
    refused: false,
  };
  players.push(p);

  video.addEventListener('play', () => render(p));
  video.addEventListener('pause', () => render(p));

  button.addEventListener('click', () => {
    if (!video.paused) {
      p.want = 'pause';
      video.pause();
    } else {
      p.want = 'play';
      p.refused = false;
      p.inView = true;
      start(p);
    }
    render(p);
  });

  playObserver?.observe(video);
  nearObserver?.observe(video);
  update(p);
});

// The device's reduced-motion setting changed while the page is open.
reduceQuery.addEventListener?.('change', () => players.forEach(update));

// Hidden tab: pause; back: resume what was playing.
document.addEventListener('visibilitychange', () => {
  players.forEach((p) => {
    if (document.hidden) {
      if (!p.video.paused) p.video.pause();
    } else {
      update(p);
    }
  });
});
