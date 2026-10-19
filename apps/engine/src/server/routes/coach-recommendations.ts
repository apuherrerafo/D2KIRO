import { buildTeamCoachBoard, CoachOrchestrator, credibleHeroesForPosition, personalCandidateUniverse, type CoachRecomputation, type CurrentDecisionRecomputation, type TeamCoachBoard } from "../../coach";
import { buildRecommendationSetFromPerspective } from "../../recommendation/build-from-perspective";
import { AP_RECOMMENDATION_OUTPUT_LIMIT } from "../../recommendation/construct";
import { configuredPoolForPosition, poolForPosition, type ComputeSuggestionsForRecommendation, type PerspectiveRecommendationContext } from "../../recommendation/perspective-context";
import { loadHeroCounters, type CuratedCounter } from "../../signals/hero-counters";
import { loadHeroPositions, type HeroPositions } from "../../signals/hero-positions";

// AP Ranked Roles V1 / Wave 2 (product review) -- the Coach's server-side entry point.
//
// STRUCTURAL BOUNDARY: everything this module can reach about a draft comes through
// `PerspectiveContextSource`, whose single method returns a `PerspectiveRecommendationContext`
// (perspective view + open seats + party structure + patch). The interface deliberately does NOT
// expose the session store's authoritative state accessor, so a `DraftProtocolState` is not merely
// avoided here -- it is not obtainable through the types this file is given. The route hands over
// `ProtocolSessionStore`, which satisfies the narrow interface structurally.
//
// Legacy `GET .../recommendations` (RecommendationSetV2 from authoritative state) does not go
// through here and is unchanged.

export interface PerspectiveContextSource {
  perspectiveRecommendationContext(sessionId: string): PerspectiveRecommendationContext | null;
}

export interface CoachRecommendationsDeps {
  source: PerspectiveContextSource;
  computeSuggestions: ComputeSuggestionsForRecommendation;
  heroPositions?: HeroPositions;
  /** Curated counter relationships (Safe Core, Wave 4A). Defaults to the validated `hero-counters.json`. */
  heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>;
}

export interface CoachRecommendations {
  /** Null for an unknown session. */
  recommend(sessionId: string, playerPersonalPosition: 1 | 2 | 3 | 4 | 5 | null, accountId?: number | null): Promise<CoachRecomputation | null>;
  assignPosition(sessionId: string, playerPersonalPosition: 1 | 2 | 3 | 4 | 5 | null, accountId: number | null, heroId: number, position: 1 | 2 | 3 | 4 | 5 | null): Promise<CoachRecomputation | null>;
  /**
   * Product Semantics Recovery WP2 -- the V4 CurrentHumanDecision. `undefined` for an unknown session,
   * `null` for a session without HumanActionability (non-AP-Simulator).
   */
  recommendCurrentDecision(sessionId: string, playerPersonalPosition: 1 | 2 | 3 | 4 | 5 | null, accountId?: number | null, requestedTarget?: 1 | 2 | 3 | 4 | 5 | null): Promise<CurrentDecisionRecomputation | null | undefined>;
  /**
   * Team Coach Board -- every human-controlled position ranked against ONE perspective snapshot,
   * with the SAME target ranking builder as V4. Team-level (no account) EXCEPT the owner's own position, which is
   * ranked with the owner's personal hero pool when `accountId` is given. `undefined` for an unknown session,
   * `null` for a session without HumanActionability/controlled positions.
   */
  recommendTeamBoard(sessionId: string, playerPersonalPosition: 1 | 2 | 3 | 4 | 5 | null, accountId?: number | null): Promise<TeamCoachBoard | null | undefined>;
}

export function createCoachRecommendations(deps: CoachRecommendationsDeps): CoachRecommendations {
  const heroPositions = deps.heroPositions ?? MODULE_HERO_POSITIONS;
  const heroCounters = deps.heroCounters ?? MODULE_HERO_COUNTERS;
  // Assignments are per observer/account. A pool overlay must not accidentally share state with
  // another account that happens to inspect the same simulator session.
  const coaches: { accountId: string; coach: CoachOrchestrator }[] = [];
  // Step 1B-B: a configured, non-empty Party5 pool for the target position IS the candidate universe (hard admission --
  // it never provides identity). Unconfigured/empty keeps the credible-universe behaviour.
  function targetUniverse(context: PerspectiveRecommendationContext, targetPosition: 1 | 2 | 3 | 4 | 5) {
    const pool = configuredPoolForPosition(context.playerPoolsByPosition, targetPosition);
    if (pool) return { candidateHeroIds: pool, candidateUniverseIsAdmission: true };
    return { candidateHeroIds: credibleHeroesForPosition(targetPosition, heroPositions) };
  }
  function coachFor(accountId: number | null): CoachOrchestrator {
    const key = accountId === null ? "anonymous" : String(accountId);
    let coach = coaches.find((entry) => entry.accountId === key)?.coach;
    if (!coach) {
      // The authenticated Hero Pool is personal data.  Deliberately erase the account before
      // every team-level evaluation: the team set, its evidence and its ordering must have the
      // same inputs for every observer of this visible draft.  Only the separate, target-position
      // PersonalHeroView is allowed to load that account's metadata overlay.
      const computeForTeam = (draft: Parameters<ComputeSuggestionsForRecommendation>[0], _ignored: number | null, options?: Parameters<ComputeSuggestionsForRecommendation>[2]) =>
        deps.computeSuggestions(draft, null, options);
      const computeForPersonal = (draft: Parameters<ComputeSuggestionsForRecommendation>[0], _ignored: number | null, options?: Parameters<ComputeSuggestionsForRecommendation>[2]) =>
        deps.computeSuggestions(draft, accountId, options);
      coach = new CoachOrchestrator({
        heroPositions,
        heroCounters,
        buildRecommendationSet: (context) => buildRecommendationSetFromPerspective({ context, computeSuggestions: computeForTeam, heroPositions, outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT }),
        buildActionRecommendationSet: (context, candidateHeroIds, targetPosition) => buildRecommendationSetFromPerspective({
          context,
          computeSuggestions: computeForTeam,
          heroPositions,
          targetPosition,
          candidateHeroIds,
          teamOpening: false,
          singleSlotEvaluation: true,
          outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT,
        }),
        buildPersonalRecommendation: (context, position) => buildRecommendationSetFromPerspective({
          context,
          computeSuggestions: computeForPersonal,
          heroPositions,
          targetPosition: position,
          // Pre-ranking universe: only heroes credibly played at the Player's own position (Dota-Judge RB-1).
          candidateHeroIds: personalCandidateUniverse(position, heroPositions),
          teamOpening: false,
          singleSlotEvaluation: true,
          outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT,
        }),
        // V4: ONE position-agnostic team evaluation (target selection over every eligible position,
        // never the account's pool) and ONE ranking for the chosen target.
        buildTeamEvaluation: (context) => buildRecommendationSetFromPerspective({
          context,
          computeSuggestions: computeForTeam,
          heroPositions,
          singleSlotEvaluation: true,
          outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT,
        }),
        buildTargetRanking: (context, targetPosition, usePersonalPool) => {
          const positionPool = poolForPosition(context.playerPoolsByPosition, targetPosition);
          return buildRecommendationSetFromPerspective({
            context,
            computeSuggestions: positionPool ? computeForTeam : (usePersonalPool ? computeForPersonal : computeForTeam),
            overrideHeroPool: positionPool ?? undefined,
            heroPositions,
            targetPosition,
            ...targetUniverse(context, targetPosition),
            teamOpening: false,
            singleSlotEvaluation: true,
            outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT,
          });
        },
      });
      coaches.push({ accountId: key, coach });
    }
    return coach;
  }
  // Team-level by construction: a teammate's column is computed with the account erased, so it has the same inputs for
  // every observer of a visible draft. The ONE exception is the owner's own position: the owner always plays from their
  // personal hero pool (a saved team never carries that seat -- withoutOwnerSeat), so that column is ranked with it.
  function buildTeamTargetRanking(context: PerspectiveRecommendationContext, targetPosition: 1 | 2 | 3 | 4 | 5, ownerAccountId: number | null) {
    const positionPool = poolForPosition(context.playerPoolsByPosition, targetPosition);
    return buildRecommendationSetFromPerspective({
      context,
      computeSuggestions: (draft, _ignored, options) => deps.computeSuggestions(draft, ownerAccountId, options),
      overrideHeroPool: positionPool ?? undefined,
      heroPositions,
      targetPosition,
      ...targetUniverse(context, targetPosition),
      teamOpening: false,
      singleSlotEvaluation: true,
      outputLimit: AP_RECOMMENDATION_OUTPUT_LIMIT,
    });
  }
  return {
    async recommendTeamBoard(sessionId, playerPersonalPosition, accountId = null) {
      const context = deps.source.perspectiveRecommendationContext(sessionId);
      if (!context) return undefined;
      const buildTargetRanking = (boardContext: PerspectiveRecommendationContext, position: 1 | 2 | 3 | 4 | 5) =>
        buildTeamTargetRanking(boardContext, position, position === playerPersonalPosition ? accountId : null);
      return buildTeamCoachBoard({ context, playerPersonalPosition, heroPositions, heroCounters, buildTargetRanking });
    },
    async recommend(sessionId, playerPersonalPosition, accountId = null) {
      const context = deps.source.perspectiveRecommendationContext(sessionId);
      if (!context) return null;
      return coachFor(accountId).recompute({ context, playerPersonalPosition });
    },
    async recommendCurrentDecision(sessionId, playerPersonalPosition, accountId = null, requestedTarget = null) {
      const context = deps.source.perspectiveRecommendationContext(sessionId);
      if (!context) return undefined;
      return coachFor(accountId).recomputeCurrentDecision({ context, playerPersonalPosition, personalPoolAvailable: accountId !== null, requestedTarget });
    },
    async assignPosition(sessionId, playerPersonalPosition, accountId, heroId, position) {
      const context = deps.source.perspectiveRecommendationContext(sessionId);
      if (!context) return null;
      const input = { context, playerPersonalPosition };
      return position === null
        ? coachFor(accountId).onPlayerPositionCleared(input, heroId)
        : coachFor(accountId).onPlayerPositionAssigned(input, heroId, position);
    },
  };
}

const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
const MODULE_HERO_COUNTERS = loadHeroCounters();
