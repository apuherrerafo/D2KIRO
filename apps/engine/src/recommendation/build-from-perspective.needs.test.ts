import { describe, expect, test } from "bun:test";
import { fakeCompute, harness, HERO_POSITIONS } from "../coach/session-harness.fixtures";
import { buildRecommendationSetFromPerspective } from "./build-from-perspective";
import type { ComputeSuggestionsForRecommendation } from "./perspective-context";

// TSK-253: the Coach is the ONLY caller that tells V6 how many own picks are left (so `team_synergy` can weigh what the team critically
// lacks). It does so when it ranks FOR a position; the team-level opening never does. Options captured at the seam V6 is called through.

type Options = NonNullable<Parameters<ComputeSuggestionsForRecommendation>[2]>;

function capturing(): { compute: ComputeSuggestionsForRecommendation; calls: Options[] } {
  const inner = fakeCompute();
  const calls: Options[] = [];
  const compute: ComputeSuggestionsForRecommendation = (state, accountId, options) => {
    calls.push({ ...options });
    return inner(state, accountId, options);
  };
  return { compute, calls };
}

describe("buildRecommendationSetFromPerspective -- teamNeedsOwnPicksRemaining", () => {
  const h = harness({ adapterKind: "simulator", controlledPositions: [1, 2, 3, 4, 5] });
  const context = h.store.perspectiveRecommendationContext(h.id)!;

  test("ranking FOR a position pasa los picks propios que faltan (5 con el draft vacío)", async () => {
    const { compute, calls } = capturing();
    await buildRecommendationSetFromPerspective({ context, computeSuggestions: compute, heroPositions: HERO_POSITIONS, targetPosition: 2, teamOpening: false, singleSlotEvaluation: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.teamNeedsOwnPicksRemaining).toBe(5);
  });

  test("sin posición objetivo (apertura de equipo) no pide nada", async () => {
    const { compute, calls } = capturing();
    await buildRecommendationSetFromPerspective({ context, computeSuggestions: compute, heroPositions: HERO_POSITIONS });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.teamNeedsOwnPicksRemaining).toBeUndefined();
  });
});
