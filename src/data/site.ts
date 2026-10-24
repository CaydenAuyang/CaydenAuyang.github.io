// site.ts: facts about the site itself (its name and address) and the small interface words
// that are not part of Cayden's copy (button labels, screen-reader hints).
// Everything a visitor reads as content lives in content.ts instead.

export const site = {
  name: 'Cayden Auyang',
  url: 'https://caydenauyang.github.io',
  // The browser bar color on phones. Keep it equal to --chart in src/styles/tokens.css.
  themeColor: '#e2e8e9',
  // The share image (1200 x 630) in public/.
  ogImage: '/og.png',
  ogImageAlt: 'Cayden Auyang, with one line about his work, beside a figure of him drawn in points on a pale survey plate.',
  // The key the Motion On/Off choice is saved under in the visitor's browser.
  motionKey: 'ca:motion',
  // The key the Snapshot view choice is saved under.
  snapshotKey: 'ca:snapshot',
};

// Places on the chart. Design labels allowed by the Datum spec.
export const places = {
  pomfret: { name: 'Pomfret', lat: 41.87, coords: '41.87° N 71.97° W' },
  hongKong: { name: 'Hong Kong', lat: 22.32, coords: '22.32° N 114.17° E' },
};

export const ui = {
  // Design labels from the Datum spec.
  clockPomfret: 'Pomfret',
  clockHongKong: 'Hong Kong',
  index: 'Index',
  openFullSite: 'Open the full site',
  replay: 'Replay',
  figure: (n: number) => `Fig. ${n}`,
  heroCaption: 'Cayden',
  heroCaptionCount: (count: string) => `, in ${count} points.`,
  snapshot: 'Snapshot view',
  // Interface words.
  skip: 'Skip to content',
  navLabel: 'Sections',
  newTab: '(opens in a new tab)',
  motion: 'Motion',
  motionOn: 'On',
  motionOff: 'Off',
  motionDevice: 'Off (device setting)',
  motionDeviceNote: 'Motion is off because your device asks websites for reduced motion.',
  play: 'Play',
  pause: 'Pause',
  previewOf: (name: string) => `${name} preview`,
  previewPending: 'To come: preview recording',
  noteRef: (n: number) => `Note ${n}`,
  viewLegend: 'Show the question as',
  viewMay: 'May',
  viewMarked: 'Edits',
  viewOctober: 'October',
  backToEdit: (n: number) => `Back to edit ${n}`,
  deleted: 'deleted',
  inserted: 'inserted',
  notFoundTitle: 'Page not found',
  notFoundBody: 'There is nothing at this address.',
  notFoundLink: 'Go to the home page',
};
