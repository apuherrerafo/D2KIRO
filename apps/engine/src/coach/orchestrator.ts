import { deriveDecisionContextFromView } from "../drafter/decision-context";
import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import type { RecommendationSetV2 } from "../recommendation/types";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedCounter } from "../signals/hero-counters";
import { buildCoachObservableState, type CoachObservableState } from "./observable-state";
import { credibleHeroesForPosition } from "./hero-card";
import { isCompatiblePosition } from "./observable-state";
import { buildPersonalPositionRecommendation, type PersonalHeroView } from "./personal-hero-view";
import { translateToRecommendationOutputV3, type CoachOutputConfig, type CoachTrigger, type RecommendationOutputV3 } from "./recommendation-output-v3";
import { deriveRevealStrategy } from "./reveal-strategy";
import { buildCurrentHumanDecision, deriveCandidateResult, selectDecisionTarget } from "./current-human-decision";
import { buildRecommendationOutputV4, type RecommendationOutputV4 } from "./recommendation-output-v4";

// AP Ranked Roles V1 / Wave 2 (task 19) -- Coach orchestration: one continuous pipeline
//
//   PerspectiveDraftView -> CoachObservableState -> RecommendationSetV2 (V6, Level 2)
//     -> RevealStrategy (Level 1) -> RecommendationOutputV3
//
// recomputed at EVERY legal observable-state change, never suspended:
//   1. the start of the pick phase (an actionable answer exists before the Player's first pick),
//   2. immediately after each of our own seats is sealed -- Round 1's second seat is advised
//      BEFORE the enemy reveal, because the Player's own pick is already legal knowledge,
//   3. after every enemy round reveal,
//   4. when the Player assigns a position to a visible hero,
//   5. any other observable change (a collision ban reopening a seat).
//
// INFORMATION BOUNDARY: this module receives a `PerspectiveRecommendationContext` (a
// PerspectiveDraftView + the open seats the client is already told about + the Player's party
// structure + the patch) and an injected `buildRecommendationSet(context)`. Both the context and the
// builder are perspective-only types: a value carrying authoritative protocol state, a hidden enemy
// selection, the simulator ledger or Enemy Bot data cannot be expressed in them. The Coach never
// holds, reads or forwards the kernel, the Simulator or the Enemy Bot.
//
// The Player is never constrained: a pick the Coach did not suggest is just another accepted state
// change -- there is no "wrong pick" notion here, only a fresh recomputation.
//
// Delivery is pull-based (HTTP): each request recomputes from the current view, so no trigger can be
// dropped or suppressed by a busy computation. Concurrent requests each run to completion; every
// result carries a revision assigned when it STARTED, so a client can discard an out-of-order one.

/** Bound on remembered sessions (oldest evicted): the store evicts stale sessions on its own clock. */
const MAX_TRACKED_SESSIONS = 256;

export interface CoachOrchestratorDeps {
  /** Builds the V2 set from EXACTLY this perspective-safe context (buildRecommendationSetFromPerspective). */
  buildRecommendationSet(context: PerspectiveRecommendationContext): Promise<RecommendationSetV2>;
  /**
   * Team-level (no account overlay) V6 evaluation over a PRE-ranking candidate universe. Used only to fill the shortlist of a
   * REVEAL_POSITION action with heroes that can execute it (Dota-Judge RB-2). Omitted -> the shortlist is drawn from the team set alone.
   */
  buildActionRecommendationSet?(context: PerspectiveRecommendationContext, candidateHeroIds: readonly HeroId[], targetPosition: Position): Promise<RecommendationSetV2>;
  /** Independent personal evaluation, scoped by declared role (Wave 3). */
  buildPersonalRecommendation?(context: PerspectiveRecommendationContext, position: Position): Promise<RecommendationSetV2>;
  /**
   * Product Semantics Recovery WP2 -- the team-level, position-agnostic, no-personal-pool evaluation
   * the V4 target is selected from (one single-slot V6 run over every eligible position).
   */
  buildTeamEvaluation?(context: PerspectiveRecommendationContext): Promise<RecommendationSetV2>;
  /**
   * WP2 -- the ONE target-specific ranking of a V4 decision: pre-ranking universe = heroes credible at
   * `targetPosition`. `usePersonalPool` is true only when the target is the Player's personal position.
   */
  buildTargetRanking?(context: PerspectiveRecommendationContext, targetPosition: Position, usePersonalPool: boolean): Promise<RecommendationSetV2>;
  heroPositions?: HeroPositions;
  /** Wave 4A: curated counter relationships for the Safe Core opportunity. Omitted -> no opportunity is ever produced. */
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
}

export interface CoachRecomputeInput {
  context: PerspectiveRecommendationContext;
  /** Declared personal position (Wave 3 consumes it; Wave 2 only threads it through, timing-neutral). */
  playerPersonalPosition?: Position | null;
  config?: Omit<CoachOutputConfig, "revision" | "trigger" | "playerPersonalPosition">;
}

export interface CurrentDecisionRecomputeInput extends CoachRecomputeInput {
  /** The authenticated account's pool overlay exists for this request (personal pool CAN apply). */
  personalPoolAvailable?: boolean;
}

export interface CurrentDecisionRecomputation {
  output: RecommendationOutputV4;
  /** The ranking the candidates came from (the target ranking, or the empty team evaluation). */
  sourceSet: RecommendationSetV2;
  trigger: CoachTrigger;
  revision: number;
}

export interface CoachRecomputation {
  /** Null when there is nothing to decide for this side right now (no open seat: complete, or not our turn). */
  output: RecommendationOutputV3 | null;
  /** The V2 set the output was built on -- unchanged, for every V2 consumer. */
  recommendationSet: RecommendationSetV2;
  /** Separate personal-position set; never derived from the team set. */
  personalRecommendationSet?: RecommendationSetV2;
  /** Engine-internal (not serialized by the route): what the Coach believed while computing. */
  coachState: CoachObservableState;
  trigger: CoachTrigger;
  revision: number;
}

interface SessionMemory {
  lastSeq: number;
  latestRevision: number;
  observed: { ownVisible: number; revealedEnemy: number; bans: number; assignments: string } | null;
  assignments: Map<HeroId, Position>;
}

function countVisible(view: PerspectiveDraftView) {
  return {
    ownVisible: view.ownPicks.filter((slot) => slot.visibility !== "HIDDEN").length,
    revealedEnemy: view.enemyPicks.filter((slot) => slot.visibility === "REVEALED").length,
    bans: view.bannedHeroes.length,
  };
}

function assignmentsKey(assignments: ReadonlyMap<HeroId, Position>): string {
  return [...assignments].sort(([a], [b]) => a - b).map(([hero, position]) => `${hero}:${position}`).join(",");
}

function isOwnVisibleHero(view: PerspectiveDraftView, heroId: HeroId): boolean {
  return view.ownPicks.some((slot) => slot.visibility !== "HIDDEN" && slot.heroId === heroId);
}

export class CoachOrchestrator {
  private readonly sessions = new Map<string, SessionMemory>();

  constructor(private readonly deps: CoachOrchestratorDeps) {}

  private memory(sessionId: string): SessionMemory {
    let memory = this.sessions.get(sessionId);
    if (!memory) {
      memory = { lastSeq: 0, latestRevision: 0, observed: null, assignments: new Map() };
      this.sessions.set(sessionId, memory);
      if (this.sessions.size > MAX_TRACKED_SESSIONS) this.sessions.delete(this.sessions.keys().next().value!);
    }
    return memory;
  }

  /** What legally changed since the last output for this session (explicit `trigger` wins). */
  private classify(memory: SessionMemory, view: PerspectiveDraftView): CoachTrigger {
    const previous = memory.observed;
    if (previous === null) return "DRAFT_PICKS_STARTED";
    const now = countVisible(view);
    if (now.revealedEnemy > previous.revealedEnemy) return "ROUND_REVEALED";
    if (now.ownVisible !== previous.ownVisible) return "OWN_PICK_CONFIRMED";
    if (assignmentsKey(memory.assignments) !== previous.assignments) return "PLAYER_POSITION_ASSIGNED";
    if (now.bans !== previous.bans) return "STATE_CHANGED";
    return "REFRESH";
  }

  /** Recompute now. The trigger is derived from what changed unless the caller names it. */
  async recompute(input: CoachRecomputeInput, explicitTrigger?: CoachTrigger): Promise<CoachRecomputation> {
    const { view } = input.context;
    const memory = this.memory(view.sessionId);
    const trigger = explicitTrigger ?? this.classify(memory, view);
    const revision = (memory.lastSeq += 1);
    const assignments = new Map(memory.assignments);
    // P0-2 (INV-BIND-001) -- authoritative own-team position bindings (sealed-time session truth,
    // PD-027 point 3) always win over a stale/absent manual assignment for the SAME hero: merged
    // on top, never the other way around. This is what makes believe() treat that hero's position
    // as CONFIRMED (computeRoleBelief's confirmedPosition path) instead of leaving it to
    // RoleBelief's own evidence-based argmax, which is the exact defect INV-BIND-001 exists to
    // catch. Bypasses isCompatiblePosition on purpose: an authoritative binding is session truth
    // the human actually chose, not a correction that needs curated-evidence validation -- an
    // off-role pick still fills the position the human chose (PD-027 point 6).
    for (const [heroId, position] of input.context.ownAssignedPositions ?? []) assignments.set(heroId, position);

    const heroPool = input.config?.heroPool ?? [];
    const coachState = buildCoachObservableState(view, {
      heroPositions: this.deps.heroPositions,
      playerPositionAssignments: assignments,
      personalContext: input.playerPersonalPosition ? { position: input.playerPersonalPosition, heroPool: [...heroPool] } : null,
    });
    const recommendationSet = await this.deps.buildRecommendationSet(input.context);
    const personal = input.playerPersonalPosition && this.deps.buildPersonalRecommendation
      ? await buildPersonalPositionRecommendation(input.context, input.playerPersonalPosition, heroPool, {
          buildRecommendationSet: this.deps.buildPersonalRecommendation,
          heroPositions: this.deps.heroPositions,
          heroCounters: this.deps.heroCounters,
          ownRoleBeliefs: coachState.ownRoleBeliefs,
        })
      : null;
    const decisionContext = deriveDecisionContextFromView(view);
    // No open seat for this side (draft complete, or waiting on the other side): nothing to advise.
    // With an open seat there is ALWAYS an answer -- a role-level one when the evidence is thin.
    const hasDecision = recommendationSet.decision.actionCount > 0;
    const strategy = hasDecision
      ? deriveRevealStrategy(view, recommendationSet, input.playerPersonalPosition ?? null, input.config?.heroPool ?? [], decisionContext, {
          ownRoleBeliefs: coachState.ownRoleBeliefs,
          heroPositions: this.deps.heroPositions,
          heroCounters: this.deps.heroCounters,
          roleCollision: coachState.roleCollision,
          // P0-1 (INV-OWN-001) -- null/absent for a non-AP-Simulator or legacy session (same
          // convention as the context field itself), which keeps the pre-P0-1 unconstrained
          // behaviour exactly as it was. Non-null for an AP Simulator session: every human-facing
          // position claim below must come from this set, never from ALL_POSITIONS.
          humanOpenPositions: input.context.humanOpenPositions,
        })
      : null;
    // "Reveal Pos P": the shortlist's candidate universe is decided BEFORE ranking (heroes credibly played at P), like the personal view.
    const actionRecommendationSet = strategy?.kind === "REVEAL_POSITION" && this.deps.buildActionRecommendationSet && this.deps.heroPositions
      ? await this.deps.buildActionRecommendationSet(input.context, credibleHeroesForPosition(strategy.position, this.deps.heroPositions), strategy.position)
      : undefined;
    const output = strategy
      ? translateToRecommendationOutputV3(recommendationSet, strategy, coachState, decisionContext, {
          ...input.config,
          actionRecommendationSet,
          heroPositions: this.deps.heroPositions,
          heroCounters: this.deps.heroCounters,
          playerPersonalPosition: input.playerPersonalPosition ?? null,
          trigger,
          revision,
        })
      : null;
    if (output && personal) output.personalHeroView = personal.view;

    // Only the newest-started computation may move the session's "latest" bookkeeping forward.
    if (revision > memory.latestRevision) {
      memory.latestRevision = revision;
      // Trigger bookkeeping tracks EXPLICIT UI assignments only (memory.assignments, unmerged) --
      // classify()'s next call compares against the same source. Snapshotting the merged
      // `assignments` (which also carries the authoritative P0-2 bindings, re-derived fresh from
      // session truth every call) here would desync the two and misclassify the trigger as
      // PLAYER_POSITION_ASSIGNED on every subsequent recompute, even with no player action.
      memory.observed = { ...countVisible(view), assignments: assignmentsKey(memory.assignments) };
    }
    return { output, recommendationSet, personalRecommendationSet: personal?.recommendationSet ?? undefined, coachState, trigger, revision };
  }

  /**
   * Product Semantics Recovery WP2 -- the V4 CurrentHumanDecision. Shares this session's revision and
   * trigger bookkeeping (and the Player's own-hero assignments) with the V3 path. Returns null when
   * the context carries no HumanActionability (non-AP-Simulator session) or the deps cannot build it.
   */
  async recomputeCurrentDecision(input: CurrentDecisionRecomputeInput, explicitTrigger?: CoachTrigger): Promise<CurrentDecisionRecomputation | null> {
    const { view } = input.context;
    const actionability = input.context.humanActionability;
    const { buildTeamEvaluation, buildTargetRanking } = this.deps;
    const heroPositions = this.deps.heroPositions;
    if (!actionability || !buildTeamEvaluation || !buildTargetRanking || !heroPositions) return null;
    const memory = this.memory(view.sessionId);
    const trigger = explicitTrigger ?? this.classify(memory, view);
    const revision = (memory.lastSeq += 1);
    const assignments = new Map(memory.assignments);
    for (const [heroId, position] of input.context.ownAssignedPositions ?? []) assignments.set(heroId, position);
    const coachState = buildCoachObservableState(view, { heroPositions, playerPositionAssignments: assignments, personalContext: null });
    const personal = input.playerPersonalPosition ?? null;

    const teamEvaluation = await buildTeamEvaluation(input.context);
    let sourceSet = teamEvaluation;
    let decision = buildCurrentHumanDecision({ actionability, target: null, candidates: null, personalPoolApplied: false });
    if (actionability.hasHumanAction) {
      const target = selectDecisionTarget({ eligiblePositions: actionability.eligiblePositions, teamEvaluation, view, playerPersonalPosition: personal, heroPositions, heroCounters: this.deps.heroCounters });
      // COHERENCE-007: the Personal Hero Pool may shape the active decision ONLY for the personal position.
      const personalPoolApplied = input.personalPoolAvailable === true && personal !== null && target.targetPosition === personal;
      const targetRanking = await buildTargetRanking(input.context, target.targetPosition, personalPoolApplied);
      sourceSet = targetRanking;
      const candidates = deriveCandidateResult({ targetPosition: target.targetPosition, targetRanking, view, heroPositions, heroCounters: this.deps.heroCounters, personalPoolApplied });
      decision = buildCurrentHumanDecision({ actionability, target, candidates, personalPoolApplied });
    }
    const output = buildRecommendationOutputV4({
      decision,
      coachState,
      decisionContext: deriveDecisionContextFromView(view),
      source: { basedOn: sourceSet.basedOn, ...(sourceSet.readiness ? { readiness: sourceSet.readiness } : {}) },
      trigger,
      revision,
    });
    if (revision > memory.latestRevision) {
      memory.latestRevision = revision;
      memory.observed = { ...countVisible(view), assignments: assignmentsKey(memory.assignments) };
    }
    return { output, sourceSet, trigger, revision };
  }

  /** Trigger 0: the pick phase just opened (BAN_RESOLUTION_COMPLETE). */
  onDraftPicksStarted(input: CoachRecomputeInput): Promise<CoachRecomputation> {
    return this.recompute(input, "DRAFT_PICKS_STARTED");
  }

  /** Trigger 1: one of our own seats was sealed. Recomputes at once -- no enemy reveal is awaited. */
  onOwnPickConfirmed(input: CoachRecomputeInput): Promise<CoachRecomputation> {
    return this.recompute(input, "OWN_PICK_CONFIRMED");
  }

  /** Trigger 2: enemy picks became legally visible. */
  onRoundReveal(input: CoachRecomputeInput): Promise<CoachRecomputation> {
    return this.recompute(input, "ROUND_REVEALED");
  }

  /**
   * Trigger 3: the Player assigned a position to one of their own visible flexible heroes. Enemy
   * roles are public-evidence inference only; this boundary prevents a UI click from promoting an
   * enemy LIKELY/POSSIBLE belief to hard truth.
   */
  onPlayerPositionAssigned(input: CoachRecomputeInput, heroId: HeroId, position: Position): Promise<CoachRecomputation> {
    const memory = this.memory(input.context.view.sessionId);
    if (isOwnVisibleHero(input.context.view, heroId) && isCompatiblePosition(heroId, position, this.deps.heroPositions)) memory.assignments.set(heroId, position);
    return this.recompute(input, "PLAYER_POSITION_ASSIGNED");
  }

  /** Removing an own-team assignment restores observable inference; enemy/unknown IDs are ignored. */
  onPlayerPositionCleared(input: CoachRecomputeInput, heroId: HeroId): Promise<CoachRecomputation> {
    const memory = this.memory(input.context.view.sessionId);
    if (isOwnVisibleHero(input.context.view, heroId)) memory.assignments.delete(heroId);
    return this.recompute(input, "PLAYER_POSITION_ASSIGNED");
  }

  /** Forget a session (e.g. when the store evicts it). */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }
}
