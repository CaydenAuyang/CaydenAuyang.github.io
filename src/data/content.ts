// content.ts: every sentence the site shows, in one place.
//
// The section components in src/components/sections/ read from this file and nothing else, so
// changing a line here changes it on the page. The wording follows Cayden's copy files word for
// word: the concise copy is what the page shows, and the longer copy appears only inside the
// "More" toggles (each `more` field below).
//
// Every factual line is a `Line`:
//   text     what the page shows.
//   source   the source tag for that line (fact-sheet keys such as "CEX §3b, ER §5.1"), kept so
//            every claim can be traced. It is never rendered.
//
// Faculty appear by office, never by name.

export interface Line {
  text: string;
  source?: string;
}

export interface Link {
  label: string;
  href: string;
}

// ---- Page meta ---------------------------------------------------------------------------------

export const meta = {
  title: 'Cayden Auyang',
  description: {
    text: 'Cayden Auyang, Pomfret School Class of 2027. I study how institutions hear the people they serve, and build tools that help them do it.',
    source: 'POSTER; CEX; CLUB',
  } satisfies Line,
  figureAlt: 'Cayden, drawn in points of light above the Hong Kong skyline.',
};

// ---- Title colors -----------------------------------------------------------------------------

// Every title's words in their own color (content.md, Interface labels, Title colors). Keys are the
// titles as written in this file; one color per word, in order, only window, cool and text (no
// pink). Tokens: tokens.css.
export type TitleColor = 'window' | 'cool' | 'text';
export const titleColors: Record<string, TitleColor[]> = {
  'Cayden Auyang': ['window', 'cool'],
  'Why I build': ['text', 'text', 'window'],
  Experience: ['cool'],
  'Civic Exchange': ['window', 'text'],
  Wisers: ['window'],
  'Selected work': ['window', 'cool'],
  OurCityHealth: ['cool'],
  'AI Simply': ['window', 'cool'],
  'Civic AI Club': ['cool', 'window', 'cool'],
  'More work': ['text', 'window'],
  'Reach out': ['window', 'cool'],
};

// ---- Navigation --------------------------------------------------------------------------------

export const nav: Link[] = [
  { label: 'Mission', href: '#mission' },
  { label: 'Experience', href: '#experience' },
  { label: 'Work', href: '#work' },
  { label: 'Contact', href: '#contact' },
];

// The lift indicator on desktop (content.md, Interface labels): G for the hero, a floor per
// section, R (the roof) for Contact. `name` is the section it stands for; G's is the hero's name.
export const floors: { floor: string; name: string; href: string }[] = [
  { floor: 'G', name: 'Cayden Auyang', href: '#hero' },
  { floor: '1', name: 'Mission', href: '#mission' },
  { floor: '2', name: 'Experience', href: '#experience' },
  { floor: '3', name: 'Work', href: '#work' },
  { floor: 'R', name: 'Contact', href: '#contact' },
];

// ---- 1. Hero -----------------------------------------------------------------------------------

export const hero = {
  name: 'Cayden Auyang',
  // The name breaks onto two lines in the hero.
  nameLines: ['Cayden', 'Auyang'],
  line: {
    text: 'I study how institutions hear people, and build tools that help.',
    source: 'POSTER; CEX §3; CLUB §4',
  } satisfies Line,
  small: {
    text: 'Grew up in Hong Kong. Pomfret School, Class of 2027.',
    source: 'About Cayden (personal notes)',
  } satisfies Line,
  scrollCue: 'Scroll',
};

// ---- 1b. Intro module --------------------------------------------------------------------------

// Between the hero and the mission (content.md section 1b, V4.md section 6): the folding phone, the
// greeting card and the "Worked with" logo strip. It has no title; it belongs to the hero's floor.

/**
 * One of the strip's logos, in one flat text color (V4.md 6.3, 8.7): a symbol in the SVG sprite
 * public/intro/logos/logos.svg (filled with the page's text color), or a WebP in public/intro/logos/.
 */
export interface Logo {
  // The organisation's name: the image's alt text.
  name: string;
  // The sprite symbol's id, or the raster file's path: one or the other.
  symbol?: string;
  src?: string;
  // The symbol's viewBox size, or the file's own size in px, for the width and height attributes
  // (no layout shift).
  width: number;
  height: number;
  // Its height on desktop in px, between 36 and 44, so wide wordmarks and tall marks carry the
  // same weight (phones show 0.7 of it). Tuned by eye in the strip.
  size: number;
  // Where the logo came from. Never rendered.
  source: string;
}

export const intro = {
  // What the phone's two screens show (content.md 1b alt texts): the live phone's description (it
  // is a button, "Open the phone"). The still shows it closed, so only the cover photo.
  phoneLabel:
    'A folding phone showing two photos: Cayden, smiling in front of painted lanterns, and Civic AI Club members around a meeting table',
  phoneStillLabel: 'A folded phone showing a photo: Cayden, smiling in front of painted lanterns',
  // The greeting card (Cayden approved option C). `bold` is the phrase inside `text` shown in window.
  greeting: [
    { text: "Hi, I'm Cayden." },
    { text: "I'm a student and civic tech builder, hooked on passing know-how on.", bold: 'civic tech builder' },
    { text: 'Building tools for nonprofits, schools and small businesses, then handing them over, clean.' },
  ] as { text: string; bold?: string }[],
  greetingSource: 'CEX §3; CLUB §4; OCH §5; "know-how" from Cayden\'s mission, Oct 24',
  // The link line. Cayden may swap it for a CV PDF later.
  email: { text: 'caydenauyang@gmail.com', source: 'POSTER' } satisfies Line,
  logosLabel: 'Worked with',
  // What the strip's pause button names (with ui.pause and ui.play): "Pause the logos".
  logosName: 'the logos',
  // In this order (content.md 1b). [CONFIRM in REVIEW.md: "Worked with" is accurate for all six.]
  // Three of the four organisations' sites publish no SVG logo, so those three are traced from the
  // largest official raster each site has (potrace, then hand-checked against the original).
  logos: [
    {
      name: 'Changing Young Lives Foundation',
      symbol: 'changing-young-lives',
      width: 265,
      height: 160,
      size: 44,
      source:
        'Traced from https://www.changingyounglives.org.hk/wp-content/uploads/2016/12/logo.png (the site header, 400 x 242); the site has no SVG',
    },
    {
      name: 'Civic Exchange',
      symbol: 'civic-exchange',
      width: 759,
      height: 200,
      size: 40,
      source:
        'Traced from https://civic-exchange.org/wp-content/uploads/2016/11/CE-logo_white.png (1353 x 406, the site media library; the header shows the same logo as ce-logo.png at 218 x 57); the site has no SVG',
    },
    {
      name: 'Silver Pillars',
      src: '/intro/logos/silver-pillars.webp',
      width: 72,
      height: 96,
      size: 44,
      source: 'site-handoff/hero-module/web/logos/silver-pillars.webp (from Cayden\'s file), recoloured to text',
    },
    {
      name: 'Capstone',
      symbol: 'capstone',
      width: 639,
      height: 120,
      size: 36,
      source:
        'Traced from https://www.capstoneprep.com/wp/wp-content/uploads/2018/11/cap-logo.png (1481 x 474, the site media library): the CAPSTONE serif wordmark alone, as the white header logo (Captone_CTL_White.png) shows it on navy; the site has no SVG',
    },
    {
      name: 'MAK Solicitors',
      src: '/intro/logos/mak-solicitors.webp',
      width: 196,
      height: 96,
      size: 42,
      source: 'site-handoff/hero-module/web/logos/mak-solicitors.webp (from Cayden\'s file), recoloured to text',
    },
    {
      name: 'Pomfret School',
      symbol: 'pomfret',
      width: 188,
      height: 41,
      size: 36,
      source: 'https://resources.finalsite.net/images/v1710351085/pomfret/usyvkhpb3fbp3swt0it0/logo-white.svg (the site header), its path unchanged',
    },
  ] satisfies Logo[],
};

// ---- 2. The mission ----------------------------------------------------------------------------

// One tracked change, from the Previously text to the Now text. Edits apply in order, left to
// right, each searching the Previously text from where the previous edit ended.
//   del:      strike `text`.
//   ins:      insert `text` right after the words in `after`. `after: ''` means directly after the
//             previous edit.
//   replace:  strike `text` and insert `insertText` right after it.
// The build stops with an error if a `text` or `after` can't be found, or if the edits don't turn
// the Previously text into the Now text exactly (MissionPanel.astro).
export interface Edit {
  type: 'del' | 'ins' | 'replace';
  text: string;
  insertText?: string;
  after?: string;
}

// A title (v5, Cayden picked it Oct 26), and still no lead or notes: the switch is the panel's only
// label. The nav and the lift still say Mission.
export const mission = {
  heading: 'Why I build',
  // The switch, left to right. The default view is Now.
  views: { from: 'Previously', edits: 'Edits', to: 'Now' },
  from: {
    text: "If money is what separates people, what could I build that's big enough to close the gap? Which tool finally makes it fair?",
    source: 'Cayden, Oct 24 chat',
  } satisfies Line,
  // Cayden's draft; he may still edit it.
  to: {
    text: 'Why does know-how move so easily among the people who already have it, and so rarely reach the people who need it most? What does it take to get it across, and how do I pass it on in a way that lets them pass it on too?',
    source: 'Cayden, Oct 24 chat; angle from his Common App essay',
  } satisfies Line,
  // In reading order. Phrase level: each old phrase is struck, the new one inserted right after it.
  edits: [
    {
      type: 'replace',
      text: 'If money is what separates people,',
      insertText: 'Why does know-how move so easily among the people who already have it, and so rarely reach the people who need it most?',
    },
    { type: 'replace', text: "what could I build that's big enough to close the gap?", insertText: 'What does it take to get it across,' },
    {
      type: 'replace',
      text: 'Which tool finally makes it fair?',
      insertText: 'and how do I pass it on in a way that lets them pass it on too?',
    },
  ] satisfies Edit[] as Edit[],
};

// ---- 3. Experience -----------------------------------------------------------------------------

export interface MoreBlock {
  // A short bold lead-in ("The problem."), shown at the start of the text's paragraph.
  title?: string;
  // A heading line of its own above the text: bold words, then the rest in regular weight
  // ("Measuring What Matters" then "(independent study, fall 2026)").
  head?: { bold: string; rest?: string };
  text?: Line;
  list?: Line[];
}

// Civic Exchange first, with the full block; then Wisers, one entry with two summers.
export interface Summer {
  beat: '2024' | '2025';
  label: string;
  line: Line;
  link?: Link;
}

export const experience = {
  heading: 'Experience',
  civic: {
    name: 'Civic Exchange, Hong Kong',
    meta: {
      text: 'Intern (voluntary), June 9 to August 28, 2026',
      source: 'CEX §1, Agr; C4 p6',
    } satisfies Line,
    // Moved here from the People section (cut in v4).
    supervisor: {
      text: 'Supervised by Lawrence Iu, Executive Director, who pushed me to build a model other nonprofits could follow.',
      source: 'CEX §2, J6tx, J15',
    } satisfies Line,
    lead: {
      text: 'A Hong Kong think tank had 25 years of research nobody could search. I listened first, then built the fix.',
      source: 'CEX §2, C1 p1; CEX §3',
    } satisfies Line,
    facts: [
      { text: '11 interviews before building anything', source: 'CEX §3a, UR, FD P2' },
      // The twelve notebooks (`archive` below) are listed under this fact for screen readers.
      { text: '12 searchable notebooks, about 2,350 documents', source: 'CEX §3b, ER §3.1', archive: true },
      { text: '18 of 18 hand-checked citations correct', source: 'CEX §3b, ER §5.1' },
      { text: 'Handed over with a 39-page manual and a staff workshop', source: 'CEX §3g, FD P42; §3f, FD P38' },
    ] satisfies (Line & { archive?: boolean })[] as (Line & { archive?: boolean })[],
    // The full Summer section from the long copy (The problem, Listening first, What I built,
    // What I took away).
    more: [
      {
        title: 'The problem.',
        text: {
          text: "Civic Exchange is a public policy think tank in Hong Kong. Its executive director, Lawrence Iu, didn't give me a technical assignment. He described a problem: staff used AI in different ways and got different results, 25 years of research sat in folders nobody could search, and reports didn't share a style.",
          source: 'CEX §2, C1 p1; CEX §3; title confirmed by Cayden',
        },
      },
      {
        title: 'Listening first.',
        text: {
          text: 'I started with interviews: 11 of them, from interns to the executive director, written up as a report on how the team actually used AI. Then a staff town hall, where the real objections came out, and the team approved the notebook categories before I built the full set.',
          source: 'CEX §3a, UR, FD P2; CEX §3f, FD P18; CEX §6, CE p32',
        },
      },
      {
        title: 'What I built.',
        list: [
          {
            text: '12 searchable notebooks holding about 2,350 documents, drawn from an archive of more than 10,000 files.',
            source: 'CEX §3b, ER §3.1; Corpus_Triage',
          },
          {
            text: 'Every answer cites its source. In testing, all 18 citations I checked by hand were correct, and questions asked in Chinese worked too.',
            source: 'CEX §3b, ER §5.1, FD P17',
          },
          {
            text: "Writing and translation assistants grounded in Civic Exchange's own reports and its 390-term glossary.",
            source: 'CEX §3c, ER §3.3',
          },
          { text: 'A move to Google Workspace for Nonprofits, worked out with the operations team.', source: 'CEX §3e, FD P22' },
          {
            text: 'A handover: a 39-page manual and a workshop where everyone in the room used the tools.',
            source: 'CEX §3g, FD P42; CEX §3f, FD P38',
          },
        ],
      },
      {
        title: 'What I took away.',
        text: {
          text: 'The hard part was never the model. It was finding out what people actually needed, and giving them something they could check. These tools can find and draft. Deciding what matters stays with people.',
          source: 'CEX §2, C1 p1; CEX §3g, FD P43; CEX §6, ER §6.3',
        },
      },
    ] satisfies MoreBlock[] as MoreBlock[],
    moreLabel: 'about Civic Exchange',
  },
  // Wisers: one entry, two summers, 2024 first. The signal draws each summer as you reach it.
  wisers: {
    name: 'Wisers Information Limited, Hong Kong',
    // CONFIRM: the title. Records say Data Intern, AI Team Intern and AI Engineering Intern, so
    // the page says plain "Intern" until Cayden picks one.
    meta: { text: 'Intern, two summers (2024 and 2025)', source: 'OCH §3, CV' } satisfies Line,
    summers: [
      {
        beat: '2024',
        label: 'Summer 2024',
        line: {
          text: 'Built a pipeline that turned thousands of RedNote posts into brand analysis for four sportswear brands.',
          source: 'POSTER; OCH §3; Drive: Sportswear Brand Trend Analysis Report, July 2024',
        },
      },
      {
        beat: '2025',
        label: 'Summer 2025',
        line: {
          text: "Built a prototype agent that reads a Mac's screen with computer vision and OCR, then plans its steps with a language model.",
          source: 'OCH §3, GUI',
        },
        link: { label: 'View the code', href: 'https://github.com/CaydenAuyang/screen-parsing-gui-agent' },
      },
    ] satisfies Summer[] as Summer[],
  },
};

/**
 * The twelve notebooks behind "12 searchable notebooks, about 2,350 documents": the Experience
 * archive columns (NIGHT-SIGNAL.md 11b.3). Each label reads "<topic>, <count> documents". The
 * counts add up to 2,347, shown on the page as "about 2,350".
 */
export const archive = {
  source: 'CEX §3b, ER §3.1',
  columns: [
    { topic: 'Overview', count: 80 },
    { topic: 'Energy', count: 264 },
    { topic: 'Mobility', count: 299 },
    { topic: 'Buildings', count: 179 },
    { topic: 'Finance', count: 300 },
    { topic: 'Nature', count: 293 },
    { topic: 'Waste', count: 42 },
    { topic: 'Cross-cutting', count: 290 },
    { topic: 'Urban Liveability', count: 170 },
    { topic: 'Community', count: 117 },
    { topic: 'Consumption', count: 13 },
    { topic: 'Sustainable Finance (team)', count: 300 },
  ],
  total: 2347,
  label: (topic: string, count: number) => `${topic}, ${count} documents`,
};

// ---- 4. Work -----------------------------------------------------------------------------------

export interface Project {
  // The world's work stop (contract.ts SceneKey) and the preview's projectId in previews.json.
  stop: 'och' | 'ais' | 'club';
  previewId: string;
  name: string;
  role: Line;
  lead: Line;
  facts: Line[];
  link: Link;
  caption: string;
  more?: MoreBlock[];
}

export const work = {
  heading: 'Selected work',
  projects: [
    {
      stop: 'och',
      previewId: 'ourcityhealth',
      name: 'OurCityHealth',
      role: { text: 'Founder, since November 2024', source: 'OCH §1, CV' },
      lead: { text: 'A free dashboard that scores cities from what local news reports.', source: 'OCH §1, GHC' },
      facts: [
        { text: 'The demo shows saved scores from news dated 2014 to early 2024', source: 'OCH §1, REPO, GHC' },
        { text: 'My own pipeline has analyzed three cities so far', source: 'OCH §1, E44' },
        { text: 'This fall: testing whether the news actually tracks how a city is doing', source: 'OCH §2, ISP' },
      ],
      link: { label: 'Open the site', href: 'https://caydenauyang.github.io/OurCityHealth/' },
      caption: 'Saved demo data, news from 2014 to early 2024.',
      more: [
        {
          head: { bold: 'Measuring What Matters', rest: '(independent study, fall 2026)' },
          text: {
            text: "I'm comparing official statistics with informal signals (local news, search trends and social media) for Hong Kong, New York and London across about two decades. Before any category counts, I hand-code a sample and check the AI's labels against it. Two faculty mentors advise the study, and it runs through the end of the fall term.",
            source: 'OCH §2, ISP, METH, ISC',
          },
        },
      ],
    },
    {
      stop: 'ais',
      previewId: 'aisimply',
      name: 'AI Simply',
      role: { text: 'Founder, one-person practice', source: 'OCH §5, CV, AIS' },
      lead: { text: 'Tools for charities and small businesses. Unpaid so far.', source: 'OCH §5, CV, E46' },
      facts: [
        { text: "Automated a Hong Kong charity's donor update emails (2024)", source: 'OCH §5, TRK' },
        { text: 'Built a bilingual photo-album site for Our Gallery in Wan Chai (2025 to 2026)', source: 'OCH §5, SITE, AIS' },
      ],
      link: { label: 'Open the site', href: 'https://aisimply.co' },
      caption: 'aisimply.co',
    },
    {
      stop: 'club',
      previewId: 'civicaiclub',
      name: 'Civic AI Club',
      role: { text: 'Founder and president, Pomfret School', source: 'CLUB §2' },
      lead: { text: 'School offices bring us a problem. Students build the tool and hand it over.', source: 'CLUB §8, CTX' },
      facts: [
        { text: '40+ members, 8 cases this year', source: 'CLUB §2; CLUB §1, §4' },
        { text: '2 tools handed over in October', source: 'CLUB §4 A, B' },
        { text: 'None of our tools calls an AI model', source: 'CLUB §8, CTX' },
      ],
      link: { label: 'Open the site', href: 'https://civicaiclub.github.io' },
      caption: 'Demo data.',
      // The club's full facts from the long copy.
      more: [
        {
          list: [
            { text: '40+ members.', source: 'CLUB §2' },
            { text: 'Eight cases this school year, each for a different school office.', source: 'CLUB §1, §4' },
            {
              text: 'Two tools delivered and handed over in October: a weekly planner for the CLC Supported Study Hall, and a lesson and booking portal for the Music Department.',
              source: 'CLUB §4 A, B',
            },
            { text: "None of the tools we've built so far calls an AI model.", source: 'CLUB §8, CTX' },
            { text: 'Three local organizations have student teams at the discovery stage.', source: 'CLUB §5' },
            { text: 'A school-wide AI Literacy Week in May 2026, with AI Youth Alliance.', source: 'CLUB §6' },
          ],
        },
      ],
    },
  ] satisfies Project[] as Project[],
  moreWork: {
    heading: 'More work',
    linkLabel: 'GitHub',
    items: [
      {
        name: 'Han Dynasty Jeopardy',
        line: { text: 'A teaching game for my Advanced Global Studies class.', source: 'POSTER; 20-Repos card' },
        href: 'https://github.com/CaydenAuyang/Han-Dynasty-Jeopardy',
      },
      {
        name: 'Inferno Acoustic Map',
        line: { text: "Dante's Inferno, mapped by how its sound decays.", source: 'POSTER; 20-Repos card' },
        href: 'https://github.com/CaydenAuyang/Inferno-Acoustic-Map',
      },
    ],
  },
};

// ---- 7. Contact (footer) -----------------------------------------------------------------------

export const contact = {
  heading: 'Reach out',
  email: { text: 'caydenauyang@gmail.com', source: 'POSTER' } satisfies Line,
  github: { label: 'GitHub', href: 'https://github.com/CaydenAuyang' } satisfies Link,
  smallPrint: 'Cayden Auyang. Pomfret School, Class of 2027.',
  // The labels under the two lights the signal draws at the contact key.
  lights: { pomfret: 'Pomfret', hongKong: 'Hong Kong' },
};
