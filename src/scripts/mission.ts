// mission.ts: the mission scrubber (MissionPanel.astro, NIGHT-SIGNAL.md 11b.5).
//
// One stop per edit on a native range input: 0 is Previously (no edits, plain), 1 to 3 apply the
// edits one by one in reading order, 4 is Now (every edit, clean; the default). Moving the handle
// turns each edit's span on or off in the one marked paragraph; an edit switched on gets .is-new
// for a moment, so its strike draws and its insertion lights. The Previously, Edits and Now switch
// becomes three presets that move the handle (0, 3, 4) and shows which one the handle is on.
// Reduced motion: the same changes, instant (base.css). Snapshot keeps the fixed Edits view, so the
// scrubber doesn't run there: the switch stays as the poster's key to the marked text, set to
// Edits and inert. Without JavaScript the switch's CSS views stay.
//
// Height: the text area keeps the tallest stop's height at every stop (MissionPanel.astro), so
// nothing here measures or moves anything: the slider stays put under a drag (mouse, pen or
// touch), a preset or a key.

const html = document.documentElement;
const root = document.querySelector<HTMLElement>('.qp');
const range = root?.querySelector<HTMLInputElement>('#qp-scrub');
const scrub = root?.querySelector<HTMLElement>('[data-qp-scrub]');
const marked = root?.querySelector<HTMLElement>('[data-qp-marked]');

if (root && html.hasAttribute('data-snapshot')) {
  const edits = root.querySelector<HTMLInputElement>('#qp-edits');
  if (edits) edits.checked = true;
  root.querySelector<HTMLElement>('[data-qp-switch]')?.setAttribute('inert', '');
} else if (root && range && scrub && marked) {
  const texts: string[] = JSON.parse(range.dataset.texts || '[]');
  const last = Number(range.max);
  const editsStop = Number(range.dataset.editsStop);
  const edits = Array.from(marked.querySelectorAll<HTMLElement>('.qp__edit'));
  const ticks = Array.from(scrub.querySelectorAll<HTMLElement>('.qp__tick'));
  const track = range.parentElement as HTMLElement;
  const presets: [HTMLInputElement | null, number][] = [
    [root.querySelector<HTMLInputElement>('#qp-from'), 0],
    [root.querySelector<HTMLInputElement>('#qp-edits'), editsStop],
    [root.querySelector<HTMLInputElement>('#qp-to'), last],
  ];

  // Restart a one-shot animation class.
  const flash = (el: HTMLElement, cls: string) => {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  };

  const set = (value: number, animate: boolean) => {
    const stop = Math.max(0, Math.min(last, Math.round(value)));
    edits.forEach((edit, i) => {
      const on = stop === last || stop >= i + 1;
      const was = edit.classList.contains('is-on');
      edit.classList.toggle('is-on', on);
      if (!on) edit.classList.remove('is-new');
      else if (!was && animate) flash(edit, 'is-new');
    });
    marked.classList.toggle('is-clean', stop === last);
    if (range.value !== String(stop)) range.value = String(stop);
    range.setAttribute('aria-valuetext', texts[stop] ?? String(stop));
    track.style.setProperty('--p', String(stop / last));
    ticks.forEach((tick, i) => tick.classList.toggle('is-lit', i <= stop));
    for (const [radio, at] of presets) if (radio) radio.checked = at === stop;
  };

  // Scrubber mode: the one marked paragraph shows every stop. The slider's value text says what
  // changed, so the paragraph stops announcing itself on every step.
  root.classList.add('is-scrub');
  root.querySelector('[data-qp-views]')?.setAttribute('aria-live', 'off');
  // A reload may bring back the handle where the visitor left it.
  set(Number(range.value), false);

  range.addEventListener('input', () => set(Number(range.value), true));
  for (const [radio, at] of presets) radio?.addEventListener('change', () => radio.checked && set(at, true));
}
