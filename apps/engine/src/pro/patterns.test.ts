import { expect, test } from "bun:test";
import { compilePatterns, type PatternCompileInput } from "../../../../scripts/pro/compile-patterns";
import { parseProPatterns, loadProPatterns } from "./patterns";

const input: PatternCompileInput = {
  positions: [{ heroId: 1, positionEst: 4, patch: "7.41e", tier: "tier_1", sampleSize: 30, openingPicks: 10, averagePickOrder: 8, earlyPicks: 30, intermediatePicks: 0, lastPicks: 0, positionConfidence: 0.8, isFlexible: false, ref: { source: "opendota_match", fetchedAt: "2026-01-01", sampleSize: 30 }, confidence: "medium" }],
  pairs: [], triples: [], banResponses: [],
  drafts: [{ matchId: "m", leagueId: 1, patch: "7.41e", startTime: 1, gameMode: 2, radiantTeamId: null, direTeamId: null, winningSide: "radiant", turns: [
    ...Array.from({ length: 5 }, (_, i) => ({ order: i, isPick: true, heroId: i + 1, team: 0 as const })),
    ...Array.from({ length: 5 }, (_, i) => ({ order: i + 5, isPick: true, heroId: i + 6, team: 1 as const })),
  ], slots: [], ref: { source: "opendota_match", fetchedAt: "2026-01-01", sampleSize: 1 }}],
};

test("compila patrones y corpus con orden determinista y formato compatible", () => {
  const result = compilePatterns(input);
  expect(result.patterns.positions[0]?.heroId).toBe(1);
  expect(result.corpus).toHaveLength(1);
  expect(result.corpus[0]?.radiantHeroes).toEqual([1, 2, 3, 4, 5]);
  expect(result.corpus[0]?.direHeroes).toEqual([6, 7, 8, 9, 10]);
});

test("loader degrada archivo ausente o corrupto a sin datos", () => {
  expect(parseProPatterns(undefined)).toBeNull();
  expect(parseProPatterns({ version: 999 })).toBeNull();
  expect(loadProPatterns(() => undefined)).toBeNull();
});
