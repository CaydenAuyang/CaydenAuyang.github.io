// site.ts: facts about the site itself (its name and address) and the small interface words that
// are not part of Cayden's copy (button labels, screen-reader hints).
// Everything a visitor reads as content lives in content.ts instead.

export const site = {
  name: 'Cayden Auyang',
  url: 'https://caydenauyang.github.io',
  // The browser bar color on phones. Keep it equal to --night in src/styles/tokens.css.
  themeColor: '#05070D',
  // The share image (1200 x 630) in public/.
  ogImage: '/og.png',
  ogImageAlt: 'Cayden Auyang, with one line about his work, beside a figure of him drawn in points.',
};

export const ui = {
  skip: 'Skip to content',
  menu: 'Menu',
  close: 'Close',
  menuLabel: 'Sections',
  newTab: '(opens in a new tab)',
  play: 'Play',
  pause: 'Pause',
  previewOf: (name: string) => `${name} preview`,
  previewPending: 'Recording to come',
  more: 'More',
  less: 'Less',
  viewLegend: 'Show the question as',
  // The mission scrubber (NIGHT-SIGNAL.md 11b.5): its label (content.md Interface labels) and what
  // each stop says to screen readers.
  scrubLabel: 'Drag from Previously to Now',
  scrubStep: (k: number, n: number, what: string) => `Edit ${k} of ${n}: ${what}`,
  scrubStruck: (words: string) => `"${words}" struck`,
  scrubInserted: (words: string) => `"${words}" inserted`,
  scrubReplaced: (from: string, to: string) => `"${from}" replaced with "${to}"`,
  deleted: 'deleted',
  inserted: 'inserted',
  moreAbout: (name: string) => `about ${name}`,
  emailLabel: 'Email',
  // Contact (NIGHT-SIGNAL.md 11b.7, content.md Interface labels).
  copyEmail: 'Copy email',
  copied: 'Copied',
  // The lift indicator (NIGHT-SIGNAL.md 11b.6): the nav's label for screen readers.
  liftLabel: 'Floors',
  // The one-time hint in the hero (NIGHT-SIGNAL.md 11b.1, content.md Interface labels).
  hintMouse: 'Click anywhere in the city',
  hintTouch: 'Tap the city',
  // The intro phone (V5.md 1.3, 1.4): its button's name, open or closed, and the hint under it.
  phoneOpen: 'Open the phone',
  phoneClose: 'Close the phone',
  phoneHintMouse: 'Click to open',
  phoneHintTouch: 'Tap to open',
  notFoundTitle: 'Page not found',
  notFoundBody: 'There is nothing at this address.',
  notFoundLink: 'Go to the home page',
};
