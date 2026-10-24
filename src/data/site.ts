// site.ts: facts about the site itself (its name and address) and the small interface words
// that are not part of Cayden's copy (button labels, screen-reader hints).
// Everything a visitor reads as content lives in content.ts instead.

export const site = {
  name: 'Cayden Auyang',
  url: 'https://caydenauyang.github.io',
  // The browser bar color on phones. Keep it equal to --bg in src/styles/tokens.css.
  themeColor: '#ffffff',
  // The share image (1200 x 630) in public/.
  ogImage: '/og.png',
  ogImageAlt: 'Cayden Auyang, certificate portfolio.',
  // The key the Motion On/Off choice is saved under in the visitor's browser.
  motionKey: 'ca:motion',
};

export const ui = {
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
  backToEdit: 'Back to the edit',
  deleted: 'deleted:',
  inserted: 'inserted:',
  notFoundTitle: 'Page not found',
  notFoundBody: 'There is nothing at this address.',
  notFoundLink: 'Go to the home page',
};
