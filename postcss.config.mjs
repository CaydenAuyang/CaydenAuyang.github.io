// postcss.config.mjs: one CSS step Vite runs on every stylesheet before Astro bundles it.
//
// postcss-custom-media turns the layout names in src/styles/media.css (@media (--stack) and so on;
// V4.md section 8.1) into their queries. It writes a list of queries as a plain comma list, which
// every browser reads; Lightning CSS would write it with "or", which Safari before 16.4 ignores.
import customMedia from 'postcss-custom-media';

export default {
  plugins: [customMedia()],
};
