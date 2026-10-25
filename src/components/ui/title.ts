// title.ts: a title's words, each in its own color (content.ts `titleColors`), at build time.
//
//   titleHtml('Selected work')
//     -> <span class="tw tw--window">Selected</span> <span class="tw tw--cool">work</span>
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
