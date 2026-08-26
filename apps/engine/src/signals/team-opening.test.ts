import { expect, test } from "bun:test";
import { createIdleDraftState } from "../draft/reducer";
import { buildSuggestions } from "./mix";
import type { MetaSnapshot } from "./types";

const heroPositions = {
  1: [{ position: 1 as const, matches: 300 }],
  2: [{ position: 2 as const, matches: 300 }],
  3: [{ position: 3 as const, matches: 300 }],
  4: [{ position: 4 as const, matches: 300 }],
  5: [{ position: 5 as const, matches: 300 }],
  6: [{ position: 5 as const, matches: 300 }],
};

const meta: MetaSnapshot = {
  heroes: Object.fromEntries([1, 2, 3, 4, 5, 6].map((hero) => [hero, { id: hero, localizedName: `Hero ${hero}` }])),
  matchups: { 1: [{ vsHero: 99, games: 400, wins: 160 }] },
  heroPool: [{ hero: 6, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-08-25" }],
};

test("la apertura de equipo entrega cinco opciones, ignora rol/pool personal y explica el counter baneado", () => {
  const state = { ...createIdleDraftState("opening"), phase: "active" as const, format: "all_pick" as const, patch: "7.41e", localSide: "radiant" as const, banned: [99] };
  const stateWithoutCounterBan = { ...state, banned: [] };

  const result = buildSuggestions(state, meta, {
    teamOpening: true,
    targetPosition: 5,
    usePersonalPool: true,
    heroPositions,
    heroCapabilities: [],
  });

  expect(result.suggestions).toHaveLength(5);
  expect(result.suggestions.map((suggestion) => suggestion.rank)).toEqual([1, 2, 3, 4, 5]);
  expect(result.suggestions.map((suggestion) => suggestion.hero)).toContain(1);
  expect(result.suggestions.map((suggestion) => suggestion.hero)).toContain(2);
  const withoutCounterBan = buildSuggestions(stateWithoutCounterBan, meta, { teamOpening: true, heroPositions, heroCapabilities: [] });
  const relieved = result.suggestions.find((suggestion) => suggestion.hero === 1)!;
  const baseline = withoutCounterBan.suggestions.find((suggestion) => suggestion.hero === 1)!;
  expect(relieved.score).toBeGreaterThan(baseline.score);
  expect(relieved.reason).toContain("Héroe 99 está baneado");
  expect(relieved.reason).toContain("Hero 1 pierde una respuesta adversa identificada por el matchup");
  expect(relieved.reason).not.toContain("seguro");
});
