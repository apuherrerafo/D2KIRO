import { expect, test } from "bun:test";
import type { ProSourceRef } from "../../apps/engine/src/pro/types";
import type { NormalizedDraft } from "./normalize";
import { aggregateBanResponses, aggregateDrafts, aggregatePair, aggregatePosition, type AggregateInput } from "./aggregate";

const ref: ProSourceRef = { source: "opendota_match", fetchedAt: "2026-01-01T00:00:00Z", sampleSize: 30 };
const makeDraft = (positionEst: 1 | 2 | 3 | 4 | 5, laneRole: number, order = 7): NormalizedDraft => ({
  turns: [{ order, isPick: true, heroId: 1, team: 0, phase: "opening_picks" }],
  slots: [{ heroId: 1, team: 0, positionEst, laneRole, isRoaming: positionEst === 4, netWorth: 100, netWorthRank: 1 }],
  revealedAtTurnByHero: { "1": order }, missingOrders: [], unsupportedGameMode: false,
});
const input = (draft: NormalizedDraft, patch = "7.41e"): AggregateInput => ({ draft, patch, tier: "tier_1", ref });

const pairDraft = (count: number): AggregateInput[] => Array.from({ length: count }, (_, index) => input({
  ...makeDraft(4, 4, 7),
  turns: [
    { order: 7, isPick: true, heroId: 1, team: 0, phase: "opening_picks" },
    { order: 8, isPick: true, heroId: 2, team: 0, phase: "opening_picks" },
  ],
  slots: [{ heroId: 1, team: 0, positionEst: 4, laneRole: 4, isRoaming: true, netWorth: 100, netWorthRank: 1 }, { heroId: 2, team: 0, positionEst: 5, laneRole: 5, isRoaming: false, netWorth: 90, netWorthRank: 2 }],
  revealedAtTurnByHero: { "1": 7, "2": 8 },
}));

test("agrega frecuencia, orden medio, apertura y buckets por héroe/posición", () => {
  const rows = aggregateDrafts(Array.from({ length: 15 }, () => input(makeDraft(4, 4, 7))).concat(Array.from({ length: 15 }, () => input(makeDraft(4, 4, 22)))));
  expect(rows[0]).toMatchObject({ heroId: 1, positionEst: 4, sampleSize: 30, openingPicks: 15, averagePickOrder: 14.5, earlyPicks: 15, lastPicks: 15 });
});

test("por debajo de 30 observaciones el agregado es null", () => {
  expect(aggregatePosition([input(makeDraft(1, 1))])).toBeNull();
});

test("muestra alta pero concordancia baja produce positionConfidence bajo", () => {
  const drafts = Array.from({ length: 30 }, () => input(makeDraft(1, 5)));
  const row = aggregatePosition(drafts)!;
  expect(row.positionConfidence).toBeLessThan(0.6);
});

test("dos posiciones con share 50/50 son flexibles; 95/5 no", () => {
  const balanced = Array.from({ length: 30 }, () => input(makeDraft(1, 1))).concat(Array.from({ length: 30 }, () => input(makeDraft(2, 2))));
  const skewed = Array.from({ length: 570 }, () => input(makeDraft(1, 1))).concat(Array.from({ length: 30 }, () => input(makeDraft(2, 2))));
  expect(aggregateDrafts(balanced).every((row) => row.isFlexible)).toBe(true);
  expect(aggregateDrafts(skewed).some((row) => row.isFlexible)).toBe(false);
});

test("respuestas a ban usan umbral 10 y quedan marcadas exploratory", () => {
  const make = (count: number) => Array.from({ length: count }, () => input({
    ...makeDraft(4, 4, 7),
    turns: [{ order: 0, isPick: false, heroId: 9, team: 0, phase: "opening_bans" }, { order: 7, isPick: true, heroId: 1, team: 0, phase: "opening_picks" }],
  }));
  expect(aggregateBanResponses(make(9))).toEqual([]);
  expect(aggregateBanResponses(make(10))[0]).toMatchObject({ bannedHero: 9, nextPickHero: 1, sampleSize: 10, confidence: "exploratory" });
});

test("parejas no-ban requieren 30 observaciones y emiten winrate esperado", () => {
  expect(aggregatePair(pairDraft(29))).toEqual([]);
  const rows = aggregatePair(pairDraft(30));
  expect(rows[0]).toMatchObject({ heroes: [1, 2], sampleSize: 30, confidence: "medium" });
  expect(rows[0]?.expectedWinrate).toBeGreaterThanOrEqual(0);
});
