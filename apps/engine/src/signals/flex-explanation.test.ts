import { expect, test } from "bun:test";
import { createIdleDraftState } from "../draft/reducer";
import { buildSuggestions } from "./mix";
import type { MetaSnapshot } from "./types";

test("explica un flex real sin confundirlo con el aporte táctico al equipo", () => {
  const state = {
    ...createIdleDraftState("flex"),
    phase: "active" as const,
    format: "all_pick" as const,
    patch: "7.41e",
    localSide: "radiant" as const,
    picks: { radiant: [1], dire: [] },
  };
  const meta: MetaSnapshot = {
    heroes: {
      1: { id: 1, localizedName: "Crystal Maiden" },
      2: { id: 2, localizedName: "Earthshaker" },
      3: { id: 3, localizedName: "Lina" },
    },
    matchups: {},
  };

  const result = buildSuggestions(state, meta, {
    heroPositions: {
      1: [{ position: 5, matches: 500 }],
      2: [{ position: 4, matches: 500 }, { position: 2, matches: 300 }],
      3: [{ position: 2, matches: 500 }],
    },
    heroCapabilities: [
      { hero: 1, damageType: "magical", hasInitiation: false, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "medium", scaling: "low" },
      { hero: 2, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "high", scaling: "low" },
      { hero: 3, damageType: "magical", hasInitiation: false, hasCatch: true, hasWaveclear: true, structuralDamage: "medium", teamfight: "medium", scaling: "medium" },
    ],
  });

  const earthshaker = result.suggestions.find((suggestion) => suggestion.hero === 2)!;
  expect(earthshaker.reason).toContain("Puede flexearse entre support y midlane");
  expect(earthshaker.reason).toContain("Aporta");
});
