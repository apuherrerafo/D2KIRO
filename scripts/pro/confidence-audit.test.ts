import { expect, test } from "bun:test";
import { auditWeakPatterns } from "./confidence-audit";
import type { ProPatternIndex } from "../../apps/engine/src/pro/patterns";

const ref = { source: "opendota_match" as const, fetchedAt: "2026-01-01", sampleSize: 10 };
const index = {
  version: 1,
  positions: [{ heroId: 1, positionEst: 5, patch: "7.41e", tier: "tier_1", sampleSize: 9, openingPicks: 1, averagePickOrder: 1, earlyPicks: 1, intermediatePicks: 0, lastPicks: 0, positionConfidence: .2, isFlexible: false, ref, confidence: "medium" }],
  pairs: [{ heroes: [1, 2], patch: "7.41e", tier: "tier_1", observedWinrate: .5, expectedWinrate: .5, delta: 0, sampleSize: 12, ref, confidence: "medium" }], triples: [],
  banResponses: [{ bannedHero: 3, nextPickHero: 4, patch: "7.41e", tier: "tier_1", sampleSize: 10, observedWinrate: .5, ref, confidence: "exploratory" }],
} as ProPatternIndex;

test("identifica patrones por debajo del mínimo y conserva exploratory", () => {
  const weak = auditWeakPatterns(index);
  expect(weak.map((row) => row.key)).toEqual(["position:1:5", "ban:3->4", "pair:1:2"]);
  expect(weak.find((row) => row.key === "ban:3->4")?.confidence).toBe("exploratory");
});

test("permite auditar con un umbral explícito", () => {
  expect(auditWeakPatterns(index, 10).map((row) => row.key)).toEqual(["position:1:5"]);
});
