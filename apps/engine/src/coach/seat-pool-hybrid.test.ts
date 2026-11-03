import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import { buildRecommendationSetFromPerspective } from "../recommendation/build-from-perspective";
import type { PerspectiveRecommendationContext } from "../recommendation/perspective-context";
import { poolsByConfirmedPosition, type SavedTeamMember } from "../recommendation/team-positions";
import { CoachOrchestrator } from "./orchestrator";
import { fakeCompute, harness, HERO_POSITIONS } from "./session-harness.fixtures";

// Hero Pools V2 / F2 -- the HYBRID behaviour of F1 (a pool is a preference, never a filter) holds for the pool the
// resolver activates for the seat played THIS match. Saved team -> resolver -> REAL kernel/store/Coach; inline fixtures.
//   fixture: hero 4 is credible at Pos 2, hero 3 at Pos 4 (see session-harness.fixtures).

const ALL: Position[] = [1, 2, 3, 4, 5];

// One saved person: usual seat 4, a pool for Pos 4 ([3]) and a different pool for Pos 2 ([4]).
const person: SavedTeamMember = {
  id: 7,
  position: 4,
  heroPool: [3],
  positionPools: [
    { position: 4, heroPool: [3] },
    { position: 2, heroPool: [4] },
  ],
};

function coachFor() {
  return new CoachOrchestrator({
    heroPositions: HERO_POSITIONS,
    buildRecommendationSet: (context) => buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS }),
    buildTeamEvaluation: (context) => buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, singleSlotEvaluation: true }),
    buildTargetRanking: (context, targetPosition) =>
      buildRecommendationSetFromPerspective({ context, computeSuggestions: fakeCompute(), heroPositions: HERO_POSITIONS, targetPosition, teamOpening: false, singleSlotEvaluation: true }),
  });
}

async function cardsFor(assignedSeat: Position) {
  const pools = poolsByConfirmedPosition([person], new Map([[7, assignedSeat]]));
  const h = harness({ adapterKind: "simulator", controlledPositions: ALL });
  const base = h.store.perspectiveRecommendationContext(h.id)!;
  const context: PerspectiveRecommendationContext = { ...base, playerPoolsByPosition: Object.keys(pools).length === 0 ? null : pools };
  const result = await coachFor().recomputeCurrentDecision({ context, playerPersonalPosition: assignedSeat === 2 ? 4 : 2, requestedTarget: assignedSeat });
  const decision = result!.output.decision;
  if (decision.kind !== "ACTIONABLE") throw new Error("expected ACTIONABLE");
  if (decision.candidates.state !== "RANKED") throw new Error("expected RANKED");
  return { decision, cards: decision.candidates.cards };
}

describe("F2 + F1 hybrid: the activated seat pool is a preference over credible role candidates", () => {
  test("seated at Pos 2, the Pos 2 pool is marked IN_POOL and the Pos 4 pool hero is not even a Pos 2 candidate", async () => {
    const { cards } = await cardsFor(2);
    expect(cards.find((card) => card.heroId === 4)!.poolMembership).toBe("IN_POOL");
    expect(cards.map((card) => card.heroId)).not.toContain(3); // the usual-seat pool does not travel to Pos 2
  });

  test("seated at their usual Pos 4, the Pos 4 pool is the one in force", async () => {
    const { cards } = await cardsFor(4);
    expect(cards.find((card) => card.heroId === 3)!.poolMembership).toBe("IN_POOL");
  });

  test("seated at a seat with NO pool: still ranked from credible role candidates, nothing marked IN_POOL (never another seat's pool)", async () => {
    const { cards } = await cardsFor(5);
    expect(cards.length).toBeGreaterThan(0);
    expect(cards.every((card) => card.poolMembership !== "IN_POOL")).toBe(true);
    expect(cards.map((card) => card.heroId)).not.toContain(4);
  });
});
