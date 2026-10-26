# caydenauyang.github.io

Cayden Auyang's portfolio for the Pomfret School Certificate Program (Global Citizenship and Awareness). Live at https://caydenauyang.github.io, and embedded in the program's Google Site.

"Night Signal": night falls on Victoria Harbour, seen from the Kowloon side. The lit windows of a procedural Hong Kong skyline are the site's material. As you scroll, window lights lift off the towers and gather into pictures: Cayden's head and shoulders, a current over the water, the 12 notebooks he built, a feed, a shoe and a screen from his two Wisers summers, and two lights for Pomfret and Hong Kong. Between the hero and the mission, a folding phone waits beside a short greeting, and opens when you click it.

Built with [Astro](https://astro.build) 7 as a static site, three.js for the scene, GSAP ScrollTrigger and Lenis for scrolling. Every push to `main` deploys to GitHub Pages through `.github/workflows/deploy.yml`; `.github/workflows/ci.yml` runs `npm run check` on every push and pull request.

## Run it

```sh
nvm use               # Node 24, from .nvmrc
npm ci
npx playwright-core install chromium   # once, for the browser checks (add webkit for --webkit)
npm run dev           # http://localhost:4321 (only one dev server per project)
npm run build         # writes dist/
npm run preview       # serves dist/
npm run check         # everything below, against a fresh build it serves and stops itself
npm run stills        # re-renders the no-WebGL fallback stills from the live scene, with preview running
npm run perf          # frame rates at laptop, phone and tablet sizes, with preview running
```

Test pages (not linked, noindex): `/lab/world` (the city, with a camera slider and scene keys) and `/lab/signal` (the particle states and morphs).

## Checks

`npm run check` (`scripts/check.mjs`) builds the site, then runs each check in turn and ends with a summary; it exits with code 1 if any of them failed. The build is served by `scripts/serve.mjs` on a free port, close to how GitHub Pages serves it (gzip, a real 404 page, byte ranges for Safari's video). Each check also runs alone against a running preview (`BASE=http://localhost:PORT` points it elsewhere).

| Command | What it checks |
| --- | --- |
| `npm run check:types` | `astro check`: TypeScript in every `.astro` and `.ts` file. Errors fail it; hints don't. Then `tsc -p tsconfig.client.json` checks the browser code (`src/scripts`, `src/world`, `src/intro`, `src/data`) again without Node's types, so a `process.env` or `Buffer` there fails here instead of in the browser. |
| `npm run check:a11y` | axe, WCAG 2.2 A and AA (see Accessibility). |
| `npm run check:devices` | `scripts/devices.mjs`, 15 sizes: four phones upright, two sideways, three iPads each way, three laptops and desktops. At each, across the whole page (header, main and the footer with Contact) at the top and ten points down it: no horizontal scroll, no text past the edge, and no control, picture or bordered box cut off by the window edge (body, main and the footer clip sideways overflow, so this is what that clip would hide); 44px tap targets on touch; nothing under the notch or home indicator on phones sideways. Once per size: the layout (`html[data-layout]`) and input mode (`html[data-input]`) the size should get; the intro phone's canvas there wherever the browser has WebGL 2, its drawing buffer at most 1.3 megapixels; at most two live WebGL contexts; no console errors; and a toolbar-sized height change doesn't rebuild the world. `-- --webkit` runs it in Safari's engine, `-- --only=iphone-15,laptop-15` picks sizes, `-- --shard=1/2` takes every second size, `-- --shots` saves screenshots to `.devices/`. |
| `npm run check:budgets` | `scripts/budgets.mjs`, on the build in `dist/`: all the JavaScript the home page can load under 300 KB gzipped, the intro phone's own lazy code at most 25 KB, three.js in the build once, and a phone's first load (without videos and photos) under 1 MB. `-- --lighthouse` adds Lighthouse mobile (Performance at least 85, Accessibility 100, CLS under 0.05, LCP under 2.5 s, fetched once with npx). |

`npm run check -- --webkit` adds the WebKit device check, `--skip=types,a11y` leaves steps out, `--out-dir=<folder>` builds somewhere other than `dist/`, `--lighthouse` passes through to the budgets, and `--only=` and `--shard=` pass through to the device check.

CI runs the same command on Linux in three parallel jobs: the build, types, accessibility and budgets; and the device check split in two (`--shard=1/2` and `2/2`), each expected to take well under 10 minutes. Linux runners have no GPU, so Chromium draws the world and the intro phone in software (SwiftShader, on the phone and low tiers): every check above still means the same thing there, but frame rates don't, so `npm run perf` is a local check, and so are WebKit and Lighthouse. Where a browser has no WebGL at all, the device check skips only the toolbar rebuild test and the intro canvas test, and says so. If a device check fails in CI, its screenshots are under the run's Artifacts for a week.

## Where things are

| Path | What it holds |
| --- | --- |
| `src/data/content.ts` | Every sentence the site shows, each with its source tag (never rendered). Built from the concise copy and, for the "More" panels, the long copy. |
| `src/data/site.ts` | Site name, address and small interface words. |
| `src/styles/tokens.css` | Colors with measured contrast ratios, type scale, 8px spacing, easings and durations. |
| `src/styles/media.css`, `src/world/layout.ts` | The three layouts and the input modes, defined once: `--stack`, `--short`, `--wide`, `--pin`, `--mouse`, `--touch` for CSS (compiled by postcss-custom-media), the same queries plus `layoutMode()` for scripts. See Layouts. |
| `src/styles/base.css` | Reset, focus rings, skip link, scrims and glass, the fixed canvas and fallback still, snapshot and print rules. |
| `src/layouts/Base.astro` | The page frame: meta tags, share image, fonts, the pre-paint script, the canvas. |
| `src/components/sections/` | One component per section, in page order: Hero, Mission, Experience (Civic Exchange, then Wisers), Work, Contact. |
| `src/components/intro/` | The intro module between Hero and Mission: `Intro.astro` (the phone's stage, the greeting card, the no-WebGL still) and `LogoStrip.astro` ("Worked with"). |
| `src/intro/` | The intro's scripts: `card-drag.ts`, and `phone/`, loaded only when the module is near (`index.ts` runs it: render on demand, context loss; `device.ts`, `materials.ts`, `screens.ts`, `controls.ts`, `entrance.ts`). |
| `src/components/ui/` | The mission panel, per-word title colors (`title.ts`), the preview video, the More toggle, external links. |
| `src/scripts/` | The page's own scripts: the mission slider, the held Wisers block, the laser cursor (`laser.ts`), the menu, More panels, videos, the lift indicator, the clocks. |
| `src/world/shapes/` | The Wisers pictures (a feed, a shoe, a screen agent), drawn as SVG paths in code and sampled at one fixed spacing. |
| `src/world/contract.ts` | The one interface the world, the signal and the timeline use to talk to each other, plus the hero's screen anchors. |
| `src/world/renderer.ts` and the files beside it | The world: tiers, camera path, sky, Peak, skyline (windows lit by a shared hash rule in `windows.ts`), harbour. |
| `src/world/signal.ts` | The particle system and its six states. |
| `src/world/timeline.ts`, `main.ts` | Scroll drives the scene; `main.ts` boots it after first paint. |
| `src/world/interact.ts` | Every pointer, tap, drag and key the scene answers. It decides which presses belong to the world (never text or controls), and runs the figure's spring, drag and idle sway. |
| `src/world/shaders/` | GLSL for every material. |
| `public/figure/` | The figure of light, built from Cayden's turntable video: `figure-hi`, `figure-lo` and `figure-phone` (`.bin` with a `.json` describing it), exactly 60,000, 30,000 and 16,000 dots, one per particle on each tier. Each dot is 10 bytes (position, normal, brightness). Loaded as is, never resampled. |
| `public/world/` | The fallback stills of the hero scene. |
| `public/media/previews/` | The three project preview loops, MP4 and WebM, in desktop encodes and 720px-wide ones for smaller screens, with posters (`src/data/previews.json`). |
| `public/intro/` | The intro's phone photos (two sizes each, the smaller for phones), the closed phone's still, and the logos. |
| `tools/previews/` | Records the preview loops with Playwright. |
| `tools/intro/phone-still/` | Renders the closed phone's no-WebGL still from the real scene. |
| `scripts/` | The checks (`check.mjs` runs them all; `devices.mjs`, `check-a11y.mjs`, `budgets.mjs`, with `serve.mjs` to serve a build), `perf.mjs` and `stills.mjs`. |

## Modes

- **Reduced motion** (the device setting): no intro, no smooth scrolling, no pins (the Wisers block still holds its frame while its three pictures cut from one to the next); the camera and the signal cut to each section's view instead of moving, both at the middle of the section's morph; stars hold still; videos wait for Play.
- **Snapshot** (`?snapshot`, for poster screenshots): motion off, the intro skipped, pins off, every More panel open, interface controls hidden, and the world frozen at each section's best frame. At 1440 x 900 each section is one screen, except Experience, which is four (Civic Exchange with the chart, its open More text, Wisers 2024 with the shoe, Wisers 2025 with the screen agent): scroll a section's top to the top of the window (for Experience's later screens, 900 px further each time; Contact: scroll to the bottom). The dark background is kept for print.
- **No WebGL**: a still of the hero scene sits behind the page; every word is still there.

## Layouts

Three layouts, set before first paint on `html[data-layout]` and kept current on resize and rotation (no reload):

| Layout | When | Who gets it |
| --- | --- | --- |
| `stack` | width 767px or less, or portrait up to 1199px wide | Phones upright, every iPad upright (including the 13-inch Pro at 1024 x 1366) |
| `short` | landscape, at least 768px wide and at most 560px tall | Phones sideways: side by side like `wide`, but compact and with no pins |
| `wide` | everything else | Laptops, desktops, iPads sideways |

Pins happen only in `wide`, and only when the window is at least 600px tall (`--pin`). Input is separate from layout and set on `html[data-input]`: `mouse` is `(hover: hover) and (pointer: fine)`, everything else is `touch` (an iPad with a trackpad counts as touch). The laser pointer, the pointer spotlight, the lift indicator and hover-only labels need a mouse; touch gets tap versions.

## Motion

Every animation on the site. Two curves: `power3.out` for reveals and `power2.inOut` for the camera, the morphs and heights. CSS animates only transform, opacity and clip-path.

| What moves | When | Timing | Where |
| --- | --- | --- | --- |
| Sky and stars fade in from black | on load | 0 to 700 ms | `timeline.ts` (intro), `sky.ts` |
| Windows switch on in a wave, left to right | on load | 300 to 1,900 ms | `timeline.ts`, `skyline.ts` |
| Hero name, line and small line wipe in | on load | at 600, 950 and 1,150 ms, 600 ms each | `timeline.ts`, `Hero.astro` |
| A tenth of the lit windows stream up into the figure, which fills in as a scan from the crown down; those windows dim | on load | 1,600 to 3,400 ms | `timeline.ts`, `signal.ts` |
| The intro jumps to its end | the first scroll, touch or key | at once | `timeline.ts` |
| The canvas fades in over the page background | when the scene is ready | 600 ms | `base.css` |
| The camera moves along the skyline | scroll, every section | eased into each section's view, once (the long moves into More work and Contact are not eased twice); headings use capped tangents, so the camera never swings past a stop; Wisers holds near Experience's, drifting slightly | `timeline.ts`, `camera-path.ts` |
| Figure to current, current to columns, columns to the Wisers feed, feed to shoe, shoe to screen agent, screen agent to city, city to two lights | scroll: Mission, Experience, Wisers (held for about 160vh), the top of Work, Contact | per point, a delay of up to 30%, curved paths, curl noise peaking mid-flight | `signal.ts` |
| Project highlights: a brightness wave (OurCityHealth), three small clusters (AI Simply), one low-rise block (Civic AI Club) | scroll, each project | fades in and out across the stop | `skyline.ts` |
| Civic Exchange holds while you read it, the twelve columns standing still above the skyline | scroll, `wide` layout | about 70vh, in a CSS sticky frame | `Experience.astro` |
| Each project pins while you read it | scroll, `wide` layout | about 150vh a project, the video playing throughout | `timeline.ts` |
| The hero text fades as it scrolls up toward the figure | scroll, phones | gone before it reaches the figure's bottom edge | `timeline.ts` |
| The intro phone arrives closed, the vertical photo on its cover, and turns from a tilt to its closed display pose; then it floats. A hint under it says "Click to open" ("Tap to open" on touch) until the first open | once, when 40% of it is in view | after 0.6 s, a 1.4 s turn; the float is ±4 px and ±2° over 6 s, a CSS transform | `src/intro/phone/entrance.ts` |
| Dragging the phone turns it live in every direction (the drawn phone follows the drag through a critically damped spring, 60 ms), with inertia on release; a click or tap opens or closes it like a book, turning a quarter into landscape to face you; open, it folds shut by itself, and it eases back to the display pose for its state | drag (a mouse after 4 px; horizontal on touch, so vertical swipes scroll); click or tap; Enter or Space | 1.4 s to fold; shut after 6 s without input or when it leaves the screen; back after 4 s without input | `src/intro/phone/controls.ts` |
| The greeting card pulls away from its place and springs back | drag | up to 120px (80px, horizontal only, on phones) | `src/intro/card-drag.ts` |
| The "Worked with" logos slide past, fading at both ends; hovering pauses them, and a pause button stops them | always | about 40 s a loop | `LogoStrip.astro` |
| Smooth scrolling | always | Lenis | `timeline.ts` |
| Stars twinkle and drift: each swings between 40% and 100% of its brightness on its own 1.5 to 4 s rhythm, and 6% flash briefly every few seconds | always | flash: a 60 ms rise and a fast fall | `sky.ts`, `stars.vert.glsl` |
| A rare window flickers; aviation lights blink; the water ripples; a ferry crosses | always | aviation 1 s; ferry about 90 s | `skyline.ts`, `peak.ts`, `harbour.ts` |
| The current flows, the columns rise, the field drifts | while shown | slow | `signal.ts` |
| The view tilts slightly toward the pointer | mouse or trackpad | ±1.5° yaw, ±0.8° pitch, about 600 ms lag | `renderer.ts` |
| The figure turns toward the pointer: its x to ±30° of yaw (the head fully, the shoulders 0.85 as far, the neck between), its y to ±5° of pitch; every dot is one colour (#EEE9E1), shaded by its own brightness and a soft key light, and dots turning away fade | mouse or trackpad, in the hero | a spring that settles in about 600 ms with a slight overshoot | `interact.ts`, `signal.ts` |
| Dragging on the figure turns it (on phones it springs back to center on release) | drag | follows the finger; one figure width covers the whole range | `interact.ts` |
| The figure sways 8° each way | after 3 s without input | a 6 s cycle | `interact.ts` |
| Windows near the mouse brighten (up to 60%) and warm, like a soft spotlight | mouse or trackpad | fades over 800 ms behind the pointer | `pulse.ts`, `tower.frag.glsl` |
| A click or tap on the sky, city or water sends a pulse: a thin ring spreads over the harbour, windows switch on in a wave by distance, nearby stars glint | click or tap (never on text or controls) | light on the next frame; the wave settles in about 1 s, the ring fades in about 3 s; at most 3 at once, 400 ms apart | `interact.ts`, `pulse.ts`, `tower.frag.glsl`, `water.frag.glsl`, `stars.vert.glsl` |
| The hint "Click anywhere in the city" ("Tap the city" on touch) fades in, then out after the first pulse, and stays away on later visits | after the intro; the first pulse | 400 ms | `Hero.astro`, `hero-hint.ts` |
| Section headlines light up like neon tubes, letter by letter from the left, each striking with a flicker or two, then holding a faint glow in each word's color | the first time each headline comes into view | all lit within 700 ms; once per headline | `ignite.ts` (components and scripts), `base.css` |
| Then the titles stay alive: one or two letters of a title, now and then the whole word, flicker off and on like a tired neon tube | while a title is on screen; never two titles at once; paused while the tab is hidden | 80 to 200 ms, every 4 to 10 s per title | `ignite.ts` (scripts) |
| Hovering or tapping one of the twelve archive columns brightens it, dims the rest and shows its topic and document count above it | hover or tap, in Experience | 200 ms | `interact.ts`, `signal.ts`, `Experience.astro` |
| A playing project video tints the windows nearest it and the harbour reflections with its average color, up to 20% | while a video plays | sampled about 4 times a second off the main thread, eased over about 250 ms | `loop-video.ts`, `spill-worker.ts`, `spill.ts` |
| Under the mission, a slider runs from Previously to Now and applies the three edits one by one: each old phrase is struck, its new phrase lights, its note number glows; Previously, Edits and Now move the handle (Now is the default) | drag, tap, arrow keys | short wipes as the handle passes each edit | `MissionPanel.astro`, `mission.ts` |
| The Wisers feed drifts upward; the screen agent loops: five boxes draw around its interface, a dotted path joins them, a small cursor travels it and clicks each | while shown | the feed slowly; the agent every 6 s | `signal.ts`, `shapes/` |
| The summer being drawn is highlighted (2024, then 2025) | scroll, Wisers | 2025 from the middle of the shoe-to-screen morph | `timeline.ts`, `Experience.astro` |
| A searchlight on the tallest Central roof sweeps the sky in a lazy figure-eight, centred on the widest stretch of open sky the camera sees, dimming while it passes behind text and fading out over the figure and the Wisers pictures; stars brighten slightly inside it | after the intro, in every section | 14 s a loop | `lightshow.ts`, `sky.ts`, `main.ts` |
| A white laser dot with a soft halo and a tapering white tail replaces the cursor; a 28 px white ring over links and buttons, the normal text cursor over text and inputs | mouse or trackpad | drawn from the latest pointer event every frame; tail 180 ms | `laser.ts` |
| A slim floor display on the right edge, like a Hong Kong lift's (G, 1 to 3, R), lights the current section; a floor is a link there | scroll, `wide` layout with a mouse | follows the section under the middle of the window | `Lift.astro`, `lift.ts` |
| Live local times sit under Pomfret and Hong Kong; an arc of light travels between the two lights about every 6 s, and hovering or focusing the email sends another; Copy email confirms with Copied | Contact | 2.6 s an arc; Copied for 2 s | `Contact.astro`, `arc.ts` |
| A faint shooting star crosses the sky, never across text; tapping one of the brightest stars sends one from it | every 20 to 40 s; a tap | under a second | `shooting.ts` |
| The harbour light show: five searchlight beams sweep from rooftops across the island while the windows and a glow along the horizon pulse in rhythm | on its own while Contact is on screen | 100 beats a minute; fades out over 1 s when Contact leaves | `lightshow.ts`, `timeline.ts` |
| The scroll cue pulses, then hides | until the first scroll | 2.4 s loop | `Hero.astro` |
| More panels open and close | click | 420 ms height | `More.astro`, `more.ts` |
| The menu opens, its links step in | click | 240 ms; 420 ms | `Header.astro` |
| Previews play | at least half visible | pause when not | `loop-video.ts` |
| The Pomfret and Hong Kong labels fade in | at the bottom of the page | 400 ms | `Contact.astro` |

With reduced motion, none of this runs except opening and closing panels and the menu (instantly), and videos play only on request. Dragging the figure still turns it, directly and without a spring, and it stays where it is left. A pulse lights the windows around the tap at once and switches them off 1.5 s later, with no ring or wave, and the spotlight switches on and off without fading. Section headlines are lit from the start and never flicker. Hovering or tapping an archive column lights it and shows its label at once. Videos tint nothing. The mission's slider applies edits without animating. The arc is a faint still line, and hovering the email lights it for a moment. No shooting stars. The searchlight and the light show's beams hold still and nothing pulses. The Wisers pictures hold a still frame. The intro phone shows closed and still, a click swaps it open or closed at once, it only closes by itself when it leaves the screen, and dragging turns it directly with no inertia; the logos sit in a still, wrapping row. The system cursor stays (no laser pointer).

## Accessibility

- axe (WCAG 2.2 A and AA) on `/`, `/?snapshot` and `/404`, at 1440 x 900 and 390 x 844, each with motion on and reduced, and at 820 x 1180 (an upright iPad) and 852 x 393 (a phone sideways) with motion on, at the top and after scrolling to the bottom. Serious or critical problems fail `npm run check` and CI.
- The canvas is `aria-hidden`; every word lives in semantic HTML in reading order. Skip link, focus rings in window color with a dark halo, 44px tap targets on every touch screen (the device check measures them at 12 sizes).
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
