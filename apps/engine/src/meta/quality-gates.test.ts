import { expect, test } from "bun:test";
import { DEFAULT_SYNC_QUALITY_GATES, evaluateSyncQuality, type SyncStagingCounts } from "./quality-gates";

function healthy(): SyncStagingCounts {
  return {
    sourceErrors: 0,
    heroes: { received: 127, valid: 127, invalid: 0, duplicateIds: 0 },
    patchStats: { received: 127, invalid: 0, heroesCovered: 127, heroesCoveredInHeroes: 127, duplicateKeys: 0, totalPicks: 1_000_000 },
    matchups: { heroesRequested: 127, heroesWithRows: 127, invalidRows: 0, receivedRows: 15_982, orphanRows: 0, duplicatePairs: 0 },
    previous: { heroes: 127, matchupRows: 15_982 },
  };
}

test("un snapshot completo pasa", () => {
  expect(evaluateSyncQuality(healthy()).passed).toBe(true);
});

test("el caso P0-05E: 119 de 127 héroes con matchups (93.7%) NO pasa", () => {
  const counts = healthy();
  counts.matchups.heroesWithRows = 119;
  const report = evaluateSyncQuality(counts);
  expect(report.passed).toBe(false);
  expect(report.failures.join(";")).toContain("119/127");
});

test("cada gate falla por separado", () => {
  const cases: Array<[string, (c: SyncStagingCounts) => void]> = [
    ["heroes:", (c) => { c.heroes.valid = 50; c.heroes.received = 50; }],
    ["duplicado", (c) => { c.heroes.duplicateIds = 1; }],
    ["fuente", (c) => { c.sourceErrors = 1; }],
    ["heroStats: cubre", (c) => { c.patchStats.heroesCoveredInHeroes = 100; }],
    ["cero picks", (c) => { c.patchStats.totalPicks = 0; }],
    ["rival inexistente", (c) => { c.matchups.orphanRows = 1000; }],
    ["par(es) duplicado", (c) => { c.matchups.duplicatePairs = 2; }],
    ["publicadas", (c) => { c.matchups.receivedRows = 5000; }],
  ];
  for (const [expected, mutate] of cases) {
    const counts = healthy();
    mutate(counts);
    const report = evaluateSyncQuality(counts, DEFAULT_SYNC_QUALITY_GATES);
    expect(report.passed).toBe(false);
    expect(report.failures.join(";")).toContain(expected);
  }
});

test("sin datos previos publicados, la regresión no aplica (primera sync)", () => {
  const counts = healthy();
  counts.previous = { heroes: 0, matchupRows: 0 };
  expect(evaluateSyncQuality(counts).passed).toBe(true);
});
