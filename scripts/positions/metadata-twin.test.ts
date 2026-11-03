import { describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildPositionsMetadataTwin, checkSync, LEGACY_FORMAT, serializeTwin } from "./metadata-twin";

const DATASET_PATH = "apps/engine/src/signals/hero-positions.json";

// Small, internally-consistent v2 (hero-position-observations/v1) fixture. Sums in `heroes[]`
// deliberately match `provenance.completenessEvidence` so the identity cross-check passes.
const V2_FIXTURE = {
  schema: "hero-position-observations/v1",
  provenance: {
    source: "api.stratz.com/graphql (STRATZ GraphQL heroStats.winDay, offline snapshot)",
    bracketClaim: "IMMORTAL",
    gameMode: "ALL_PICK_RANKED",
    patchClaim: { verified: false, note: "the source API does not state a patch in winDay" },
    rulesetTarget: "7.41f",
    retrievedAt: { from: "2026-09-22T05:21:38.864Z", to: "2026-09-22T05:21:38.864Z" },
    selectedBucketIds: [1789084800, 1789171200, 1789257600],
    bucketSelection: { selectedBucketIds: [1789084800, 1789171200, 1789257600] },
    completeness: "authoritative completeness closed by comparing unfiltered total winDay against P1-P5 winDay",
    completenessEvidence: {
      totalPopulationMatches: 5100,
      totalKnownPositionMatches: 5000,
      unassignedMatches: 100,
    },
    admissionFloorMatches: 200,
    generator: "scripts/positions/import-observations.ts@stratz-v2",
    rawSnapshotSha256: "deadbeefcafe0000000000000000000000000000000000000000000000000000",
  },
  heroes: [
    {
      hero: 1,
      totalPopulationMatches: 3000,
      totalKnownPositionMatches: 2950,
      unassignedMatches: 50,
      observations: [
        { position: 1, matches: 2500 },
        { position: 2, matches: 300 },
        { position: 3, matches: 150 }, // below the 200 floor
      ],
    },
    {
      hero: 2,
      totalPopulationMatches: 2100,
      totalKnownPositionMatches: 2050,
      unassignedMatches: 50,
      observations: [
        { position: 3, matches: 1900 },
        { position: 4, matches: 150 }, // below the 200 floor
      ],
    },
  ],
};

const LEGACY_FIXTURE = [
  { hero: 1, positions: [{ position: 1, matches: 1000 }] },
  { hero: 2, positions: [{ position: 3, matches: 500 }, { position: 4, matches: 300 }] },
];

function bytesOf(value: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(value));
}

describe("Wave 5 positional metadata twin -- deterministic generation", () => {
  test("1: twin sha256 equals the actual SHA-256 of the dataset bytes", () => {
    const bytes = bytesOf(V2_FIXTURE);
    const twin = buildPositionsMetadataTwin(DATASET_PATH, bytes);
    expect(twin.sha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  test("2: twin schema/format equal the dataset's own schema", () => {
    const v2 = buildPositionsMetadataTwin(DATASET_PATH, bytesOf(V2_FIXTURE));
    expect(v2.schema).toBe("hero-position-observations/v1");
    expect(v2.format).toBe("hero-position-observations/v1");

    const legacy = buildPositionsMetadataTwin(DATASET_PATH, bytesOf(LEGACY_FIXTURE));
    expect(legacy.schema).toBeNull();
    expect(legacy.format).toBe(LEGACY_FORMAT);
  });

  test("3: heroCount equals the actual dataset hero count", () => {
    expect(buildPositionsMetadataTwin(DATASET_PATH, bytesOf(V2_FIXTURE)).heroCount).toBe(2);
    expect(buildPositionsMetadataTwin(DATASET_PATH, bytesOf(LEGACY_FIXTURE)).heroCount).toBe(2);
  });

  test("4: observation row count equals the actual row count", () => {
    // hero 1: 3 rows, hero 2: 2 rows
    expect(buildPositionsMetadataTwin(DATASET_PATH, bytesOf(V2_FIXTURE)).observationRowCount).toBe(5);
    // legacy hero 1: 1 row, hero 2: 2 rows
    expect(buildPositionsMetadataTwin(DATASET_PATH, bytesOf(LEGACY_FIXTURE)).observationRowCount).toBe(3);
  });

  test("5: denominatorCorrected and population semantics agree with the dataset's structure", () => {
    const v2 = buildPositionsMetadataTwin(DATASET_PATH, bytesOf(V2_FIXTURE));
    expect(v2.denominatorCorrected).toBe(true);
    expect(v2.population).not.toBeNull();
    expect(v2.population!.totalPopulationMatches).toBe(5100);
    expect(v2.population!.totalKnownPositionMatches).toBe(5000);
    expect(v2.population!.totalUnassignedMatches).toBe(100);
    expect(v2.population!.identityVerifiedAgainstProvenance).toBe(true);
    expect(v2.belowFloorRowCount).toBe(2); // hero1 pos3 (150) + hero2 pos4 (150)

    const legacy = buildPositionsMetadataTwin(DATASET_PATH, bytesOf(LEGACY_FIXTURE));
    expect(legacy.denominatorCorrected).toBe(false);
    expect(legacy.population).toBeNull();
  });

  test("6: stale legacy D2PT-shaped metadata would fail a sync check against the real dataset", () => {
    // Approximates the actual stale twin this task set out to replace: wrong sha256, wrong
    // format, denominatorCorrected: false -- none of which describe the current v2 dataset.
    const staleD2ptTwin = {
      source: "dota2protracker.com/meta?position=pos+N (third-party site, manual headless-browser scrape)",
      format: "v1-floor-truncated",
      denominatorCorrected: false,
      sha256: "bc93884e1c733e05668c3627196c0901d9dca7ad0b15a337278bb35277047244",
      path: DATASET_PATH,
    };
    const bytes = bytesOf(V2_FIXTURE);
    const result = checkSync(DATASET_PATH, bytes, JSON.stringify(staleD2ptTwin));
    expect(result.inSync).toBe(false);
    expect(result.twin.denominatorCorrected).toBe(true);
    expect(result.twin.sha256).not.toBe(staleD2ptTwin.sha256);
  });

  test("7: changing the dataset without regenerating the twin is detected", () => {
    const originalBytes = bytesOf(V2_FIXTURE);
    const baseline = checkSync(DATASET_PATH, originalBytes, null);
    const inSyncWithItself = checkSync(DATASET_PATH, originalBytes, baseline.expectedText);
    expect(inSyncWithItself.inSync).toBe(true);

    const mutated = { ...V2_FIXTURE, heroes: [...V2_FIXTURE.heroes, { hero: 3, totalPopulationMatches: 10, totalKnownPositionMatches: 10, unassignedMatches: 0, observations: [{ position: 5, matches: 10 }] }] };
    const afterDrift = checkSync(DATASET_PATH, bytesOf(mutated), baseline.expectedText);
    expect(afterDrift.inSync).toBe(false);
  });

  test("8: running the generator twice over the same bytes produces byte-identical output", () => {
    const bytes = bytesOf(V2_FIXTURE);
    const first = serializeTwin(buildPositionsMetadataTwin(DATASET_PATH, bytes));
    const second = serializeTwin(buildPositionsMetadataTwin(DATASET_PATH, bytes));
    expect(first).toBe(second);
  });

  test("9: the serialized twin never carries secrets, and the generator source never reads process.env", () => {
    const twin = buildPositionsMetadataTwin(DATASET_PATH, bytesOf(V2_FIXTURE));
    const text = serializeTwin(twin);
    expect(text.toLowerCase()).not.toMatch(/api[_-]?key|password|secret|bearer\s/);

    const source = readFileSync(join(import.meta.dir, "metadata-twin.ts"), "utf8");
    expect(source).not.toContain("process.env");
  });

  test("10: no raw STRATZ payload or network access is required -- the generator only reads the frozen dataset", () => {
    // Building the twin needs nothing beyond the dataset bytes handed to it.
    expect(() => buildPositionsMetadataTwin(DATASET_PATH, bytesOf(V2_FIXTURE))).not.toThrow();

    const source = readFileSync(join(import.meta.dir, "metadata-twin.ts"), "utf8");
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");
    expect(codeOnly).not.toContain("fetch(");
    expect(codeOnly).not.toContain("STRATZ_API_KEY");
    expect(codeOnly).not.toContain("fetch-stratz");
  });
});
