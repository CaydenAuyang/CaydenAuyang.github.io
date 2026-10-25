// title.ts: a title's words, each in its own color (content.ts `titleColors`), at build time.
//
//   titleHtml('The mission')
//     -> <span class="tw tw--cool">The</span> <span class="tw tw--window">mission</span>
//   titleHtml('Civic Exchange, Hong Kong', 'Civic Exchange')
//     -> the colored words for "Civic Exchange", then "Hong Kong" on a smaller line of its own
//        (<span class="t-tail">). The comma is kept for screen readers only (the line break stands
//        in for it on screen), so the heading still reads word for word as written. It stays in
//        the text flow (.sr-inline, base.css): a hidden comma taken out of the flow (.sr-only)
//        makes the heading's name "Civic Exchange , Hong Kong", with a space before it.
// Each .tw carries its color as custom properties (base.css), which the neon ignition reads, so a
// headline's letters strike in their word's color. The build stops if a title has no colors.
import { titleColors } from '../../data/content';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Each title word's width in Barlow Condensed 700, uppercase, tracking 0.01em, in em (measured in
// the browser). A title only gets smaller than its spec size where its longest word would run past
// its block (base.css: --wmax).
const WORD_EM: Record<string, number> = {
  the: 1.413,
  mission: 2.953,
  experience: 4.471,
  selected: 3.669,
  work: 2.147,
  more: 1.97,
  since: 2.14,
  may: 1.478,
  people: 2.765,
  reach: 2.382,
  out: 1.45,
  civic: 1.926,
  exchange: 3.822,
  wisers: 2.776,
  ourcityhealth: 5.894,
  ai: 0.732,
  simply: 2.613,
  club: 1.873,
};

/**
 * A whole title's width on one line, in em (its words plus 0.21em spaces), for `--wall`; a
 * one-word title can't wrap, so it gets 99 (base.css then never adjusts it).
 */
export function titleWall(lead: string): number {
  const words = lead.split(' ');
  if (words.length < 2) return 99;
  const sum = words.reduce((n, w) => n + (WORD_EM[w.toLowerCase()] ?? 0), 0);
  return Math.round((sum + 0.21 * (words.length - 1)) * 1000) / 1000;
}

/** The width of a title's longest word, in em, for `style="--wmax: ..."`. */
export function titleWmax(lead: string): number {
  const widths = lead.split(' ').map((w) => WORD_EM[w.toLowerCase()]);
  if (widths.some((w) => w === undefined)) throw new Error(`title.ts: no measured width for a word of "${lead}".`);
  return Math.max(...(widths as number[]));
}

export function titleHtml(text: string, lead: string = text): string {
  const colors = titleColors[lead];
  if (!colors) throw new Error(`title.ts: no title colors for "${lead}" (content.ts titleColors).`);
  if (!text.startsWith(lead)) throw new Error(`title.ts: "${text}" doesn't start with "${lead}".`);
  const words = lead.split(' ');
  if (words.length !== colors.length) throw new Error(`title.ts: "${lead}" has ${words.length} words but ${colors.length} colors.`);
  // The rest of the name goes on its own smaller line. A comma between them would hang off the
  // display title, so the line break stands in for it on screen and screen readers still hear it.
  let tail = text.slice(lead.length);
  let comma = '';
  if (tail.startsWith(',')) {
    comma = '<span class="sr-inline">,</span>';
    tail = tail.slice(1);
  }
  const head = words.map((w, i) => `<span class="tw tw--${colors[i]}">${esc(w)}</span>`).join(' ');
  return tail.trim() ? `${head}${comma} <span class="t-tail">${esc(tail.trim())}</span>` : head;
}
