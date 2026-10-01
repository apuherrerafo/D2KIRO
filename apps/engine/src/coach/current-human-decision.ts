import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { HumanActionability } from "../recommendation/human-actionability";
import { unavailableHeroesFrom } from "../recommendation/perspective-context";
import type { RecommendationDegradation, RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { buildHeroCard, candidateServesPosition, credibleHeroesForPosition, demoteRevealedHardCountered, extractHeroCandidates, revealedEnemyHeroes, type HeroCandidate } from "./hero-card";
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
  playerPersonalPosition: Position | null;
}

/** The stable default: the Player's own position when it is still eligible, else the lowest eligible one. */
function defaultTarget(eligible: readonly Position[], personal: Position | null): Position {
  return personal !== null && eligible.includes(personal) ? personal : eligible[0]!;
}

/**
 * The Coach's recommended target. PSR-001: STRATEGIC means "defensible evidence that one eligible human
 * position should be prioritised over the others". The engine has NO cross-position priority signal --
 * V6 ranks heroes, not positions, and "the top hero happens to resolve to Pos X" is a property of that
 * hero, not a comparison between positions -- so this never returns STRATEGIC. It returns the stable
 * default and says so. (`TargetBasis` keeps "STRATEGIC" as a reserved wire value for a future real signal.)
 * Never influenced by what the Player is viewing.
 */
export function selectDecisionTarget(input: SelectDecisionTargetInput): DecisionTarget {
  const eligible = [...input.eligiblePositions].sort((a, b) => a - b);
  if (eligible.length === 0) throw new Error("selectDecisionTarget requires at least one eligible position");
  const fallback = defaultTarget(eligible, input.playerPersonalPosition);
  if (eligible.length === 1) {
    return { targetPosition: fallback, targetBasis: "DETERMINISTIC_DEFAULT", targetRationale: `${positionPhrase(fallback)} es tu única posición humana pendiente: no hay prioridad que elegir.` };
  }
  return {
    targetPosition: fallback,
    targetBasis: "DETERMINISTIC_DEFAULT",
    targetRationale: `No hay una prioridad estratégica clara entre tus posiciones pendientes. Vista inicial sugerida: ${positionPhrase(fallback)}.`,
  };
}

/**
 * PSR-002: the position the Player is INSPECTING. Navigation only -- honoured when eligible, otherwise
 * the recommendation itself. It never changes the recommendation, ownership or session state.
 */
export function resolveViewedPosition(eligiblePositions: readonly Position[], recommended: Position, requested: Position | null | undefined): Position {
  return requested != null && eligiblePositions.includes(requested) ? requested : recommended;
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

/**
 * COHERENCE-007 provenance (Greptile PR #9): did the Personal Hero Pool actually vote in THIS ranking?
 * Read from the ranking's own `hero_pool_fit` signal -- `applicable: false` for a pool that is absent or
 * empty -- never approximated from "an account is present".
 */
export function rankingAppliedPersonalPool(ranking: RecommendationSetV2): boolean {
  return ranking.recommendations.some((recommendation) =>
    Object.values(recommendation.signalsByHero).some((signals) => signals.some((signal) => signal.signal === "hero_pool_fit" && signal.applicable === true)));
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
      // COHERENCE-006: every visible card is legal and serves THIS target, whatever else V6 returned. A candidate
      // whose role V6 already resolved serves only that resolved position (never relabelled as the viewed one).
      .filter((candidate) => !unavailable.has(candidate.heroId) && candidateServesPosition(candidate, targetPosition, heroPositions));
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
    // The Coach recommendation (never moved by navigation)...
    targetPosition: input.target.targetPosition,
    targetBasis: input.target.targetBasis,
    targetRationale: input.target.targetRationale,
    // ...and the position the candidates below belong to (what the Player is inspecting).
    viewedPosition: input.candidates.targetPosition,
    candidates: input.candidates,
    personalPoolApplied: input.personalPoolApplied,
  };
}
