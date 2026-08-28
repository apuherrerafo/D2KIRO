import { expect, test } from "bun:test";
import { benchmarkPatterns, temporalPatternStability, tournamentDiversity, type BenchmarkDimensions } from "./benchmark";
import type { ProPatternIndex } from "../../apps/engine/src/pro/patterns";

const dimensions: BenchmarkDimensions = { publicData: 1, highMmrData: 1, professionalData: 1, tier1Patterns: .8, banSensitivity: .5, pickOrderPrecision: .7, evidenceCoverage: .9, explanationQuality: .6 };
const index = { version: 1, positions: [{ heroId: 1, positionEst: 5, patch: "7.41e", tier: "tier_1", sampleSize: 30, openingPicks: 1, averagePickOrder: 1, earlyPicks: 1, intermediatePicks: 0, lastPicks: 0, positionConfidence: .8, isFlexible: false, ref: { source: "opendota_match", fetchedAt: "2026-01-01", sampleSize: 30 }, confidence: "medium" }], pairs: [], triples: [], banResponses: [] } as ProPatternIndex;

test("calcula concentración dominante y Herfindahl", () => {
  expect(tournamentDiversity([{ draftId: "a", patch: "p", leagueId: 1 }, { draftId: "b", patch: "p", leagueId: 1 }, { draftId: "c", patch: "p", leagueId: 2 }])).toEqual({ dominantShare: 2 / 3, herfindahl: 5 / 9 });
});

test("mide estabilidad temporal por intersección de patrones", () => {
  expect(temporalPatternStability(["a", "b"], ["b", "c"])).toBe(1 / 3);
});

test("marca corpus sesgado y reporta cobertura de héroes", () => {
  const report = benchmarkPatterns([{ draftId: "a", patch: "p", leagueId: 1 }, { draftId: "b", patch: "p", leagueId: 1 }, { draftId: "c", patch: "p", leagueId: 2 }], index, dimensions, { oldKeys: ["a"], newKeys: ["a"] });
  expect(report.biasedByTournament).toBe(true);
  expect(report.heroCoverage).toBe(1);
  expect(report.temporalStability).toBe(1);
});
