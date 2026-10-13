/* LANDING V2 · every word that belongs to the integrated page, in one place (English first, like Landing 01B).
   The Hero loop, the Memory scenes and the Counterfactual keep their own locked strings next to their code; this file holds
   what the integration adds: the narrative frame, the seams, the Proposition and the nav.
   One vocabulary across the page: FIT · Your games · Often played · Some history · No history yet · For anyone · For you.
   FIT is a recommendation score for this draft. It is never a win rate, win chance, probability or confidence. */

export const NAV = {
  label: "D2KIRO",
  links: [
    { href: "#memory", label: "Memory" },
    { href: "#counterfactual", label: "For you" },
    { href: "#proposition", label: "What you get" },
  ],
  themeToLight: "Switch to light theme",
  themeToDark: "Switch to dark theme",
  themeLight: "Light",
  themeDark: "Dark",
} as const;

export const HERO = {
  kicker: "Draft coach for Dota 2",
  title: "D2KIRO makes the call while the draft changes.",
  sub: "It reads the draft and your games, then shows one pick for your seat with the reasons beside it.",
  illustrative: "Illustrative draft",
  pause: "Pause",
  play: "Play",
  pauseHint: "Pause the draft demo",
  playHint: "Resume the draft demo",
} as const;

/** The bridge from the Hero's calls to Memory: a call is not forgotten when the next draft starts. */
export const SEAM_HERO_MEMORY = "Every call leaves a trace.";
/** The bridge from Memory to the Counterfactual: knowledge becomes a decision. */
export const SEAM_MEMORY_CF = "Now use it.";

export const MEMORY = {
  kicker: "Memory",
  title: "Then it remembers how you play.",
  scrollCue: "Keep scrolling",
  /** What a screen reader gets instead of the animated graph. */
  summary:
    "Illustrative. One game of Puck is remembered, not concluded. A second reads as a comfort pick, not proven. A match with Viper changes the picture: the same evidence is read differently once a condition about your seat enters. By match 56 there are enough games to read you, not enough to be sure.",
  illustrative: "Illustrative fixtures. Nothing on this graph is a statistic.",
} as const;

export const COUNTERFACTUAL = {
  kicker: "Same draft, two reads",
  title: "That memory can change the answer.",
  lede: "One draft, read for anyone. Add your games and only the reading changes.",
} as const;

export const PROPOSITION = {
  kicker: "What you get",
  title: "One pick. Every reason on screen.",
  lede: "This is what stays in front of you while you draft.",
  promises: [
    { id: "pick", title: "One pick, two backups", body: "The call for your seat and the next two, each with its FIT." },
    { id: "yours", title: "Your draft + your games", body: "Bans, picks and your seat, read together with how you have played." },
    { id: "guess", title: "Tells you when it is guessing", body: "With nothing of yours behind it, it says so and marks the call as a draft read only." },
  ],
  call: "Your call",
  backup: "Backup",
  draft: "Your draft",
  games: "Your games",
  seatLabel: "Seat",
  draftReadOnly: "Draft read only",
  noHistory: "No history yet",
  fitNote: "FIT is a recommendation score for this draft. It is not a win rate.",
  illustrative: "Illustrative draft",
} as const;
