import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { HumanActionability } from "../recommendation/human-actionability";
import { unavailableHeroesFrom } from "../recommendation/perspective-context";
import type { RecommendationDegradation, RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import { isCredibleForPosition, type HeroPositions } from "../signals/hero-positions";
import { buildHeroCard, credibleHeroesForPosition, demoteRevealedHardCountered, extractHeroCandidates, revealedEnemyHeroes, type HeroCandidate } from "./hero-card";
import type { CandidateResult, CurrentHumanDecision, PositionalAlternative, RankedCandidateCard, TargetBasis } from "./recommendation-output-v4";
import { positionPhrase } from "./reveal-strategy";

// Product Semantics Recovery WP2 -- the CurrentHumanDecision builder (pure).
//
//   HumanActionability -> (no action? NO_HUMAN_ACTION)
//     -> target selection over ALL eligible positions, from the team-level evaluation
//     -> exactly ONE target-specific ranking (supplied by the caller for the chosen target)
//     -> exactly ONE candidate provenance: RANKED | UNRANKED_POSITIONAL | UNAVAILABLE
//
// Nothing here scores or re-ranks: V6 stays the only scorer. Target selection reads the team
// evaluation's own order and role resolution; candidate state reads the target ranking verbatim.
// Position is never inferred from round, slot or pick ordinal -- only from HumanActionability and
// V6's role impact.

export const CURRENT_DECISION_SHORTLIST_SIZE = 5;

/**
 * Degradations that mean "no trustworthy ranking exists for this result". A result carrying any of
 * them can never be RANKED -- this is the structural cut that makes "ranking unavailable + ranked
 * cards" unrepresentable.
 */
export const RANKING_INVALIDATING_REASONS: ReadonlySet<string> = new Set(["SNAPSHOT_UNAVAILABLE", "NO_LEGAL_HERO_UNIVERSE", "no_signal_available"]);

function invalidatesRanking(degradations: readonly RecommendationDegradation[]): boolean {
  return degradations.some((degradation) => RANKING_INVALIDATING_REASONS.has(degradation.reason));
}

export interface DecisionTarget {
  targetPosition: Position;
  targetBasis: TargetBasis;
  targetRationale: string;
}

export interface SelectDecisionTargetInput {
  eligiblePositions: readonly Position[];
  /** The team-level (position-agnostic, no personal pool) evaluation of this state. */
  teamEvaluation: RecommendationSetV2;
  view: PerspectiveDraftView;
  playerPersonalPosition: Position | null;
  heroPositions?: HeroPositions;
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
}

/** The stable default: the Player's own position when it is still eligible, else the lowest eligible one. Navigation only. */
function defaultTarget(eligible: readonly Position[], personal: Position | null): Position {
  return personal !== null && eligible.includes(personal) ? personal : eligible[0]!;
}

/**
 * STRATEGIC only when the evidence supports a real priority AMONG alternatives: two or more eligible
 * positions, a trustworthy team ranking, a leader whose role V6 resolved to an eligible position, and
 * no equally-scored candidate resolved to a DIFFERENT eligible position (a tie is not a priority).
 * Otherwise DETERMINISTIC_DEFAULT -- and its rationale says so, it never claims to be advice.
 */
export function selectDecisionTarget(input: SelectDecisionTargetInput): DecisionTarget {
  const eligible = [...input.eligiblePositions].sort((a, b) => a - b);
  if (eligible.length === 0) throw new Error("selectDecisionTarget requires at least one eligible position");
  const fallback = defaultTarget(eligible, input.playerPersonalPosition);

  if (eligible.length === 1) {
    return { targetPosition: fallback, targetBasis: "DETERMINISTIC_DEFAULT", targetRationale: `${positionPhrase(fallback)} es tu única posición humana pendiente: no hay prioridad que elegir.` };
  }

  const noPriority = (reason: string): DecisionTarget => ({
    targetPosition: fallback,
    targetBasis: "DETERMINISTIC_DEFAULT",
    targetRationale: `${reason} Se muestra ${positionPhrase(fallback)} como vista inicial; podés elegir cualquiera de tus posiciones pendientes.`,
  });

  if (input.teamEvaluation.recommendations.length === 0 || invalidatesRanking(input.teamEvaluation.degradations)) {
    return noPriority("No hay un ranking de equipo confiable para priorizar una posición.");
  }

  const candidates: HeroCandidate[] = demoteRevealedHardCountered(extractHeroCandidates(input.teamEvaluation, input.heroPositions), revealedEnemyHeroes(input.view), input.heroCounters);
  const resolvedEligible = candidates.filter((candidate) => candidate.roleStatus !== "UNRESOLVED" && eligible.includes(candidate.position));
  const leader = resolvedEligible[0];
  if (!leader) return noPriority("El ranking de equipo no resuelve la posición de ningún candidato entre tus posiciones pendientes.");

  const rival = resolvedEligible.find((candidate) => candidate.position !== leader.position);
  if (rival && rival.score === leader.score) {
    return noPriority(`El ranking de equipo empata entre ${positionPhrase(leader.position)} y ${positionPhrase(rival.position)}.`);
  }

  return {
    targetPosition: leader.position,
    targetBasis: "STRATEGIC",
    targetRationale: `El mejor candidato del ranking de equipo con posición resuelta juega ${positionPhrase(leader.position)}.`,
  };
}

export interface DeriveCandidateResultInput {
  targetPosition: Position;
  /** The ONE target-specific ranking (pre-ranking universe = heroes credible at targetPosition). */
  targetRanking: RecommendationSetV2;
  view: PerspectiveDraftView;
  heroPositions: HeroPositions;
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  personalPoolApplied: boolean;
  shortlistSize?: number;
}

function isFromPersonalPool(candidate: HeroCandidate): boolean {
  return candidate.signals.some((signal) => signal.signal === "hero_pool_fit" && signal.explanation.startsWith("En tu pool"));
}

/** Legal heroes curated as credible for the target, in id order (explicitly NOT a ranking). */
function positionalAlternatives(target: Position, view: PerspectiveDraftView, heroPositions: HeroPositions, size: number): PositionalAlternative[] {
  const unavailable = unavailableHeroesFrom(view);
  return credibleHeroesForPosition(target, heroPositions)
    .filter((heroId) => !unavailable.has(heroId))
    .slice(0, size)
    .map((heroId) => ({ heroId, position: target }));
}

export function deriveCandidateResult(input: DeriveCandidateResultInput): CandidateResult {
  const { targetPosition, targetRanking, view, heroPositions } = input;
  const size = input.shortlistSize ?? CURRENT_DECISION_SHORTLIST_SIZE;
  const degradations = [...targetRanking.degradations];
  const unavailable = unavailableHeroesFrom(view);

  if (!invalidatesRanking(degradations)) {
    const candidates = demoteRevealedHardCountered(extractHeroCandidates(targetRanking, heroPositions), revealedEnemyHeroes(view), input.heroCounters)
      // COHERENCE-006: every visible card is legal and credible for THIS target, whatever else V6 returned.
      .filter((candidate) => !unavailable.has(candidate.heroId) && isCredibleForPosition(candidate.heroId, targetPosition, heroPositions));
    if (candidates.length > 0) {
      const revealedEnemies = revealedEnemyHeroes(view);
      const cards: RankedCandidateCard[] = candidates.slice(0, size).map((candidate, index) => {
        const card = buildHeroCard(candidate, [], { revealedEnemies, heroCounters: input.heroCounters });
        return {
          heroId: card.heroId,
          position: targetPosition,
          rank: index + 1,
          score: card.score,
          confidence: card.confidence,
          roleStatus: card.roleStatus,
          badges: card.badges.filter((badge) => badge !== "YOUR_POOL" && badge !== "OUTSIDE_YOUR_POOL"),
          rationale: card.rationale,
          // COHERENCE-007: a pool mark exists only when the pool actually shaped this ranking.
          isFromPool: input.personalPoolApplied && isFromPersonalPool(candidate),
        };
      });
      return { state: "RANKED", targetPosition, cards, degradations };
    }
  }

  const alternatives = positionalAlternatives(targetPosition, view, heroPositions, size);
  if (alternatives.length > 0) {
    return {
      state: "UNRANKED_POSITIONAL",
      targetPosition,
      alternatives,
      reason: `No hay un ranking confiable para ${positionPhrase(targetPosition)}: se listan héroes legales que se juegan en esa posición, sin orden de preferencia.`,
      degradations,
    };
  }
  return { state: "UNAVAILABLE", targetPosition, reason: `No hay héroes legales creíbles para ${positionPhrase(targetPosition)} en este momento.`, degradations };
}

export interface BuildCurrentHumanDecisionInput {
  actionability: HumanActionability;
  target: DecisionTarget | null;
  candidates: CandidateResult | null;
  personalPoolApplied: boolean;
}

/** Assembles the decision. With no human action nothing else is carried -- no target, no candidates. */
export function buildCurrentHumanDecision(input: BuildCurrentHumanDecisionInput): CurrentHumanDecision {
  const { actionability } = input;
  if (!actionability.hasHumanAction || input.target === null || input.candidates === null) {
    return { kind: "NO_HUMAN_ACTION", actionablePositions: [], roundCapacity: 0, reason: actionability.noActionReason ?? "ROUND_COMPLETE" };
  }
  return {
    kind: "ACTIONABLE",
    actionablePositions: [...actionability.eligiblePositions],
    roundCapacity: actionability.roundCapacity,
    targetPosition: input.target.targetPosition,
    targetBasis: input.target.targetBasis,
    targetRationale: input.target.targetRationale,
    candidates: input.candidates,
    personalPoolApplied: input.personalPoolApplied,
  };
}
