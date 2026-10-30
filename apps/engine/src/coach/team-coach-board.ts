import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { stateIdentityOf } from "../recommendation/identity";
import { configuredPoolForPosition, unavailableHeroesFrom, type PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCandidateResult, rankingAppliedPersonalPool, selectDecisionTarget } from "./current-human-decision";
import { banOpeningOf, synergiesWithOwn, type BanOpening } from "./context-reorder";
import { revealedEnemyHeroes } from "./hero-card";
import { selectLivePositionPriority, type LivePositionPriority } from "./live-position-priority";
import type { TargetBasis } from "./recommendation-output-v4";
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

export const TEAM_COACH_BOARD_SCHEMA = "team-coach-board/v1" as const;
/** Cards per position (the product floor is 3). */
export const TEAM_COACH_TOP_SIZE = 5;

export type TeamCoachPositionState = "RANKED" | "UNRANKED_POSITIONAL" | "UNAVAILABLE" | "FILLED" | "WAITING";

/** A revealed enemy hero that curated-counters this candidate, with the curated reason (`why`). */
export interface TeamCoachRisk {
  vsHeroId: HeroId;
  why: string;
}

/** A hero this candidate beats according to the curated data, with the curated reason (`why`). Never invented. */
export interface TeamCoachStrength {
  vsHeroId: HeroId;
  level: "hard" | "medium";
  why: string;
  /** True only when that enemy is already visible to the Player; otherwise it is a "what if they pick it" note. */
  revealed: boolean;
}

/** A partner already on the Player's team and the curated reason the pair works. */
export interface TeamCoachSynergy {
  withHeroId: HeroId;
  why: string;
}

export interface TeamCoachCandidate {
  heroId: HeroId;
  /** Rank inside THIS list (1 = first). The order is V6's score plus the capped context bonus (context-reorder.ts). */
  rank: number;
  /** V6 score; `null` for an unranked positional alternative (no score exists). */
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
  /** The hero the team plan assigns to this position. At most one per position, never shared between positions. */
  isPrimary: boolean;
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
}

export interface BuildTeamCoachBoardInput {
  context: PerspectiveRecommendationContext;
  playerPersonalPosition: Position | null;
  heroPositions: HeroPositions;
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  /** Curated pairs (production: the real file; tests: their own map or none). */
  heroSynergies?: ReadonlyMap<HeroId, readonly CuratedSynergy[]>;
  /** The V4 target ranking for one position (team-level, never an account's pool). */
  buildTargetRanking(context: PerspectiveRecommendationContext, position: Position): Promise<RecommendationSetV2>;
  topSize?: number;
}

const UNASSIGNED_COST = 1_000;

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
 * action, no controlled positions). V4 takes its target from here so the two surfaces cannot diverge.
 */
export async function buildTeamPositionPriority(input: BuildTeamCoachBoardInput): Promise<LivePositionPriority | null> {
  return (await computeTeamCoach(input))?.priority ?? null;
}

async function computeTeamCoach(input: BuildTeamCoachBoardInput): Promise<{ board: TeamCoachBoard; priority: LivePositionPriority | null } | null> {
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
  const strengthIndex = strengthIndexOf(input.heroCounters);
  const revealedSet = new Set<HeroId>(revealedEnemies);
  const ownPickSet = new Set<HeroId>(view.ownPicks.flatMap((slot) => (slot.visibility !== "HIDDEN" ? [slot.heroId] : [])));
  const bannedSet = new Set<HeroId>(view.bannedHeroes);
  // Todo lo que una tarjeta cuenta del draft visible: riesgos, a quién le gana de lo ya revelado, qué abrieron los bans y
  // con quién ya elegido combina. Nada de esto supone lo que el rival va a sacar.
  const contextOf = (heroId: HeroId): Pick<TeamCoachCandidate, "risks" | "strengths" | "opening" | "synergies"> => ({
    risks: risksOf(heroId, revealedEnemies, input.heroCounters),
    strengths: strengthsOf(heroId, strengthIndex, cannotBeEnemy, revealedSet),
    opening: banOpeningOf(heroId, { banned: bannedSet, ownPicks: ownPickSet, revealedEnemies: revealedSet, phase: view.rankedAp?.phase ?? null, heroCounters: input.heroCounters }),
    synergies: synergiesWithOwn(heroId, { ownPicks: ownPickSet, heroSynergies: input.heroSynergies }).slice(0, MAX_SYNERGIES_PER_CANDIDATE).map((synergy) => ({ withHeroId: synergy.with, why: synergy.why.trim().replace(/[.\s]+$/, "") })),
  });
  const toCandidate = (card: { heroId: HeroId; rank: number; score: number; rationale: string }): TeamCoachCandidate => ({
    heroId: card.heroId,
    rank: card.rank,
    score: card.score,
    reasons: [card.rationale],
    ...contextOf(card.heroId),
    isPrimary: false,
  });
  const cannotBeEnemy = new Set<HeroId>([...view.bannedHeroes, ...view.ownPicks.flatMap((slot) => (slot.visibility !== "HIDDEN" ? [slot.heroId] : []))]);
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
    const result = deriveCandidateResult({ targetPosition: position, targetRanking: ranking, view, heroPositions, heroCounters: input.heroCounters, heroSynergies: input.heroSynergies, personalPoolApplied: position === input.playerPersonalPosition && rankingAppliedPersonalPool(ranking), shortlistSize: topSize, poolShortlistSize: TEAM_COACH_POOL_SIZE, activePool: configuredPoolForPosition(context.playerPoolsByPosition, position) });
    if (result.state === "RANKED") {
      return {
        position,
        state: "RANKED",
        filledHeroId: null,
        note: null,
        candidates: result.cards.map(toCandidate),
        poolCandidates: result.poolCards.map(toCandidate),
      };
    }
    if (result.state === "UNRANKED_POSITIONAL") {
      return {
        position,
        state: "UNRANKED_POSITIONAL",
        filledHeroId: null,
        note: result.reason,
        candidates: result.alternatives.map((alternative, index) => ({ heroId: alternative.heroId, rank: index + 1, score: null, reasons: [result.reason], ...contextOf(alternative.heroId), isPrimary: false })),
        poolCandidates: [],
      };
    }
    return { position, state: "UNAVAILABLE", candidates: [], poolCandidates: [], filledHeroId: null, note: result.reason };
  }));

  const ranked = drafts.filter((draft) => draft.candidates.length > 0).map((draft) => ({ position: draft.position, heroIds: draft.candidates.map((candidate) => candidate.heroId) }));
  // A FILLED column is never actionable, whatever the actionability said.
  const actionable = (actionability.hasHumanAction ? actionability.eligiblePositions : []).filter((position) => drafts.find((draft) => draft.position === position)?.state !== "FILLED");
  // Hero Pools V2: a pool is a preference, so an exhausted pool never narrows the target field.
  const unavailable = unavailableHeroesFrom(view);
  const targetField = actionable;
  const priority = usesPositionPriority(context.liveCapture, actionable.length)
    ? selectLivePositionPriority({
        actionablePositions: targetField,
        phase: view.rankedAp?.phase ?? null,
        columns: ranked,
        revealedEnemies: revealedEnemyHeroes(view),
        heroCounters: input.heroCounters,
        playerPoolsByPosition: context.playerPoolsByPosition,
        unavailable,
        occupancy: context.ownPositionOccupancy,
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

  const board: TeamCoachBoard = {
    schema: TEAM_COACH_BOARD_SCHEMA,
    sessionId: view.sessionId,
    stateIdentity,
    currentDecision: deriveTeamDecision(actionability, actionable, targetField, columns, input.playerPersonalPosition, priority),
    positions: columns,
    unboundOwnHeroIds,
  };
  return { board, priority };
}

const MAX_RISKS_PER_CANDIDATE = 2;
const MAX_STRENGTHS_PER_CANDIDATE = 3;
const MAX_SYNERGIES_PER_CANDIDATE = 2;
/** How many heroes of the configured pool get their own list per position. */
export const TEAM_COACH_POOL_SIZE = 3;

/** counterer -> the heroes it beats, built once per board from the curated counters (victim -> who counters it). */
export function strengthIndexOf(heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined): Map<HeroId, TeamCoachStrength[]> {
  const index = new Map<HeroId, TeamCoachStrength[]>();
  if (!heroCounters) return index;
  for (const [victim, entries] of heroCounters) {
    for (const entry of entries) {
      const list = index.get(entry.vs) ?? [];
      list.push({ vsHeroId: victim, level: entry.level, why: entry.why.trim().replace(/[.\s]+$/, ""), revealed: false });
      index.set(entry.vs, list);
    }
  }
  return index;
}

/**
 * Whom this hero beats among the enemies the Player can ALREADY see (hard before medium, stable by hero id). An enemy
 * that is not revealed is never offered: saying who it beats before anyone picked it is a guess (user, 2026-10-29).
 */
export function strengthsOf(heroId: HeroId, index: ReadonlyMap<HeroId, readonly TeamCoachStrength[]>, excluded: ReadonlySet<HeroId>, revealedEnemies: ReadonlySet<HeroId> = new Set()): TeamCoachStrength[] {
  // Solo lo que el rival YA tiene: contar contra quién gana sobre algo que nadie ha sacado es suponer (decisión del usuario).
  const usable = (index.get(heroId) ?? []).filter((entry) => !excluded.has(entry.vsHeroId) && revealedEnemies.has(entry.vsHeroId)).map((entry) => ({ ...entry, revealed: true }));
  const rank = (entry: TeamCoachStrength): number => (entry.level === "hard" ? 0 : 1);
  return usable.sort((a, b) => rank(a) - rank(b)).slice(0, MAX_STRENGTHS_PER_CANDIDATE);
}

/**
 * Which REVEALED enemies counter this hero according to the curated data (hard first, then medium). Only heroes the
 * Player can see are read, so a sealed enemy seat can never leak into a card.
 */
export function risksOf(heroId: HeroId, revealedEnemies: readonly HeroId[], heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]> | undefined): TeamCoachRisk[] {
  if (!heroCounters || revealedEnemies.length === 0) return [];
  const revealed = new Set(revealedEnemies);
  const entries = (heroCounters.get(heroId) ?? []).filter((entry) => revealed.has(entry.vs));
  const hardFirst = [...entries.filter((entry) => entry.level === "hard"), ...entries.filter((entry) => entry.level !== "hard")];
  return hardFirst.slice(0, MAX_RISKS_PER_CANDIDATE).map((entry) => ({ vsHeroId: entry.vs, why: entry.why.trim().replace(/[.\s]+$/, "") }));
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
  // >= 2 open positions (or live): LivePositionPriorityV1. One open position: the target function V4 uses on its own.
  const target = priority ?? selectDecisionTarget({ eligiblePositions: actionable, playerPersonalPosition: personal, viablePositions: targetField });
  const column = columns.find((candidate) => candidate.position === target.targetPosition);
  const primary = column?.top.find((candidate) => candidate.isPrimary) ?? null;
  const heroReason = primary?.reasons[0] ?? column?.note ?? "";
  return {
    recommendedPosition: target.targetPosition,
    recommendedHeroId: primary?.heroId ?? null,
    targetBasis: target.targetBasis,
    reason: [target.targetRationale, heroReason].filter((part) => part.length > 0).join(" "),
    actionablePositions: [...actionable],
    roundCapacity: actionability.roundCapacity,
  };
}
