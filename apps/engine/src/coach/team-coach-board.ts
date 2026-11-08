import type { HeroCapabilities } from "../draft-paths/types";
import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { stateIdentityOf } from "../recommendation/identity";
import { configuredPoolForPosition, unavailableHeroesFrom, type PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCandidateResult, rankingAppliedPersonalPool, selectDecisionTarget, type DecisionTarget } from "./current-human-decision";
import { alliesAnswering, reasonedCounters, reasonedSynergies, type BanOpening } from "./context-reorder";
import { freeThreatsOf, type FreeThreat } from "./free-threats";
import { selectGoldenCard, type GoldenCard } from "./golden-card";
import { type TeamCoachSteal, type TeamCoachStrength, type TeamCoachSynergy } from "./card-context";
import { revealedEnemyHeroes } from "./hero-card";
import { compositionNeedForContext, uncoveredPositions, type CompositionNeed } from "./composition-need";
import { selectLivePositionPriority, type LivePositionPriority } from "./live-position-priority";
import type { PoolMembership, RankedCandidateCard, TargetBasis } from "./recommendation-output-v4";
import { positionPhrase } from "./reveal-strategy";

// Team Coach Board -- ONE projection of every human-controlled position from ONE perspective-safe
// snapshot of the canonical protocol session.
//
//   PerspectiveRecommendationContext (one snapshot)
//     -> per open controlled position: the SAME target ranking V4 uses (buildTargetRanking)
//     -> deriveCandidateResult (the SAME candidate provenance as V4)
//     -> a deterministic primary plan (no two positions share their #1 when an alternative exists)
//     -> currentDecision: the target is LivePositionPriorityV1 (live-position-priority.ts) whenever a human may pick
//        for >= 2 positions now (Party 5 / team preset, simulator or live) -- and V4 asks for this SAME priority
//        (buildTeamPositionPriority), so board and V4 never disagree. With ONE open position it is selectDecisionTarget.
//        The priority only names the position to look at first: every open column stays ranked and selectable.
//
// Nothing here scores, re-ranks or decides legality: V6 is the only scorer, the kernel the only
// rule-keeper. The board never mutates the session -- it only reads the context it is handed.
//
// RECOMMENDATION IS ADVISORY, LEGALITY IS AUTHORITATIVE: `currentDecision.recommendedPosition` is a
// hint. Every position in `actionablePositions` stays selectable; the board never narrows them.
// POSITION != PICK ORDER != SLOT: positions come only from HumanActionability and the session's own
// position bindings, never from a round slot or pick ordinal.

export { strengthIndexOf, strengthsOf } from "./card-context";
export type { TeamCoachStrength, TeamCoachSynergy } from "./card-context";

export const TEAM_COACH_BOARD_SCHEMA = "team-coach-board/v1" as const;
/** Cards per position (the product floor is 3). */
export const TEAM_COACH_TOP_SIZE = 5;

/** RANKED = la columna se calculó; con cero candidatos significa que ningún héroe tiene fundamento (no se muestra nada: sin relleno ni mensaje). */
export type TeamCoachPositionState = "RANKED" | "UNAVAILABLE" | "FILLED" | "WAITING";

/** A revealed enemy hero that curated-counters this candidate, with the curated reason (`why`). */
export interface TeamCoachRisk {
  vsHeroId: HeroId;
  why: string;
  /** Aliados ya elegidos que le ganan a ese rival (por eso baja menos). Ausente = ninguno. */
  answeredBy?: HeroId[];
}

export interface TeamCoachCandidate {
  heroId: HeroId;
  /** Rank inside THIS list (1 = first). The order is V6's score plus the capped context bonus (context-reorder.ts). */
  rank: number;
  /** V6 score of the card (every candidate shown has a ground; there are no score-less alternatives any more). */
  score: number | null;
  reasons: string[];
  /** Revealed enemies that counter this hero (curated, hard first, at most 2). Empty when none: never invented. */
  risks: TeamCoachRisk[];
  /** Heroes this candidate beats (curated, hard first, at most 3), so a card says WHY to pick it and not only where it plays. */
  strengths: TeamCoachStrength[];
  /** What the visible bans opened for this hero (its banned counters) and the risk that stays (counters still free). */
  opening: BanOpening;
  /** Curated partners among the heroes the Player's team ALREADY picked (never a hypothetical ally). */
  synergies: TeamCoachSynergy[];
  /** Own picks this FREE hero takes a counter away from if the Player picks it (the "robo"; hard first, at most 2). Empty = not a steal. */
  steals: TeamCoachSteal[];
  /** The hero the team plan assigns to this position. At most one per position, never shared between positions. */
  isPrimary: boolean;
  /** FUERZA de la evidencia (ver `RankedCandidateCard.evidenceStrength`): solo un candidato STRONG puede ser primario / héroe recomendado. */
  evidenceStrength: "STRONG" | "WEAK";
  /**
   * P0-03D -- the SAME pool identification V4 gives the card (`RankedCandidateCard.poolMembership`), so the Simulator panel and the Live board say the
   * same thing: `OUTSIDE_POOL` (a pool is configured for this position and the hero is not in it) is what the UI shows as OFF-POOL; `NO_POOL` shows nothing.
   * INFORMATIVE only: never a reason, never part of the score or the order.
   */
  poolMembership: PoolMembership;
}

export interface TeamCoachPosition {
  position: Position;
  /** A human may pick for this position right now (HumanActionability). */
  eligibleNow: boolean;
  alreadyFilled: boolean;
  filledHeroId: HeroId | null;
  state: TeamCoachPositionState;
  primaryHeroId: HeroId | null;
  /** Primary first, then the rest of the position's own ranking in rank order. */
  top: TeamCoachCandidate[];
  /** The best heroes of the configured pool for this position (may repeat heroes of `top`); empty when no pool voted. */
  poolTop: TeamCoachCandidate[];
  /** Identity of the snapshot this column was ranked against (always the board's stateIdentity). */
  stateIdentity: string;
  note: string | null;
}

/**
 * V4's basis, plus the live-only PHASE_FALLBACK: a position chosen by draft-phase commitment order because no
 * tactical evidence distinguishes the open positions (never presented as STRATEGIC).
 */
export type TeamTargetBasis = TargetBasis | "PHASE_FALLBACK";

export interface TeamCoachDecision {
  /** LivePositionPriorityV1 with >= 2 open positions or a live capture; selectDecisionTarget with one. Never a FILLED position. */
  recommendedPosition: Position | null;
  recommendedHeroId: HeroId | null;
  targetBasis: TeamTargetBasis | null;
  reason: string;
  /** Every position a human may legally pick for now -- never narrowed by the recommendation. */
  actionablePositions: Position[];
  roundCapacity: number;
}

export interface TeamCoachBoard {
  schema: typeof TEAM_COACH_BOARD_SCHEMA;
  sessionId: string;
  stateIdentity: string;
  currentDecision: TeamCoachDecision;
  positions: TeamCoachPosition[];
  /** Own visible heroes with no position binding (e.g. a live pick whose role the game did not report). */
  unboundOwnHeroIds: HeroId[];
  /** La card dorada: UN héroe fuera de tu pool que encaja de verdad con este draft (ver golden-card.ts). null = ninguno cumple el estándar. */
  goldenCard: GoldenCard | null;
  /**
   * ADVERTIR: counters FUERTES con porqué que siguen libres contra tus picks ya elegidos (free-threats.ts). Solo informa: no entra al puntaje, al
   * ranking, a las cinco tarjetas ni a "ELIGE AHORA". Vacío = ninguna amenaza fuerte libre.
   */
  freeThreats: FreeThreat[];
}

export interface BuildTeamCoachBoardInput {
  context: PerspectiveRecommendationContext;
  playerPersonalPosition: Position | null;
  heroPositions: HeroPositions;
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  /** Curated pairs (production: the real file; tests: their own map or none). */
  heroSynergies?: ReadonlyMap<HeroId, readonly CuratedSynergy[]>;
  /** Capacidades curadas: sin ellas la composición nunca es un fundamento (recommendation-eligibility.ts). */
  heroCapabilities?: readonly HeroCapabilities[];
  /** The V4 target ranking for one position (team-level, never an account's pool). */
  buildTargetRanking(context: PerspectiveRecommendationContext, position: Position): Promise<RecommendationSetV2>;
  topSize?: number;
  /** ADVERTIR: relaciones habilitadas para avisar (advertir-approved.ts). Ausente = ninguna: la sección queda vacía, nunca se inventa un aviso. */
  advertirApproved?: ReadonlySet<string>;
}

const UNASSIGNED_COST = 1_000;
const NO_ADVERTIR_APPROVED: ReadonlySet<string> = new Set();

/**
 * Deterministic primary plan over each position's ranked candidates: an injective assignment
 * (no hero is the primary of two positions) minimising the sum of ranks. Ties break toward the
 * lexicographically smallest rank vector in ascending position order, so the same input always
 * yields the same plan. A position is left without a primary only when no distinct hero remains.
 */
export function assignTeamPrimaries(columns: readonly { position: Position; heroIds: readonly HeroId[] }[]): Map<Position, HeroId | null> {
  const ordered = [...columns].sort((a, b) => a.position - b.position);
  let best: { cost: number; picks: (number | null)[] } | null = null;
  const current: (number | null)[] = [];
  const used = new Set<HeroId>();

  function search(index: number, cost: number): void {
    if (best !== null && cost >= best.cost) return;
    if (index === ordered.length) {
      best = { cost, picks: [...current] };
      return;
    }
    const column = ordered[index]!;
    column.heroIds.forEach((heroId, rankIndex) => {
      if (used.has(heroId)) return;
      used.add(heroId);
      current.push(rankIndex);
      search(index + 1, cost + rankIndex);
      current.pop();
      used.delete(heroId);
    });
    current.push(null);
    search(index + 1, cost + UNASSIGNED_COST);
    current.pop();
  }
  search(0, 0);

  const plan = new Map<Position, HeroId | null>();
  const picks = (best as { cost: number; picks: (number | null)[] } | null)?.picks ?? [];
  ordered.forEach((column, index) => {
    const rankIndex = picks[index];
    plan.set(column.position, rankIndex === null || rankIndex === undefined ? null : column.heroIds[rankIndex] ?? null);
  });
  return plan;
}

function withPrimaryFirst(candidates: TeamCoachCandidate[], primary: HeroId | null): TeamCoachCandidate[] {
  const marked = candidates.map((candidate) => ({ ...candidate, isPrimary: candidate.heroId === primary }));
  return [...marked.filter((candidate) => candidate.isPrimary), ...marked.filter((candidate) => !candidate.isPrimary)];
}

interface ColumnDraft {
  position: Position;
  state: TeamCoachPositionState;
  candidates: TeamCoachCandidate[];
  poolCandidates: TeamCoachCandidate[];
  filledHeroId: HeroId | null;
  note: string | null;
}

/**
 * Live: ¿lo que TODAVÍA le falta a la composición no tiene ningún candidato con evidencia fuerte? Sólo entonces se calla ELIGE AHORA. Una columna
 * que falló al calcularse (UNAVAILABLE) no es "sin candidato": ahí no se calla y manda el orden de siempre. Sin dato de composición, nunca.
 */
export function nothingStrongForWhatIsMissing(
  need: CompositionNeed | null,
  actionable: readonly Position[],
  targetField: readonly Position[],
  stateOf: (position: Position) => TeamCoachPositionState | undefined,
): boolean {
  if (need === null) return false;
  const missing = uncoveredPositions(actionable, need);
  if (missing.length === 0 || !missing.every((position) => stateOf(position) === "RANKED")) return false;
  return uncoveredPositions(targetField, need).length === 0;
}

/** LivePositionPriorityV1 decides the target when a human has >= 2 open positions to choose from, or on a live capture. */
export function usesPositionPriority(liveCapture: boolean | undefined, openPositions: number): boolean {
  return openPositions > 0 && (liveCapture === true || openPositions >= 2);
}

/**
 * Null when the session has no human-controlled positions or no HumanActionability (a session the
 * Team Coach cannot describe honestly). Never throws for a ranking failure: that column degrades.
 */
export async function buildTeamCoachBoard(input: BuildTeamCoachBoardInput): Promise<TeamCoachBoard | null> {
  return (await computeTeamCoach(input))?.board ?? null;
}

/**
 * The position priority the board's own currentDecision uses, or null when none applies (one open position, no human
 * action, no controlled positions). V4 takes its target from here so the two surfaces do not diverge -- except in one Live-only case: when
 * nothing strong exists for what is still missing the board is silent (priority null) and a V4 request (`?format=v4`, consumed only by the
 * simulator) falls back to `selectDecisionTarget`.
 */
export async function buildTeamPositionPriority(input: BuildTeamCoachBoardInput): Promise<LivePositionPriority | null> {
  return (await computeTeamCoach(input))?.priority ?? null;
}

/**
 * The ONE target policy (P0-03): which position to look at first, resolved by the SAME rule the board's `currentDecision` uses
 * (`resolveTeamTarget`: LivePositionPriorityV1 when it applies, else the default over the positions that have STRONG evidence).
 * V4 (`?format=v4`, the Simulator) takes its target from here, so a position without STRONG evidence can never displace one that has it.
 * THREE outcomes, never conflated (P0-03C):
 *   undefined -> the board could NOT be computed (no controlled positions / no actionability): the caller falls back to its own default;
 *   null      -> the board WAS computed and decided to stay silent (no STRONG hero, or live composition says nothing strong exists for what is
 *                missing): the caller must not recommend anybody, and must not derive a recommendation from its own cards;
 *   target    -> the board recommends; `primaryHeroId` is the hero it names.
 */
export async function buildTeamDecisionTarget(input: BuildTeamCoachBoardInput): Promise<DecisionTarget | null | undefined> {
  const computed = await computeTeamCoach(input);
  if (computed === null) return undefined;
  const resolved = computed.target;
  if (resolved === null) return null;
  // V4's wire has no PHASE_FALLBACK: the habitual commitment order is "no clear strategic priority", so it travels as DETERMINISTIC_DEFAULT.
  return { targetPosition: resolved.targetPosition, targetBasis: resolved.targetBasis === "STRATEGIC" ? "STRATEGIC" : "DETERMINISTIC_DEFAULT", targetRationale: resolved.targetRationale, primaryHeroId: computed.board.currentDecision.recommendedHeroId };
}

/** Shared by the board's decision and V4: priority when it applies, else the stable default, ONLY over positions with an eligible STRONG hero. */
function resolveTeamTarget(targetField: readonly Position[], personal: Position | null, priority: LivePositionPriority | null): { targetPosition: Position; targetBasis: TeamTargetBasis; targetRationale: string } | null {
  if (targetField.length === 0) return null;
  return priority ?? selectDecisionTarget({ eligiblePositions: targetField, playerPersonalPosition: personal });
}

async function computeTeamCoach(input: BuildTeamCoachBoardInput): Promise<{ board: TeamCoachBoard; priority: LivePositionPriority | null; target: ReturnType<typeof resolveTeamTarget> } | null> {
  const { context, heroPositions } = input;
  const { view } = context;
  const actionability = context.humanActionability;
  const controlled = context.controlledPositions;
  if (!actionability || !controlled || controlled.length === 0) return null;
  const topSize = input.topSize ?? TEAM_COACH_TOP_SIZE;
  const stateIdentity = stateIdentityOf(view);

  const heroByPosition = new Map<Position, HeroId>();
  for (const [heroId, position] of context.ownAssignedPositions ?? []) heroByPosition.set(position, heroId);
  const boundHeroes = new Set(heroByPosition.values());
  // Live: positions our picks fill whichever hero is which (two flex heroes covering Pos 3 / Pos 4) are filled too.
  const occupiedUnbound = new Set((context.ownPositionOccupancy?.necessarilyOccupied ?? []).filter((position) => !heroByPosition.has(position)));
  const unboundOwnHeroIds = view.ownPicks.flatMap((slot) => (slot.visibility !== "HIDDEN" && !boundHeroes.has(slot.heroId) ? [slot.heroId] : []));

  const positions = [...new Set(controlled)].sort((a, b) => a - b);
  const revealedEnemies = revealedEnemyHeroes(view);
  const revealedSet = new Set<HeroId>(revealedEnemies);
  const ownPickSet = new Set<HeroId>(view.ownPicks.flatMap((slot) => (slot.visibility !== "HIDDEN" ? [slot.heroId] : [])));
  const bannedSet = new Set<HeroId>(view.bannedHeroes);
  // Todo lo que una tarjeta cuenta del draft visible: riesgos, a quién le gana de lo ya revelado, qué abrieron los bans y
  // con quién ya elegido combina. Nada de esto supone lo que el rival va a sacar.
  // Todo lo que una tarjeta cuenta sale del contrato de elegibilidad (la misma tarjeta que arma la decisión V4): `context` ya trae solo
  // relaciones con porqué verificable, y la frase es la de su fundamento -- si los chips ya lo dicen, la frase se calla.
  const toCandidate = (card: RankedCandidateCard): TeamCoachCandidate => {
    const { opening, strengths, synergies, steals } = card.context;
    return {
      heroId: card.heroId,
      rank: card.rank,
      score: card.score,
      reasons: card.hideRationale ? [] : [card.rationale],
      risks: risksOf(card.heroId, revealedEnemies, reasonedCounters(input.heroCounters), ownPickSet),
      strengths,
      opening,
      synergies,
      steals,
      isPrimary: false,
      evidenceStrength: card.evidenceStrength,
      poolMembership: card.poolMembership,
    };
  };
  // Every ranking is requested against the SAME context object: one snapshot, one stateIdentity.
  const drafts: ColumnDraft[] = await Promise.all(positions.map(async (position): Promise<ColumnDraft> => {
    const filledHeroId = heroByPosition.get(position) ?? null;
    if (filledHeroId !== null) return { position, state: "FILLED", candidates: [], poolCandidates: [], filledHeroId, note: null };
    if (occupiedUnbound.has(position)) {
      return { position, state: "FILLED", candidates: [], poolCandidates: [], filledHeroId: null, note: "Ocupada por uno de tus héroes cuyo rol exacto todavía no se confirmó." };
    }
    if (!actionability.hasHumanAction) {
      return { position, state: "WAITING", candidates: [], poolCandidates: [], filledHeroId: null, note: "Sin acción humana en este momento: se recalcula cuando se abra la próxima ronda." };
    }
    let ranking: RecommendationSetV2;
    try {
      ranking = await input.buildTargetRanking(context, position);
    } catch {
      return { position, state: "UNAVAILABLE", candidates: [], poolCandidates: [], filledHeroId: null, note: `No se pudo calcular el ranking de ${positionPhrase(position)}.` };
    }
    if (ranking.basedOn.stateIdentity !== stateIdentity) {
      return { position, state: "UNAVAILABLE", candidates: [], poolCandidates: [], filledHeroId: null, note: "El ranking no corresponde al estado actual del draft." };
    }
    const result = deriveCandidateResult({ targetPosition: position, targetRanking: ranking, view, heroPositions, heroCounters: input.heroCounters, heroSynergies: input.heroSynergies, heroCapabilities: input.heroCapabilities, personalPoolApplied: position === input.playerPersonalPosition && rankingAppliedPersonalPool(ranking), shortlistSize: topSize, poolShortlistSize: TEAM_COACH_POOL_SIZE, activePool: configuredPoolForPosition(context.playerPoolsByPosition, position) });
    return { position, state: "RANKED", filledHeroId: null, note: null, candidates: result.cards.map(toCandidate), poolCandidates: result.poolCards.map(toCandidate) };
  }));

  // Elegibilidad != fuerza: toda tarjeta mostrada es elegible, pero SOLO los candidatos con evidencia FUERTE entran al plan (héroe primario, posición
  // destacada, "ELIGE AHORA"). Una columna con solo evidencia débil (p. ej. solo meta) muestra sus héroes pero no recomienda a nadie ni se destaca.
  const ranked = drafts
    .map((draft) => ({ position: draft.position, state: draft.state, heroIds: draft.candidates.filter((candidate) => candidate.evidenceStrength === "STRONG").map((candidate) => candidate.heroId) }))
    .filter((draft) => draft.state === "RANKED" && draft.heroIds.length > 0)
    .map((draft) => ({ position: draft.position, heroIds: draft.heroIds }));
  // A FILLED column is never actionable, whatever the actionability said.
  const actionable = (actionability.hasHumanAction ? actionability.eligiblePositions : []).filter((position) => drafts.find((draft) => draft.position === position)?.state !== "FILLED");
  const unavailable = unavailableHeroesFrom(view);
  // El objetivo SOLO puede ser una posición con un héroe elegible: "ELIGE AHORA" nunca cae sobre una columna sin recomendación.
  const targetField = actionable.filter((position) => ranked.some((column) => column.position === position));
  // Live, con picks cuya posición no se afirmó: si lo que TODAVÍA le falta a la composición (mid, carry...) no tiene ningún candidato con evidencia
  // fuerte, no se inventa un ELIGE AHORA ni se vuelve al orden fijo por fase (que mandaría a otro support). Las tarjetas elegibles de cada columna se
  // conservan tal cual; sólo se calla la recomendación de a dónde ir primero.
  const compositionNeed = compositionNeedForContext(context, heroPositions);
  const decisionField = nothingStrongForWhatIsMissing(compositionNeed, actionable, targetField, (position) => drafts.find((draft) => draft.position === position)?.state) ? [] : targetField;
  const priority = usesPositionPriority(context.liveCapture, decisionField.length)
    ? selectLivePositionPriority({
        actionablePositions: decisionField,
        phase: view.rankedAp?.phase ?? null,
        columns: ranked,
        revealedEnemies: revealedEnemyHeroes(view),
        heroCounters: reasonedCounters(input.heroCounters), // una ventana de counter "Lo dicen: …" no es una razón para fijar la posición ni el héroe
        playerPoolsByPosition: context.playerPoolsByPosition,
        unavailable,
        occupancy: context.ownPositionOccupancy,
        compositionNeed,
      })
    : null;
  const plan = planWithPriority(ranked, priority);
  const eligible = new Set(actionable);
  const columns: TeamCoachPosition[] = drafts.map((draft) => {
    const primaryHeroId = plan.get(draft.position) ?? null;
    return {
      position: draft.position,
      eligibleNow: eligible.has(draft.position),
      // A position our picks necessarily occupy is filled even when no single hero is bound to it.
      alreadyFilled: draft.state === "FILLED",
      filledHeroId: draft.filledHeroId,
      state: draft.state,
      primaryHeroId,
      top: withPrimaryFirst(draft.candidates, primaryHeroId),
      poolTop: draft.poolCandidates,
      stateIdentity,
      note: draft.note,
    };
  });

  const openPositions = columns.filter((column) => column.eligibleNow && !column.alreadyFilled).map((column) => column.position);
  const goldenCard = selectGoldenCard({
    view,
    openPositions,
    heroPositions: input.heroPositions,
    heroCounters: reasonedCounters(input.heroCounters),
    heroSynergies: reasonedSynergies(input.heroSynergies),
    poolFor: (position) => configuredPoolForPosition(context.playerPoolsByPosition, position),
  });
  const board: TeamCoachBoard = {
    schema: TEAM_COACH_BOARD_SCHEMA,
    sessionId: view.sessionId,
    stateIdentity,
    currentDecision: deriveTeamDecision(actionability, actionable, decisionField, columns, input.playerPersonalPosition, priority),
    positions: columns,
    unboundOwnHeroIds,
    goldenCard,
    // ADVERTIR: solo lee el draft visible (picks propios, bans, rivales revelados) y las posiciones que a tu equipo todavía le faltan.
    freeThreats: freeThreatsOf({
      banned: bannedSet,
      ownPicks: ownPickSet,
      revealedEnemies: revealedSet,
      heroCounters: input.heroCounters,
      heroPositions: input.heroPositions,
      unfilledPositions: columns.filter((column) => !column.alreadyFilled).map((column) => column.position),
      approved: input.advertirApproved ?? NO_ADVERTIR_APPROVED,
    }),
  };
  const target = actionability.hasHumanAction ? resolveTeamTarget(decisionField, input.playerPersonalPosition, priority) : null;
  return { board, priority, target };
}

const MAX_RISKS_PER_CANDIDATE = 2;
/** How many heroes of the configured pool get their own list per position. */
export const TEAM_COACH_POOL_SIZE = 3;

/**
 * Which REVEALED enemies counter this hero according to the curated data (hard first, then medium). Only heroes the
 * Player can see are read, so a sealed enemy seat can never leak into a card.
 */
export function risksOf(heroId: HeroId, revealedEnemies: readonly HeroId[], heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined, ownPicks: ReadonlySet<HeroId> = new Set()): TeamCoachRisk[] {
  if (!heroCounters || revealedEnemies.length === 0) return [];
  const revealed = new Set(revealedEnemies);
  const entries = (heroCounters.get(heroId) ?? []).filter((entry) => revealed.has(entry.vs));
  const hardFirst = [...entries.filter((entry) => entry.level === "hard"), ...entries.filter((entry) => entry.level !== "hard")];
  return hardFirst.slice(0, MAX_RISKS_PER_CANDIDATE).map((entry) => {
    const risk: TeamCoachRisk = { vsHeroId: entry.vs, why: entry.why.trim().replace(/[.\s]+$/, "") };
    const answeredBy = alliesAnswering(entry.vs, { ownPicks, heroCounters }).map((note) => note.heroId);
    if (answeredBy.length > 0) risk.answeredBy = answeredBy;
    return risk;
  });
}

/**
 * The team plan. When the live priority chose a position BECAUSE of one hero (its counter, its last pool hero), that
 * hero is that position's primary -- so the recommended hero is the one the reason talks about -- and the other
 * positions are planned around it.
 */
function planWithPriority(columns: readonly { position: Position; heroIds: readonly HeroId[] }[], priority: LivePositionPriority | null): Map<Position, HeroId | null> {
  const pinned = priority?.signalHeroId ?? null;
  const target = priority?.targetPosition;
  if (pinned === null || target === undefined || !columns.some((column) => column.position === target && column.heroIds.includes(pinned))) return assignTeamPrimaries(columns);
  const plan = assignTeamPrimaries(columns.filter((column) => column.position !== target).map((column) => ({ position: column.position, heroIds: column.heroIds.filter((heroId) => heroId !== pinned) })));
  plan.set(target, pinned);
  return plan;
}

function deriveTeamDecision(
  actionability: NonNullable<PerspectiveRecommendationContext["humanActionability"]>,
  actionable: readonly Position[],
  targetField: readonly Position[],
  columns: readonly TeamCoachPosition[],
  personal: Position | null,
  priority: LivePositionPriority | null,
): TeamCoachDecision {
  if (!actionability.hasHumanAction || actionable.length === 0) {
    return {
      recommendedPosition: null,
      recommendedHeroId: null,
      targetBasis: null,
      reason: actionability.noActionReason === "DRAFT_COMPLETE" ? "El draft terminó." : "No hay un pick humano abierto en este momento.",
      actionablePositions: [],
      roundCapacity: 0,
    };
  }
  // Sin ninguna columna con un héroe elegible no hay recomendación: ni posición destacada, ni héroe, ni texto que explique la falta.
  if (targetField.length === 0) {
    return { recommendedPosition: null, recommendedHeroId: null, targetBasis: null, reason: "", actionablePositions: [...actionable], roundCapacity: actionability.roundCapacity };
  }
  // >= 2 open positions (or live): LivePositionPriorityV1. One open position: the target function V4 uses on its own.
  // El objetivo SOLO se elige entre las columnas con héroe elegible (`targetField`): no son "posiciones con el pool agotado", son columnas sin nada que mostrar.
  const target = resolveTeamTarget(targetField, personal, priority)!; // targetField is non-empty here (early return above)
  const column = columns.find((candidate) => candidate.position === target.targetPosition);
  const primary = column?.top.find((candidate) => candidate.isPrimary) ?? null;
  const heroReason = primary?.reasons[0] ?? "";
  // Solo una razón ESTRATÉGICA real (ventana de counter, último héroe del pool) se dice; "no hay prioridad / orden por fase" no es un motivo y
  // no se muestra (dueño del producto, 2026-11-04: nada de mensajes que expliquen falta de información).
  const targetReason = target.targetBasis === "STRATEGIC" ? target.targetRationale : "";
  return {
    recommendedPosition: target.targetPosition,
    recommendedHeroId: primary?.heroId ?? null,
    targetBasis: target.targetBasis,
    reason: [targetReason, heroReason].filter((part) => part.length > 0).join(" "),
    actionablePositions: [...actionable],
    roundCapacity: actionability.roundCapacity,
  };
}
