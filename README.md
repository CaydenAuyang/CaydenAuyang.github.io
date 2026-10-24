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
| `src/components/ui/` | Shared parts: header, tracked-change question, preview video, Motion and Snapshot switches, motion helper. |
| `src/components/datum/`, `src/scripts/datum/` | Datum parts for Summer, Work and Progress (locator, archive, charts). |
| `scripts/check-a11y.mjs` | The accessibility check. |
| `tools/figure/`, `src/figure/` | The point figure in the hero (built separately). |
| `tools/previews/` | Records the project preview loops. |

## Content rules

- Every factual line carries a `source` tag in `content.ts`. Sources never show on the page.
- Lines marked `pending: true` are things only Cayden can supply. They show as a dashed "To come" chip.
- Lines with a `confirm` note ship as written but still need Cayden's confirmation.
- Find all open items with `grep -n "pending: true\|confirm:" src/data/content.ts`.

## Design: Datum

A surveyor's chart: pale chart ground, vellum plates with 1px neatlines and edge ticks, ink text, and one orange used only for marks (triangles, link underlines, delivered dots). Newsreader for the name, titles, the question and project names; Atkinson Hyperlegible Next for everything else. Every color, size and timing is a token in `src/styles/tokens.css`, with its contrast ratio.

## Snapshot mode

For poster screenshots: white ground, darker text, no motion, no buttons. It is on when the address has `?snapshot`, when the footer's "Snapshot view" switch is on (saved in the browser), and always when printing. Mark interface that should vanish in snapshots with `data-snapshot-hide`.

## Motion

Every animation on the site. CSS animates only transform, opacity and clip-path. Three curves: settle `cubic-bezier(0.16,1,0.3,1)`, draw `cubic-bezier(0.65,0,0.35,1)`, quick `cubic-bezier(0.2,0,0,1)`.

| ID | What moves | Timing | Where |
| --- | --- | --- | --- |
| M1 | The figure assembles from two streams of points (Pomfret, Hong Kong), on load and on Replay | 1000 to 1300 ms per point, done by 1.8 s | `src/figure/` |
| M2 | The figure turns slightly toward the pointer (fine pointers, over the hero) | about 500 ms smoothing | `src/figure/` |
| M3 | The figure turns and drifts as the plate scrolls away | follows scroll | `src/figure/` |
| M4 | Cross-fade to the still image if WebGL is missing or slow | 240 ms quick | `src/components/Figure.astro` |
| M5 | The question's revisions, edit by edit: triangle, dashed strike, insertion, note. Any input jumps to the end | 180, 320, 520, 240 ms; about 4.2 s | `src/components/ui/TrackedQuestion.astro` |
| M6 | May / Edits / October switch: the new view fades in | 200 ms | `TrackedQuestion.astro` |
| M7 | Archive dots settle into 12 notebook columns, once | 1200 ms settle, 40 ms stagger | `src/scripts/datum/archive.ts` |
| M8 | A project's locator box fills, once per plate | 280 ms quick | `src/components/datum/Locator.astro` |
| M9 | Previews play at 60% visible, pause below 20%; a manual pause sticks | 200 ms poster to first frame | `src/scripts/datum/loop-video.ts` |
| M10 | Progress lines draw left to right; marks and dots appear | 900 ms draw; 160 ms; 120 ms each | `src/scripts/datum/progress.ts` |
| M11 | The phone Index sheet slides down, and back up | 240 ms settle; 180 ms quick | `src/components/ui/SiteHeader.astro` |
| M12 | Link underlines turn from orange to ink on hover or focus | 120 ms linear | `src/styles/base.css` |

Clocks update once a minute with no animation. On purpose there are no text reveals, blur-ins, smooth scrolling, custom cursor, preloader, particle background or grain.

With reduced motion (the device setting), Motion: Off (the footer switch) or snapshot mode, everything shows its end state, videos show their poster with a Play button (snapshot: poster only), and Replay is hidden. Components ask one helper, `motionAllowed()` in `src/components/ui/motion.ts`, and listen with `onMotionChange()`.

## Accessibility and motion

- axe (WCAG 2.2 A and AA) on `/`, `/?snapshot` and `/404`, at 1440 x 900 and 390 x 844, each with motion on and reduced, at the top of the page and after scrolling to the bottom. Serious or critical problems fail the check.
- If the motion script fails to load, a 3.5 second safety net shows everything in its end state.
- Links to other sites open in a new tab, because the Google Sites frame can't navigate away.
