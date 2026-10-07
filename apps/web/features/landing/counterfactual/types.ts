/* Counterfactual personalization — shapes. One draft, one set of candidates; what changes between "Generic meta"
   and "For you" is which evidence is read, not which hero is on screen. Levels are QUALITATIVE (0–3), never a
   win rate, a count or a probability: they exist so the order can be derived, and are never shown as numbers. */

export type FactorId = "meta" | "lane" | "history";

/** neutral = generic / unchanged · cyan = retained, known context · pink = evidence changing the reading · lime = qualified, usable. */
export type TagTone = "neutral" | "cyan" | "pink" | "lime";

/** The story, in order. `generic` and `personal` are rests; the three between are the transformation. */
export type CounterfactualStage = "generic" | "context" | "reinterpret" | "reorder" | "personal";

export const COUNTERFACTUAL_STAGES: readonly CounterfactualStage[] = ["generic", "context", "reinterpret", "reorder", "personal"];

export interface Reading {
  /** 0–3. Only used to derive the order. */
  readonly level: number;
  /** Short tag text, e.g. "Lane · a risk". */
  readonly text: string;
}

export interface HeroRef { readonly id: number; readonly name: string }

export interface CandidateFixture {
  readonly hero: HeroRef;
  /** What an aggregate reading says about anyone in this draft. */
  readonly generic: { readonly meta: Reading; readonly lane: Reading };
  /** What the player's own history adds. `missing` is "no evidence", never "bad". */
  readonly history: Reading & { readonly evidence: "present" | "missing" };
  /** The generic lane reading, re-read through the player's own games: first challenged (pink), then qualified (lime). */
  readonly laneThroughYou?: { readonly challenged: string; readonly qualified: Reading };
}

export interface ModelFact {
  readonly id: "history" | "matchup";
  readonly text: string;
}

export interface DraftFixture {
  readonly id: string;
  readonly context: string;
  readonly allies: readonly HeroRef[];
  readonly enemies: readonly HeroRef[];
  readonly you: string;
}

export interface CounterfactualFixture {
  readonly draft: DraftFixture;
  /** In the generic order of the fixture. The order itself is derived, not stored. */
  readonly candidates: readonly CandidateFixture[];
  readonly facts: readonly ModelFact[];
}

export interface CandidateTag {
  readonly id: FactorId;
  readonly text: string;
  readonly tone: TagTone;
  /** Absence of evidence is drawn dashed, never as a negative. */
  readonly dashed: boolean;
}
