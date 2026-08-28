import { expect, test } from "bun:test";
import type { ProPatternIndex } from "./patterns";
import { queryProPatterns, type ProQueryContext } from "./query";

const ref = { source: "opendota_match" as const, fetchedAt: "2026-01-01", sampleSize: 30 };
const index: ProPatternIndex = {
  version: 1,
  positions: [
    { heroId: 1, positionEst: 5, patch: "7.41e", tier: "tier_1", sampleSize: 30, openingPicks: 20, averagePickOrder: 4, earlyPicks: 30, intermediatePicks: 0, lastPicks: 0, positionConfidence: .8, isFlexible: false, ref, confidence: "medium" },
    { heroId: 2, positionEst: 5, patch: "7.41e", tier: "tier_1", sampleSize: 30, openingPicks: 20, averagePickOrder: 4, earlyPicks: 30, intermediatePicks: 0, lastPicks: 0, positionConfidence: .8, isFlexible: true, ref, confidence: "medium" },
    { heroId: 3, positionEst: 5, patch: "7.40", tier: "tier_1", sampleSize: 30, openingPicks: 20, averagePickOrder: 4, earlyPicks: 30, intermediatePicks: 0, lastPicks: 0, positionConfidence: .8, isFlexible: false, ref, confidence: "medium" },
  ],
  pairs: [{ heroes: [10, 11], patch: "7.41e", tier: "tier_1", observedWinrate: .6, expectedWinrate: .5, delta: .1, sampleSize: 30, ref, confidence: "medium" }],
  triples: [{ heroes: [10, 11, 12], patch: "7.41e", tier: "tier_1", observedWinrate: .6, expectedWinrate: .5, delta: .1, sampleSize: 30, ref, confidence: "medium" }],
  banResponses: [{ bannedHero: 20, nextPickHero: 21, patch: "7.41e", tier: "tier_1", sampleSize: 10, observedWinrate: .55, ref, confidence: "exploratory" }],
};
const context = (overrides: Partial<ProQueryContext> = {}): ProQueryContext => ({ patch: "7.41e", observedBans: [], confirmedAllies: [], revealedRivals: [], targetPosition: 5, currentTurn: 6, ...overrides });

test("filtra por parche, posición y fase; incluye flex y procedencia", () => {
  const opening = queryProPatterns(index, context());
  expect(opening.map((m) => m.heroId)).toEqual([1, 2]);
  expect(opening.find((m) => m.heroId === 2)?.kind).toBe("flex");
  expect(opening.every((m) => m.ref.sampleSize > 0 && m.confidence)).toBe(true);
  expect(queryProPatterns(index, context({ currentTurn: 18 })).map((m) => m.kind)).toEqual(["pick_order", "flex"]);
});

test("los bans observados cambian la salida y conserva exploratory", () => {
  const withoutBan = queryProPatterns(index, context());
  const withBan = queryProPatterns(index, context({ observedBans: [20] }));
  expect(withBan.some((m) => m.heroId === 21 && m.kind === "ban_response" && m.confidence === "exploratory")).toBe(true);
  expect(withBan.length).toBeGreaterThan(withoutBan.length);
});

test("solo usa hechos rivales revelados; un rival no revelado nunca se devuelve", () => {
  const result = queryProPatterns(index, context({ confirmedAllies: [10], revealedRivals: [99] }));
  expect(result.some((m) => m.heroId === 99)).toBe(false);
  expect(result.some((m) => m.heroId === 11 && m.kind === "pair")).toBe(true);
});

test("sin datos del contexto o parche desconocido devuelve lista vacía", () => {
  expect(queryProPatterns(index, context({ patch: "7.99" }))).toEqual([]);
  expect(queryProPatterns(index, context({ currentTurn: 24 }))).toEqual([]);
});

test("consulta de un índice grande permanece dentro del presupuesto", () => {
  const large: ProPatternIndex = { ...index, positions: Array.from({ length: 2000 }, (_, i) => ({ ...index.positions[0]!, heroId: i + 1 })) };
  const start = performance.now(); queryProPatterns(large, context());
  expect(performance.now() - start).toBeLessThan(5);
});
