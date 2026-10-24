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
