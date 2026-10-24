// title.ts: a title's words, each in its own color (content.ts `titleColors`), at build time.
//
//   titleHtml('The mission')
//     -> <span class="tw tw--cool">The</span> <span class="tw tw--window">mission</span>
//   titleHtml('Civic Exchange, Hong Kong', 'Civic Exchange')
//     -> the colored words for "Civic Exchange," (the comma stays on the name's line), then
//        "Hong Kong" on a smaller line of its own (<span class="t-tail">), so the heading still
//        reads word for word as written.
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
  // A comma right after the name stays on the name's line, in the last word's color; the rest of
  // the tail goes on its own smaller line.
  let tail = text.slice(lead.length);
  let comma = '';
  if (tail.startsWith(',')) {
    comma = ',';
    tail = tail.slice(1);
  }
  const head = words.map((w, i) => `<span class="tw tw--${colors[i]}">${esc(w)}${i === words.length - 1 ? comma : ''}</span>`).join(' ');
  return tail.trim() ? `${head} <span class="t-tail">${esc(tail.trim())}</span>` : head;
}
