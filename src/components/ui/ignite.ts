// ignite.ts: builds a section headline for the neon ignition (NIGHT-SIGNAL.md 11b.2), at build time.
//
// A headline's letters are split into spans so each can strike like a neon tube, left to right.
// Screen readers get the plain heading text from a visually hidden copy; the letter spans are
// aria-hidden. The spans are inline (no inline-block, no transforms), so the letters shape and
// wrap exactly as plain text would: splitting them moves nothing.
//
// Use it on an <h2 class="h2"> in the section's own template:
//   const ig = ignite(question.heading);
//   <h2 id="question-title" class="h2" {...ig.attrs} set:html={ig.html} />
//
// Timing: each letter's strike runs SEQ_MS with one or two flickers; letters start `stagger` apart
// so the last one finishes within TOTAL_MS. The runtime (src/scripts/ignite.ts) starts it the
// first time the headline enters view; reduced motion and snapshot show it lit from the start.

export const SEQ_MS = 320;
export const TOTAL_MS = 700;
const MAX_STAGGER = 50;
// Three strike patterns (base.css): a = one flicker, b = two flickers, c = one late flicker.
const PATTERNS = ['a', 'b', 'c', 'a', 'c', 'b'];

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function ignite(text: string) {
  const chars = [...text];
  const count = chars.filter((c) => c.trim()).length;
  const stagger = count > 1 ? Math.min(MAX_STAGGER, (TOTAL_MS - SEQ_MS) / (count - 1)) : 0;
  const total = Math.round((count - 1) * stagger + SEQ_MS);
  let i = 0;
  const letters = chars
    .map((c) => {
      if (!c.trim()) return c;
      const n = i++;
      const pattern = PATTERNS[(n * 5 + text.length) % PATTERNS.length];
      return `<span class="ign__l ign__l--${pattern}" style="--i: ${n}">${esc(c)}</span>`;
    })
    .join('');
  return {
    attrs: { 'data-ignite': '', 'data-ignite-ms': String(total), style: `--stagger: ${stagger.toFixed(1)}ms` },
    html: `<span class="sr-only">${esc(text)}</span><span class="ign" aria-hidden="true">${letters}</span>`,
  };
}
