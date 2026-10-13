/* COUNTERFACTUAL LAB · ONE fixture, derived from the frozen Hero Loop's draft A instead of authored a second time.
   Same seat (Pos 2 Mid), same allies, same enemies, same three candidates, same base FIT, same evidence deltas, same
   personal-history phrases. A contradiction with the Hero is therefore impossible by construction: change the Hero's
   scenario and this follows (and the unit test notices). The old landing fixture (Viper / Outworld Destroyer / "History ·
   yours" on Puck / "History · none" on the others) is NOT carried over: it said a different thing about the same pool.

   FIT is a recommendation score for the Lab. It is not a win rate, win chance, probability or confidence, and no game count,
   win percentage or MMR exists anywhere in this fixture.

   ILLUSTRATIVE · DOTA SIGN-OFF REQUIRED: see CF_SIGNOFF. The UI never says so. */
import { LOOP_SCENARIOS, type EvidenceStep } from "../landing-v2/story/scenarios";

const base = LOOP_SCENARIOS.find((s) => s.id === "A");
if (!base) throw new Error("counterfactual-lab: Hero Loop scenario A is missing");

const personalStep = base.steps.find((s): s is EvidenceStep & { detail: Readonly<Record<string, string>> } => s.kind === "personal" && !s.absent && !!s.detail);
if (!personalStep) throw new Error("counterfactual-lab: Hero Loop scenario A has no personal step");

/** The steps a stranger's read already includes: the enemy picks and the supports. */
const GENERIC_STEPS = base.steps.filter((s) => s.kind !== "personal");

export type Tone = "none" | "some" | "often";

export type CandidateFixture = {
  hero: string;
  /** Position in the generic order of the fixture; ties keep it. */
  order: number;
  /** FIT for anyone: base + the enemy and supports reads. */
  genericFit: number;
  /** FIT for you: the generic FIT + what your games add. */
  personalFit: number;
  /** Signed change caused by your games (0 = your games move nothing for this hero). */
  gamesDelta: number;
  /** One qualitative phrase, never a count or a rate. */
  evidence: string;
  tone: Tone;
  /** What the generic read says in a few words. ILLUSTRATIVE, sign-off required. */
  signal: string;
};

const TONE_BY_PHRASE: Record<string, Tone> = { "Often played": "often", "Some history": "some", "No history yet": "none", "In your pool": "some" };

/** Short generic reads, each tied to a real non-zero delta of the Hero fixture (Queen +1 vs Slark, Void Spirit −3 vs Slark, Puck +1 supports). */
const SIGNAL: Record<string, string> = {
  "Queen of Pain": "Holds vs Slark",
  "Void Spirit": "Weaker vs Slark",
  Puck: "Pairs with the supports",
};

export const CANDIDATES: readonly CandidateFixture[] = base.candidates.map((c, order) => {
  const genericFit = c.base + GENERIC_STEPS.reduce((sum, s) => sum + (s.deltas[c.hero] ?? 0), 0);
  const gamesDelta = personalStep.deltas[c.hero] ?? 0;
  const evidence = personalStep.detail[c.hero] ?? "No history yet";
  return { hero: c.hero, order, genericFit, personalFit: genericFit + gamesDelta, gamesDelta, evidence, tone: TONE_BY_PHRASE[evidence] ?? "none", signal: SIGNAL[c.hero] ?? "" };
});

export const DRAFT = {
  seat: base.seat,
  allies: base.allies.filter((a) => a.hero).map((a) => a.hero as string),
  enemies: base.enemies.map((e) => e.hero),
} as const;

export const COPY = {
  kicker: "Counterfactual",
  title: "Same draft, two reads.",
  modes: { generic: "For anyone", evidence: "Add your games", personal: "For you" },
  lines: {
    generic: "What the draft says before it knows who is playing.",
    evidence: "Now add your games.",
    personal: "The same draft, read for you.",
  },
  note: "Puck is the same Puck. What it means for you is not.",
  cause: "Your games",
  topRead: "Top read",
  call: "Your call",
  fit: "FIT",
  illustrative: "Illustrative draft",
} as const;

/** What a Dota expert must confirm before any of this is more than a Lab illustration. Never rendered. */
export const CF_SIGNOFF = {
  candidateSet: { seat: base.seat.label, heroes: base.candidates.map((c) => c.hero), claim: "these three are the natural Pos 2 Mid shortlist for this draft" },
  baseFit: base.candidates.map((c) => ({ hero: c.hero, base: c.base })),
  enemyAssertions: base.steps.filter((s) => s.kind === "enemy").map((s) => ({ step: s.id, deltas: s.deltas })),
  synergyAssertions: base.steps.filter((s) => s.kind === "synergy").map((s) => ({ step: s.id, deltas: s.deltas })),
  signedMatchupDeltas: GENERIC_STEPS.map((s) => ({ step: s.id, deltas: s.deltas })),
  genericSignals: SIGNAL,
  composition: { allies: DRAFT.allies, enemies: DRAFT.enemies },
  bans: base.bans,
  roleAssumptions: "Earth Spirit = Pos 4, Crystal Maiden = Pos 5, all three candidates viable at Pos 2 Mid",
  personalWeights: { claim: "what your games add (+6 / −1 / 0) and the phrases are placeholders for a model that is not defined", deltas: personalStep.deltas, phrases: personalStep.detail },
} as const;
