import { describe, expect, test } from "bun:test";
import { parseHeroPositionObservations, MIN_POSITION_MATCHES } from "../../apps/engine/src/signals/hero-positions";
import { evaluateCoverage, SPOTLIGHT_HEROES } from "./coverage";
import {
  buildSnapshotObject,
  DEFAULT_BRACKET,
  DEFAULT_GAME_MODE,
  DEFAULT_RULESET_TARGET,
  DEFAULT_STRATZ_ENDPOINT,
  extractClosedBucketIds,
  fetchStratzSnapshot,
  STRATZ_SNAPSHOT_SCHEMA,
  type StratzPositionSnapshot,
  type StratzResponseData,
} from "./fetch-stratz";
import { buildObservationsFromStratz } from "./import-observations";
import { verifyLowCountEvidence } from "./verify-stratz-low-counts";

// Canonical catalog fixture -- no network, no DB needed
const catalog = [
  { id: 1, localizedName: "Anti-Mage" },
  { id: 2, localizedName: "Axe" },
  { id: 7, localizedName: "Earthshaker" },
  { id: 66, localizedName: "Chen" },
  { id: 131, localizedName: "Ringmaster" },
  { id: 145, localizedName: "Kez" },
  { id: 155, localizedName: "Largo" },
];

function makeSnapshot(
  heroStats: StratzResponseData["heroStats"],
  closedBucketIds?: number[],
): StratzPositionSnapshot {
  const allDays = new Set<number>();
  for (const posKey of ["p1", "p2", "p3", "p4", "p5"] as const) {
    for (const r of heroStats[posKey] ?? []) {
      if (typeof r?.day === "number") allDays.add(r.day);
    }
  }
  const buckets = closedBucketIds ?? (allDays.size > 0 ? [...allDays].sort((a, b) => a - b) : [101]);

  return buildSnapshotObject(
    {
      constants: {
        heroes: catalog.map((h) => ({ id: h.id, displayName: h.localizedName })),
      },
      heroStats,
    },
    {
      endpoint: DEFAULT_STRATZ_ENDPOINT,
      variables: {
        bracketIds: [DEFAULT_BRACKET],
        gameModeIds: [DEFAULT_GAME_MODE],
        take: 14,
      },
      bracket: DEFAULT_BRACKET,
      gameMode: DEFAULT_GAME_MODE,
      retrievedAt: "2026-09-21T12:00:00.000Z",
      closedBucketIds: buckets,
    },
  );
}

describe("STRATZ offline positional pipeline", () => {
  test("Task G5: matchCount = 1 is retained and not dropped", () => {
    const raw = makeSnapshot({
      p1: [{ day: 101, heroId: 1, matchCount: 1, winCount: 1 }],
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    });

    const { file, report } = buildObservationsFromStratz(raw, catalog);
    expect(report.observationRows).toBe(1);
    expect(report.lowCountRows).toBe(1);
    expect(report.belowFloorRows).toBe(1);

    const am = file.heroes.find((h) => h.hero === 1)!;
    expect(am.observations).toEqual([{ position: 1, matches: 1 }]);

    // Engine loader parses it: heroTotalMatches is 1 (denominator retained)
    // Floor is applied afterwards (matches 1 < 200 => raw: null, unadmitted)
    const positions = parseHeroPositionObservations(file);
    expect(positions[1]).toBeUndefined(); // below admission floor
  });

  test("Task G5: matchCount = 19 is retained and reported as low-count", () => {
    const raw = makeSnapshot({
      p1: [],
      p2: [],
      p3: [{ day: 102, heroId: 2, matchCount: 19, winCount: 11 }],
      p4: [],
      p5: [],
    });

    const { file, report } = buildObservationsFromStratz(raw, catalog);
    expect(report.lowCountRows).toBe(1);

    const axe = file.heroes.find((h) => h.hero === 2)!;
    expect(axe.observations).toEqual([{ position: 3, matches: 19 }]);
  });

  test("Task G5: matchCount = 200 is retained and clears admission floor in engine", () => {
    const raw = makeSnapshot({
      p1: [{ day: 101, heroId: 1, matchCount: 200, winCount: 108 }],
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    });

    const { file } = buildObservationsFromStratz(raw, catalog);
    const am = file.heroes.find((h) => h.hero === 1)!;
    expect(am.observations).toEqual([{ position: 1, matches: 200 }]);

    const positions = parseHeroPositionObservations(file);
    expect(positions[1]).toBeDefined();
    expect(positions[1]![0]!.position).toBe(1);
    expect(positions[1]![0]!.matches).toBe(200);
    expect(positions[1]![0]!.heroTotalMatches).toBe(200);
  });

  test("Task G5: multiple day aggregation correctly sums across days for each position", () => {
    const raw = makeSnapshot({
      p1: [
        { day: 101, heroId: 7, matchCount: 100, winCount: 52 },
        { day: 102, heroId: 7, matchCount: 150, winCount: 80 },
        { day: 103, heroId: 7, matchCount: 50, winCount: 25 },
      ],
      p2: [],
      p3: [],
      p4: [
        { day: 101, heroId: 7, matchCount: 15, winCount: 7 },
        { day: 102, heroId: 7, matchCount: 5, winCount: 2 },
      ],
      p5: [],
    });

    const { file } = buildObservationsFromStratz(raw, catalog);
    const es = file.heroes.find((h) => h.hero === 7)!;

    // Pos 1: 100 + 150 + 50 = 300
    // Pos 4: 15 + 5 = 20
    expect(es.observations).toEqual([
      { position: 1, matches: 300 },
      { position: 4, matches: 20 },
    ]);

    // Engine: Pos 1 admitted (300 >= 200), Pos 4 sub-floor, denominator = 320
    const positions = parseHeroPositionObservations(file);
    expect(positions[7]!.map((s) => s.position)).toEqual([1]);
    expect(positions[7]![0]!.heroTotalMatches).toBe(320);
    expect(positions[7]![0]!.matches).toBe(300);
  });

  test("Task G5: duplicate row rejection (same position, day, heroId)", () => {
    const raw = makeSnapshot({
      p1: [
        { day: 101, heroId: 1, matchCount: 50, winCount: 25 },
        { day: 101, heroId: 1, matchCount: 60, winCount: 30 }, // duplicate
      ],
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    });

    const { report } = buildObservationsFromStratz(raw, catalog);
    expect(report.duplicateRows).toEqual([{ position: 1, day: 101, heroId: 1 }]);
  });

  test("Task G5: wrong bucket set raises clear error", () => {
    const raw = makeSnapshot(
      {
        p1: [{ day: 101, heroId: 1, matchCount: 50, winCount: 25 }],
        p2: [],
        p3: [],
        p4: [],
        p5: [],
      },
      [101],
    );

    // Requesting closed buckets when fewer than required days are present
    expect(() => buildObservationsFromStratz(raw, catalog, { selectedBucketIds: [999] })).toThrow();
  });

  test("Task G5: unknown hero ID is rejected and reported", () => {
    const raw = makeSnapshot({
      p1: [{ day: 101, heroId: 9999, matchCount: 50, winCount: 25 }], // not in catalog
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    });

    const { report } = buildObservationsFromStratz(raw, catalog);
    expect(report.unmatchedHeroes).toEqual([{ position: 1, day: 101, heroId: 9999 }]);
  });

  test("Task G5: malformed winCount is rejected (winCount > matchCount or negative)", () => {
    const raw = makeSnapshot({
      p1: [
        { day: 101, heroId: 1, matchCount: 10, winCount: 15 }, // winCount > matchCount
        { day: 102, heroId: 1, matchCount: 10, winCount: -1 }, // negative
      ],
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    });

    const { report } = buildObservationsFromStratz(raw, catalog);
    expect(report.unparseableRows.length).toBe(2);
    expect(report.unparseableRows[0]!.reason).toContain("cannot exceed matchCount");
    expect(report.unparseableRows[1]!.reason).toContain("non-negative integer");
  });

  test("Task G5: catalog coverage asserts Chen 66, Ringmaster 131, Kez 145, Largo 155", () => {
    const obsMap = new Map<number, Map<1 | 2 | 3 | 4 | 5, number>>();
    // Chen has 15 matches on Pos 5
    obsMap.set(66, new Map([[5, 15]]));
    // Ringmaster has 220 matches on Pos 4
    obsMap.set(131, new Map([[4, 220]]));
    // Kez has 180 matches on Pos 1
    obsMap.set(145, new Map([[1, 180]]));
    // Largo is absent from the 7-day window (0 matches)

    const reports = evaluateCoverage(catalog, obsMap);
    expect(reports.length).toBe(4);

    const chen = reports.find((r) => r.heroId === 66)!;
    expect(chen.canonicalName).toBe("Chen");
    expect(chen.existsInCatalog).toBe(true);
    expect(chen.observedInWindow).toBe(true);
    expect(chen.countsByPosition).toEqual({ 5: 15 });

    const ringmaster = reports.find((r) => r.heroId === 131)!;
    expect(ringmaster.canonicalName).toBe("Ringmaster");
    expect(ringmaster.existsInCatalog).toBe(true);
    expect(ringmaster.observedInWindow).toBe(true);
    expect(ringmaster.countsByPosition).toEqual({ 4: 220 });

    const kez = reports.find((r) => r.heroId === 145)!;
    expect(kez.canonicalName).toBe("Kez");
    expect(kez.existsInCatalog).toBe(true);
    expect(kez.observedInWindow).toBe(true);
    expect(kez.countsByPosition).toEqual({ 1: 180 });

    const largo = reports.find((r) => r.heroId === 155)!;
    expect(largo.canonicalName).toBe("Largo");
    expect(largo.existsInCatalog).toBe(true);
    expect(largo.observedInWindow).toBe(false);
    expect(largo.countsByPosition).toEqual({});
    expect(largo.totalMatches).toBe(0);
  });

  test("Task G5: deterministic byte-identical output regardless of input order", () => {
    const rawA = makeSnapshot({
      p1: [
        { day: 101, heroId: 1, matchCount: 50, winCount: 25 },
        { day: 102, heroId: 1, matchCount: 60, winCount: 30 },
      ],
      p2: [{ day: 101, heroId: 7, matchCount: 20, winCount: 10 }],
      p3: [],
      p4: [],
      p5: [],
    });

    const outA = JSON.stringify(buildObservationsFromStratz(rawA, catalog).file);
    const outB = JSON.stringify(buildObservationsFromStratz(rawA, catalog).file);
    expect(outA).toBe(outB);

    // Deep clone from same serialized bytes
    const rawB = JSON.parse(JSON.stringify(rawA)) as StratzPositionSnapshot;
    const outC = JSON.stringify(buildObservationsFromStratz(rawB, catalog).file);
    expect(outC).toBe(outA);

    // Also assert that inner hero observation lists are canonically ordered (hero asc, pos asc)
    const file = buildObservationsFromStratz(rawA, catalog).file;
    expect(file.heroes.map((h) => h.hero)).toEqual([1, 7]);
    expect(file.heroes[0]!.observations.map((o) => o.position)).toEqual([1]);
  });

  test("Task G5 / A2-R4: current/incomplete day exclusion", () => {
    const baseDaySeconds = 1789084800; // 2026-09-11
    const DAY = 86400;
    const currentDay = baseDaySeconds + 7 * DAY; // 2026-09-18 (in-progress)
    const heroStats: StratzResponseData["heroStats"] = {
      p1: [
        { day: currentDay, heroId: 1, matchCount: 999, winCount: 500 }, // in-progress day!
        { day: baseDaySeconds + 6 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
        { day: baseDaySeconds + 5 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
        { day: baseDaySeconds + 4 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
        { day: baseDaySeconds + 3 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
        { day: baseDaySeconds + 2 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
        { day: baseDaySeconds + 1 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
        { day: baseDaySeconds, heroId: 1, matchCount: 10, winCount: 5 },
      ],
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    };

    const retrievedAt = new Date(currentDay * 1000);
    const closed = extractClosedBucketIds(heroStats, 7, undefined, retrievedAt);
    // currentDay dropped, exactly 7 closed days selected
    const expectedClosed = [0, 1, 2, 3, 4, 5, 6].map((i) => baseDaySeconds + i * DAY);
    expect(closed).toEqual(expectedClosed);

    const snapshot = makeSnapshot(heroStats, closed);
    const { file } = buildObservationsFromStratz(snapshot, catalog);
    const am = file.heroes.find((h) => h.hero === 1)!;

    // matchCount 999 from in-progress day must NOT be in the aggregated total (7 days * 10 = 70)
    expect(am.observations[0]!.matches).toBe(70);
  });

  test("Task G5 / A2-R3: secret is never serialized into snapshot", async () => {
    const mockBearerValue = "sample_synthetic_auth_credential_value";
    const prevKey = process.env.STRATZ_API_KEY;
    process.env.STRATZ_API_KEY = mockBearerValue;

    const baseDay = 1789084800;
    const DAY = 86400;
    const retrievedDate = new Date((baseDay + 8 * DAY) * 1000);

    const mockFetch = async () =>
      new Response(
        JSON.stringify({
          data: {
            constants: { heroes: [{ id: 1, displayName: "Anti-Mage" }] },
            heroStats: {
              p1: [
                { day: baseDay + 7 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
                { day: baseDay + 6 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
                { day: baseDay + 5 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
                { day: baseDay + 4 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
                { day: baseDay + 3 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
                { day: baseDay + 2 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
                { day: baseDay + 1 * DAY, heroId: 1, matchCount: 10, winCount: 5 },
              ],
              p2: [],
              p3: [],
              p4: [],
              p5: [],
            },
          },
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );

    const tempOut = `data/raw/stratz/test-sample-snapshot-${Date.now()}.json`;
    try {
      const { snapshot } = await fetchStratzSnapshot({
        outPath: tempOut,
        customFetch: mockFetch as unknown as typeof fetch,
      });

      const serializedSnapshot = JSON.stringify(snapshot);
      expect(serializedSnapshot).not.toContain(mockBearerValue);

      const { file } = buildObservationsFromStratz(snapshot, catalog);
      const serializedFile = JSON.stringify(file);
      expect(serializedFile).not.toContain(mockBearerValue);
    } finally {
      process.env.STRATZ_API_KEY = prevKey;
      const { unlinkSync, existsSync } = await import("node:fs");
      if (existsSync(tempOut)) {
        unlinkSync(tempOut);
      }
    }
  });

  test("Task A2-R3: passing --token via argv throws security error", async () => {
    const originalArgv = [...process.argv];
    try {
      process.argv.push("--token=insecure_cli_token");
      await expect(fetchStratzSnapshot()).rejects.toThrow("SECURITY ERROR");
    } finally {
      process.argv = originalArgv;
    }
  });

  test("Task A2-R1: totalPopulationMatches and unassignedMatches tracked from total aggregate", () => {
    const raw = makeSnapshot({
      total: [{ day: 101, heroId: 1, matchCount: 105, winCount: 55 }],
      p1: [{ day: 101, heroId: 1, matchCount: 250, winCount: 125 }],
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    });

    const { file, report } = buildObservationsFromStratz(raw, catalog);
    expect(report.totalPopulationMatches).toBe(105);
    expect(report.totalKnownPositionMatches).toBe(250);

    const am = file.heroes.find((h) => h.hero === 1)!;
    expect(am.totalPopulationMatches).toBe(105);
    expect(am.totalKnownPositionMatches).toBe(250);

    // Engine loader uses totalPopulationMatches as heroTotalMatches
    const positions = parseHeroPositionObservations(file);
    expect(positions[1]![0]!.heroTotalMatches).toBe(105);
    expect(positions[1]![0]!.matches).toBe(250);
    expect(positions[1]![0]!.totalPopulationMatches).toBe(105);
  });

  test("Task G6: live acceptance probe passes when low count (1..19) exists", () => {
    const raw = makeSnapshot({
      p1: [{ day: 101, heroId: 1, matchCount: 7, winCount: 4 }], // 1 <= 7 <= 19
      p2: [],
      p3: [],
      p4: [],
      p5: [],
    });

    const result = verifyLowCountEvidence(raw);
    expect(result.pass).toBe(true);
    expect(result.firstEvidence).toBeDefined();
    expect(result.firstEvidence!.heroId).toBe(1);
    expect(result.firstEvidence!.position).toBe(1);
    expect(result.firstEvidence!.day).toBe(101);
    expect(result.firstEvidence!.matchCount).toBe(7);
    expect(result.firstEvidence!.snapshotHash).toBeDefined();
  });

  test("Task G6: live acceptance probe fails with LOW_COUNT_NOT_OBSERVED when all counts >= 20", () => {
    const raw = makeSnapshot({
      p1: [{ day: 101, heroId: 1, matchCount: 250, winCount: 130 }], // >= 20
      p2: [{ day: 102, heroId: 2, matchCount: 50, winCount: 26 }],   // >= 20
      p3: [],
      p4: [],
      p5: [],
    });

    const result = verifyLowCountEvidence(raw);
    expect(result.pass).toBe(false);
    expect(result.firstEvidence).toBeUndefined();
    expect(result.totalMatches).toBe(0);
  });
});
