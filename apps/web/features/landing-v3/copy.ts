/* LANDING V3 · every player-facing word, in one place (English, like Landing 01B / V2).
   Colour language the copy relies on: cyan = evidence / memory / reasoning · magenta = contradiction / pressure · lime = personal resolution.
   FIT is a recommendation score for this draft. It is never a win rate, win chance, probability or confidence.
   Modes: the page says what D2KIRO is BUILT AROUND, never that a mode is publicly supported. */

export const SITE = {
  name: "D2KIRO",
  title: "D2KIRO · Dota 2 draft assistant",
  description:
    "D2KIRO is a Dota 2 draft assistant. It reads the draft, weighs counter picks and synergy for your role, adds how you play, and shows why each hero recommendation changes. Join the waitlist.",
} as const;

export const NAV = {
  homeLabel: "D2KIRO home",
  sectionsLabel: "Sections",
  links: [
    { href: "#graph", label: "How it decides" },
    { href: "#payoff", label: "For you" },
    { href: "#practical", label: "What it does" },
    { href: "#faq", label: "Questions" },
  ],
  join: "Join the waitlist",
} as const;

export const HERO = {
  kicker: "Draft coach for ",
  kickerGame: "Dota 2",
  title: "A draft that adapts to you.",
  sub: "D2KIRO reads the draft, remembers how you play, and shows why a pick fits you.",
  formLabel: "Get early access",
  productLabel: "D2KIRO product view, illustrative draft",
  railLabel: "Draft progress",
  rail: ["Draft", "Reveal", "Evidence", "Recommendation", "Lock"],
  cardHead: "Draft 1 · All Pick",
  cardSeat: "Your seat · Position 2 · Mid",
  enemy: "Enemy",
  team: "Team",
  rankLabel: "Top 3, unresolved",
  pending: "Unresolved · reading the evidence",
  illustrative: "Illustrative draft",
  coachAlt: "The D2KIRO Coach, watching the recommendation",
  pause: "Pause motion",
  play: "Play motion",
  pauseHint: "Pause the hero animation",
  playHint: "Resume the hero animation",
} as const;

export const HANDOFF = "That's the draft. Now watch the call take shape.";

export const DIFF = {
  kicker: "General context · ",
  kickerPlayer: "Player context",
  lineOne: "The meta knows the game.",
  lineTwo: "D2KIRO knows your game.",
  anyoneTitle: "For anyone",
  anyoneBody: "What anyone in your seat would see: the enemy picks, your supports, the role you're filling.",
  gamesTitle: "Your games",
  gamesBody: "What only you can bring: the heroes you actually play, and how often you play them in this seat.",
  caption: "Illustrative draft. The ranking has not changed yet.",
  figureLabel:
    "General context feeds a ranking for anyone: Queen of Pain 84, Puck 82, Void Spirit 77. Your games, not read yet, begin to connect to the ranking.",
} as const;

export const GRAPH = {
  title: "The living decision graph: how the ranking changes when your games enter",
  railLabel: "Beats of the decision",
  legendLabel: "Legend",
  legend: [
    { tone: "cyan", style: "solid", label: "Evidence" },
    { tone: "pink", style: "dash", label: "Losing support" },
    { tone: "faint", style: "dot", label: "No history yet" },
    { tone: "lime", style: "solid", label: "Resolution" },
  ],
  note: "Illustrative draft. Links show which evidence supports a pick. They are not statistics.",
  topAnyone: "TOP 3 · FOR ANYONE",
  topYou: "TOP 3 · FOR YOU",
  stillLabels: ["For anyone", "Your games enter", "For you"],
} as const;

/** Six beats, one persistent Draft A. `pose` is the Coach state the beat shows; `tone` colours the rail. */
export type BeatTone = "" | "cyan" | "pink" | "lime";
export interface BeatCopy {
  n: string;
  k: string;
  pose: "Watching" | "Analyzing" | "Pointing";
  tone: BeatTone;
  title: string;
  sub: string;
  aria: string;
}

export const BEATS: readonly BeatCopy[] = [
  { n: "01", k: "Read for anyone", pose: "Watching", tone: "", title: "For anyone in this seat, Queen of Pain leads.", sub: "Axe and Slark are in the enemy draft. Nothing about you is in the picture yet.", aria: "Generic read. You, Mid, Axe and Slark feed a ranking for anyone: Queen of Pain 84, Puck 82, Void Spirit 77." },
  { n: "02", k: "Analyzing", pose: "Analyzing", tone: "pink", title: "Slark changes the read.", sub: "One pick changes which answers still hold. Void Spirit loses support and its old links scatter.", aria: "Slark, already in the draft, becomes relevant. Pressure on Void Spirit; its links loosen." },
  { n: "03", k: "Support context", pose: "Analyzing", tone: "cyan", title: "Your supports pull toward Puck.", sub: "Earth Spirit and Crystal Maiden. Cyan marks evidence.", aria: "Your supports connect to Puck." },
  { n: "04", k: "Your games enter", pose: "Analyzing", tone: "cyan", title: "Now your games enter.", sub: "Puck is often played by you. Queen of Pain, some history. Void Spirit, none yet.", aria: "Your games connect strongly to Puck, weakly to Queen of Pain, and not yet to Void Spirit." },
  { n: "05", k: "Convergence", pose: "Analyzing", tone: "pink", title: "The generic lead loses support. The evidence gathers on Puck.", sub: "Enemy fit, support fit, your games.", aria: "Queen of Pain's lead loses support while three reasons converge on Puck." },
  { n: "06", k: "Resolution", pose: "Pointing", tone: "lime", title: "The graph settles. Puck is your call.", sub: "You · Mid → Puck → Top 3. Queen of Pain moves to second.", aria: "Resolved. Puck is first for you: 88. Queen of Pain 83, Void Spirit 77." },
];

export const PAYOFF = {
  kicker: "Draft A · one draft, read twice",
  lineOne: "Same draft.",
  lineTwo: "Different player.",
  lineThree: "Different pick.",
  lede: "Nothing in the draft changed. Your games entered the graph, and the ranking it produced is yours.",
  stepsLabel: "From the generic ranking to yours",
  steps: [
    { title: "For anyone", body: "Queen of Pain leads. Puck is second.", tone: "" },
    { title: "Your games enter", body: "Puck +6, Queen of Pain −1, Void Spirit no history yet.", tone: "cyan" },
    { title: "For you", body: "Puck is first. Queen of Pain moves to second.", tone: "lime" },
  ],
  cardKicker: "For you · Top 3",
  illustrative: "Illustrative draft",
  was: "was",
  noHistory: "no history yet",
  whyLabel: "Why Puck",
  fitNote: "FIT is a recommendation score for this draft. It is not a win rate.",
} as const;

export const TRUST = {
  kicker: "The final call",
  lineOne: "One pick.",
  lineTwo: "Every reason on screen.",
  lede: "The graph settled on one hero. What's left is the call and the reasons it stands on, in plain sight.",
  callLabel: "Final call: Puck",
  callKicker: "Final call",
  meta: "Position 2 · Mid · Draft A",
  proof: [
    { key: "COUNTER", tone: "cyan", line: "Holds up vs the enemy picks", detail: "Axe and Slark" },
    { key: "SYNERGY", tone: "cyan", line: "Pairs with your supports", detail: "Earth Spirit and Crystal Maiden" },
    { key: "YOUR GAMES", tone: "cyan", line: "Often played by you", detail: "Moves Puck from #2 to #1" },
    { key: "ROLE", tone: "muted", line: "Fits Position 2 / Mid", detail: "A mid hero for your seat" },
  ],
  backups: "Queen of Pain and Void Spirit stay as backups.",
  note: "Illustrative draft. FIT is a recommendation score, not a win rate.",
} as const;

export const PRACTICAL = {
  kicker: "What it works with",
  title: "Built for your next draft.",
  lede: "D2KIRO is a Dota 2 draft assistant. It reads the picks, weighs counter picks and synergy for your role, then adds how you play to give personalized draft recommendations, and shows why a recommendation changes.",
  rows: [
    { term: "The draft", body: "Both teams' picks and bans as they land, in order. The recommendation updates when the draft does." },
    { term: "Your seat", body: "Position 1 to 5, Mid included. Hero recommendations are made for the role you are playing in this match, weighing counters and synergy with your team." },
    { term: "Your games", body: "The heroes you play and how often, where there is history to read. When there is nothing of yours to go on, the call says so and stays a draft read.", em: "says so" },
    { term: "What you get", body: "A Top 3 for your seat, with the reasons beside every pick: counter, synergy, role and your games. When a pick moves, you see what moved it." },
    { term: "Draft modes", body: "Built around All Pick and Captain's Mode. Additional modes are not promised yet." },
    { term: "What it won't do", body: "Promise a win. FIT is a recommendation score for this draft, never a win rate. D2KIRO supports your draft decision; it does not make it for you." },
  ],
} as const;

export const FAQ = {
  kicker: "Questions",
  title: "Straight answers.",
  items: [
    { q: "What does D2KIRO look at?", a: "The draft as it happens: both teams' picks and bans, the position you are playing (1 to 5) and, where there is history to read, the heroes you actually play. From that it weighs counter picks, synergy with your team and how well a hero fits your role." },
    { q: "Why can the hero recommendation change?", a: "Two things move it: the draft and you. A new pick can weaken some answers and strengthen others, and your own games can lift a hero you play well. D2KIRO shows which reason moved the pick, so you can see why it changed." },
    { q: "Does it replace learning the game?", a: "No. D2KIRO is draft decision support. It gives you a Top 3 and the reasons behind it, and the call stays yours. If you disagree, you can see exactly which reason you are disagreeing with." },
    { q: "Which draft modes is it built around?", a: "D2KIRO is built around All Pick and Captain's Mode drafts. Additional modes are not promised yet." },
    { q: "Is joining the waitlist free?", a: "Yes. Joining is free and no payment is required. You will get early-access updates, launch news and chances to give feedback." },
  ],
} as const;

export const WAITLIST = {
  button: "Join the waitlist",
  emailPlaceholder: "your@email.com",
  emailLabel: "Email address",
  micro: "Free to join · No payment required.",
  emailError: "Enter an email address like name@example.com.",
  failed: "That did not go through. Try again in a moment.",
  busy: "Joining…",
  done: "You're on the list.",
  doneNote: "Early-access updates and launch news will come to the address you gave.",
  helpTitle: "Want to help shape D2KIRO?",
  helpFeedback: "Share feedback",
  helpFollow: "Follow development",
  helpSee: "See how",
  foundingSummary: "Learn about becoming a Founding Supporter later",
  foundingBody: "Not open yet, and nothing is required. Joining the waitlist stays free.",
  /** Shown instead of a stored sign-up while no approved backend / legal pages exist. Never reads as "you are subscribed". */
  previewTag: "Preview only",
  previewNote: "Your email is not sent or stored.",
  previewDone: "Preview only, not sent.",
  previewDoneNote: "This is a preview. Your email was not sent or stored, and nobody will write to you from it.",
} as const;

export const CLOSE = {
  kicker: "Early access",
  title: "Join the waitlist.",
  lede: "Help shape what D2KIRO becomes next.",
  extras: ["Early-access updates", "Launch news", "Chances to give feedback"],
  restPill: "Resting",
} as const;

export const FOOTER = {
  tag: "Draft coach for Dota 2.",
  navLabel: "Footer",
  legalNavLabel: "Legal",
  legal: "Drafts on this page are illustrative. D2KIRO is not affiliated with or endorsed by Valve Corporation. Dota 2 is a trademark of Valve Corporation.",
  privacy: "Privacy",
  terms: "Terms",
  links: [
    { href: "#graph", label: "How it decides" },
    { href: "#payoff", label: "For you" },
    { href: "#practical", label: "What it does" },
    { href: "#faq", label: "Questions" },
    { href: "#waitlist", label: "Join the waitlist" },
  ],
} as const;
