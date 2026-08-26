import { expect, test } from "bun:test";
import { createIdleDraftState } from "../draft/reducer";
import { observedDraftFacts } from "./observed-draft";

test("expone únicamente picks materializados como hechos observados", () => {
  const state = {
    ...createIdleDraftState("observed-facts"),
    phase: "active" as const,
    localSide: "radiant" as const,
    banned: [90],
    picks: { radiant: [1, 2], dire: [10, 11] },
  };

  expect(observedDraftFacts(state)).toEqual({
    ownPicks: [1, 2],
    revealedEnemyPicks: [10, 11],
    bannedHeroes: [90],
  });
});
