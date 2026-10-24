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
