// astro.config.mjs: the main settings file for the site.
//
// The site is built ahead of time into plain files ("static"), which is what GitHub Pages
// hosts. It lives at the root of caydenauyang.github.io, so there is no "base" path.
//
// Fonts (NIGHT-SIGNAL.md section 3, Cayden's choice): Astro downloads these from Fontsource while
// it builds, stores them with the site's own files (no requests to other servers), and writes the
// CSS. Both are free under the SIL Open Font License. A browser only downloads the faces a page
// actually uses. Latin subset only.
//   - Barlow Condensed 600, 700 and 800, always uppercase: the name (800), section headlines,
//     project names and subheads (700), and small labels (600). font-display: swap, with 800
//     preloaded for the name (Base.astro). Every Barlow line on the first screen is one word in
//     a box whose size is set in CSS, so the swap changes the letters but moves nothing.
//   - JetBrains Mono 400 and 500: all paragraph text, facts, captions, buttons and menu items.
//     font-display: swap, with both weights preloaded. Its stand-in is Courier New with Astro's
//     metric overrides; both are monospaced at 0.6em per character, so lines break in exactly
//     the same places before and after the swap (no layout shift).
// The last fallback is a generic family, so Astro adjusts the stand-in font's metrics to match
// and the text doesn't jump when the real font arrives.
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  site: 'https://caydenauyang.github.io',
  output: 'static',

  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Barlow Condensed',
      cssVariable: '--font-barlow',
      weights: [600, 700, 800],
      styles: ['normal'],
      display: 'swap',
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'JetBrains Mono',
      cssVariable: '--font-mono',
      weights: [400, 500],
      styles: ['normal'],
      display: 'swap',
      subsets: ['latin'],
      fallbacks: ['monospace'],
    },
  ],
});
