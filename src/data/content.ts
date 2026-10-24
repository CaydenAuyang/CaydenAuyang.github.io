// content.ts: every sentence the site shows, in one place.
//
// The section components in src/components/sections/ read from this file and nothing else, so
// changing a line here changes it on the page.
//
// Rules for each item (a "Line"):
//   text      what the page shows, worded exactly as in Cayden's copy file.
//   source    the short source tag for that line (fact-sheet keys like "CEX §3b, ER §5.1").
//             Kept here so every factual line can be traced. Never rendered.
//   confirm   a fact Cayden still has to confirm. The line ships as written. Never rendered.
//   pending   true when only Cayden can supply this. The page shows `text` inside a dashed
//             "To come" chip so nobody mistakes it for finished copy. `todo` says what is needed
//             and is never rendered.
//
// Find everything still open with:  grep -n "pending: true\|confirm:" src/data/content.ts

export interface Line {
  text: string;
  source?: string;
  confirm?: string;
  pending?: true;
  todo?: string;
}

export interface Link extends Line {
  href: string;
}

// ---- Page meta ---------------------------------------------------------------------------------

export const meta = {
  title: 'Cayden Auyang',
  description: {
    text: 'Cayden Auyang, Pomfret School Class of 2027. How institutions hear the people they serve, from a Hong Kong think tank to my own school.',
    source: 'POSTER; CEX; CLUB',
  } satisfies Line,
  figureAlt: 'A figure of Cayden made of points.',
};

// ---- Navigation --------------------------------------------------------------------------------

export const nav: { label: string; href: string }[] = [
  { label: 'Question', href: '#question' },
  { label: 'Summer', href: '#summer' },
  { label: 'Work', href: '#work' },
  { label: 'Progress', href: '#progress' },
  { label: 'People', href: '#people' },
  { label: 'Portfolio', href: '#portfolio' },
];

// ---- 1. Hero -----------------------------------------------------------------------------------

export const hero = {
  name: 'Cayden Auyang',
  line: {
    text: 'I study how institutions hear the people they serve, and build tools that help them do it.',
    source: 'POSTER essential question; CEX §3; CLUB §4',
  } satisfies Line,
  school: {
    text: 'Pomfret School, Class of 2027. Certificate Program in Global Citizenship and Awareness, in progress.',
    source: 'POSTER; program/About: awarded at graduation',
  } satisfies Line,
};

// ---- 2. The question ---------------------------------------------------------------------------

// One tracked change to the May question. Edits apply in order, left to right, each one
// searching the May text from where the previous edit ended.
//   del:      strike `text` (words found in the May question).
//   ins:      insert `text` right after the May words in `after`. `after: ''` means directly
//             after the previous edit; no `after` at all means at the very end.
//   replace:  strike `text` and insert `insertText` in its place.
// noteId points at the margin note that says what caused the edit (some edits have none).
// The build stops with an error if a `text` or `after` can't be found, or if the edits don't
// turn the May text into the October text, so a typo can't ship.
export interface Edit {
  type: 'del' | 'ins' | 'replace';
  text: string;
  insertText?: string;
  after?: string;
  noteId?: string;
}

export interface Note extends Line {
  id: string;
}

export const question = {
  heading: 'The question, revised',
  intro: {
    text: 'In May I asked a question. A summer at a think tank and a fall of building and testing changed it. Here are the edits, and what caused each one.',
    source: 'POSTER; CEX; OCH §2; CLUB §8',
  } satisfies Line,
  mayLabel: 'May 2026, as written:',
  may: {
    text: 'Most institutions struggle to actually hear the people they serve. What would it take for AI to change that, from a city down to a school?',
    source: 'POSTER',
  } satisfies Line,
  octoberLabel: 'October 2026:',
  october: {
    text: 'Most institutions struggle to hear the people they serve, or even their own records. What would it take for AI to help, and how would we know it heard them correctly, from a city to a nonprofit to a school?',
    source: 'Cayden, final wording approved October 2026',
  } satisfies Line,
  // The edits from May to October, in reading order.
  edits: [
    { type: 'del', text: 'actually' },
    { type: 'ins', text: ', or even their own records', after: 'the people they serve', noteId: 'records' },
    { type: 'replace', text: 'change that', insertText: 'help', noteId: 'help' },
    { type: 'ins', text: ', and how would we know it heard them correctly', after: '', noteId: 'heard-correctly' },
    { type: 'replace', text: 'down to a school', insertText: 'to a nonprofit to a school', noteId: 'nonprofit' },
  ] satisfies Edit[] as Edit[],
  // The margin notes, numbered on the page in the order their edits appear.
  notes: [
    {
      id: 'records',
      text: 'At Civic Exchange, 25 years of research sat in folders nobody could search, and what staff wanted most was a way to search their own past work. The first listening problem was inside the institution.',
      source: 'CEX §3b, ER §1; CEX §3a, UR',
    },
    {
      id: 'help',
      text: 'This summer showed me what AI is good for: finding and drafting. Deciding what matters stays with people.',
      source: 'CEX §3g, FD P43; CEX §3d, ER §5.3',
    },
    {
      id: 'heard-correctly',
      text: "An answer was only useful when its source checked out, so every answer had to cite one. My independent study builds the same check into its method: I hand-code samples and test the AI's labels against them.",
      source: 'CEX §6, ER §6.3; OCH §2, METH',
    },
    {
      id: 'nonprofit',
      text: 'The summer added a middle case between OurCityHealth and the Civic AI Club: a nonprofit with a research team and an archive.',
      source: 'CEX §8, J15',
    },
  ] satisfies Note[],
};

// ---- 3. The summer -----------------------------------------------------------------------------

export const summer = {
  heading: 'Summer 2026, Civic Exchange, Hong Kong',
  meta: {
    text: 'Intern (voluntary). June 9 to August 28, 2026.',
    source: 'CEX §1, Agr; CEX §1, C4 p6',
  } satisfies Line,
  problem: {
    title: 'The problem.',
    body: {
      text: "Civic Exchange is a public policy think tank in Hong Kong. Its executive director, Lawrence Iu, didn't give me a technical assignment. He described a problem: staff used AI in different ways and got different results, 25 years of research sat in folders nobody could search, and reports didn't share a style.",
      source: 'CEX §2, C1 p1; CEX §3; title confirmed by Cayden',
    } satisfies Line,
  },
  listening: {
    title: 'Listening first.',
    body: {
      text: 'I started with interviews: 11 of them, from interns to the executive director, written up as a report on how the team actually used AI. Then a staff town hall, where the real objections came out, and the team approved the notebook categories before I built the full set.',
      source: 'CEX §3a, UR, FD P2; CEX §3f, FD P18; CEX §6, CE p32',
    } satisfies Line,
  },
  built: {
    title: 'What I built.',
    items: [
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
      {
        text: 'A move to Google Workspace for Nonprofits, worked out with the operations team.',
        source: 'CEX §3e, FD P22',
      },
      {
        text: 'A handover: a 39-page manual and a workshop where everyone in the room used the tools.',
        source: 'CEX §3g, FD P42; CEX §3f, FD P38',
      },
    ] satisfies Line[],
  },
  takeaway: {
    title: 'What I took away.',
    body: {
      text: 'The hard part was never the model. It was finding out what people actually needed, and giving them something they could check. These tools can find and draft. Deciding what matters stays with people.',
      source: 'CEX §2, C1 p1; CEX §3g, FD P43; CEX §6, ER §6.3',
    } satisfies Line,
  },
};

// ---- 4. Work -----------------------------------------------------------------------------------

export interface Project {
  // Matches the preview recording's id in src/data/previews.json (written by the previews tool).
  id: 'civic-ai-club' | 'ourcityhealth' | 'ai-simply';
  name: string;
  role: Line;
  summary: Line;
  points: Line[];
  // OurCityHealth only: the independent study, shown as its own small block.
  study?: { name: string; when: string; body: Line };
  link: Link;
  caption: Line;
}

export const work = {
  heading: 'Work',
  intro: {
    text: 'Three projects. Each preview is a short recording; each card opens the live site.',
  } satisfies Line,
  projects: [
    {
      id: 'civic-ai-club',
      name: 'Civic AI Club',
      role: {
        text: 'Founder and president. Pomfret School, since the 2025-26 school year.',
        source: 'CLUB §2; CLUB §1, C12',
      },
      summary: {
        text: 'A student engineering club. School offices bring us a chore that eats their week; students build the tool and hand it over. The client talks first, and nothing gets built until the problem is written down in their words.',
        source: 'CLUB §8, CTX; civicaiclub.github.io README',
      },
      points: [
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
      link: { text: 'civicaiclub.github.io', href: 'https://civicaiclub.github.io' },
      caption: { text: 'Demo data.' },
    },
    {
      id: 'ourcityhealth',
      name: 'OurCityHealth',
      role: { text: 'Founder. Since November 2024.', source: 'OCH §1, CV' },
      summary: {
        text: 'A free civic dashboard that scores how cities are doing on housing, safety, cost of living and more, from what local news reports.',
        source: 'OCH §1, GHC repo description',
      },
      points: [
        {
          text: 'The live demo shows saved scores from news dated 2014 to early 2024. My own pipeline has analyzed three cities so far.',
          source: 'OCH §1, REPO, GHC; OCH §1, E44',
        },
        {
          text: 'This fall I stopped scaling it and started testing the assumption it rests on: does news coverage actually track how a city is doing?',
          source: 'OCH §2, ISP, METH',
        },
      ],
      study: {
        name: 'Measuring What Matters',
        when: '(independent study, fall 2026)',
        body: {
          text: "I'm comparing official statistics with informal signals (local news, search trends and social media) for Hong Kong, New York and London across about two decades. Before any category counts, I hand-code a sample and check the AI's labels against it. Two faculty mentors advise the study, and it runs through the end of the fall term.",
          source: 'OCH §2, ISP, METH, ISC',
        },
      },
      link: { text: 'caydenauyang.github.io/OurCityHealth', href: 'https://caydenauyang.github.io/OurCityHealth/' },
      caption: { text: 'Saved demo data, news from 2014 to early 2024.' },
    },
    {
      id: 'ai-simply',
      name: 'AI Simply',
      role: { text: 'Founder. One-person practice.', source: 'OCH §5, CV, AIS' },
      summary: {
        text: 'I build tools for charities and small businesses. The work so far has been unpaid.',
        source: 'OCH §5, CV, E46',
      },
      points: [
        {
          text: 'For the Changing Young Lives Foundation, a Hong Kong charity, I automated the donor update emails staff had been sending by hand (2024).',
          source: 'OCH §5, TRK',
        },
        {
          text: 'For Our Gallery in Wan Chai, a bilingual website with albums of more than 800 event photos (2025 to 2026).',
          source: 'OCH §5, SITE, AIS',
        },
      ],
      link: {
        text: 'aisimply.co',
        href: 'https://aisimply.co',
        confirm: 'the Oct 11 audit fixes are live before this link ships',
      },
      caption: { text: 'aisimply.co' },
    },
  ] satisfies Project[],
};

// ---- 5. Progress -------------------------------------------------------------------------------

export interface Strand {
  name: string;
  proposed: Line;
  // The current status, as one or more lines shown together (a pending chip can follow).
  now: Line[];
}

export const progress = {
  heading: 'Progress against the May proposal',
  intro: { text: "In May I proposed three things. Here's where each one stands.", source: 'POSTER' } satisfies Line,
  proposedLabel: 'Proposed:',
  nowLabel: 'Now:',
  strands: [
    {
      name: 'Build.',
      proposed: { text: 'OurCityHealth v3, with 1,000+ cities, a public API and a funding decision.', source: 'POSTER' },
      now: [
        {
          text: "Both funding applications were declined, HKSTP Ideation in March and Cyberport's CCMF in May. The demo still runs on saved data, and my own analysis covers three cities. I've moved from scaling it to testing whether its core signal is real.",
          source: 'OCH §1 Funding; OCH §1, E44; OCH §2',
        },
      ],
    },
    {
      name: 'Apply.',
      proposed: {
        text: '5 to 10 school cases and 5 to 10 outside organizations, each with measured outcomes.',
        source: 'POSTER',
      },
      now: [
        {
          text: "Eight school cases, two delivered and handed over in October. Three outside organizations are at the discovery stage. Outcomes haven't been measured yet.",
          source: 'CLUB §8',
        },
      ],
    },
    {
      name: 'Reflect.',
      proposed: {
        text: 'A 15 to 20 page thesis comparing a city-scale case and a school-scale case.',
        source: 'POSTER',
      },
      now: [
        { text: 'The summer added a third case between them, a nonprofit.', source: 'CEX §8' },
      ],
    },
  ] satisfies Strand[],
};

// ---- 6. People ---------------------------------------------------------------------------------

export interface Person {
  name: string;
  title: Line;
  body: Line;
}

export const people = {
  heading: 'People',
  intro: {
    text: 'Professionals outside Pomfret who have shaped the work.',
    source: 'program/About, summer requirements',
  } satisfies Line,
  // Confirmed connections only. Next, after their conversations: Alvin Mok and Victor Kwong
  // (Kay Huang as the fallback). Add them only once Cayden confirms.
  list: [
    {
      name: 'Lawrence Iu.',
      title: { text: 'Executive Director, Civic Exchange.', source: 'title confirmed by Cayden' },
      body: {
        text: 'He supervised my summer project and pushed me to treat it as a model other nonprofits could follow, not just a set of tools, and to document the process as carefully as I built them.',
        source: 'CEX §2, J6tx, C1 p1; CEX §2, J15',
      },
    },
  ] satisfies Person[],
};

// ---- 7. Portfolio ------------------------------------------------------------------------------

export const portfolio = {
  heading: 'Portfolio',
  // No links yet. They can be added once Cayden shares those files.
  body: {
    text: 'My certificate portfolio lives in my school Google Drive and on the program\'s Google Site: the May 2026 poster and literature review, reflections, and supervisor letters.',
    source: 'program/Instructions for Portfolios; POSTER',
  } satisfies Line,
};

// ---- 8. Footer ---------------------------------------------------------------------------------

export const footer = {
  line: { text: 'Cayden Auyang. Pomfret School, Class of 2027.' } satisfies Line,
  emailLabel: 'Email',
  email: { text: 'caydenauyang@gmail.com', href: 'mailto:caydenauyang@gmail.com', source: 'POSTER' } satisfies Link,
  githubLabel: 'GitHub',
  github: { text: 'github.com/CaydenAuyang', href: 'https://github.com/CaydenAuyang' } satisfies Link,
};
