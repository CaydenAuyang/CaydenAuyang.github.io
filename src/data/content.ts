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

// ---- Navigation --------------------------------------------------------------------------------

export const nav: Link[] = [
  { label: 'Question', href: '#question' },
  { label: 'Summer', href: '#summer' },
  { label: 'Work', href: '#work' },
  { label: 'Since May', href: '#since' },
  { label: 'People', href: '#people' },
  { label: 'Contact', href: '#contact' },
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

// ---- 2. The question ---------------------------------------------------------------------------

// One tracked change to the May question. Edits apply in order, left to right, each searching the
// May text from where the previous edit ended.
//   del:      strike `text` (words in the May question).
//   ins:      insert `text` right after the May words in `after`. `after: ''` means directly after
//             the previous edit.
//   replace:  strike `text` and insert `insertText` in its place.
// `note` is the number of the note that says what caused the edit (one edit has none).
// The build stops with an error if a `text` or `after` can't be found, or if the edits don't turn
// the May text into the October text exactly (QuestionPanel.astro).
export interface Edit {
  type: 'del' | 'ins' | 'replace';
  text: string;
  insertText?: string;
  after?: string;
  note?: number;
}

export const question = {
  heading: 'The question',
  lead: {
    text: "What I'm trying to answer, and how this year changed it.",
    source: 'POSTER; CEX; OCH §2',
  } satisfies Line,
  views: { may: 'May', edits: 'Edits', october: 'October' },
  may: {
    text: 'Most institutions struggle to actually hear the people they serve. What would it take for AI to change that, from a city down to a school?',
    source: 'POSTER',
  } satisfies Line,
  october: {
    text: 'Most institutions struggle to hear the people they serve, or even their own records. What would it take for AI to help, and how would we know it heard them correctly, from a city to a nonprofit to a school?',
    source: 'Cayden, October 2026',
  } satisfies Line,
  // In reading order.
  edits: [
    { type: 'del', text: 'actually' },
    { type: 'ins', text: ', or even their own records', after: 'the people they serve', note: 1 },
    { type: 'replace', text: 'change that', insertText: 'help', note: 2 },
    { type: 'ins', text: ', and how would we know it heard them correctly', after: '', note: 3 },
    { type: 'replace', text: 'down to a school', insertText: 'to a nonprofit to a school', note: 4 },
  ] satisfies Edit[] as Edit[],
  // One line each, numbered 1 to 4 on the page.
  notes: [
    { text: 'At Civic Exchange, 25 years of research sat in folders no one could search.', source: 'CEX §3b, ER §1' },
    { text: 'AI is good at finding and drafting. Deciding what matters stays with people.', source: 'CEX §3g, FD P43' },
    {
      text: 'Every answer had to cite its source. My independent study checks its AI the same way.',
      source: 'CEX §6, ER §6.3; OCH §2, METH',
    },
    { text: 'A nonprofit became the middle case.', source: 'CEX §8, J15' },
  ] satisfies Line[],
};

// ---- 3. Summer ---------------------------------------------------------------------------------

export interface MoreBlock {
  // A short bold lead-in ("The problem."), shown at the start of the text's paragraph.
  title?: string;
  // A heading line of its own above the text: bold words, then the rest in regular weight
  // ("Measuring What Matters" then "(independent study, fall 2026)").
  head?: { bold: string; rest?: string };
  text?: Line;
  list?: Line[];
}

export const summer = {
  heading: 'Summer 2026',
  subhead: 'Civic Exchange, Hong Kong',
  meta: {
    text: 'Intern (voluntary), June 9 to August 28, 2026',
    source: 'CEX §1, Agr; C4 p6',
  } satisfies Line,
  lead: {
    text: 'A Hong Kong think tank had 25 years of research nobody could search. I listened first, then built the fix.',
    source: 'CEX §2, C1 p1; CEX §3',
  } satisfies Line,
  facts: [
    { text: '11 interviews before building anything', source: 'CEX §3a, UR, FD P2' },
    { text: '12 searchable notebooks, about 2,350 documents', source: 'CEX §3b, ER §3.1' },
    { text: '18 of 18 hand-checked citations correct', source: 'CEX §3b, ER §5.1' },
    { text: 'Handed over with a 39-page manual and a staff workshop', source: 'CEX §3g, FD P42; §3f, FD P38' },
  ] satisfies Line[],
  // The full Summer section from the long copy.
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
  moreLabel: 'about the summer',
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
      {
        name: 'Screen-parsing agent',
        line: {
          text: "A prototype from my 2025 Wisers internship that reads and operates a Mac's screen.",
          source: 'OCH §3, GUI',
        },
        href: 'https://github.com/CaydenAuyang/screen-parsing-gui-agent',
      },
    ],
  },
};

// ---- 5. Since May ------------------------------------------------------------------------------

export interface Strand {
  label: string;
  status: string;
  text: Line;
  // From the long copy: what May proposed, and where it stands now.
  proposed: Line;
  now: Line;
}

export const since = {
  heading: 'Since May',
  lead: { text: "In May I proposed three things. Here's where they stand.", source: 'POSTER' } satisfies Line,
  strands: [
    {
      label: 'Build.',
      status: 'Changed course.',
      text: {
        text: "Both funding bids were declined, so I'm testing OurCityHealth's core signal before scaling it.",
        source: 'OCH §1 Funding; OCH §2',
      },
      proposed: { text: 'OurCityHealth v3, with 1,000+ cities, a public API and a funding decision.', source: 'POSTER' },
      now: {
        text: "both funding applications were declined, HKSTP Ideation in March and Cyberport's CCMF in May. The demo still runs on saved data, and my own analysis covers three cities. I've moved from scaling it to testing whether its core signal is real.",
        source: 'OCH §1 Funding; OCH §1, E44; OCH §2',
      },
    },
    {
      label: 'Apply.',
      status: 'Under way.',
      text: {
        text: '8 school cases, 2 handed over. Outside organizations are at the discovery stage.',
        source: 'CLUB §8',
      },
      proposed: {
        text: '5 to 10 school cases and 5 to 10 outside organizations, each with measured outcomes.',
        source: 'POSTER',
      },
      now: {
        text: "eight school cases, two delivered and handed over in October. Three outside organizations are at the discovery stage. Outcomes haven't been measured yet.",
        source: 'CLUB §8',
      },
    },
    {
      label: 'Reflect.',
      status: 'Growing.',
      text: { text: 'The summer added a third case: a nonprofit.', source: 'CEX §8' },
      proposed: {
        text: 'a 15 to 20 page thesis comparing a city-scale case and a school-scale case.',
        source: 'POSTER',
      },
      now: { text: 'the summer added a third case between them, a nonprofit.', source: 'CEX §8' },
    },
  ] satisfies Strand[] as Strand[],
  proposedLabel: 'Proposed:',
  nowLabel: 'Now:',
  moreLabel: 'about the May proposal',
};

// ---- 6. People ---------------------------------------------------------------------------------

export const people = {
  heading: 'People',
  list: [
    {
      name: 'Lawrence Iu',
      role: { text: 'Executive Director, Civic Exchange.', source: 'title confirmed by Cayden' },
      text: {
        text: 'He supervised my summer and pushed me to build a model other nonprofits could follow.',
        source: 'CEX §2, J6tx, J15',
      },
    },
  ],
};

// ---- 7. Contact (footer) -----------------------------------------------------------------------

export const contact = {
  heading: 'Say hello',
  email: { text: 'caydenauyang@gmail.com', source: 'POSTER' } satisfies Line,
  github: { label: 'GitHub', href: 'https://github.com/CaydenAuyang' } satisfies Link,
  portfolio: {
    text: 'My certificate portfolio lives in my school Drive and on the program\'s Google Site.',
    source: 'program/Instructions for Portfolios',
  } satisfies Line,
  smallPrint: 'Cayden Auyang. Pomfret School, Class of 2027.',
  // The labels under the two lights the signal draws at the contact key.
  lights: { pomfret: 'Pomfret', hongKong: 'Hong Kong' },
};
