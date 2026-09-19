import type { DraftDecisionContext } from "../drafter/decision-context";
import type { HeroId, RankedApPhase } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { RecommendationBasedOn, RecommendationSetV2 } from "../recommendation/types";
import type { HeroPositions } from "../signals/hero-positions";
import type { CoachObservableState } from "./observable-state";
import { buildHeroCard, extractHeroCandidates, type Confidence, type HeroCandidate, type HeroCard } from "./hero-card";
import { positionPhrase, type RevealStrategy } from "./reveal-strategy";

// AP Ranked Roles V1 / Wave 2 (task 18) -- RecommendationOutputV3: the Coach's UI contract, built
// ON TOP of RecommendationSetV2 (never replacing it: V2 keeps serving its existing consumers).
//
//   PRIMARY ACTION  -> what to reveal / preserve / do now   (Level 1, RevealStrategy)
//   SHORTLIST       -> concrete hero options for that action (Level 2, the existing V6 ranking)
//
// The shortlist may hold concrete heroes while the primary action is role-level. It is a list of
// OPTIONS, and it never upgrades the action to hero-level: `primaryAction.strategy` is the only
// statement of how specific the Coach is being.
//
// Blocks owned by later waves are typed here but never populated in Wave 2 (no fabricated evidence):
// `opportunity` (Wave 4, Safe Core), `personalHeroView` / `outsidePoolRecommendation` (Wave 3).

/** How many hero options the shortlist carries (task 18's stated initial default; configurable per call). */
export const COACH_SHORTLIST_SIZE = 5;

/** Why the Coach recomputed: the legal observable-state change that triggered this output. */
export type CoachTrigger =
  | "DRAFT_PICKS_STARTED" // first output of a session (start of the pick phase)
  | "OWN_PICK_CONFIRMED" // one of our own seats was sealed (recomputed immediately, no enemy reveal needed)
  | "ROUND_REVEALED" // new enemy picks became legally visible
  | "PLAYER_POSITION_ASSIGNED" // the Player assigned a position to a visible hero
  | "STATE_CHANGED" // any other legal observable change (e.g. a collision ban reopening a seat)
  | "REFRESH"; // nothing changed; recomputed on request

export interface CoachOutputConfig {
  /** Monotonic per session (orchestrator-assigned): lets a client discard an out-of-order response. */
  revision?: number;
  trigger?: CoachTrigger;
  /** Declared personal position. Wave 2 does not use it: it never constrains pick timing. */
  playerPersonalPosition?: Position | null;
  shortlistSize?: number;
  /** Curated position evidence: the repo's definition of Flex (a hero registered in 2+ positions). */
  heroPositions?: HeroPositions;
  /** Wave 3 (Hero Pool). Wave 2 callers omit it, so no pool badge/flag is ever produced. */
  heroPool?: readonly HeroId[];
}

export interface RecommendationOutputV3 {
  schema: "recommendation-output/v3";
  sessionId: string;
  primaryAction: {
    strategy: RevealStrategy;
    /** A suggestion, never an obligation: the Player keeps full authority (PD-003). */
    label: string;
  };
  shortlist: HeroCard[];
  /** Wave 4. Absent unless real evidence exists (never by default). */
  opportunity?: { label: string; heroId?: HeroId; evidence: string };
  /** Wave 3. Absent unless a personal position is declared AND implemented. */
  personalHeroView?: { positionLabel: string; heroes: { heroId: HeroId; rank: number; score: number }[] };
  /** Wave 3. Absent unless a hero pool is configured. */
  outsidePoolRecommendation?: { heroId: HeroId; label: string; rationale: string };
  meta: {
    round: 1 | 2 | 3 | null;
    phase: RankedApPhase | null;
    ownPicksRemaining: number;
    confidence: Confidence;
    decisionContext: DraftDecisionContext;
    trigger: CoachTrigger;
    revision: number;
    /** Same object as the source RecommendationSetV2.basedOn: stale detection = compare stateIdentity + evidenceVersion. */
    basedOn: RecommendationBasedOn;
  };
}

// ---------------------------------------------------------------------------------------------
// primaryAction.label -- composed from the strategy's own fields, not a per-kind canned sentence.
// ---------------------------------------------------------------------------------------------

const LABEL_VERB: Readonly<Record<RevealStrategy["kind"], string>> = {
  REVEAL_POSITION: "Sugerencia: revela",
  REVEAL_HERO: "Sugerencia: asegura",
  DEFER_POSITION: "Sugerencia: guarda para más tarde",
  REVEAL_FLEX: "Sugerencia: revela un pick flexible",
  OPPORTUNITY: "Oportunidad:",
};

function labelTarget(strategy: RevealStrategy): string {
  if (strategy.kind === "REVEAL_HERO") return `este héroe ahora (${positionPhrase(strategy.position)})`;
  if (strategy.kind === "REVEAL_FLEX") return `(${strategy.possiblePositions.map(positionPhrase).join(" / ")})`;
  if (strategy.kind === "OPPORTUNITY") return strategy.rationale;
  return positionPhrase(strategy.position);
}

export function labelForStrategy(strategy: RevealStrategy): string {
  return `${LABEL_VERB[strategy.kind]} ${labelTarget(strategy)}`;
}

// ---------------------------------------------------------------------------------------------
// shortlist -- V6 order, with the options that fit the primary action first.
// ---------------------------------------------------------------------------------------------

function fitsStrategy(candidate: HeroCandidate, strategy: RevealStrategy): boolean {
  if (strategy.kind === "REVEAL_HERO") return candidate.heroId === strategy.heroId;
  if (strategy.kind === "REVEAL_POSITION" || strategy.kind === "DEFER_POSITION") {
    const resolvedHere = candidate.roleStatus !== "UNRESOLVED" && candidate.position === strategy.position;
    return resolvedHere || candidate.flexPositions.includes(strategy.position);
  }
  if (strategy.kind === "REVEAL_FLEX") return candidate.flexPositions.some((position) => strategy.possiblePositions.includes(position));
  return strategy.heroId !== undefined && candidate.heroId === strategy.heroId;
}

function orderForStrategy(candidates: readonly HeroCandidate[], strategy: RevealStrategy): HeroCandidate[] {
  if (strategy.kind === "DEFER_POSITION") {
    // Deferring a position means not spending it now: options for OTHER positions lead.
    const others = candidates.filter((candidate) => !fitsStrategy(candidate, strategy));
    return others.length > 0 ? others : [...candidates];
  }
  const fitting = candidates.filter((candidate) => fitsStrategy(candidate, strategy));
  return [...fitting, ...candidates.filter((candidate) => !fitting.includes(candidate))];
}

// ---------------------------------------------------------------------------------------------
// meta.confidence -- never higher than the evidence behind the action.
// ---------------------------------------------------------------------------------------------

const CONFIDENCE_ORDER: readonly Confidence[] = ["baja", "media", "alta"];

function lower(a: Confidence, b: Confidence): Confidence {
  return CONFIDENCE_ORDER.indexOf(a) <= CONFIDENCE_ORDER.indexOf(b) ? a : b;
}

/** Role-level actions rest on a role belief or an opening prior: V6's "alta" is capped at "media". */
const KIND_CONFIDENCE_CAP: Readonly<Record<RevealStrategy["kind"], Confidence>> = {
  REVEAL_HERO: "alta",
  REVEAL_POSITION: "media",
  DEFER_POSITION: "media",
  REVEAL_FLEX: "media",
  OPPORTUNITY: "alta",
};

function stepDown(confidence: Confidence): Confidence {
  return CONFIDENCE_ORDER[Math.max(CONFIDENCE_ORDER.indexOf(confidence) - 1, 0)]!;
}

function deriveConfidence(candidates: readonly HeroCandidate[], strategy: RevealStrategy): Confidence {
  const top = candidates[0];
  if (!top) return "baja";
  const confidence = lower(top.confidence, KIND_CONFIDENCE_CAP[strategy.kind]);
  // No separation between the two best options: one tier less (a tie is not evidence of a leader).
  const second = candidates[1];
  return second && second.score === top.score ? stepDown(confidence) : confidence;
}

function roundOf(phase: RankedApPhase | null): 1 | 2 | 3 | null {
  if (phase === "PICK_ROUND_1") return 1;
  if (phase === "PICK_ROUND_2") return 2;
  if (phase === "PICK_ROUND_3") return 3;
  return null;
}

export function translateToRecommendationOutputV3(
  recommendationSet: RecommendationSetV2,
  revealStrategy: RevealStrategy,
  coachState: CoachObservableState,
  decisionContext: DraftDecisionContext,
  config: CoachOutputConfig = {},
): RecommendationOutputV3 {
  const heroPool = config.heroPool ?? [];
  const size = config.shortlistSize ?? COACH_SHORTLIST_SIZE;
  const candidates = extractHeroCandidates(recommendationSet, config.heroPositions);
  const view = coachState.view;
  const phase = view.rankedAp?.phase ?? null;
  const ownVisible = view.ownPicks.filter((slot) => slot.visibility !== "HIDDEN").length;

  return {
    schema: "recommendation-output/v3",
    sessionId: view.sessionId,
    primaryAction: { strategy: revealStrategy, label: labelForStrategy(revealStrategy) },
    shortlist: orderForStrategy(candidates, revealStrategy)
      .slice(0, size)
      .map((candidate) => buildHeroCard(candidate, heroPool)),
    meta: {
      round: roundOf(phase),
      phase,
      ownPicksRemaining: Math.max(5 - ownVisible, 0),
      confidence: deriveConfidence(candidates, revealStrategy),
      decisionContext,
      trigger: config.trigger ?? "REFRESH",
      revision: config.revision ?? 0,
      basedOn: recommendationSet.basedOn,
    },
  };
}
