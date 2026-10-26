// print-still.ts: gets the hero stills ready for printing.
//
// The canvas doesn't print (paper would stretch its frame), so the first printed page shows a
// still in its place (base.css, @media print): the desktop still on landscape paper, the phone
// still on portrait paper. With WebGL the page never paints a still on screen, so the first time
// someone printed, the still was only asked for once printing had started, too late for that
// print: page 1 came out with no figure and no skyline.
//
// So once the page has settled (settled.ts: loaded, the world up, its intro over and the browser
// idle), this fetches both stills at low priority (88 and 51 KB), and the phone still's fade
// (still-fade.svg, 2 KB). Printing then finds them in memory and decodes them on the spot (not
// before, so they don't hold 10 MB of pixels for a print that may never come). It adds nothing to
// the page, so nothing moves. Opening the print dialog before that, or with Save-Data on, starts
// the fetch at once (that print may still miss the still; the next has it). Snapshot mode fetches
// them up front in CSS instead (base.css), since it exists to be captured.
import { whenSettled } from './settled';

const html = document.documentElement;
const fallback = document.querySelector<HTMLElement>('[data-world-fallback][data-still]');
// Kept, so the fetched images stay in the page's memory cache until a print needs them.
const kept: HTMLImageElement[] = [];

// Safari gives an unquoted url() back with its slashes and dots escaped (url(\/_astro\/a\.svg)),
// so the escapes come off before the path is used.
function stillUrls(el: HTMLElement): string[] {
  const style = getComputedStyle(el);
  return ['--still-desktop', '--still-phone', '--still-fade']
    .map((name) => /url\(\s*['"]?([^'")]+)['"]?\s*\)/.exec(style.getPropertyValue(name))?.[1]?.replace(/\\(.)/g, '$1'))
    .filter((url, i, all): url is string => !!url && all.indexOf(url) === i);
}

function warm() {
  if (!fallback || kept.length) return;
  for (const url of stillUrls(fallback)) {
    const img = new Image();
    img.decoding = 'async';
    img.fetchPriority = 'low';
    img.src = url;
    kept.push(img);
  }
}

if (fallback && !html.hasAttribute('data-snapshot')) {
  whenSettled(warm);
  window.addEventListener('beforeprint', warm, { once: true });
}
