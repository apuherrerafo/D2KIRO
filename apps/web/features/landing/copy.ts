/* LANDING-01B · every word the page says, in one place. English first (same decision as Landing V0).
   Honest by construction: no "AI-powered", no "best pick", no rank promises — FORBIDDEN_CLAIMS is
   enforced against the rendered text by Landing01B.test.tsx. */

export const CTA_LABEL = "Join the waitlist";

export const HERO = {
  eyebrow: "Draft coach for Dota 2",
  headlineLead: "Draft data in.",
  headlineAccent: "Your next call out.",
  sub: "D2KIRO reads your draft and shows one call, with the evidence beside it.",
  secondary: "Watch a draft play out",
  reassurance: "Early access by email. No spam, unsubscribe anytime.",
  illustrative: "Illustrative draft",
} as const;

export const NAV_LINKS = [
  { href: "#demo", label: "How it works" },
  { href: "#signals", label: "Signals" },
  { href: "#evidence", label: "Evidence" },
] as const;

/** The bridge from the Hero's one call to the Memory Strip. The strip's own words stay in its scenes. */
export const MEMORY = {
  kicker: "After the draft",
  title: "The call is made. D2KIRO keeps it.",
} as const;

export const PROPOSITION = {
  title: "One call, with the reasons beside it.",
  points: [
    { id: "reads", title: "Reads the draft", body: "Bans, picks, who is revealed, and the position you are filling." },
    { id: "ranks", title: "Shows three calls", body: "Each one with the signals that put it there: counter, synergy, position." },
    { id: "honest", title: "Says when it is unsure", body: "With thin evidence it shows a neutral starting view and marks it as one." },
  ],
} as const;

export const DEMO = {
  kicker: "In a draft",
  title: "Watch the call change as the draft does.",
  lede: "A draft played out in four moments. Step through it, or let it run once.",
  replay: "Replay",
  stepperLabel: "Draft moments",
  illustrative: "Illustrative draft. The numbers show how the product reads a draft, not a promise about any game.",
} as const;

export const SIGNALS = {
  kicker: "Signals",
  title: "Three signals decide the order.",
  lede: "Pick one to see what it does to each candidate.",
  listLabel: "Signals",
  shiftsTitle: "Effect on fit",
  shiftsUnit: "pts",
} as const;

export const EVIDENCE = {
  kicker: "Evidence",
  title: "Strong evidence is a call. Thin evidence is said plainly.",
  lede: "The number of matches behind a call is real, and so is the label.",
  toggleLabel: "Evidence level",
  enough: "Enough matches",
  thin: "Too few matches",
  samplesLabel: "matches behind this call",
  strategicNote: "A strategic call: there is a reason to prefer this hero.",
  defaultNote: "A neutral starting view, not an advantage.",
} as const;

export const WAITLIST = {
  kicker: "Early access",
  title: "Be in the first draft rooms.",
  lede: "Simulator beta first. Leave your email and we write when it opens.",
  emailLabel: "Email",
  emailPlaceholder: "you@example.com",
  emailError: "Enter an email address like name@example.com.",
  busy: "Sending…",
  success: "You are on the list",
  successNote: "We will write when the simulator beta opens.",
  previewNote: "Preview build: nothing you type here leaves this page.",
} as const;

export const FOOTER = {
  notAffiliated: "D2KIRO is an independent project, not affiliated with or endorsed by Valve.",
} as const;

/** Claims the landing must never make. Enforced against rendered text by test. */
export const FORBIDDEN_CLAIMS: readonly RegExp[] = [
  /ai[- ]powered/i,
  /\bbest pick/i,
  /\boptimal/i,
  /guarantee/i,
  /\bclimb/i,
  /rank gains?/i,
  /\bmmr\b/i,
  /dota\s*plus/i,
  /grows with you/i,
  /automatic(ally)?\s+(ranked\s+)?captur/i,
  /\bthousands of players\b/i,
  /\btrusted by\b/i,
];
