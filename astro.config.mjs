// astro.config.mjs: the main settings file for the site.
//
// The site is built ahead of time into plain files ("static"), which is what GitHub Pages
// hosts. It lives at the root of caydenauyang.github.io, so there is no "base" path.
import { defineConfig } from 'astro/config';

export default defineConfig({
  site: 'https://caydenauyang.github.io',
  output: 'static',
});
