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
  'Where it started': ['text', 'text', 'window'],
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
  { label: 'Origins', href: '#mission' },
  { label: 'Experience', href: '#experience' },
  { label: 'Work', href: '#work' },
  { label: 'Contact', href: '#contact' },
];

// The lift indicator on desktop (content.md, Interface labels): G for the hero, a floor per
// section, R (the roof) for Contact. `name` is the section it stands for; G's is the hero's name.
export const floors: { floor: string; name: string; href: string }[] = [
  { floor: 'G', name: 'Cayden Auyang', href: '#hero' },
  { floor: '1', name: 'Origins', href: '#mission' },
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
  // (no layout shift). Both are trimmed to the logo's visible marks, so LogoStrip.astro sizes each
  // logo by their area (V5 section 4).
  width: number;
  height: number;
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
    { text: "I'm a student and civic tech builder.", bold: 'civic tech builder' },
    { text: 'Building tools for nonprofits, schools and small businesses, then handing them over, clean.' },
  ] as { text: string; bold?: string }[],
  greetingSource: 'CEX §3; CLUB §4; OCH §5',
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
      source:
        'Traced from https://www.changingyounglives.org.hk/wp-content/uploads/2016/12/logo.png (the site header, 400 x 242); the site has no SVG',
    },
    {
      name: 'Civic Exchange',
      symbol: 'civic-exchange',
      width: 759,
      height: 200,
      source:
        'Traced from https://civic-exchange.org/wp-content/uploads/2016/11/CE-logo_white.png (1353 x 406, the site media library; the header shows the same logo as ce-logo.png at 218 x 57); the site has no SVG',
    },
    {
      name: 'Silver Pillars',
      src: '/intro/logos/silver-pillars.webp',
      width: 116,
      height: 156,
      source: 'site-handoff/hero-module/logos/silver-pillars-mono.png (Cayden\'s file, already in the text color), resized to 156 px tall: 3x its desktop height',
    },
    {
      name: 'Capstone',
      symbol: 'capstone',
      width: 639,
      height: 120,
      source:
        'Traced from https://www.capstoneprep.com/wp/wp-content/uploads/2018/11/cap-logo.png (1481 x 474, the site media library): the CAPSTONE serif wordmark alone, as the white header logo (Captone_CTL_White.png) shows it on navy; the site has no SVG',
    },
    {
      name: 'MAK Solicitors',
      src: '/intro/logos/mak-solicitors.webp',
      width: 196,
      height: 96,
      source: 'site-handoff/hero-module/web/logos/mak-solicitors.webp (from Cayden\'s file), recoloured to text',
    },
    {
      name: 'Pomfret School',
      symbol: 'pomfret',
      width: 188,
      height: 41,
      source: 'https://resources.finalsite.net/images/v1710351085/pomfret/usyvkhpb3fbp3swt0it0/logo-white.svg (the site header), its path unchanged',
    },
  ] satisfies Logo[],
};

// ---- 2. Where it started -----------------------------------------------------------------------

// Where it started (Nov 1 2026): replaces the Previously / Edits / Now question. A short opening in
// Cayden's words, then a dated list in time order. The list states what happened and when; it makes
// no claims about what caused what, except where a source says so (Civic Exchange).
export const mission = {
  heading: 'Where it started',
  lead: {
    text: 'TODO(CAYDEN): one or two sentences, in your own words, on how AI Simply started.',
    source: 'Cayden',
  } satisfies Line,
  steps: [
    {
      when: '2024',
      text: 'AI Simply: donor update emails for Changing Young Lives Foundation',
      source: 'aisimply.co case study, Jul 5 2024',
    },
    {
      when: 'Summer 2024',
      text: 'Wisers: thousands of RedNote posts turned into brand analysis',
      source: 'content.ts wisers.summers 2024; CV, Oct 21 2026',
    },
    { when: 'November 2024', text: 'Started OurCityHealth', source: 'OCH §1, CV' },
    {
      when: 'Summer 2025',
      text: "Wisers: a prototype agent that reads a computer's screen",
      source: 'OCH §3, GUI; screen-parsing-gui-agent README',
    },
    {
      when: 'Fall 2025',
      text: 'Founded the Civic AI Club at Pomfret',
      source: 'CLUB §2; civic-ai-group notes (founded fall of junior year, 2025-26)',
    },
    {
      when: 'Summer 2026',
      text: 'Civic Exchange, which started as an AI Simply client',
      source: 'Common App Additional Information; aisimply.co case study, Aug 31 2026',
    },
    { when: 'October 2026', text: 'Three club tools delivered', source: 'civicaiclub numbers.json, Oct 30 2026' },
  ] satisfies (Line & { when: string })[] as (Line & { when: string })[],
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
      text: 'AI Consultant, June 9 to August 28, 2026',
      source: 'CEX §1, Agr; C4 p6; Common App activity 2 (AI Consultant, 2026), Nov 1 2026',
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
      {
        title: 'Next summer.',
        text: {
          text: 'Civic Exchange invited me back for summer 2027 as a research intern, to study how Hong Kong NGOs, nonprofits, think tanks and schools use AI.',
          source: 'CV, Oct 21 2026',
        },
      },
    ] satisfies MoreBlock[] as MoreBlock[],
    moreLabel: 'about Civic Exchange',
  },
  // Wisers: one entry, two summers, 2024 first. The signal draws each summer as you reach it.
  wisers: {
    name: 'Wisers Information Limited, Hong Kong',
    // Title confirmed from Cayden's CV (Oct 21, 2026).
    meta: { text: 'Data Intern, two summers (2024 and 2025)', source: 'CV, Oct 21 2026' } satisfies Line,
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
    // The technical write-up behind More (Nov 1 2026), shaped like Civic Exchange's. It sits after
    // the held track (Experience.astro), so it never changes the held frame or the beats.
    more: [
      {
        title: 'Summer 2024.',
        text: {
          text: 'I built my own program that collected thousands of RedNote posts about four sportswear brands and used a language model to turn them into brand analysis. I also sat in on meetings about social commentary and how it links to sentiment, which is where the OurCityHealth idea started.',
          source: "Cayden's tech notes, Oct 22 2026; Common App activity 8; Drive: Sportswear Brand Trend Analysis Report, July 2024",
        },
      },
      {
        title: 'Summer 2025.',
        text: {
          text: 'My mentor pointed out that no reliable tool on the market could yet operate a computer on its own, so I built a prototype. You type a goal, and it plans the steps with a language model, reads the screen with computer vision and OCR, then clicks, types and scrolls across apps and websites to carry them out.',
          source: 'screen-parsing-gui-agent README, intro',
        },
      },
      {
        title: 'How the agent works.',
        list: [
          { text: 'Plan: the language model turns the goal into a list of steps.', source: 'screen-parsing-gui-agent README, How it works 1' },
          {
            text: 'See: for each step it takes a screenshot, finds icons with a detection model and reads text with OCR, so every element on screen gets a label and a position.',
            source: 'screen-parsing-gui-agent README, How it works 2',
          },
          {
            text: "Act and recover: it clicks or types on the matching label, notices when an action changed nothing, and tries another way when it's stuck.",
            source: 'screen-parsing-gui-agent README, How it works 3 and 4',
          },
          {
            text: 'Check: it confirms each step from the URL or page text, and a final model call checks whether the whole goal was met.',
            source: 'screen-parsing-gui-agent README, How it works 5',
          },
          {
            text: 'Remember: it keeps a small file per website of which labels led somewhere useful, and tries those first next time.',
            source: 'screen-parsing-gui-agent README, How it works 6',
          },
        ],
      },
      {
        title: 'Built on.',
        text: {
          text: "Microsoft's OmniParser icon detection model, PaddleOCR for the text, and OpenAI models for planning. Only the on-screen text and the URL go to OpenAI, never screenshots. It runs only on macOS and takes over the mouse and keyboard while it works.",
          source: "screen-parsing-gui-agent README, Built on; What it can't do",
        },
      },
      {
        title: 'What I took away.',
        text: { text: 'TODO(CAYDEN)', source: 'Cayden' },
      },
    ] satisfies MoreBlock[] as MoreBlock[],
    moreLabel: 'about Wisers',
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
  // A second link, to the code, beside the first (Work.astro).
  code?: Link;
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
        {
          text: 'Built to analyze 1,000+ cities. The first run scored seven: Hong Kong, Shanghai, Shenzhen, Singapore, Tokyo, London and New York.',
          source: 'OurCityHealth README (Cities scored; CesiumJS globe of 1,000+ cities); Common App activity 7; Cayden, Nov 1 2026',
        },
        { text: 'This fall: testing whether the news actually tracks how a city is doing', source: 'OCH §2, ISP' },
      ],
      link: { label: 'Open the site', href: 'https://caydenauyang.github.io/OurCityHealth/' },
      code: { label: 'View the code', href: 'https://github.com/CaydenAuyang/OurCityHealth' },
      caption: 'Saved demo data, news from 2014 to early 2024.',
      // The technical write-up from the OurCityHealth README (Nov 1 2026), then the study.
      more: [
        {
          title: 'The problem.',
          text: {
            text: "There's no standard, easy way to see how a city is doing and why it's changing. Consultancy reports go deep but cost six figures, cover a few hundred cities and come out once a year as PDFs. Raw news event data is free, but you have to build the whole pipeline yourself.",
            source: 'OurCityHealth README, The Problem',
          },
        },
        {
          title: 'What I built.',
          list: [
            {
              text: 'A pipeline that reads news from 380,000+ outlets through GDELT and ranks every source on a four-tier credibility scale.',
              source: 'OurCityHealth README, How It Works',
            },
            // Keep the second sentence only if Cayden confirms it came from a real run.
            {
              text: 'Duplicate reports are grouped into single stories before anything is scored. In one run, about 25,000 raw events came down to 24 real stories.',
              source: 'OurCityHealth README, How It Works (PROCESS)',
            },
            {
              text: 'Each city gets a 0 to 100 score on 12 dimensions, from housing and safety to cost of living, with the change since the last period, what drove it, and links to the articles behind it.',
              source: 'OurCityHealth README, intro; The 12-Dimension Taxonomy',
            },
            {
              text: 'A 3D globe of 1,000+ cities (CesiumJS), served by a FastAPI backend on PostgreSQL with PostGIS and TimescaleDB.',
              source: "OurCityHealth README, What's Built (V2)",
            },
          ],
        },
        {
          title: 'How I built it.',
          text: {
            text: 'I made the core design decisions myself: the 12 dimensions, the four-tier source ranking, and a fixed, structured format for the AI scoring step, so its output stays consistent from one run to the next and every claim traces back to its sources. I built the code with AI coding tools in Cursor. My job was deciding what to build, testing what came back and fixing what was broken.',
            source: 'OurCityHealth README, How I built this',
          },
        },
        {
          title: 'What I took away.',
          text: { text: 'TODO(CAYDEN)', source: 'Cayden' },
        },
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
      lead: {
        text: 'Free tools for charities and small businesses.',
        source: 'OCH §5, CV, E46; Common App activity 6 ("built tools (for free)")',
      },
      // The three case studies on aisimply.co/insights, oldest first.
      facts: [
        {
          text: "Automated donor update emails for Changing Young Lives Foundation, a Hong Kong children's charity (2024)",
          source: 'OCH §5, TRK; aisimply.co case study "Streamlining Data Management for a NPO", Jul 5 2024',
        },
        {
          text: 'Built a bilingual photo-album site for Our Gallery in Wan Chai (2025 to 2026)',
          source: 'OCH §5, SITE, AIS; aisimply.co case study "A Bilingual Website for a Hong Kong Community Gallery", Feb 13 2026',
        },
        {
          text: 'Took on Civic Exchange as a client, which became my summer 2026 role (see Experience)',
          source: 'aisimply.co case study "Institutional Memory and AI Writing for a Hong Kong Think Tank", Aug 31 2026; Common App Additional Information',
        },
      ],
      link: { label: 'Read the case studies', href: 'https://www.aisimply.co/insights' },
      caption: 'aisimply.co',
    },
    {
      stop: 'club',
      previewId: 'civicaiclub',
      name: 'Civic AI Club',
      role: { text: 'Founder and president, Pomfret School', source: 'CLUB §2' },
      lead: { text: 'School offices bring us a problem. Students build the tool and hand it over.', source: 'CLUB §8, CTX' },
      facts: [
        { text: '40+ members, 8 cases this year', source: 'CLUB §2; CLUB §1, §4; civicaiclub numbers.json, Oct 30 2026' },
        {
          text: '3 tools delivered in October',
          source: 'civicaiclub numbers.json tools-delivered (AutoPlanner, Music Studio, Project: Pomfret sorting), Oct 30 2026',
        },
        { text: 'Student teams working with 3 local organizations', source: 'Common App activity 1 ("3 community clients"); civicaiclub clients.json' },
      ],
      link: { label: 'Open the site', href: 'https://civicaiclub.github.io' },
      code: { label: "The club's GitHub", href: 'https://github.com/CivicAIClub' },
      caption: 'Demo data.',
      // The club's full facts (Nov 1 2026).
      more: [
        {
          list: [
            { text: '40+ members.', source: 'CLUB §2' },
            { text: 'Eight cases this school year, each for a different school office.', source: 'CLUB §1, §4' },
            {
              text: 'Three tools delivered in October: a weekly planner for the CLC Supported Study Hall, a lesson and booking portal for the Music Department, and a group sorter for Project: Pomfret.',
              source: 'CLUB §4 A, B; civicaiclub cases a, b, f',
            },
            {
              text: 'Student teams are working with three local organizations: two projects are under way and a third is about to start.',
              source:
                'Common App activity 1; civicaiclub clients.json (Green Valley Hospitality and Black Pond Brews in progress, Covenant Soup Kitchen discovery pending)',
            },
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
        name: 'STORM',
        line: {
          text: 'A storm in Three.js that a crowd controls with its noise and movement.',
          source: 'STORM README (mic level and webcam pose / crowd detection)',
        },
        href: 'https://github.com/CaydenAuyang/STORM',
      },
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
