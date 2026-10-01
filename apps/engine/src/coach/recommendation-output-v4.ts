import type { DraftDecisionContext } from "../drafter/decision-context";
import type { HeroId, RankedApPhase } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { MetaReadiness } from "../meta/readiness";
import type { NoHumanActionReason } from "../recommendation/human-actionability";
import type { RecommendationBasedOn, RecommendationDegradation, RoleImpactStatus } from "../recommendation/types";
import type { Confidence, HeroBadge } from "./hero-card";
import type { RoleCollisionObservation } from "./observable-state";
import type { CoachObservableState } from "./observable-state";
import { displayBeliefs, type CoachOpportunity, type CoachTrigger, type RoleBeliefDisplay } from "./recommendation-output-v3";

// Product Semantics Recovery -- CONTRACT FREEZE: RecommendationOutputV4 / CurrentHumanDecision.
//
// ONE authoritative projection of the current human decision. V3 (recommendation-output-v3.ts) is
// untouched and keeps serving `?format=v3`; V4 is a separate, explicitly versioned wire contract
// served by `?format=v4`. Every current-action surface of the web reads THIS object only:
//
//   decision.kind         -- is there a human action right now at all (from HumanActionability)?
//   actionablePositions   -- EVERY eligible human position (never truncated by round capacity)
//   roundCapacity         -- how many picks fit this round (never which positions)
//   targetPosition        -- the Coach's RECOMMENDED position (never moved by navigation)
//   targetBasis           -- STRATEGIC (reserved: a real cross-position priority signal; the engine does
//                            not emit it today) or DETERMINISTIC_DEFAULT (no priority -- a stable initial
//                            view, never presented as advice). User navigation is NOT a basis.
//   viewedPosition        -- the position the Player is inspecting; the ONE position `candidates` belong to
//   candidates.state      -- RANKED | UNRANKED_POSITIONAL | UNAVAILABLE: exactly one candidate
//                            provenance, with the degradations of THAT result only
//   personalPoolApplied   -- the Personal Hero Pool influenced these candidates (only possible when
//                            targetPosition is the Player's personal position)
//
// STRUCTURAL GUARANTEES (tested in current-human-decision.test.ts / coherence gates):
//   - A RANKED result carries rank/score/confidence; an UNRANKED_POSITIONAL result has NO such fields
//     at all, so a response cannot say "ranking unavailable" while presenting ranked cards.
//   - A RANKED result never carries a degradation that invalidates ranking.
//   - NO_HUMAN_ACTION carries no target and no candidates.

export const RECOMMENDATION_OUTPUT_V4_SCHEMA = "recommendation-output/v4" as const;

export type TargetBasis = "STRATEGIC" | "DETERMINISTIC_DEFAULT";

export type CandidateState = "RANKED" | "UNRANKED_POSITIONAL" | "UNAVAILABLE";

/** A card of a ranking that survived validation for the target position. */
export interface RankedCandidateCard {
  heroId: HeroId;
  /** Always the decision's targetPosition: a card never belongs to another position. */
  position: Position;
  rank: number;
  /** V6 score (internal ordering). */
  score: number;
  confidence: Confidence;
  roleStatus: RoleImpactStatus;
  badges: HeroBadge[];
  rationale: string;
  /** Only ever true when the decision's personalPoolApplied is true. */
  isFromPool: boolean;
}

/** A legal hero curated as credible for the target position -- no rank, score or confidence exists. */
export interface PositionalAlternative {
  heroId: HeroId;
  position: Position;
}

export type CandidateResult =
  | { state: "RANKED"; targetPosition: Position; cards: RankedCandidateCard[]; degradations: RecommendationDegradation[] }
  | { state: "UNRANKED_POSITIONAL"; targetPosition: Position; alternatives: PositionalAlternative[]; reason: string; degradations: RecommendationDegradation[] }
  | { state: "UNAVAILABLE"; targetPosition: Position; reason: string; degradations: RecommendationDegradation[] };

export type CurrentHumanDecision =
  | {
      kind: "ACTIONABLE";
      actionablePositions: Position[];
      roundCapacity: number;
      /** The Coach's RECOMMENDED position (default view). Never changed by the Player navigating the selector. */
      targetPosition: Position;
      targetBasis: TargetBasis;
      targetRationale: string;
      /** The position the Player is INSPECTING; `candidates` belong to it. Equals targetPosition unless the Player navigated. */
      viewedPosition: Position;
      candidates: CandidateResult;
      personalPoolApplied: boolean;
    }
  | {
      kind: "NO_HUMAN_ACTION";
      actionablePositions: [];
      roundCapacity: 0;
      reason: NoHumanActionReason;
    };

export interface RecommendationOutputV4 {
  schema: typeof RECOMMENDATION_OUTPUT_V4_SCHEMA;
  sessionId: string;
  decision: CurrentHumanDecision;
  /** Observable role uncertainty (context for manual position assignment) -- never a decision surface. */
  roleBeliefs: { own: RoleBeliefDisplay[]; enemy: RoleBeliefDisplay[] };
  roleCollision?: RoleCollisionObservation;
  /**
   * Safe Core (Wave 4A) -- INFORMATIONAL only, never part of `decision`: it names no target, moves no view,
   * changes no capacity and reorders no candidate. Absent (never null) unless curated public evidence supports it.
   */
  opportunity?: CoachOpportunity;
  meta: {
    round: 1 | 2 | 3 | null;
    phase: RankedApPhase | null;
    decisionContext: DraftDecisionContext;
    trigger: CoachTrigger;
    /** Monotonic per session: a client discards an out-of-order response. */
    revision: number;
    /** Identity of the ranking the candidates came from (or of the observed state when there is none). */
    basedOn: RecommendationBasedOn;
    readiness?: MetaReadiness;
  };
}

function roundOf(phase: RankedApPhase | null): 1 | 2 | 3 | null {
  if (phase === "PICK_ROUND_1") return 1;
  if (phase === "PICK_ROUND_2") return 2;
  if (phase === "PICK_ROUND_3") return 3;
  return null;
}

export interface BuildRecommendationOutputV4Input {
  decision: CurrentHumanDecision;
  coachState: CoachObservableState;
  decisionContext: DraftDecisionContext;
  /** The ranking the candidates came from; for NO_HUMAN_ACTION, the (empty) team evaluation of the observed state. */
  source: { basedOn: RecommendationBasedOn; readiness?: MetaReadiness };
  trigger: CoachTrigger;
  revision: number;
  opportunity?: CoachOpportunity | null;
}

export function buildRecommendationOutputV4(input: BuildRecommendationOutputV4Input): RecommendationOutputV4 {
  const { coachState } = input;
  const phase = coachState.view.rankedAp?.phase ?? null;
  return {
    schema: RECOMMENDATION_OUTPUT_V4_SCHEMA,
    sessionId: coachState.view.sessionId,
    decision: input.decision,
    roleBeliefs: { own: displayBeliefs(coachState.ownRoleBeliefs), enemy: displayBeliefs(coachState.enemyRoleBeliefs) },
    ...(coachState.roleCollision ? { roleCollision: coachState.roleCollision } : {}),
    ...(input.opportunity ? { opportunity: input.opportunity } : {}),
    meta: {
      round: roundOf(phase),
      phase,
      decisionContext: input.decisionContext,
      trigger: input.trigger,
      revision: input.revision,
      basedOn: input.source.basedOn,
      ...(input.source.readiness ? { readiness: input.source.readiness } : {}),
    },
  };
}
