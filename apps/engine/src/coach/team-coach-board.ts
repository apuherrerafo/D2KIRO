import type { HeroId } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import { stateIdentityOf } from "../recommendation/identity";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCandidateResult, selectDecisionTarget } from "./current-human-decision";
import type { TargetBasis } from "./recommendation-output-v4";
import { positionPhrase } from "./reveal-strategy";

// Team Coach Board -- ONE projection of every human-controlled position from ONE perspective-safe
// snapshot of the canonical protocol session.
//
//   PerspectiveRecommendationContext (one snapshot)
//     -> per open controlled position: the SAME target ranking V4 uses (buildTargetRanking)
//     -> deriveCandidateResult (the SAME candidate provenance as V4)
//     -> a deterministic primary plan (no two positions share their #1 when an alternative exists)
//     -> currentDecision: the SAME target V4 recommends (selectDecisionTarget) + that position's primary
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

export interface TeamCoachCandidate {
  heroId: HeroId;
  /** Rank inside THIS position's own ranking (1 = V6's best for this position). */
  rank: number;
  /** V6 score; `null` for an unranked positional alternative (no score exists). */
  score: number | null;
  reasons: string[];
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
  /** Identity of the snapshot this column was ranked against (always the board's stateIdentity). */
  stateIdentity: string;
  note: string | null;
}

export interface TeamCoachDecision {
  /** The V4 target (selectDecisionTarget) -- exactly the canonical currentDecision's recommendation. */
  recommendedPosition: Position | null;
  recommendedHeroId: HeroId | null;
  targetBasis: TargetBasis | null;
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
  filledHeroId: HeroId | null;
  note: string | null;
}

/**
 * Null when the session has no human-controlled positions or no HumanActionability (a session the
 * Team Coach cannot describe honestly). Never throws for a ranking failure: that column degrades.
 */
export async function buildTeamCoachBoard(input: BuildTeamCoachBoardInput): Promise<TeamCoachBoard | null> {
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
  const unboundOwnHeroIds = view.ownPicks.flatMap((slot) => (slot.visibility !== "HIDDEN" && !boundHeroes.has(slot.heroId) ? [slot.heroId] : []));

  const positions = [...new Set(controlled)].sort((a, b) => a - b);
  // Every ranking is requested against the SAME context object: one snapshot, one stateIdentity.
  const drafts: ColumnDraft[] = await Promise.all(positions.map(async (position): Promise<ColumnDraft> => {
    const filledHeroId = heroByPosition.get(position) ?? null;
    if (filledHeroId !== null) return { position, state: "FILLED", candidates: [], filledHeroId, note: null };
    if (!actionability.hasHumanAction) {
      return { position, state: "WAITING", candidates: [], filledHeroId: null, note: "Sin acción humana en este momento: se recalcula cuando se abra la próxima ronda." };
    }
    let ranking: RecommendationSetV2;
    try {
      ranking = await input.buildTargetRanking(context, position);
    } catch {
      return { position, state: "UNAVAILABLE", candidates: [], filledHeroId: null, note: `No se pudo calcular el ranking de ${positionPhrase(position)}.` };
    }
    if (ranking.basedOn.stateIdentity !== stateIdentity) {
      return { position, state: "UNAVAILABLE", candidates: [], filledHeroId: null, note: "El ranking no corresponde al estado actual del draft." };
    }
    const result = deriveCandidateResult({ targetPosition: position, targetRanking: ranking, view, heroPositions, heroCounters: input.heroCounters, personalPoolApplied: false, shortlistSize: topSize });
    if (result.state === "RANKED") {
      return {
        position,
        state: "RANKED",
        filledHeroId: null,
        note: null,
        candidates: result.cards.map((card) => ({ heroId: card.heroId, rank: card.rank, score: card.score, reasons: [card.rationale], isPrimary: false })),
      };
    }
    if (result.state === "UNRANKED_POSITIONAL") {
      return {
        position,
        state: "UNRANKED_POSITIONAL",
        filledHeroId: null,
        note: result.reason,
        candidates: result.alternatives.map((alternative, index) => ({ heroId: alternative.heroId, rank: index + 1, score: null, reasons: [result.reason], isPrimary: false })),
      };
    }
    return { position, state: "UNAVAILABLE", candidates: [], filledHeroId: null, note: result.reason };
  }));

  const plan = assignTeamPrimaries(drafts.filter((draft) => draft.candidates.length > 0).map((draft) => ({ position: draft.position, heroIds: draft.candidates.map((candidate) => candidate.heroId) })));
  const eligible = new Set(actionability.hasHumanAction ? actionability.eligiblePositions : []);
  const columns: TeamCoachPosition[] = drafts.map((draft) => {
    const primaryHeroId = plan.get(draft.position) ?? null;
    return {
      position: draft.position,
      eligibleNow: eligible.has(draft.position),
      alreadyFilled: draft.filledHeroId !== null,
      filledHeroId: draft.filledHeroId,
      state: draft.state,
      primaryHeroId,
      top: withPrimaryFirst(draft.candidates, primaryHeroId),
      stateIdentity,
      note: draft.note,
    };
  });

  return {
    schema: TEAM_COACH_BOARD_SCHEMA,
    sessionId: view.sessionId,
    stateIdentity,
    currentDecision: deriveTeamDecision(actionability, columns, input.playerPersonalPosition),
    positions: columns,
    unboundOwnHeroIds,
  };
}

function deriveTeamDecision(actionability: NonNullable<PerspectiveRecommendationContext["humanActionability"]>, columns: readonly TeamCoachPosition[], personal: Position | null): TeamCoachDecision {
  if (!actionability.hasHumanAction) {
    return {
      recommendedPosition: null,
      recommendedHeroId: null,
      targetBasis: null,
      reason: actionability.noActionReason === "DRAFT_COMPLETE" ? "El draft terminó." : "No hay un pick humano abierto en este momento.",
      actionablePositions: [],
      roundCapacity: 0,
    };
  }
  // The SAME target function V4's CurrentHumanDecision uses: one canonical recommendation, not a second one.
  const target = selectDecisionTarget({ eligiblePositions: actionability.eligiblePositions, playerPersonalPosition: personal });
  const column = columns.find((candidate) => candidate.position === target.targetPosition);
  const primary = column?.top.find((candidate) => candidate.isPrimary) ?? null;
  const heroReason = primary?.reasons[0] ?? column?.note ?? "";
  return {
    recommendedPosition: target.targetPosition,
    recommendedHeroId: primary?.heroId ?? null,
    targetBasis: target.targetBasis,
    reason: [target.targetRationale, heroReason].filter((part) => part.length > 0).join(" "),
    actionablePositions: [...actionability.eligiblePositions],
    roundCapacity: actionability.roundCapacity,
  };
}
