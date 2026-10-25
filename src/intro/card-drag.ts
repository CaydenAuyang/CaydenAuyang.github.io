// card-drag.ts: the greeting card in the intro module can be pulled about, and springs back
// (V4.md 6.2, 8.4). It's decoration: the words are in the page's reading order and the card never
// takes focus.
//
//   - Mouse and pen: a press becomes a drag after 4 px of movement, in any direction, so a plain
//     click on the email link still follows it; a drag that ends on the link doesn't. The card
//     moves freely up to 120 px from its spot, then a rubber band gives at most 36 px more.
//   - Touch: the card is touch-action pan-y (Intro.astro), so vertical swipes scroll the page. A
//     press becomes a drag after 8 px of movement when it is mostly sideways (|dx| > |dy|); one
//     that starts up or down is left to the page. Once dragging, the card moves sideways only, and
//     never more than 80 px (free to 56, then the band).
//   - A press that doesn't become a drag leaves the card alone (a tap on it while it springs home
//     doesn't stop it). Its words stay selectable (double-click, long-press); only a drag doesn't
//     select.
//   - Reduced motion (html[data-motion="off"], from the page's head script): it still drags, but
//     snaps home on release instead of springing.
// The spring runs on requestAnimationFrame only while the card is away from home.

const reduce = document.documentElement.dataset.motion === 'off';

/** How far the card moves freely, and the most the rubber band adds past that (px). */
const REACH = { mouse: 120, touch: 56 };
const GIVE = { mouse: 36, touch: 24 };
/** Movement before a press becomes a drag (px). */
const SLOP = { mouse: 4, touch: 8 };
const STIFFNESS = 210; // the spring home (per second squared), with a small overshoot
const DAMPING = 19;

export function cardDrag(card: HTMLElement) {
  let pointer: number | null = null;
  let touch = false;
  let downX = 0;
  let downY = 0;
  let startX = 0;
  let startY = 0;
  let dragging = false;
  // Offset from home, its velocity, and the last pointer sample (for the release speed).
  let x = 0;
  let y = 0;
  let vx = 0;
  let vy = 0;
  let lastT = 0;
  let frame = 0;
  let prev = 0;
  let swallowClick = false;

  /** Free up to the reach, then each extra pixel counts for less, never more than the give in all. */
  const band = (dx: number, dy: number): [number, number] => {
    const reach = touch ? REACH.touch : REACH.mouse;
    const give = touch ? GIVE.touch : GIVE.mouse;
    const d = Math.hypot(dx, dy);
    if (d <= reach) return [dx, dy];
    const r = reach + give * (1 - Math.exp(-(d - reach) / (give * 2.5)));
    return [(dx * r) / d, (dy * r) / d];
  };

  const paint = () => {
    if (Math.abs(x) < 0.25 && Math.abs(y) < 0.25 && !dragging) {
      card.style.transform = '';
      return;
    }
    // A slight lean toward the pull, as if held by one corner (none under reduced motion).
    const lean = reduce ? 0 : Math.max(-2.5, Math.min(2.5, x * 0.02));
    card.style.transform = `translate3d(${x.toFixed(2)}px, ${y.toFixed(2)}px, 0) rotate(${lean.toFixed(3)}deg)`;
  };

  const spring = (now: number) => {
    const dt = Math.min(1 / 30, (now - prev) / 1000 || 1 / 60);
    prev = now;
    vx += (-STIFFNESS * x - DAMPING * vx) * dt;
    vy += (-STIFFNESS * y - DAMPING * vy) * dt;
    x += vx * dt;
    y += vy * dt;
    if (Math.hypot(x, y) < 0.3 && Math.hypot(vx, vy) < 6) {
      x = y = vx = vy = 0;
      frame = 0;
      paint();
      return;
    }
    paint();
    frame = requestAnimationFrame(spring);
  };

  const stopSpring = () => {
    if (frame) cancelAnimationFrame(frame);
    frame = 0;
  };

  /** Back to its spot from wherever it is: a spring, or a snap under reduced motion. */
  const goHome = () => {
    if (frame) return;
    if (reduce || (Math.hypot(x, y) < 0.3 && Math.hypot(vx, vy) < 6)) {
      x = y = vx = vy = 0;
      paint();
      return;
    }
    prev = performance.now();
    frame = requestAnimationFrame(spring);
  };

  // While a press is down the page listens, not the card, so a press that slips off the card
  // before it becomes a drag (near an edge, or a quick flick) still ends cleanly.
  const listen = (on: boolean) => {
    const method = on ? 'addEventListener' : 'removeEventListener';
    window[method]('pointermove', move as EventListener);
    window[method]('pointerup', up as EventListener);
    window[method]('pointercancel', cancel as EventListener);
  };

  const release = () => {
    listen(false);
    if (pointer !== null && card.hasPointerCapture(pointer)) card.releasePointerCapture(pointer);
    pointer = null;
    if (dragging) {
      dragging = false;
      card.classList.remove('is-dragging');
      // The click that follows this pointerup (if any) comes in the same task.
      setTimeout(() => (swallowClick = false), 0);
    }
    goHome();
  };

  const move = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    if (!dragging) {
      const mx = e.clientX - downX;
      const my = e.clientY - downY;
      if (Math.hypot(mx, my) < (touch ? SLOP.touch : SLOP.mouse)) return;
      // A finger that starts up or down is scrolling the page: let it.
      if (touch && Math.abs(mx) <= Math.abs(my)) {
        release();
        return;
      }
      dragging = true;
      swallowClick = true;
      // Catch the card where it is (it may still be springing home).
      stopSpring();
      startX = downX - x;
      startY = downY - y;
      vx = vy = 0;
      lastT = e.timeStamp;
      card.classList.add('is-dragging');
      try {
        card.setPointerCapture(e.pointerId);
      } catch {
        /* the pointer is already gone; the page's listeners still end the drag */
      }
      // Drop the few letters a mouse selected before the press became a drag.
      const sel = window.getSelection();
      if (sel && !sel.isCollapsed && sel.anchorNode && card.contains(sel.anchorNode)) sel.removeAllRanges();
    }
    const dt = Math.max(1, e.timeStamp - lastT) / 1000;
    const [bx, by] = band(e.clientX - startX, touch ? 0 : e.clientY - startY);
    vx = (bx - x) / dt;
    vy = (by - y) / dt;
    x = bx;
    y = by;
    lastT = e.timeStamp;
    paint();
  };

  const up = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    // Let go after holding still: no fling.
    if (e.timeStamp - lastT > 80) vx = vy = 0;
    vx = Math.max(-1500, Math.min(1500, vx * 0.4));
    vy = Math.max(-1500, Math.min(1500, vy * 0.4));
    release();
  };

  const cancel = (e: PointerEvent) => {
    if (e.pointerId !== pointer) return;
    if (dragging) vx = vy = 0;
    release();
  };

  card.addEventListener('pointerdown', (e) => {
    if (pointer !== null || !e.isPrimary || (e.pointerType === 'mouse' && e.button !== 0)) return;
    pointer = e.pointerId;
    touch = e.pointerType === 'touch';
    swallowClick = false;
    downX = e.clientX;
    downY = e.clientY;
    listen(true);
  });
  // Losing the card's own capture ends the drag. (Touch first captures the pointer to the element
  // the finger landed on, a paragraph inside the card; that one is lost when the card takes over.)
  card.addEventListener('lostpointercapture', (e) => {
    if (e.pointerId === pointer && e.target === card) release();
  });

  // A drag that ends over the link doesn't follow it. Keyboard clicks (detail 0) always go through.
  card.addEventListener(
    'click',
    (e) => {
      if (!swallowClick || e.detail === 0) return;
      swallowClick = false;
      e.preventDefault();
      e.stopPropagation();
    },
    true,
  );
  // The link and anything in the card never start the browser's own drag-and-drop.
  card.addEventListener('dragstart', (e) => e.preventDefault());
}
