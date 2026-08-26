import { expect, test } from "bun:test";
import { createIdleDraftState } from "../draft/reducer";
import { buildSuggestions } from "./mix";

test("expone contrapick, sinergia y flex como evidencia separada", () => {
  const state = {
    ...createIdleDraftState("evidence"), phase: "active" as const, format: "all_pick" as const, patch: "7.41e", localSide: "radiant" as const,
    picks: { radiant: [1, 2], dire: [10, 11] },
  };
  const result = buildSuggestions(state, {
    heroes: { 1: { id: 1, localizedName: "Uno" }, 2: { id: 2, localizedName: "Dos" }, 3: { id: 3, localizedName: "Earthshaker" }, 10: { id: 10, localizedName: "Lina" }, 11: { id: 11, localizedName: "Zeus" } },
    matchups: { 3: [{ vsHero: 10, games: 400, wins: 280 }, { vsHero: 11, games: 400, wins: 220 }, { vsHero: 12, games: 400, wins: 160 }] },
  }, {
    heroPositions: { 1: [{ position: 5, matches: 400 }], 2: [{ position: 1, matches: 400 }], 3: [{ position: 4, matches: 400 }, { position: 2, matches: 300 }] },
    heroCapabilities: [
      { hero: 1, damageType: "magical", hasInitiation: false, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "medium", scaling: "low" },
      { hero: 2, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: true, structuralDamage: "high", teamfight: "low", scaling: "high" },
      { hero: 3, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "high", scaling: "low" },
    ],
  });

  const earthshaker = result.suggestions.find((suggestion) => suggestion.hero === 3)!;
  expect(earthshaker.evidence?.map((item) => item.kind)).toEqual(expect.arrayContaining(["counter", "synergy", "flex"]));
});
