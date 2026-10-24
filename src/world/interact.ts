// interact.ts: every pointer, tap, drag and key the night scene answers. Owned by the lead.
//
// NIGHT-SIGNAL.md 5.1 (the figure turns) and 11b (signature interactions). The canvas sits behind
// the page and never receives events itself, so this listens on the window and decides which
// events belong to the world: anything that doesn't land on text or a control. Content always
// wins: nothing here calls preventDefault on a click, and a press that starts on a link, a button,
// a video, a glass panel or a line of text is left alone.
//
//   - The figure (5.1): with a mouse, the pointer's x turns it up to 30 degrees each way and its y
//     tilts it up to 5, through a spring that settles in about 600 ms with a slight overshoot.
//     Dragging on the figure overrides the pointer; on phones a drag turns it and it springs back
//     to center on release. After 3 s without input it sways 8 degrees each way over 6 s.
//   - Spotlight (11b.1): the mouse's position goes to the world, which brightens the windows near it.
//   - Pulse (11b.1): a click or tap on the sky, city or water sends a pulse, and tells the page
//     (`world:pulse`) so the hero hint can go. A tap on a bright star also fires a shooting star (11b.8).
//   - Archive (11b.3): hovering or tapping a column of light lights it and shows its label.
//   - Spill (11b.4), arc (11b.7) and light show (11b.9) come in as window events from the page.
//
// Every feature checks that the world or signal offers it, so this file works with any subset.
// With motion off (reduced motion) there is no pointer-follow, sway or spring: a drag turns the
// figure directly and it stays put, and the world draws on demand. Snapshot never starts this.

import { ARCHIVE, type Ndc, type Rgb, type Signal, type World } from './contract';
import { archive } from '../data/content';

const DEG = Math.PI / 180;
const MAX_YAW = 30 * DEG;
const MAX_PITCH = 5 * DEG;
/** The spring: settles (within 2%) in about 600 ms, with about a 5% overshoot. */
const OMEGA = 9.5;
const ZETA = 0.7;
const IDLE_AFTER = 3000;
const SWAY = 8 * DEG;
const SWAY_PERIOD = 6;
/** A press that moves less than this (CSS px) is a tap, not a drag. */
const TAP_SLOP = 6;
const TAP_MAX_MS = 600;
/** Dragging one figure width turns it through the whole range. */
const DRAG_RANGE = 2 * MAX_YAW;

const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);

/** Things a press can start on that belong to the page, not the world. */
const CONTENT =
  'a, button, input, select, textarea, label, summary, details, video, audio, iframe, dialog, [role="button"], [role="slider"], [role="link"], [role="tab"], [contenteditable], [tabindex]:not([tabindex="-1"]), .glass, [data-no-world]';

function toNdc(x: number, y: number): Ndc {
  return { x: (x / window.innerWidth) * 2 - 1, y: 1 - (y / window.innerHeight) * 2 };
}

/** Whether (x, y) is on a line of text: inside one of the line boxes of the text node there. */
function onText(x: number, y: number): boolean {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const node = doc.caretPositionFromPoint?.(x, y)?.offsetNode ?? doc.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
  const range = document.createRange();
  range.selectNodeContents(node);
  const pad = 4;
  for (const r of Array.from(range.getClientRects())) {
    if (x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad) return true;
  }
  return false;
}

/** Whether a press or hover at this event belongs to the world. */
function isWorld(e: PointerEvent | MouseEvent): boolean {
  const html = document.documentElement;
  if (html.classList.contains('menu-open')) return false;
  const target = e.target as Element | null;
  if (target && target.closest?.(CONTENT)) return false;
  if (onText(e.clientX, e.clientY)) return false;
  return true;
}

export interface InteractOptions {
  world: World;
  signal: Signal | null;
  motion: boolean;
}

export function createInteractions({ world, signal, motion }: InteractOptions): { dispose(): void } {
  const html = document.documentElement;
  const touchOnly = window.matchMedia('(hover: none)').matches;
  const off: (() => void)[] = [];
  const on = <K extends keyof WindowEventMap>(type: K, fn: (e: WindowEventMap[K]) => void, opts?: AddEventListenerOptions) => {
    window.addEventListener(type, fn as EventListener, opts);
    off.push(() => window.removeEventListener(type, fn as EventListener, opts));
  };
  const redraw = () => {
    if (!motion) world.requestRender();
  };

  // ---- The figure's turn ------------------------------------------------------------------------
  const turn = { yaw: 0, pitch: 0, vy: 0, vp: 0, ty: 0, tp: 0 };
  let lastInput = performance.now();
  let pointerKnown = false;
  let drag: { id: number; x: number; y: number; yaw: number; pitch: number; width: number } | null = null;
  const canTurn = typeof signal?.setFigureTurn === 'function';

  const applyTurn = () => {
    if (canTurn) signal!.setFigureTurn(turn.yaw, turn.pitch);
  };

  if (canTurn && motion) {
    off.push(
      world.onFrame((_time, delta) => {
        // The target: the drag, else the pointer, else center; after 3 s of quiet, the sway.
        const now = performance.now();
        if (!drag) {
          if (now - lastInput > IDLE_AFTER) {
            turn.ty = SWAY * Math.sin(((now - lastInput - IDLE_AFTER) / 1000) * ((2 * Math.PI) / SWAY_PERIOD));
            turn.tp = 0;
          } else if (!pointerKnown || touchOnly) {
            turn.ty = 0;
            turn.tp = 0;
          }
        }
        // Semi-implicit Euler in small steps, so a long frame can't make the spring blow up.
        let dt = Math.min(0.1, delta);
        while (dt > 0) {
          const h = Math.min(dt, 1 / 240);
          turn.vy += (OMEGA * OMEGA * (turn.ty - turn.yaw) - 2 * ZETA * OMEGA * turn.vy) * h;
          turn.vp += (OMEGA * OMEGA * (turn.tp - turn.pitch) - 2 * ZETA * OMEGA * turn.vp) * h;
          turn.yaw += turn.vy * h;
          turn.pitch += turn.vp * h;
          dt -= h;
        }
        applyTurn();
      }),
    );
  }

  // ---- Pointer routing --------------------------------------------------------------------------
  let press: { id: number; x: number; y: number; t: number; world: boolean } | null = null;
  let hoverQueued = false;
  let hoverEvent: PointerEvent | null = null;
  let column = -1;
  const label = document.querySelector<HTMLElement>('[data-archive-label]');
  const hasColumns = typeof signal?.columnAt === 'function' && typeof signal?.setColumnHighlight === 'function';

  const showColumn = (i: number) => {
    if (!hasColumns || i === column) return;
    column = i;
    signal!.setColumnHighlight(i);
    placeLabel();
    redraw();
  };
  const placeLabel = () => {
    if (!label) return;
    const top = column >= 0 ? signal?.columnTop?.(column) : null;
    if (column < 0 || !top) {
      label.hidden = true;
      return;
    }
    const col = ARCHIVE[column];
    label.textContent = archive.label(col.topic, col.count);
    label.hidden = false;
    label.style.left = `${Math.round(top.x * window.innerWidth)}px`;
    label.style.top = `${Math.round(top.y * window.innerHeight)}px`;
  };
  if (hasColumns) {
    // The columns move with the camera as the page scrolls, so the label follows them, and goes
    // when they do.
    const follow = () => {
      if (column < 0) return;
      if (!signal!.columnTop?.(column)) showColumn(-1);
      else placeLabel();
    };
    if (motion) off.push(world.onFrame(follow));
    else on('scroll', () => requestAnimationFrame(follow), { passive: true });
  }

  const hover = () => {
    hoverQueued = false;
    const e = hoverEvent;
    if (!e) return;
    const ndc = toNdc(e.clientX, e.clientY);
    const worldHere = isWorld(e);
    world.setPointer?.(ndc);
    if (hasColumns) showColumn(worldHere ? signal!.columnAt(ndc) : -1);
    redraw();
  };

  on(
    'pointermove',
    (e) => {
      if (e.pointerType === 'touch') {
        if (drag && e.pointerId === drag.id) moveDrag(e);
        return;
      }
      lastInput = performance.now();
      pointerKnown = true;
      if (drag && e.pointerId === drag.id) {
        moveDrag(e);
      } else if (canTurn && motion) {
        turn.ty = ((e.clientX / window.innerWidth) * 2 - 1) * MAX_YAW;
        turn.tp = -((e.clientY / window.innerHeight) * 2 - 1) * MAX_PITCH;
      }
      hoverEvent = e;
      if (!hoverQueued) {
        hoverQueued = true;
        requestAnimationFrame(hover);
      }
    },
    { passive: true },
  );
  // The pointer left the window: no spotlight, and the figure eases back to center.
  const leave = (e: MouseEvent) => {
    if (e.relatedTarget) return;
    pointerKnown = false;
    world.setPointer?.(null);
    if (hasColumns && !touchOnly) showColumn(-1);
    redraw();
  };
  document.addEventListener('mouseout', leave);
  off.push(() => document.removeEventListener('mouseout', leave));

  const insideFigure = (x: number, y: number) => {
    const box = signal?.figureBox?.();
    if (!box) return null;
    const fx = x / window.innerWidth;
    const fy = y / window.innerHeight;
    const padX = (box.x1 - box.x0) * 0.08;
    const padY = (box.y1 - box.y0) * 0.04;
    if (fx < box.x0 - padX || fx > box.x1 + padX || fy < box.y0 - padY || fy > box.y1 + padY) return null;
    return box;
  };

  function moveDrag(e: PointerEvent) {
    if (!drag) return;
    lastInput = performance.now();
    const yaw = clamp(drag.yaw + ((e.clientX - drag.x) / drag.width) * DRAG_RANGE, -MAX_YAW, MAX_YAW);
    const pitch = clamp(drag.pitch - ((e.clientY - drag.y) / drag.width) * 2 * MAX_PITCH, -MAX_PITCH, MAX_PITCH);
    if (motion) {
      // The spring follows the finger closely while dragging.
      turn.ty = yaw;
      turn.tp = pitch;
    } else {
      turn.yaw = turn.ty = yaw;
      turn.pitch = turn.tp = pitch;
      applyTurn();
      redraw();
    }
  }

  on('pointerdown', (e) => {
    if (!e.isPrimary || e.button !== 0) return;
    lastInput = performance.now();
    const worldHere = isWorld(e);
    press = { id: e.pointerId, x: e.clientX, y: e.clientY, t: performance.now(), world: worldHere };
    if (!worldHere || !canTurn) return;
    const box = insideFigure(e.clientX, e.clientY);
    if (box) {
      drag = { id: e.pointerId, x: e.clientX, y: e.clientY, yaw: turn.yaw, pitch: turn.pitch, width: Math.max(80, (box.x1 - box.x0) * window.innerWidth) };
    }
  });

  const endDrag = () => {
    if (!drag) return;
    drag = null;
    lastInput = performance.now();
    if (motion && (touchOnly || !pointerKnown)) {
      // Phones: spring back toward center (the sway takes over after 3 s).
      turn.ty = 0;
      turn.tp = 0;
    }
  };

  on('pointerup', (e) => {
    const p = press;
    press = null;
    const wasDrag = drag && e.pointerId === drag.id && (Math.abs(e.clientX - (p?.x ?? e.clientX)) > TAP_SLOP || Math.abs(e.clientY - (p?.y ?? e.clientY)) > TAP_SLOP);
    endDrag();
    if (!p || p.id !== e.pointerId || !p.world || wasDrag) return;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > TAP_SLOP || performance.now() - p.t > TAP_MAX_MS) return;
    if (!document.getSelection()?.isCollapsed) return;
    tap(e);
  });
  on('pointercancel', () => {
    press = null;
    endDrag();
  });

  function tap(e: PointerEvent) {
    const ndc = toNdc(e.clientX, e.clientY);
    // A tap on a column (phones have no hover) shows that column instead of pulsing.
    if (hasColumns && e.pointerType !== 'mouse') {
      const i = signal!.columnAt(ndc);
      if (i >= 0 || column >= 0) {
        showColumn(i === column ? -1 : i);
        if (i >= 0) return;
      }
    }
    world.shootingStar?.(ndc);
    if (world.pulse?.(ndc)) {
      window.dispatchEvent(new CustomEvent('world:pulse'));
      redraw();
    }
  }

  // ---- Phones: horizontal drags on the hero turn the figure instead of doing nothing -----------
  if (canTurn) {
    const hero = document.querySelector<HTMLElement>('[data-scene="hero"]');
    if (hero) hero.style.touchAction = 'pan-y pinch-zoom';
  }

  // ---- Page events: spill, arc, light show --------------------------------------------------------
  on('world:spill', (e) => {
    const d = (e as CustomEvent<{ color: Rgb | null; strength: number; rect?: DOMRect }>).detail;
    if (!d || typeof world.setSpill !== 'function') return;
    const r = d.rect;
    const center = r ? toNdc(r.left + r.width / 2, r.top + r.height / 2) : undefined;
    world.setSpill(d.color, d.strength ?? 0, center);
    redraw();
  });

  on('world:arc', () => signal?.sendArc?.());

  if (typeof world.lightShow === 'function' && motion) {
    let showing = false;
    let startY = 0;
    const tell = () => window.dispatchEvent(new CustomEvent('world:lights-state', { detail: { on: showing } }));
    const set = (next: boolean) => {
      if (next === showing) return;
      showing = next;
      startY = window.scrollY;
      world.lightShow(next);
      tell();
    };
    on('world:lights', () => set(!showing));
    on('keydown', (e) => {
      if (e.key !== 'l' && e.key !== 'L') return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.repeat) return;
      const t = e.target as Element | null;
      if (t?.closest?.('input, textarea, select, [contenteditable]')) return;
      set(!showing);
    });
    // Any scroll stops it; so does its own end, after 12 s.
    on('scroll', () => {
      if (showing && Math.abs(window.scrollY - startY) > 4) set(false);
    }, { passive: true });
    off.push(
      world.onFrame(() => {
        if (showing && !world.lightShowOn) {
          showing = false;
          tell();
        }
      }),
    );
  }

  html.classList.add('has-interactions');
  return {
    dispose() {
      off.forEach((fn) => fn());
      html.classList.remove('has-interactions');
    },
  };
}
