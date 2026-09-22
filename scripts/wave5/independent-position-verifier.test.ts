import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CERT_ADMISSION_MIN_SHARE,
  CERT_MID_MIN_MATCHES,
  CERT_MIN_POSITION_MATCHES,
  EXPECTED_OBSERVATIONS_SCHEMA,
  evaluateIndependentCredibility,
  validateHeroPopulationEntry,
  verifyHeroPositionCredibility,
  verifyPositionalDatasetCompleteness,
  type RawHeroEntry,
  type RawObservationsDataset,
} from "./independent-position-verifier";

describe("WAVE 5 Hardening (H4) -- independent positional certification verifier", () => {
  // RH-R1 Case 1: sum(P1..P5) would falsely produce >= 25% but totalPopulationMatches correctly produces < 25%
  test("RH-R1.1: uses totalPopulationMatches as denominator -- catches inflated share when sum(P1..P5) would falsely exceed 25%", () => {
    // Hero has:
    // Pos 1 (dominant): 700 matches
    // Pos 3 (secondary): 300 matches
    // sum(P1..P5) = 1000 matches.
    // If sum(P1..P5) were used: share = 300 / 1000 = 30% (falsely >= 25%!).
    //
    // In final A2 dataset with unassigned population matches = 500:
    // totalKnownPositionMatches = 1000
    // unassignedMatches = 500
    // totalPopulationMatches = 1500
    // True share = 300 / 1500 = 20% (< 25%), so Pos 3 is NOT admitted by share.
    const entry: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 1500,
      totalKnownPositionMatches: 1000,
      unassignedMatches: 500,
      observations: [
        { position: 1, matches: 700 },
        { position: 3, matches: 300 },
      ],
    };

    const result = evaluateIndependentCredibility(entry, 3);
    expect(result.heroTotalMatches).toBe(1500);
    expect(result.targetMatches).toBe(300);
    expect(result.dominantPosition).toBe(1);
    expect(result.positionShare).toBeCloseTo(300 / 1500, 4);
    expect(result.positionShare).toBeLessThan(CERT_ADMISSION_MIN_SHARE);
    expect(result.isCredible).toBe(false);
    expect(result.rejectionReason).toContain("Neither dominant nor >= 25% share");
  });

  // RH-R1 Case 2: totalPopulationMatches < totalKnownPositionMatches -> rejected
  test("RH-R1.2: totalPopulationMatches < totalKnownPositionMatches -> rejected as corrupt", () => {
    const entry: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 800,
      totalKnownPositionMatches: 1000,
      unassignedMatches: 0,
      observations: [
        { position: 1, matches: 600 },
        { position: 3, matches: 400 },
      ],
    };

    const result = evaluateIndependentCredibility(entry, 1);
    expect(result.isCredible).toBe(false);
    expect(result.rejectionReason).toContain("totalPopulationMatches (800) < totalKnownPositionMatches (1000)");

    const validation = validateHeroPopulationEntry(entry);
    expect(validation.valid).toBe(false);
    expect(validation.error).toContain("totalPopulationMatches (800) < totalKnownPositionMatches (1000)");
  });

  // RH-R1 Case 3: negative / inconsistent unassignedMatches -> rejected
  test("RH-R1.3: negative or inconsistent unassignedMatches -> rejected", () => {
    // 3A: negative unassignedMatches
    const negativeUnassigned: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 950,
      totalKnownPositionMatches: 1000,
      unassignedMatches: -50,
      observations: [{ position: 1, matches: 1000 }],
    };
    const negResult = evaluateIndependentCredibility(negativeUnassigned, 1);
    expect(negResult.isCredible).toBe(false);
    expect(negResult.rejectionReason).toContain("unassignedMatches (-50) must be >= 0");

    // 3B: inconsistent unassignedMatches (totalPopulation != totalKnown + unassigned)
    const inconsistent: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 1500,
      totalKnownPositionMatches: 1000,
      unassignedMatches: 200, // 1000 + 200 = 1200 != 1500
      observations: [{ position: 1, matches: 1000 }],
    };
    const incResult = evaluateIndependentCredibility(inconsistent, 1);
    expect(incResult.isCredible).toBe(false);
    expect(incResult.rejectionReason).toContain("population identity mismatch");
  });

  // RH-R1 Case 4: identity mismatch (known != sum(observations)) -> rejected
  test("RH-R1.4: totalKnownPositionMatches !== sum(observations) -> rejected", () => {
    const entry: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 1200,
      totalKnownPositionMatches: 900, // sum is 600 + 400 = 1000 != 900
      unassignedMatches: 300,
      observations: [
        { position: 1, matches: 600 },
        { position: 3, matches: 400 },
      ],
    };

    const result = evaluateIndependentCredibility(entry, 1);
    expect(result.isCredible).toBe(false);
    expect(result.rejectionReason).toContain("totalKnownPositionMatches (900) does not match sum of observations (1000)");
  });

  // RH-R1 Case 5: valid complete A2-style entry -> accepted
  test("RH-R1.5: valid complete A2-style entry -> accepted and share computed against totalPopulationMatches", () => {
    const entry: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 1600,
      totalKnownPositionMatches: 1500,
      unassignedMatches: 100,
      observations: [
        { position: 1, matches: 1000 },
        { position: 3, matches: 500 },
      ],
    };

    const result = evaluateIndependentCredibility(entry, 3);
    expect(result.isCredible).toBe(true);
    expect(result.heroTotalMatches).toBe(1600);
    expect(result.targetMatches).toBe(500);
    expect(result.positionShare).toBeCloseTo(500 / 1600, 4);
    expect(result.positionShare).toBeGreaterThanOrEqual(CERT_ADMISSION_MIN_SHARE);
    expect(result.rejectionReason).toBeUndefined();
  });

  // RH-R1 Case 6: dominant-position behavior remains correct
  test("RH-R1.6: dominant position admitted even if share of total population is < 25%", () => {
    // Dominant position with 1000 matches, but massive unassigned pool: totalPopulation = 5000.
    // Share = 1000 / 5000 = 20% < 25%.
    // Because Pos 1 is dominant, it must still be accepted.
    const entry: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 5000,
      totalKnownPositionMatches: 1300,
      unassignedMatches: 3700,
      observations: [
        { position: 1, matches: 1000 },
        { position: 3, matches: 300 },
      ],
    };

    const result = evaluateIndependentCredibility(entry, 1);
    expect(result.dominantPosition).toBe(1);
    expect(result.dominantMatches).toBe(1000);
    expect(result.positionShare).toBeCloseTo(1000 / 5000, 4);
    expect(result.isCredible).toBe(true);
  });

  test("enforces Mid absolute evidence floor (600 matches)", () => {
    // Pos 2 with 400 matches (clears base 200, but fails Mid floor 600)
    const entry: RawHeroEntry = {
      hero: 1,
      totalPopulationMatches: 500,
      totalKnownPositionMatches: 500,
      unassignedMatches: 0,
      observations: [
        { position: 2, matches: 400 },
        { position: 4, matches: 100 },
      ],
    };
    const result = evaluateIndependentCredibility(entry, 2);
    expect(result.isCredible).toBe(false);
    expect(result.rejectionReason).toContain(`below Mid floor ${CERT_MID_MIN_MATCHES}`);
  });

  // RH-R2: Real completeness validation tests
  describe("RH-R2: verifyPositionalDatasetCompleteness real completeness validation", () => {
    test("rejects legacy floor-truncated array datasets", () => {
      const legacyArray = [{ hero: 1, positions: [{ position: 1, matches: 1000 }] }];
      const res = verifyPositionalDatasetCompleteness(legacyArray);
      expect(res.valid).toBe(false);
      expect(res.format).toBe("v1-floor-truncated");
      expect(res.error).toContain("Legacy floor-truncated dataset");
    });

    test("schema name alone is NOT sufficient: fails if heroes lack denominator metadata", () => {
      const claimingV1WithoutDenominator: RawObservationsDataset = {
        schema: EXPECTED_OBSERVATIONS_SCHEMA,
        heroes: [
          {
            hero: 1,
            // @ts-expect-error simulating legacy/corrupt object missing denominator fields
            observations: [{ position: 1, matches: 1000 }],
          },
        ],
      };
      const res = verifyPositionalDatasetCompleteness(claimingV1WithoutDenominator);
      expect(res.valid).toBe(false);
      expect(res.format).toBe("hero-position-observations/v1");
      expect(res.error).toContain("missing or non-integer denominator metadata");
    });

    test("fails if any hero has invalid population identities", () => {
      const corruptIdentity: RawObservationsDataset = {
        schema: EXPECTED_OBSERVATIONS_SCHEMA,
        heroes: [
          {
            hero: 1,
            totalPopulationMatches: 1000,
            totalKnownPositionMatches: 900,
            unassignedMatches: 50, // 900 + 50 = 950 != 1000
            observations: [{ position: 1, matches: 900 }],
          },
        ],
      };
      const res = verifyPositionalDatasetCompleteness(corruptIdentity);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("population identity mismatch");
    });

    test("fails if any hero has totalPopulationMatches < totalKnownPositionMatches", () => {
      const underflow: RawObservationsDataset = {
        schema: EXPECTED_OBSERVATIONS_SCHEMA,
        heroes: [
          {
            hero: 1,
            totalPopulationMatches: 500,
            totalKnownPositionMatches: 600,
            unassignedMatches: 0,
            observations: [{ position: 1, matches: 600 }],
          },
        ],
      };
      const res = verifyPositionalDatasetCompleteness(underflow);
      expect(res.valid).toBe(false);
      expect(res.error).toContain("totalPopulationMatches (500) < totalKnownPositionMatches (600)");
    });

    test("accepts complete valid A2 dataset", () => {
      const validA2: RawObservationsDataset = {
        schema: EXPECTED_OBSERVATIONS_SCHEMA,
        heroes: [
          {
            hero: 1,
            totalPopulationMatches: 1600,
            totalKnownPositionMatches: 1500,
            unassignedMatches: 100,
            observations: [
              { position: 1, matches: 1000 },
              { position: 3, matches: 500 },
            ],
          },
        ],
      };
      const res = verifyPositionalDatasetCompleteness(validA2);
      expect(res.valid).toBe(true);
      expect(res.format).toBe("hero-position-observations/v1");

      const cred = verifyHeroPositionCredibility(validA2, 1, 1);
      expect(cred.isCredible).toBe(true);
      expect(cred.heroTotalMatches).toBe(1600);
    });

    test("rejects invalid schema or malformed root", () => {
      expect(verifyPositionalDatasetCompleteness(null).valid).toBe(false);
      expect(verifyPositionalDatasetCompleteness("str").valid).toBe(false);
      expect(verifyPositionalDatasetCompleteness({ schema: "other/v1" }).valid).toBe(false);
      expect(verifyPositionalDatasetCompleteness({ schema: EXPECTED_OBSERVATIONS_SCHEMA, heroes: [] }).valid).toBe(false);
    });
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
