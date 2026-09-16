import { describe, expect, test } from "bun:test";
import {
  deterministicGoldenStatus,
  qualityGoldenStatus,
  REQUIRED_FIXTURE_COUNT,
  REQUIRED_QUALITY_COUNT,
  type DeterministicFixturesStatus,
  type QualityCasesStatus,
} from "./golden-status";

// R1 S7 (final blocker repair, Blocker 2) -- these tests inject status objects directly (never
// touch the real docs/r1/golden/*.json manifests) to prove the pure decision functions certify.ts
// depends on. The bug being fixed: a missing/unresolved deterministic fixture used to get
// laundered into "HUMAN_GATE" one layer up (golden-status.ts's old `overall` computation mixed
// both halves together) -- deterministicGoldenStatus() must be FAIL, unconditionally, independent
// of qualityCases, whenever the deterministic half isn't exactly 28/28 resolved.

function fixtures(overrides: Partial<DeterministicFixturesStatus> = {}): DeterministicFixturesStatus {
  return {
    found: true,
    totalSlots: REQUIRED_FIXTURE_COUNT,
    existingEquivalent: REQUIRED_FIXTURE_COUNT,
    missing: 0,
    unresolved: 0,
    completeCount: true,
    ...overrides,
  };
}

function quality(overrides: Partial<QualityCasesStatus> = {}): QualityCasesStatus {
  return {
    found: true,
    totalSlots: REQUIRED_QUALITY_COUNT,
    reviewedCount: REQUIRED_QUALITY_COUNT,
    llmLabelCount: 0,
    status: "COMPLETE",
    ...overrides,
  };
}

describe("deterministicGoldenStatus -- 28/28 exacto, resuelto, es el único PASS", () => {
  test("28/28, todo existing_equivalent y resuelto -> PASS", () => {
    expect(deterministicGoldenStatus(fixtures())).toBe("PASS");
  });

  // The exact regression the mandate demands: one fixture missing (27/28) must FAIL, never
  // HUMAN_GATE -- simulated purely via injected data, the real manifest is never touched.
  test("27/28 (un fixture genuinamente 'missing') -> FAIL", () => {
    const status = fixtures({ totalSlots: 28, existingEquivalent: 27, missing: 1 });
    expect(deterministicGoldenStatus(status)).toBe("FAIL");
  });

  test("28 slots pero una referencia a un test que no existe/no resuelve (unresolved: 1) -> FAIL", () => {
    const status = fixtures({ existingEquivalent: 27, unresolved: 1 });
    expect(deterministicGoldenStatus(status)).toBe("FAIL");
  });

  test("manifiesto ausente/malformado (found: false) -> FAIL", () => {
    const status = fixtures({ found: false, totalSlots: 0, existingEquivalent: 0, missing: 0, unresolved: 0, completeCount: false });
    expect(deterministicGoldenStatus(status)).toBe("FAIL");
  });

  test("29 slots (manifiesto con un slot de más) -> FAIL, aunque todos resuelvan", () => {
    const status = fixtures({ totalSlots: 29, existingEquivalent: 29 });
    expect(deterministicGoldenStatus(status)).toBe("FAIL");
  });
});

describe("qualityGoldenStatus -- independiente de deterministicGoldenStatus", () => {
  test("32/32 revisados -> PASS", () => {
    expect(qualityGoldenStatus(quality())).toBe("PASS");
  });

  test("template presente pero con revisiones pendientes -> HUMAN_GATE", () => {
    expect(qualityGoldenStatus(quality({ reviewedCount: 10, status: "HUMAN_GATE" }))).toBe("HUMAN_GATE");
  });

  test("template ausente/malformado -> FAIL, nunca HUMAN_GATE", () => {
    expect(qualityGoldenStatus(quality({ found: false, totalSlots: 0, reviewedCount: 0, status: "MISSING" }))).toBe("FAIL");
  });
});
