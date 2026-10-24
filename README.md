# caydenauyang.github.io

Cayden Auyang's portfolio for the Pomfret School Certificate Program (Global Citizenship and Awareness). Live at https://caydenauyang.github.io, and embedded in the program's Google Site.

"Night Signal": night falls on Victoria Harbour, seen from the Kowloon side. The lit windows of a procedural Hong Kong skyline are the site's material. As you scroll, window lights lift off the towers and gather into pictures: Cayden's head and shoulders, a current over the water, the 12 notebooks he built, a field among the stars, and two lights for Pomfret and Hong Kong.

Built with [Astro](https://astro.build) 7 as a static site, three.js for the scene, GSAP ScrollTrigger and Lenis for scrolling. Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`; `.github/workflows/ci.yml` checks the build with a clean install.

## Run it

```sh
nvm use            # Node 24, from .nvmrc
npm ci
npm run dev        # http://localhost:4321 (only one dev server per project)
npm run build      # writes dist/
npm run preview    # serves dist/
npm run check:a11y # axe, with preview running (BASE=http://localhost:PORT to point it elsewhere)
npm run stills     # re-renders the no-WebGL fallback stills from the live scene, with preview running
```

Test pages (not linked, noindex): `/lab/world` (the city, with a camera slider and scene keys) and `/lab/signal` (the particle states and morphs).

## Where things are

| Path | What it holds |
| --- | --- |
| `src/data/content.ts` | Every sentence the site shows, each with its source tag (never rendered). Built from the concise copy and, for the "More" panels, the long copy. |
| `src/data/site.ts` | Site name, address and small interface words. |
| `src/styles/tokens.css` | Colors with measured contrast ratios, type scale, 8px spacing, easings and durations. |
| `src/styles/base.css` | Reset, focus rings, skip link, scrims and glass, the fixed canvas and fallback still, snapshot and print rules. |
| `src/layouts/Base.astro` | The page frame: meta tags, share image, fonts, the pre-paint script, the canvas. |
| `src/components/sections/` | One component per section, in page order: Hero, Question, Experience, Work, Since, People, Contact. |
| `src/components/ui/` | The question panel, the preview video, the More toggle, external links. |
| `src/world/contract.ts` | The one interface the world, the signal and the timeline use to talk to each other, plus the hero's screen anchors. |
| `src/world/renderer.ts` and the files beside it | The world: tiers, camera path, sky, Peak, skyline (windows lit by a shared hash rule in `windows.ts`), harbour. |
| `src/world/signal.ts` | The particle system and its six states. |
| `src/world/timeline.ts`, `main.ts` | Scroll drives the scene; `main.ts` boots it after first paint. |
| `src/world/interact.ts` | Every pointer, tap, drag and key the scene answers. It decides which presses belong to the world (never text or controls), and runs the figure's spring, drag and idle sway. |
| `src/world/shaders/` | GLSL for every material. |
| `public/world/` | The resampled figure (`figure-signal.bin`), its still, and the fallback stills of the hero scene. |
| `public/media/previews/` | The three project preview loops, MP4 and WebM, with posters (`src/data/previews.json`). |
| `tools/figure/` | The figure pipeline: Cayden's photos to point data (photos and everything derived from them stay outside the repo). |
| `tools/previews/` | Records the preview loops with Playwright. |

## Modes

- **Reduced motion** (the device setting): no intro, no smooth scrolling, no pins; the camera and the signal cut to each section's view instead of moving; stars hold still; videos wait for Play.
- **Snapshot** (`?snapshot`, for poster screenshots): motion off, the intro skipped, pins off, every More panel open, interface controls hidden, and the world frozen at each section's best frame. At 1440 x 900 each section is one screen: scroll its top to the top of the window (Contact: scroll to the bottom). The dark background is kept for print.
- **No WebGL**: a still of the hero scene sits behind the page; every word is still there.

## Motion

Every animation on the site. Two curves: `power3.out` for reveals and `power2.inOut` for the camera, the morphs and heights. CSS animates only transform, opacity and clip-path.

| What moves | When | Timing | Where |
| --- | --- | --- | --- |
| Sky and stars fade in from black | on load | 0 to 700 ms | `timeline.ts` (intro), `sky.ts` |
| Windows switch on in a wave, left to right | on load | 300 to 1,900 ms | `timeline.ts`, `skyline.ts` |
| Hero name, line and small line wipe in | on load | at 600, 950 and 1,150 ms, 600 ms each | `timeline.ts`, `Hero.astro` |
| A tenth of the lit windows stream up into the figure; those windows dim | on load | 1,600 to 3,400 ms | `timeline.ts`, `signal.ts` |
| The intro jumps to its end | the first scroll, touch or key | at once | `timeline.ts` |
| The canvas fades in over the page background | when the scene is ready | 600 ms | `base.css` |
| The camera moves along the skyline | scroll, every section | eased into each section's view; headings use capped tangents, so the camera never swings past a stop | `timeline.ts`, `camera-path.ts` |
| Figure to current, current to columns, columns to city, city to star field, field to two lights | scroll: Question, Experience, the top of Work, Since May, Contact | per point, a delay of up to 30%, curved paths, curl noise peaking mid-flight | `signal.ts` |
| Project highlights: a brightness wave (OurCityHealth), three small clusters (AI Simply), one low-rise block (Civic AI Club) | scroll, each project | fades in and out across the stop | `skyline.ts` |
| Each project pins while you read it | scroll, desktop | about 120vh | `timeline.ts` |
| The hero text fades as it scrolls up toward the figure | scroll, phones | until it would reach the shoulders | `timeline.ts` |
| Smooth scrolling | always | Lenis | `timeline.ts` |
| Stars twinkle and drift: each swings between 40% and 100% of its brightness on its own 1.5 to 4 s rhythm, and 6% flash briefly every few seconds | always | flash: a 60 ms rise and a fast fall | `sky.ts`, `stars.vert.glsl` |
| A rare window flickers; aviation lights blink; the water ripples; a ferry crosses | always | aviation 1 s; ferry about 90 s | `skyline.ts`, `peak.ts`, `harbour.ts` |
| The current flows, the columns rise, the field drifts | while shown | slow | `signal.ts` |
| The view tilts slightly toward the pointer | mouse or trackpad | ±1.5° yaw, ±0.8° pitch, about 600 ms lag | `renderer.ts` |
| The figure turns toward the pointer: its x to ±30° of yaw, its y to ±5° of pitch; points facing away fade and the outline brightens | mouse or trackpad, in the hero | a spring that settles in about 600 ms with a slight overshoot | `interact.ts`, `signal.ts` |
| Dragging on the figure turns it (on phones it springs back to center on release) | drag | follows the finger; one figure width covers the whole range | `interact.ts` |
| The figure sways 8° each way | after 3 s without input | a 6 s cycle | `interact.ts` |
| The scroll cue pulses, then hides | until the first scroll | 2.4 s loop | `Hero.astro` |
| More panels open and close | click | 420 ms height | `More.astro`, `more.ts` |
| The menu opens, its links step in | click | 240 ms; 420 ms | `Header.astro` |
| Previews play | at least half visible | pause when not | `loop-video.ts` |
| The Pomfret and Hong Kong labels fade in | at the bottom of the page | 400 ms | `Contact.astro` |

With reduced motion, none of this runs except opening and closing panels and the menu (instantly), and videos play only on request. Dragging the figure still turns it, directly and without a spring, and it stays where it is left.

## Accessibility

- axe (WCAG 2.2 A and AA) on `/`, `/?snapshot` and `/404`, at 1440 x 900 and 390 x 844, each with motion on and reduced, at the top and after scrolling to the bottom. Serious or critical problems block a deploy.
- The canvas is `aria-hidden`; every word lives in semantic HTML in reading order. Skip link, focus rings in window color with a dark halo, 44px tap targets on phones.
- Text sits over the darkest parts of the scene, with soft radial scrims where it must cross light; contrast was measured against the real pixels behind each line at both widths.
- Links to other sites open in a new tab (the Google Sites frame can't navigate away).

## Content rules

- Every factual line carries a `source` tag in `content.ts`; sources never show on the page.
- Faculty are named by office. Copy matches the concise and long copy files word for word.

## Credits

- Fonts: [Barlow Condensed](https://fonts.google.com/specimen/Barlow+Condensed) and [JetBrains Mono](https://www.jetbrains.com/lp/mono/), SIL Open Font License 1.1, through Fontsource.
- Libraries: [Astro](https://astro.build) (MIT), [three.js](https://threejs.org) (MIT), [GSAP](https://gsap.com) with ScrollTrigger (GreenSock standard "no charge" license), [Lenis](https://github.com/darkroomengineering/lenis) (MIT); for development, axe-core with `@axe-core/playwright` (MPL-2.0) and `playwright-core` (Apache-2.0).
- The skyline is procedural and generic: no real buildings, no logos.
- Level of finish referenced from https://loehx.com/ for ambition only; no design, code, text or assets from it are used.
