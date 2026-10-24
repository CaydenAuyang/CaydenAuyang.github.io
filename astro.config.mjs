// astro.config.mjs: the main settings file for the site.
//
// The site is built ahead of time into plain files ("static"), which is what GitHub Pages
// hosts. It lives at the root of caydenauyang.github.io, so there is no "base" path.
//
// Fonts: Astro downloads these from Fontsource while it builds, stores them with the site's own
// files (no requests to other servers), and writes the CSS. Both are free under the SIL Open
// Font License. A browser only downloads the faces a page actually uses. Latin subset only.
//   - Unbounded, variable, 600 to 800: the name, section headlines and project names.
//   - Geist 400 and 500: everything else. font-display: optional, with both weights preloaded:
//     if Geist isn't there for the first paint, the metric-matched fallback stays for the visit,
//     so a late font never reflows wrapped lines (no layout shift).
// The last fallback is a generic family, so Astro adjusts the stand-in font's metrics to match
// and the text doesn't jump when the real font arrives.
import { defineConfig, fontProviders } from 'astro/config';

export default defineConfig({
  site: 'https://caydenauyang.github.io',
  output: 'static',

  fonts: [
    {
      provider: fontProviders.fontsource(),
      name: 'Unbounded',
      cssVariable: '--font-unbounded',
      weights: ['600 800'],
      styles: ['normal'],
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
    {
      provider: fontProviders.fontsource(),
      name: 'Geist',
      cssVariable: '--font-geist',
      weights: [400, 500],
      styles: ['normal'],
      display: 'optional',
      subsets: ['latin'],
      fallbacks: ['sans-serif'],
    },
  ],
});
