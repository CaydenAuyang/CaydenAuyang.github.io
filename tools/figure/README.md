# The point figure

This folder builds the hero figure: Cayden drawn in points, from three ordinary photos. The site
loads the result from `public/figure/` and draws it with `src/figure/` (WebGL, no libraries).

## Privacy rule

The photos are read where they are and never copied into this repo. Everything made from them
(decoded images, mattes, depth maps, overlay checks) goes to the work folder, which lives outside
the repo:

    ~/Documents/Claude/Projects/CERTIFICATE/figure-work/

`build.mjs` refuses to run if the work folder is inside the repo. The only things it writes into
the repo are the point data (`public/figure/figure-hi.bin`, `figure-lo.bin`, `figure.json`) and the
still image rendered from those points (`figure-fallback.webp`, `figure-fallback.png`).

## Run it

Once, install the two packages (the depth model runtime and a headless browser driver):

    cd tools/figure && npm install

Then, from the repo root:

    node tools/figure/build.mjs

That reads the three photos from their default place:

    ~/Documents/Claude/Projects/CERTIFICATE/site-handoff/photos/1-front_IMG_1601.heic
    ~/Documents/Claude/Projects/CERTIFICATE/site-handoff/photos/2-turned-toward-viewer-right_IMG_1611.heic
    ~/Documents/Claude/Projects/CERTIFICATE/site-handoff/photos/3-turned-toward-viewer-left_IMG_1621.heic

For other photos, name them:

    node tools/figure/build.mjs --front a.heic --right b.heic --left c.heic

"Right" means his face points to the right side of the picture. The first run compiles the Swift
tool (about 40 seconds) and downloads the depth model (about 100 MB, cached in the work folder).
After that a build takes about 20 seconds.

Options: `--no-publish` (build and check, but leave `public/figure/` alone), `--no-fallback` (skip
the still image), `--rounds 1` (no yaw refinement), `--fresh` (redo the Swift and depth steps),
`--work <dir>`, `--hi 60000`, `--lo 18000`.

`node tools/figure/build.mjs --placeholder` builds a made-up bust with no photos. Careful: it
publishes too, so it replaces the real figure unless you add `--no-publish`.

## What happens

1. `extract.swift` decodes each photo with its orientation applied, checks for an iPhone depth map
   or Portrait matte (these cropped copies have neither), and runs Apple Vision: person
   segmentation at accurate quality for the outline, face landmarks, and the face angle.
2. `depth.mjs` runs Depth Anything V2 Small on each photo. Its depth is relative, so the build
   works out the scale itself.
3. `lib/photo.mjs` fits the bust. The front outline gives the width of every horizontal slice.
   The face landmarks line the turned photos up with the front one. The leading edge of the face
   in each turned photo gives that photo's angle and the depth scale. The trailing edges give the
   back of the head and neck. The front depth gives the face relief. Where the photos clip the
   shoulders, a shoulder curve fitted to the visible slope finishes them, and the chest depth comes
   from proportions. Dark pixels inside the outline above the chin are hair.
4. `lib/points.mjs` and `lib/emit.mjs` turn the bust into points: 42.5% on the outline, weighted
   toward surfaces seen edge on; 25% hair, mostly strands flowing from a clean center part; 25%
   neck, shoulders and chest, thinning toward the bottom; 3% ears; 4.5% face, kept sparse with a
   faint gather on brows, nose and lips. Surfaces hidden behind the front of the figure from every
   angle the site shows (yaw -6 to +6 degrees) get only a trace, because points are see-through.
5. `overlay.mjs` checks the likeness (below). `build.mjs` feeds the best-matching angles back into
   the fit and repeats while the match improves, then keeps the best round.
6. `render-fallback.mjs` draws the still image from the points through the real renderer.
7. Everything is staged in `figure-work/stage/` and then copied into `public/figure/`, one file at
   a time, each written to a temporary name and renamed, so a half-written file is never there.
   The build will not publish if the front match drops below 0.97.

## Reading the overlay report

`node tools/figure/overlay.mjs` (it also runs at the end of every build) prints one line per photo
and writes pictures to the work folder:

    overlay front  yaw    0.0 deg (fit said 0.0)  IoU 0.9778  head+neck 0.9672
    overlay right  yaw   46.0 deg (fit said 40.0)  IoU 0.9358  head+neck 0.9130
    overlay left   yaw  -27.0 deg (fit said -42.0) IoU 0.8802  head+neck 0.9016

- **yaw** is the angle that makes the figure's outline match that photo best. "fit said" is the
  angle the fit estimated from the face's leading edge.
- **IoU** is how much the figure's outline and the photo's outline overlap: the shared area divided
  by the combined area. 1.0 is a perfect match. Above about 0.95, the two are hard to tell apart.
- **head+neck** is the same score for the part above the shoulders only (above the dashed line in
  the pictures). The shoulders in all three photos are cut off by the frame, so below the neck the
  figure is partly built from proportions, and the full score mixes that in.

The pictures are `overlay-front.png`, `overlay-right.png`, `overlay-left.png` and
`overlay-all.png` (all three side by side): the photo dimmed, the photo's outline in teal, the
figure's outline in orange, purple where they coincide, and the points faintly on top. The site
only ever turns the figure about 6 degrees, so the front match matters most.

## Other tools

- `node tools/figure/preview.mjs hi --yaws -6,0,6` draws the published points at a few angles
  (ink on vellum) into the work folder. Add `--dir <folder>` to preview a staged build.
- `node tools/figure/harness/shoot.mjs` screenshots the renderer at 390x844 and 1440x900 with
  motion on, reduced, off, snapshot mode, slow data and no WebGL.
- `node tools/figure/render-fallback.mjs` redraws only the still image.

## The night scene's figure (the signal)

The Night Signal design draws the figure as target B of the particle system (`src/world/signal.ts`)
instead of with `src/figure/`. It uses its own file, built from the same photo fit:

    node tools/figure/signal.mjs                    rebuild from the photos (about 3 s once cached)
    node tools/figure/signal.mjs --from-published   resample public/figure/figure-hi.bin instead

It writes `public/world/figure-signal.bin` and `figure-signal.json`. The look (`SIGNAL_LOOK` in
`signal.mjs`) puts 46% of the points on the outline, 27% on hair (mostly strands from the part),
4% on a sparse face, quiets creases inside the outline (additive light turns them into bright
lines) and dissolves the chest over the bottom third. One 60,000-point file serves every tier: the
points are ordered so any first N keep each group's share and keep hair strands whole, so phones
read only the first 16,000 (128 KB) and stop the download there. Format: the top of
`lib/signal-format.mjs` ("CASG", 8 bytes a point).

Other signal tools (a dev server must be running, `npx astro dev --port 4329`):

- `node tools/figure/signal-shots.mjs --gpu` screenshots `/lab/signal` at 390x844 and 1440x900 for
  every target and the midpoints of the morphs, with a contact sheet per size. `--film B,C` films
  one morph at t = 0, 0.1, ... 1; `--bench` adds GPU frame times; `--world mock` uses the lab's mock
  city. Output goes to `figure-work/signal-shots/`.
- `node tools/figure/signal-still.mjs` renders `public/world/figure-still.webp`, the glowing
  figure on transparent for the no-WebGL fallback, drawn from the points by the signal itself.

## The data format

See the top of `lib/format.mjs`. In short: a 48-byte header (magic "CAFG", count, bounds), then
for each point three 16-bit positions, a two-byte normal, one byte for group and weight, and one
byte for when it arrives during the assemble. 10 bytes a point: 586 KB for 60,000 points and
176 KB for 18,000. The points are shuffled, so the first N of either file are an even sample.
