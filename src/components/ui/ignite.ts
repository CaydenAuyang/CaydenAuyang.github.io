// ignite.ts: prepares a section headline for the neon ignition (NIGHT-SIGNAL.md 11b.2), at build
// time.
//
// The headline ships as plain text, with its timing worked out here: each letter's strike runs
// SEQ_MS with one or two flickers, and letters start `stagger` apart so the last one finishes
// within TOTAL_MS. The runtime (src/scripts/ignite.ts) splits the letters into spans only once
// Barlow Condensed has loaded: a letter that is its own text node moves sideways when the letters
// before it change width, so splitting before the font arrived would count as layout shift. The
// spans are inline (no inline-block, no transforms), so they shape and wrap exactly as the plain
// text did. Screen readers get a visually hidden copy; the letter spans are aria-hidden.
//
// Use it on an <h2 class="h2"> in the section's own template:
//   const ig = ignite(question.heading);
//   <h2 id="question-title" class="h2" {...ig.attrs}>{question.heading}</h2>

export const SEQ_MS = 320;
export const TOTAL_MS = 700;
const MAX_STAGGER = 50;

export function ignite(text: string) {
  const count = [...text].filter((c) => c.trim()).length;
  const stagger = count > 1 ? Math.min(MAX_STAGGER, (TOTAL_MS - SEQ_MS) / (count - 1)) : 0;
  const total = Math.round((count - 1) * stagger + SEQ_MS);
  return {
    attrs: { 'data-ignite': '', 'data-ignite-ms': String(total), style: `--stagger: ${stagger.toFixed(1)}ms` },
  };
}
