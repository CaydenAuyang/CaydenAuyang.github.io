// laser.ts: the laser pointer (NIGHT-SIGNAL.md 11b.10). Desktop with a fine pointer only.
//
// The system cursor is hidden over the page and a laser dot is drawn instead, on its own fixed 2D
// canvas above everything (pointer-events: none, sharp on high-DPI screens): a 6px white core with
// a soft white halo at the exact pointer position, and a tail of the last 180 ms of positions
// fading out as a tapering white line. Every frame draws from the latest pointer event, and the tail uses
// getCoalescedEvents(), so the dot never lags and the tail is smooth.
//   - Over links, buttons and other controls the dot opens into a 28px white ring, so they still
//     read as clickable.
//   - Over selectable text and text fields the normal text cursor comes back (no dot).
//   - It hides when the pointer leaves the window, and while the menu is open.
//   - Touch, pens, reduced motion and snapshot keep the system cursor: no dot, no tail.
// The city warms where you point through the lead's interact.ts (the spotlight), not here.

const html = document.documentElement;
const fine = window.matchMedia('(hover: hover) and (pointer: fine)');
const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

const TAIL_MS = 180;
const CORE = 3; // radius: a 6px core
const RING = 14; // radius: a 28px ring
const WHITE = '255, 255, 255';
const CONTROL =
  'a[href], button, label, summary, select, input[type="range"], input[type="radio"], input[type="checkbox"], [role="button"], [role="slider"], [role="link"]';
const TEXT_FIELD =
  'input:not([type="range"]):not([type="radio"]):not([type="checkbox"]):not([type="button"]):not([type="submit"]), textarea, [contenteditable]';

/** Whether (x, y) is on a line of selectable text (inside one of its text node's line boxes). */
function onText(x: number, y: number): boolean {
  const doc = document as Document & {
    caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node } | null;
    caretRangeFromPoint?: (x: number, y: number) => Range | null;
  };
  const node = doc.caretPositionFromPoint?.(x, y)?.offsetNode ?? doc.caretRangeFromPoint?.(x, y)?.startContainer ?? null;
  if (!node || node.nodeType !== Node.TEXT_NODE || !node.textContent?.trim()) return false;
  const parent = node.parentElement;
  if (!parent || getComputedStyle(parent).userSelect === 'none') return false;
  // Pad each line's box vertically by half the gap between lines (the half-leading), so moving down
  // through a paragraph never drops out of text mode between two lines.
  const lineHeight = parseFloat(getComputedStyle(parent).lineHeight);
  const range = document.createRange();
  range.selectNodeContents(node);
  for (const r of Array.from(range.getClientRects())) {
    const pad = Number.isFinite(lineHeight) ? Math.max(1, (lineHeight - r.height) / 2 + 1) : 4;
    if (x >= r.left - 1 && x <= r.right + 1 && y >= r.top - pad && y <= r.bottom + pad) return true;
  }
  return false;
}

function start() {
  const canvas = document.createElement('canvas');
  canvas.className = 'laser';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.append(canvas);
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    canvas.remove();
    return;
  }

  let dpr = 1;
  const size = () => {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(window.innerWidth * dpr);
    canvas.height = Math.round(window.innerHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    queue();
  };

  const tail: { x: number; y: number; t: number }[] = [];
  let x = 0;
  let y = 0;
  let shown = false;
  let target: Element | null = null;
  let mode: 'dot' | 'ring' | 'text' = 'dot';
  let ring = 0; // 0 dot, 1 ring, eased between
  let moved = false;
  let frame = 0;

  const setMode = (next: typeof mode) => {
    if (next === mode) return;
    mode = next;
    html.classList.toggle('laser-text', mode === 'text');
  };

  const classify = () => {
    if (!target) return setMode('dot');
    if (target.closest(TEXT_FIELD)) return setMode('text');
    if (target.closest(CONTROL)) return setMode('ring');
    setMode(onText(x, y) ? 'text' : 'dot');
  };

  const draw = (now: number) => {
    frame = 0;
    if (moved) {
      moved = false;
      classify();
    }
    while (tail.length && now - tail[0].t > TAIL_MS) tail.shift();
    const goal = mode === 'ring' ? 1 : 0;
    ring += (goal - ring) * 0.35;
    if (Math.abs(goal - ring) < 0.01) ring = goal;

    ctx.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
    if (shown && mode !== 'text' && !html.classList.contains('menu-open')) {
      // The tail: three nested strokes, each one single path (so no joint is drawn twice and
      // nothing beads), over the whole tail, its newer two thirds and its newest third: thin and
      // faint at the old end, thicker and brighter toward the dot. Each fades in along its length.
      const pts = [...tail, { x, y, t: now }];
      if (pts.length > 1) {
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (const [share, width, alpha] of [
          [1, 1, 0.35],
          [2 / 3, 2.2, 0.45],
          [1 / 3, 3.6, 0.6],
        ] as const) {
          const from = Math.min(pts.length - 2, Math.floor((pts.length - 1) * (1 - share)));
          const a = pts[from];
          const grad = ctx.createLinearGradient(a.x, a.y, x, y);
          grad.addColorStop(0, `rgba(${WHITE}, 0)`);
          grad.addColorStop(1, `rgba(${WHITE}, ${alpha})`);
          ctx.strokeStyle = grad;
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          for (let i = from + 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
          ctx.stroke();
        }
      }
      // The halo.
      const halo = ctx.createRadialGradient(x, y, 0, x, y, 12 + 6 * ring);
      halo.addColorStop(0, `rgba(${WHITE}, 0.32)`);
      halo.addColorStop(1, `rgba(${WHITE}, 0)`);
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(x, y, 12 + 6 * ring, 0, Math.PI * 2);
      ctx.fill();
      if (ring > 0) {
        // Over a control: the dot opens into a ring.
        ctx.strokeStyle = `rgba(${WHITE}, ${(0.95 * ring).toFixed(3)})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(x, y, CORE + (RING - CORE) * ring, 0, Math.PI * 2);
        ctx.stroke();
      }
      // The white core (shrinking to a point inside the ring).
      ctx.fillStyle = '#fff';
      ctx.beginPath();
      ctx.arc(x, y, CORE * (1 - 0.5 * ring), 0, Math.PI * 2);
      ctx.fill();
    }
    // Keep drawing while the tail fades or the ring eases; then rest (the last frame stays up).
    if (tail.length || ring !== goal) queue();
  };

  function queue() {
    if (!frame) frame = requestAnimationFrame(draw);
  }

  const hide = () => {
    shown = false;
    tail.length = 0;
    setMode('dot');
    queue();
  };

  const onMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') {
      // A touch or pen on a hybrid device: give it the system cursor until the mouse comes back.
      html.classList.remove('laser-on');
      hide();
      return;
    }
    html.classList.add('laser-on');
    const events = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
    for (const c of events.length ? events : [e]) tail.push({ x: c.clientX, y: c.clientY, t: c.timeStamp });
    x = e.clientX;
    y = e.clientY;
    target = e.target instanceof Element ? e.target : document.elementFromPoint(x, y);
    shown = true;
    moved = true;
    queue();
  };

  html.classList.add('laser-on');
  size();
  window.addEventListener('resize', size);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('pointerdown', onMove, { passive: true });
  // Leaving the window (no element to go to), or the window losing focus.
  document.addEventListener('mouseout', (e) => {
    if (!e.relatedTarget) hide();
  });
  window.addEventListener('blur', hide);
  // Scrolling moves the page under a still pointer: look again at what it's over.
  window.addEventListener(
    'scroll',
    () => {
      if (!shown) return;
      target = document.elementFromPoint(x, y);
      moved = true;
      queue();
    },
    { passive: true },
  );
  // The device starts asking for reduced motion (or loses its fine pointer): back to the system.
  const stop = () => {
    if (fine.matches && !reduce.matches) return;
    html.classList.remove('laser-on', 'laser-text');
    canvas.remove();
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerdown', onMove);
  };
  reduce.addEventListener?.('change', stop);
  fine.addEventListener?.('change', stop);
}

if (!html.hasAttribute('data-snapshot') && fine.matches && !reduce.matches) start();
