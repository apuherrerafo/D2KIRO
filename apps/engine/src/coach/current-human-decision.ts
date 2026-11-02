import type { HeroCapabilities } from "../draft-paths/types";
import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { HumanActionability } from "../recommendation/human-actionability";
import { unavailableHeroesFrom } from "../recommendation/perspective-context";
import type { RecommendationDegradation, RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { HeroPositions } from "../signals/hero-positions";
import { banOpeningOf, beatsRevealed, reorderByContext, synergiesWithOwn, type ContextReorderInput } from "./context-reorder";
import { deriveCardRisks, deriveCompositionContext } from "./card-critical-gap";
import { buildHeroCard, candidateServesPosition, credibleHeroesForPosition, extractHeroCandidates, revealedEnemyHeroes, type HeroCandidate } from "./hero-card";
import type { CandidateResult, CurrentHumanDecision, PoolMembership, PoolOwner, PoolState, PositionalAlternative, RankedCandidateCard, TargetBasis } from "./recommendation-output-v4";
import type { LivePositionPriority } from "./live-position-priority";
import { positionPhrase } from "./reveal-strategy";

// Product Semantics Recovery WP2 -- the CurrentHumanDecision builder (pure).
//
//   HumanActionability -> (no action? NO_HUMAN_ACTION)
//     -> target selection over ALL eligible positions, from the team-level evaluation
//     -> exactly ONE target-specific ranking (supplied by the caller for the chosen target)
//     -> exactly ONE candidate provenance: RANKED | UNRANKED_POSITIONAL | UNAVAILABLE
//
// Nothing here SCORES: V6 stays the only scorer. Since 2026-10-29 (user's product decision) the candidate order is
// V6's order adjusted by a capped bonus for what the Player can see (bans that open a hero, enemies it beats, allies it pairs
// with -- see context-reorder.ts). A revealed counter LOWERS a hero (more if they meet in lane, less if an ally pairs
// with it) but no longer sends it to the back: RB-4 stays only in the V3 path (user's decision, 2026-10-30).
// Target selection reads the team evaluation's own order and role resolution.
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
  /**
   * Step 1B-B -- the eligible positions whose configured Party5 pool still has an available hero (or have no pool). When
   * it narrows the field the target is chosen among them only; when it is empty or absent the full eligible set stands
   * (every position exhausted -> the candidate step reports it truthfully, nothing is invented).
   */
  viablePositions?: readonly Position[];
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
  const viable = eligible.filter((position) => input.viablePositions?.includes(position));
  if (viable.length > 0 && viable.length < eligible.length) {
    const target = defaultTarget(viable, input.playerPersonalPosition);
    const exhausted = eligible.filter((position) => !viable.includes(position)).map(positionPhrase).join(", ");
    return {
      targetPosition: target,
      targetBasis: "DETERMINISTIC_DEFAULT",
      targetRationale: `Tu pool de ${exhausted} ya no tiene héroes disponibles: la recomendación pasa a ${positionPhrase(target)}.`,
    };
  }
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
 * V4's target from the position priority the Team Coach board already computed. V4's wire has no PHASE_FALLBACK, and the
 * habitual commitment order is exactly "no clear strategic priority", so it travels as DETERMINISTIC_DEFAULT -- only a
 * counter window or a last pool hero is STRATEGIC. Null when absent or when it points at a position that is not
 * eligible here (the caller falls back to selectDecisionTarget).
 */
export function targetFromPriority(priority: LivePositionPriority | null | undefined, eligiblePositions: readonly Position[]): DecisionTarget | null {
  if (!priority || !eligiblePositions.includes(priority.targetPosition)) return null;
  return {
    targetPosition: priority.targetPosition,
    targetBasis: priority.targetBasis === "STRATEGIC" ? "STRATEGIC" : "DETERMINISTIC_DEFAULT",
    targetRationale: priority.targetRationale,
  };
}

/**
 * PSR-002: the position the Player is INSPECTING. Navigation only -- honoured when eligible. With no request
 * the Player starts on their OWN position when it is still open (the recommendation may be a habit order such as
 * Pos 5 first, which must not take their personal view away); otherwise on the recommendation itself.
 * It never changes the recommendation, ownership or session state.
 */
export function resolveViewedPosition(
  eligiblePositions: readonly Position[],
  recommended: Position,
  requested: Position | null | undefined,
  playerPersonalPosition: Position | null = null,
): Position {
  if (requested != null && eligiblePositions.includes(requested)) return requested;
  return playerPersonalPosition !== null && eligiblePositions.includes(playerPersonalPosition) ? playerPersonalPosition : recommended;
}

export interface DeriveCandidateResultInput {
  targetPosition: Position;
  /** The ONE target-specific ranking (pre-ranking universe = heroes credible at targetPosition). */
  targetRanking: RecommendationSetV2;
  view: PerspectiveDraftView;
  heroPositions: HeroPositions;
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  /** Curated pairs. Absent = none (production injects the real file; tests never read it). */
  heroSynergies?: ReadonlyMap<HeroId, readonly CuratedSynergy[]>;
  /** Capacidades curadas (la lista que lee `team_synergy`). Omitida -> no se puede derivar ningún CRITICAL_GAP. */
  heroCapabilities?: readonly HeroCapabilities[];
  personalPoolApplied: boolean;
  shortlistSize?: number;
  /** Cuántos héroes de TU pool se listan aparte (solo si algún pool votó). */
  poolShortlistSize?: number;
  /**
   * Hero Pools V2 -- the target position's configured teammate pool. It is a LABEL, never an admission: every card
   * still has to serve the target position, and a pool that ran dry leaves the credible heroes (labelled outside).
   */
  activePool?: readonly HeroId[];
}

/** Which pool shaped the ranking and whether anything is left in it. Pure; `unavailable` = banned / picked heroes. */
export function derivePoolInfo(input: { activePool?: readonly HeroId[]; personalPoolApplied: boolean; unavailable: ReadonlySet<HeroId> }): { poolState: PoolState; poolOwner: PoolOwner | null } {
  if (input.activePool && input.activePool.length > 0) {
    const left = input.activePool.some((heroId) => !input.unavailable.has(heroId));
    return { poolState: left ? "ACTIVE" : "EXHAUSTED", poolOwner: "TEAMMATE" };
  }
  if (input.personalPoolApplied) return { poolState: "ACTIVE", poolOwner: "PLAYER" };
  return { poolState: "NONE", poolOwner: null };
}

function membershipOf(candidate: HeroCandidate, input: DeriveCandidateResultInput): PoolMembership {
  if (input.activePool && input.activePool.length > 0) return input.activePool.includes(candidate.heroId) ? "IN_POOL" : "OUTSIDE_POOL";
  if (!input.personalPoolApplied) return "NO_POOL";
  return isFromPersonalPool(candidate) ? "IN_POOL" : "OUTSIDE_POOL";
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

/**
 * ¿Ya hay información DEL DRAFT? Un pick revelado (tuyo o del rival). Los bans NO cuentan aquí: en el primer pick el contexto son los
 * bans y ya reordenan la lista (context-reorder.ts); sin nada más que mirar, V6 manda (regla del usuario: "el contexto desempata, no
 * pisa a V6"). Pura.
 */
export function hasDraftInformation(context: Pick<ContextReorderInput, "ownPicks" | "revealedEnemies">): boolean {
  return context.ownPicks.size > 0 || context.revealedEnemies.size > 0;
}

/**
 * Regla del usuario (2026-11-02): una vez que el draft ya dice algo, un héroe cuya ÚNICA razón es "juega ese rol" NO se recomienda
 * (sigue eligible a mano). Tiene motivo cuando algo del draft lo respalda: los bans lo abren (se baneó lo que lo counterea), le gana
 * a un rival ya revelado, hace pareja con un aliado, pertenece a TU pool, o es la intención de draft que el jugador eligió
 * (`archetype_fit` votó con datos). `position_fit`, el parche (`patch_meta`) y FLEX NUNCA cuentan como motivo: votan en casi todos los
 * héroes (Dota-Judge RB-3) y el winrate de rangos bajos favorece a los héroes fáciles. Pura.
 */
export function hasDraftMotive(candidate: HeroCandidate, input: DeriveCandidateResultInput, revealedEnemies: readonly HeroId[], context: ContextReorderInput): boolean {
  if (membershipOf(candidate, input) === "IN_POOL") return true;
  if (banOpeningOf(candidate.heroId, context).openedBy.length > 0) return true;
  if (beatsRevealed(candidate.heroId, context).length > 0) return true;
  if (synergiesWithOwn(candidate.heroId, context).length > 0) return true;
  const card = buildHeroCard(candidate, [], { revealedEnemies, heroCounters: input.heroCounters });
  if (card.badges.some((badge) => badge === "COUNTER" || badge === "SYNERGY")) return true;
  return candidate.signals.some((signal) => signal.signal === "archetype_fit" && signal.raw !== null && signal.applicable !== false && signal.weighted > 0);
}

export function deriveCandidateResult(input: DeriveCandidateResultInput): CandidateResult {
  const { targetPosition, targetRanking, view, heroPositions } = input;
  const size = input.shortlistSize ?? CURRENT_DECISION_SHORTLIST_SIZE;
  const degradations = [...targetRanking.degradations];
  const unavailable = unavailableHeroesFrom(view);
  let droppedForNoMotive = false;

  if (!invalidatesRanking(degradations)) {
    // Regla del usuario (grill-me 2026-10-30), ver context-reorder.ts: los bans abren héroes; lo que el rival YA tiene
    // sube a quien le gana y baja a quien lo counterea (según si se cruzan en línea y si un aliado tuyo le gana a ese counter), sin
    // mandarlo al fondo de oficio. La lista del pool usa ESTE mismo orden. Sin contexto que toque a nadie, es el de V6.
    const contextInput: ContextReorderInput = {
      banned: new Set(view.bannedHeroes),
      ownPicks: new Set(view.ownPicks.flatMap((slot) => (slot.visibility !== "HIDDEN" ? [slot.heroId] : []))),
      revealedEnemies: new Set(revealedEnemyHeroes(view)),
      heroCounters: input.heroCounters,
      heroSynergies: input.heroSynergies,
      heroPositions,
      targetPosition,
    };
    const candidates = reorderByContext(extractHeroCandidates(targetRanking, heroPositions), contextInput)
      // COHERENCE-006: every visible card is legal and serves THIS target, whatever else V6 returned. A candidate
      // whose role V6 already resolved serves only that resolved position (never relabelled as the viewed one).
      .filter((candidate) => !unavailable.has(candidate.heroId) && candidateServesPosition(candidate, targetPosition, heroPositions));
    const revealedEnemies = revealedEnemyHeroes(view);
    // Con información del draft: fuera los que solo tienen el rol como razón (siguen eligibles a mano, solo no se recomiendan).
    // Sin ella (primer pick): manda V6 con el reordenamiento por bans; no hay nada más que pedirle a un héroe.
    const reasoned = hasDraftInformation(contextInput) ? candidates.filter((candidate) => hasDraftMotive(candidate, input, revealedEnemies, contextInput)) : candidates;
    droppedForNoMotive = candidates.length > 0 && reasoned.length === 0;
    if (reasoned.length > 0) {
      // Aviso informativo: se calcula DESPUÉS del orden, no lo cambia (ver card-critical-gap.ts).
      const composition = deriveCompositionContext(view, input.heroCapabilities);
      const ordered = reasoned;
      const toCard = (candidate: HeroCandidate, index: number): RankedCandidateCard => {
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
          // COHERENCE-007: a pool mark exists only when a pool actually shaped this ranking.
          isFromPool: membershipOf(candidate, input) === "IN_POOL",
          poolMembership: membershipOf(candidate, input),
          // Sólo la primera tarjeta de cada lista lleva el aviso: es la decisión que el jugador está por tomar; en las demás sería ruido repetido.
          risks: index === 0 ? deriveCardRisks(candidate, composition) : [],
        };
      };
      const cards = ordered.slice(0, size).map(toCard);
      const poolSize = input.poolShortlistSize ?? 0;
      const poolCards = poolSize === 0 ? [] : ordered.filter((candidate) => membershipOf(candidate, input) === "IN_POOL").slice(0, poolSize).map(toCard);
      return { state: "RANKED", targetPosition, cards, poolCards, degradations };
    }
  }

  const alternatives = positionalAlternatives(targetPosition, view, heroPositions, size);
  if (alternatives.length > 0) {
    return {
      state: "UNRANKED_POSITIONAL",
      targetPosition,
      alternatives,
      reason: droppedForNoMotive
        ? `Sin recomendación con motivo para ${positionPhrase(targetPosition)}: ningún héroe tiene en este draft un counter, una sinergia o fuerza en el parche que lo respalde. Se listan héroes legales que se juegan en esa posición, sin orden de preferencia.`
        : `No hay un ranking confiable para ${positionPhrase(targetPosition)}: se listan héroes legales que se juegan en esa posición, sin orden de preferencia.`,
      degradations,
    };
  }
  const reason = `No hay héroes legales creíbles para ${positionPhrase(targetPosition)} en este momento.`;
  return { state: "UNAVAILABLE", targetPosition, reason, degradations };
}

export interface BuildCurrentHumanDecisionInput {
  actionability: HumanActionability;
  target: DecisionTarget | null;
  candidates: CandidateResult | null;
  personalPoolApplied: boolean;
  poolState?: PoolState;
  poolOwner?: PoolOwner | null;
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
    poolState: input.poolState ?? "NONE",
    poolOwner: input.poolOwner ?? null,
  };
}
