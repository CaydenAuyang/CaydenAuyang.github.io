# caydenauyang.github.io

Cayden Auyang's portfolio for the Pomfret School Certificate Program (Global Citizenship and Awareness). Live at https://caydenauyang.github.io, and embedded in the program's Google Site.

Built with [Astro](https://astro.build) 7 as a static site. Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`.

## Run it

```sh
nvm use            # Node 24, from .nvmrc
npm ci
npm run dev        # http://localhost:4321
npm run build      # writes dist/
npm run preview    # serves dist/ at http://localhost:4321
npm run check:a11y # axe, with preview running (see scripts/check-a11y.mjs)
```

## Where things are

| Path | What it holds |
| --- | --- |
| `src/data/content.ts` | Every sentence the site shows, each with its source tag. Edit copy here. |
| `src/data/site.ts` | Site name and address, and small interface words (button labels). |
| `src/styles/tokens.css` | Colors (with contrast ratios), type, spacing, motion timings. |
| `src/styles/base.css` | Reset, focus ring, skip link, the "To come" chip, motion rules. |
| `src/layouts/Base.astro` | The page frame: meta tags, share image, the motion script. |
| `src/components/sections/` | One component per section of the home page. |
| `src/components/ui/` | Shared parts: preview video, tracked-change question, Motion switch. |
| `scripts/check-a11y.mjs` | The accessibility check. |
| `tools/figure/`, `src/figure/` | The point figure in the hero (built separately). |
| `tools/previews/` | Records the project preview loops. |

## Content rules

- Every factual line carries a `source` tag in `content.ts`. Sources never show on the page.
- Lines marked `pending: true` are things only Cayden can supply. They show as a dashed "To come" chip.
- Lines with a `confirm` note ship as written but still need Cayden's confirmation.
- Find all open items with `grep -n "pending: true\|confirm:" src/data/content.ts`.

## Accessibility and motion

- axe (WCAG 2.2 A and AA) at 1440 x 900 and 390 x 844, each with motion on and reduced, at the top of the page and after scrolling to the bottom. Serious or critical problems fail the check.
- Motion only runs when the device allows it and the footer's Motion switch is on. If the motion script fails to load, a 3.5 second safety net shows everything.
- Preview videos play only while in view, always have a Pause button, and show their poster frame with reduced motion.
- Links to other sites open in a new tab, because the Google Sites frame can't navigate away.
