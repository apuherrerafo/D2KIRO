/* LANDING-01C · FAKE hero story. Deterministic and illustrative, like fake-scenario.ts, and the only other
   file that invents draft data.
   The story is ONE Ranked All Pick blind round seen from the Pos 2 Mid seat: our two support picks are
   locked while the enemy's two picks are still hidden; the reveal is the NEW information, and every score
   change that follows is the sum of reasons that information (and then the player's own context) brings.
   Nothing here is a free-floating number: `fitAt` derives every score from base + the reasons applied so far,
   so a displayed delta always has a named cause. The numbers are labelled illustrative on screen. */

export type StorySignalId = "position" | "counter" | "synergy" | "meta" | "history";
export type StorySignal = { id: StorySignalId; label: string; short: string; value: string };

export type StoryContextId = "position" | "pool" | "history" | "matchups";
export type StoryContext = { id: StoryContextId; label: string };

/** The four causes, in the order the information arrives: enemy A → enemy B → our supports → the player. */
export const REASON_STAGES = ["enemyA", "enemyB", "synergy", "pool"] as const;
export type ReasonStage = (typeof REASON_STAGES)[number];

export type StoryReason = { delta: number; stage: ReasonStage; text: string };
export type StoryCandidate = { base: number; hero: string; reasons: readonly StoryReason[]; why: string };

export type StorySeat = { hero: string | null; position: 1 | 2 | 3 | 4 | 5; you: boolean };

export type StoryScenario = {
  allies: readonly StorySeat[];
  bans: readonly string[];
  candidates: readonly StoryCandidate[];
  /** The two enemy heroes of the round; hidden until the reveal. */
  enemies: readonly [string, string];
  /** What the call rests on, shown once the Top 3 has settled. */
  decision: readonly string[];
  summary: string;
};

const SCENARIO_PUCK: StoryScenario = {
  bans: ["Pudge", "Invoker", "Phantom Assassin", "Earthshaker", "Tiny", "Sniper"],
  enemies: ["Axe", "Slark"],
  allies: [
    { position: 1, hero: null, you: false },
    { position: 2, hero: null, you: true },
    { position: 3, hero: null, you: false },
    { position: 4, hero: "Earth Spirit", you: false },
    { position: 5, hero: "Crystal Maiden", you: false },
  ],
  candidates: [
    { hero: "Queen of Pain", base: 84, why: "Fits Pos 2", reasons: [
      { stage: "enemyA", delta: -1, text: "vs Axe" }, { stage: "enemyB", delta: 1, text: "vs Slark" },
      { stage: "synergy", delta: -1, text: "with your supports" }, { stage: "pool", delta: -1, text: "Your pool" },
    ] },
    { hero: "Void Spirit", base: 81, why: "Fits Pos 2", reasons: [
      { stage: "enemyA", delta: -3, text: "vs Axe" }, { stage: "enemyB", delta: -4, text: "vs Slark" },
      { stage: "synergy", delta: 1, text: "with your supports" }, { stage: "pool", delta: -1, text: "Your pool" },
    ] },
    { hero: "Puck", base: 78, why: "Fits Pos 2", reasons: [
      { stage: "enemyA", delta: 4, text: "vs Axe" }, { stage: "enemyB", delta: 3, text: "vs Slark" },
      { stage: "synergy", delta: 2, text: "with your supports" }, { stage: "pool", delta: 4, text: "Your pool" },
    ] },
  ],
  decision: ["Strong vs the enemy picks", "Pairs with your supports", "Strong personal performance"],
  summary: "Illustrative: round 1 is blind. Your two support picks are locked while the enemy's stay hidden. When the enemy picks are revealed, D2KIRO adds counter, team synergy and your own context, the Mid scores move for those reasons, Puck ranks first at 91 and is locked into Pos 2.",
};

const SCENARIO_EMBER: StoryScenario = {
  bans: ["Axe", "Techies", "Phantom Assassin", "Pudge", "Sniper", "Tiny"],
  enemies: ["Viper", "Pangolier"],
  allies: [
    { position: 1, hero: null, you: false },
    { position: 2, hero: null, you: true },
    { position: 3, hero: null, you: false },
    { position: 4, hero: "Hoodwink", you: false },
    { position: 5, hero: "Lich", you: false },
  ],
  candidates: [
    { hero: "Outworld Destroyer", base: 82, why: "Fits Pos 2", reasons: [
      { stage: "enemyA", delta: -2, text: "vs Viper" }, { stage: "enemyB", delta: 1, text: "vs Pangolier" },
      { stage: "synergy", delta: -1, text: "with your supports" }, { stage: "pool", delta: -2, text: "Your pool" },
    ] },
    { hero: "Ember Spirit", base: 80, why: "Fits Pos 2", reasons: [
      { stage: "enemyA", delta: 4, text: "vs Viper" }, { stage: "enemyB", delta: 2, text: "vs Pangolier" },
      { stage: "synergy", delta: 2, text: "with your supports" }, { stage: "pool", delta: 5, text: "Your pool" },
    ] },
    { hero: "Tinker", base: 77, why: "Fits Pos 2", reasons: [
      { stage: "enemyA", delta: -3, text: "vs Viper" }, { stage: "enemyB", delta: -2, text: "vs Pangolier" },
      { stage: "synergy", delta: 1, text: "with your supports" }, { stage: "pool", delta: 1, text: "Your pool" },
    ] },
  ],
  decision: ["Strong vs the enemy picks", "Pairs with your supports", "Strong personal performance"],
  summary: "Illustrative: a second draft. Supports locked, enemy picks hidden, then revealed; the Mid scores move for named reasons and Ember Spirit is locked into Pos 2.",
};

export const HERO_STORY = {
  youPosition: 2,
  youLabel: "Pos 2 Mid",
  scenarios: [SCENARIO_PUCK, SCENARIO_EMBER] as readonly StoryScenario[],
  signals: [
    { id: "position", label: "Position", short: "Position", value: "Pos 2 open" },
    { id: "counter", label: "Counter", short: "Counter", value: "the two reveals" },
    { id: "synergy", label: "Team synergy", short: "Synergy", value: "your Pos 4 + 5" },
    { id: "meta", label: "Meta", short: "Meta", value: "this patch" },
    { id: "history", label: "Your history", short: "You", value: "your matches" },
  ] satisfies StorySignal[],
  context: [
    { id: "position", label: "Your Pos 2" },
    { id: "pool", label: "Hero pool" },
    { id: "history", label: "Match history" },
    { id: "matchups", label: "Personal matchups" },
  ] satisfies StoryContext[],
  illustrative: "Illustrative draft",
} as const;

/** Which signal node each reason stage lights (position and meta are baseline, already in the starting scores). */
export const SIGNAL_OF_STAGE: Readonly<Record<ReasonStage, StorySignalId>> = { enemyA: "counter", enemyB: "counter", synergy: "synergy", pool: "history" };

export type StoryRow = { fit: number; hero: string };

/** A candidate's score once the first `applied` reasons (0..4) have arrived. */
export function fitAt(candidate: StoryCandidate, applied: number) {
  return candidate.reasons.slice(0, applied).reduce((sum, reason) => sum + reason.delta, candidate.base);
}

/** The Top 3 as it stands after `applied` reasons: sorted by the live score, stable on ties. */
export function rankAt(scenario: StoryScenario, applied: number): readonly StoryRow[] {
  return scenario.candidates
    .map((candidate, index) => ({ fit: fitAt(candidate, applied), hero: candidate.hero, index }))
    .sort((a, b) => b.fit - a.fit || a.index - b.index)
    .map(({ fit, hero }) => ({ fit, hero }));
}

export function candidateOf(scenario: StoryScenario, hero: string) {
  return scenario.candidates.find((candidate) => candidate.hero === hero) ?? scenario.candidates[0];
}

/** The first line of the stage's note names the enemy a counter reason is about. */
export function enemyOfStage(scenario: StoryScenario, stage: ReasonStage) {
  if (stage === "enemyA") return scenario.enemies[0];
  if (stage === "enemyB") return scenario.enemies[1];
  return null;
}
