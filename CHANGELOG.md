# Changelog

Dated notes on what changed on the site.

## 2026-10-23

- First deploy: a holding page at https://caydenauyang.github.io.
- Site skeleton: every section from the brief (Hero, Question, Summer, Work, Progress, People, Portfolio, Contact), with Cayden's copy and its source tags in `src/data/content.ts`.
- Neutral placeholder design tokens until the visual direction is chosen.
- Preview video component, tracked-change question component, Motion On/Off switch, 404 page, placeholder share image and favicon.
- Accessibility check (`npm run check:a11y`): 0 problems at phone and laptop sizes, motion on and reduced.
- The October question is final: the question section shows the tracked edits from May with numbered notes, and a May / Marked / October switch that works without JavaScript.
- Copy updates: footer email, Lawrence Iu's title confirmed, Portfolio as one paragraph, a new Civic AI Club line, "donor update emails" for CYLF.
- Fixed the lockfile so CI's clean install works on Linux.
- Datum design: chart and vellum palette with contrast ratios, Newsreader and Atkinson Hyperlegible Next, a sticky header with Pomfret and Hong Kong clocks and a phone Index sheet, the hero plate with ticks and latitude marks, the question as survey revision marks with margin notes, the ink footer, and a scattered-points 404.
- Snapshot mode for poster screenshots (`?snapshot`, the footer switch, and print).
- Project previews, the Summer archive, the Work plates and the Progress charts (built in parallel), plus a More work row.
- Placeholder point figure data committed; the figure joins the hero once its renderer matches Datum.
- The point figure joins the hero plate. It is built from Cayden's three photos (person segmentation for the outline, monocular depth for relief) and drawn as ink points that stream in from the Pomfret and Hong Kong ticks. Outline match against the photos (IoU): front 0.978, turned right 0.92, turned left 0.87. Only point data and stills rendered from the points are published.
- The plate's corner and latitude labels sit on a vellum backing so points never cut into them.
- The Progress lines draw left to right instead of jumping. The People heading drops the copy's trailing period.
- Preview clips: three desktop loops (1280x800, under 2 MB each), checked frame by frame for flagged claims, student names and emails.
- A share image in the Datum style (name, hero line, both coordinates and the point figure on a vellum plate), rendered once from the site's own fonts and figure still. The share-image script comes later.
- The point figure is cleaned up: hair falls as curtains from a thin center part, hidden surfaces are culled so no seams show at the jaw or collar, and the face interior is sparser. Outline match: front 0.978, turned right 0.936, turned left 0.880. The share image is re-rendered with it.

## 2026-10-24

- Night Signal replaces Datum (Cayden rejected Datum after seeing it live). Kept: the three preview videos, the More work row, the deploy pipeline, the accessibility check and the figure point data.
- Milestone 1: every section from the new concise copy on a static night gradient, Unbounded and Geist, tokens with measured contrast, the full-screen menu, More toggles with the long copy, and the May / Edits / October question panel.
- Milestone 2: the three.js harbour city (sky, Peak, procedural skyline with a shared window rule, harbour reflections) and the camera on scroll. Six draw calls.
- Milestone 3: the signal, up to 60,000 points moving between six states (city, figure, current, archive columns, star field, two lights), with the hero intro.
- Milestone 4: snapshot mode, measured text contrast over the scene, fallback stills, a night share image, focus rings, 44px targets, the 8px grid, no layout shift.
- Two rounds of fixes from independent checklist reviews: one clock for the intro, a snap skip, longer scroll for short morphs, pins that rebuild when a More panel opens, a no-skyline Contact view, a distinct first work stop, reflections baked per camera stop and counting side faces, a tapered Peak, caption scrims, the Contact scrim kept inside the page, Geist with no late swap.
- CI: the lockfile regained two Linux-only optional packages that a macOS install had dropped.
- Round 2, item A: Barlow Condensed and JetBrains Mono replace Unbounded and Geist; text colors by role (headlines in window amber, project names and subheads in cool, small labels in neon, meta in dim), each pairing measured against the scene; Summer becomes Experience (Civic Exchange, then the two Wisers summers); More work has two cards; 12,000 stars that twinkle and flash; the twelve archive columns sized by their real document counts, framed in clear sky.
- Round 2, spec 5.1: the figure of light is truly three-dimensional and turns: the pointer turns it up to 30 degrees each way and tilts it 5, through a spring; dragging turns it, on phones too; it sways when idle. One 3D point set is fitted to all three photo outlines (outline match: front 0.977, turned right 0.966, turned left 0.946, against 0.978, 0.936 and 0.880 before), each point carries a normal (figure data format CASG version 2, same size), and points facing away fade while the outline brightens. The Since May star field is sparser, so the real stars show.
- Round 2, 11b.1 signal pulse: the mouse is a soft spotlight on the windows; a click or tap on the sky, city or water sends a ring across the harbour and a wave of windows switching on, and nearby stars glint; a one-time hint in the hero. The renderer can no longer start a second frame loop when asked to draw from inside a frame. Phones get 6,500 stars so the first screen's sky is as dense as a laptop's.
- Round 2, 11b.2 neon ignition: the first time each section headline comes into view, its letters strike left to right like neon tubes and hold a faint amber glow; screen readers get the plain heading.
- Round 2, 11b.3 the archive as real data: hovering or tapping a column shows its notebook and document count ("Energy, 264 documents"); the same twelve counts are in a list for screen readers.
- Round 2, 11b.4 video light spill: while a project video plays, its average color tints the nearest windows and the harbour reflections, up to 20%.
- Round 2, 11b.5 question scrubber: a slider from May to October applies the edits one at a time (mouse, touch or arrow keys); May, Edits and October are presets.
