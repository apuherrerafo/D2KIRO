import { describe, expect, test } from "bun:test";
import { fakeCompute, harness, HERO_POSITIONS } from "../coach/session-harness.fixtures";
import { buildRecommendationSetFromPerspective } from "./build-from-perspective";
import type { ComputeSuggestionsForRecommendation } from "./perspective-context";

// TSK-252: the Coach is the ONLY caller that asks V6 for `position_fit` saturated at the credible median. It does so when it ranks FOR a
// position; the team-level opening (no target) never does. Options captured at the seam V6 is called through; REAL kernel + store.

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

describe("buildRecommendationSetFromPerspective -- positionFitSaturation", () => {
  const h = harness({ adapterKind: "simulator", controlledPositions: [1, 2, 3, 4, 5] });
  const context = h.store.perspectiveRecommendationContext(h.id)!;

  test("ranking FOR a position pide 'credible-median'", async () => {
    const { compute, calls } = capturing();
    await buildRecommendationSetFromPerspective({ context, computeSuggestions: compute, heroPositions: HERO_POSITIONS, targetPosition: 2, teamOpening: false, singleSlotEvaluation: true });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.targetPosition).toBe(2);
    expect(calls[0]!.positionFitSaturation).toBe("credible-median");
  });

  test("sin posición objetivo (apertura de equipo) no pide nada: la fórmula legada de relleno/seguridad no usa saturación", async () => {
    const { compute, calls } = capturing();
    await buildRecommendationSetFromPerspective({ context, computeSuggestions: compute, heroPositions: HERO_POSITIONS });
    expect(calls).toHaveLength(1);
    expect(calls[0]!.targetPosition).toBeUndefined();
    expect(calls[0]!.positionFitSaturation).toBeUndefined();
  });
});
