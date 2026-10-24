// astro.config.mjs: the main settings file for the site.
//
// The site is built ahead of time into plain files ("static"), which is what GitHub Pages
// hosts. It lives at the root of caydenauyang.github.io, so there is no "base" path.
//
// Fonts: Astro downloads these from Fontsource while it builds, stores them with the site's own
// files (no requests to other servers), and writes the CSS. Both are free under the SIL Open
// Font License. A browser only downloads the faces a page actually uses.
//   - Newsreader: roman 500 for the name, titles, the question and project names; italic 400
//     for the inserted words in the question.
//   - Atkinson Hyperlegible Next: 400 and 600 for everything else.
// The last fallback is a generic family, so Astro adjusts the stand-in font's size to match
// and the text doesn't jump when the real font arrives.
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  site: 'https://caydenauyang.github.io',
  output: 'static',

  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Newsreader',
      cssVariable: '--font-newsreader',
      weights: [400, 500],
      styles: ['normal', 'italic'],
      subsets: ['latin'],
      fallbacks: ['Georgia', 'serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Atkinson Hyperlegible Next',
      cssVariable: '--font-atkinson',
      weights: [400, 600],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['Arial', 'sans-serif'],
    },
  ],
});
