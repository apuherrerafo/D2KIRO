import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CERT_ADMISSION_MIN_SHARE,
  CERT_MID_MIN_MATCHES,
  CERT_MIN_POSITION_MATCHES,
  EXPECTED_OBSERVATIONS_SCHEMA,
  evaluateIndependentCredibility,
  verifyHeroPositionCredibility,
  verifyPositionalDatasetCompleteness,
  type RawObservationsDataset,
} from "./independent-position-verifier";

describe("WAVE 5 Hardening (H4) -- independent positional certification verifier", () => {
  test("catches inflated secondary-position share caused by omitted counts", () => {
    // A hero has:
    // Pos 1 (dominant): 1000 matches
    // Pos 3 (secondary): 350 matches
    // Pos 2, 4, 5 (sub-floor): 150 matches each = 450 matches
    // Total true matches = 1800.
    //
    // In a floor-truncated dataset where counts < 200 were omitted:
    // Surviving matches = 1000 + 350 = 1350.
    // Inflated share = 350 / 1350 = 25.93% (falsely >= 25%!).
    const truncatedObservations = [
      { position: 1 as const, matches: 1000 },
      { position: 3 as const, matches: 350 },
    ];
    const completeObservations = [
      { position: 1 as const, matches: 1000 },
      { position: 3 as const, matches: 350 },
      { position: 2 as const, matches: 150 },
      { position: 4 as const, matches: 150 },
      { position: 5 as const, matches: 150 },
    ];

    // Truncated observations inflate share to 25.9%
    const truncatedResult = evaluateIndependentCredibility(truncatedObservations, 3);
    expect(truncatedResult.positionShare).toBeGreaterThan(0.25);
    expect(truncatedResult.isCredible).toBe(true);

    // Complete denominator reveals true share is 19.44% (< 25%), so Pos 3 is NOT credible
    const completeResult = evaluateIndependentCredibility(completeObservations, 3);
    expect(completeResult.heroTotalMatches).toBe(1800);
    expect(completeResult.positionShare).toBeCloseTo(350 / 1800, 4);
    expect(completeResult.positionShare).toBeLessThan(0.25);
    expect(completeResult.isCredible).toBe(false);
    expect(completeResult.rejectionReason).toContain("Neither dominant nor >= 25% share");
  });

  test("catches a true >=25% secondary position", () => {
    // Hero with 1000 Pos 1, 500 Pos 3, and 3x 50 matches in Pos 2, 4, 5.
    // Total = 1650.
    // Pos 3 share = 500 / 1650 = 30.3% >= 25%.
    const observations = [
      { position: 1 as const, matches: 1000 },
      { position: 3 as const, matches: 500 },
      { position: 2 as const, matches: 50 },
      { position: 4 as const, matches: 50 },
      { position: 5 as const, matches: 50 },
    ];
    const result = evaluateIndependentCredibility(observations, 3);
    expect(result.heroTotalMatches).toBe(1650);
    expect(result.dominantPosition).toBe(1);
    expect(result.positionShare).toBeCloseTo(500 / 1650, 4);
    expect(result.positionShare).toBeGreaterThanOrEqual(CERT_ADMISSION_MIN_SHARE);
    expect(result.isCredible).toBe(true);
  });

  test("catches a <25% secondary position", () => {
    // Hero with 1000 Pos 1, 300 Pos 3, and 3x 50 matches in Pos 2, 4, 5.
    // Total = 1450.
    // Pos 3 share = 300 / 1450 = 20.69% < 25%.
    const observations = [
      { position: 1 as const, matches: 1000 },
      { position: 3 as const, matches: 300 },
      { position: 2 as const, matches: 50 },
      { position: 4 as const, matches: 50 },
      { position: 5 as const, matches: 50 },
    ];
    const result = evaluateIndependentCredibility(observations, 3);
    expect(result.heroTotalMatches).toBe(1450);
    expect(result.dominantPosition).toBe(1);
    expect(result.positionShare).toBeCloseTo(300 / 1450, 4);
    expect(result.positionShare).toBeLessThan(CERT_ADMISSION_MIN_SHARE);
    expect(result.isCredible).toBe(false);
  });

  test("validates dominant position regardless of share", () => {
    // Pos 1 is dominant (1000 matches)
    const observations = [
      { position: 1 as const, matches: 1000 },
      { position: 3 as const, matches: 300 },
      { position: 2 as const, matches: 50 },
    ];
    const result = evaluateIndependentCredibility(observations, 1);
    expect(result.dominantPosition).toBe(1);
    expect(result.isCredible).toBe(true);
  });

  test("enforces Mid absolute evidence floor (600 matches)", () => {
    // Pos 2 with 400 matches (clears base 200, but fails Mid floor 600)
    const observations = [
      { position: 2 as const, matches: 400 },
      { position: 4 as const, matches: 100 },
    ];
    const result = evaluateIndependentCredibility(observations, 2);
    expect(result.isCredible).toBe(false);
    expect(result.rejectionReason).toContain(`below Mid floor ${CERT_MID_MIN_MATCHES}`);
  });

  test("legacy / incomplete dataset rejection", () => {
    // 1. Array-based v1 legacy dataset
    const legacyArray = [{ hero: 1, positions: [{ position: 1, matches: 1000 }] }];
    const arrayCheck = verifyPositionalDatasetCompleteness(legacyArray);
    expect(arrayCheck.valid).toBe(false);
    expect(arrayCheck.format).toBe("v1-floor-truncated");
    expect(arrayCheck.error).toContain("Legacy floor-truncated dataset");

    // 2. Missing or incorrect schema
    const invalidSchema = { schema: "wrong/v1", heroes: [] };
    const schemaCheck = verifyPositionalDatasetCompleteness(invalidSchema);
    expect(schemaCheck.valid).toBe(false);
    expect(schemaCheck.error).toContain(`expected "${EXPECTED_OBSERVATIONS_SCHEMA}"`);

    // 3. Null or non-object
    expect(verifyPositionalDatasetCompleteness(null).valid).toBe(false);
    expect(verifyPositionalDatasetCompleteness("string").valid).toBe(false);

    // 4. Valid v2 dataset
    const validV2: RawObservationsDataset = {
      schema: EXPECTED_OBSERVATIONS_SCHEMA,
      heroes: [
        {
          hero: 1,
          observations: [
            { position: 1, matches: 1000 },
            { position: 3, matches: 500 },
          ],
        },
      ],
    };
    const validCheck = verifyPositionalDatasetCompleteness(validV2);
    expect(validCheck.valid).toBe(true);
    expect(validCheck.format).toBe("hero-position-observations/v1");

    // Integration check: verifyHeroPositionCredibility on valid dataset
    const cred = verifyHeroPositionCredibility(validV2, 1, 1);
    expect(cred.isCredible).toBe(true);

    // Integration check: verifyHeroPositionCredibility on legacy dataset
    const credLegacy = verifyHeroPositionCredibility(legacyArray, 1, 1);
    expect(credLegacy.isCredible).toBe(false);
    expect(credLegacy.rejectionReason).toContain("Legacy floor-truncated");
  });

  test("ARCHITECTURE GUARD: verifier does NOT import or call production admission helpers", () => {
    const verifierPath = join(import.meta.dir, "independent-position-verifier.ts");
    const source = readFileSync(verifierPath, "utf8");
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\/|\/\/.*/g, "");

    // The verifier must not import or call any of the three production helpers:
    expect(codeOnly).not.toContain("isCredibleForPosition");
    expect(codeOnly).not.toContain("credibleHeroesForPosition");
    expect(codeOnly).not.toContain("personalCandidateUniverse");

    // Contract assertions: constants match production specifications
    expect(CERT_MIN_POSITION_MATCHES).toBe(200);
    expect(CERT_MID_MIN_MATCHES).toBe(600);
    expect(CERT_ADMISSION_MIN_SHARE).toBe(0.25);
  });
});
