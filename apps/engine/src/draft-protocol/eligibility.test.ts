import { describe, expect, test } from "bun:test";
import {
  acceptCmHeroEligibilitySnapshot,
  computeEligibilityContentHash,
  isHeroEligible,
  parseCmHeroEligibilitySnapshot,
  verifyEligibilitySnapshotIntegrity,
} from "./eligibility";
import type { CmHeroEligibilitySnapshot } from "./types";

function buildSnapshot(): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "1234567",
    depotManifests: { "570": "111" },
    sourceHashes: { npc_heroes: "abc123" },
    heroIds: [1, 2, 3],
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

describe("parseCmHeroEligibilitySnapshot", () => {
  test("acepta un snapshot bien formado", () => {
    expect(parseCmHeroEligibilitySnapshot(buildSnapshot())).not.toBeNull();
  });

  test.each([
    ["schema incorrecto", { ...buildSnapshot(), schema: "wrong" }],
    ["appId incorrecto", { ...buildSnapshot(), appId: 730 }],
    ["patch vacío", { ...buildSnapshot(), patch: "" }],
    ["heroIds vacío", { ...buildSnapshot(), heroIds: [] }],
    ["heroIds con duplicado", { ...buildSnapshot(), heroIds: [1, 1, 2] }],
    ["heroIds con cero", { ...buildSnapshot(), heroIds: [0, 1] }],
    ["depotManifests no es record de strings", { ...buildSnapshot(), depotManifests: { a: 1 } }],
    ["null", null],
    ["no objeto", "not-an-object"],
  ])("degrada a null: %s", (_label, raw) => {
    expect(parseCmHeroEligibilitySnapshot(raw)).toBeNull();
  });
});

describe("verifyEligibilitySnapshotIntegrity", () => {
  test("un snapshot con contentHash correcto verifica true", () => {
    expect(verifyEligibilitySnapshotIntegrity(buildSnapshot())).toBe(true);
  });

  test("un snapshot manipulado (heroIds cambiado, contentHash viejo) verifica false", () => {
    const tampered = { ...buildSnapshot(), heroIds: [1, 2, 3, 4] };
    expect(verifyEligibilitySnapshotIntegrity(tampered)).toBe(false);
  });
});

// Criterio 17: falta el snapshot de elegibilidad de CM -> fail closed.
describe("acceptCmHeroEligibilitySnapshot — fail closed", () => {
  test("snapshot ausente/null -> null (nunca certifica acciones de CM)", () => {
    expect(acceptCmHeroEligibilitySnapshot(null)).toBeNull();
    expect(acceptCmHeroEligibilitySnapshot(undefined)).toBeNull();
  });

  test("snapshot corrupto -> null, nunca lanza", () => {
    expect(() => acceptCmHeroEligibilitySnapshot({ schema: "cm-hero-eligibility/v1" })).not.toThrow();
    expect(acceptCmHeroEligibilitySnapshot({ schema: "cm-hero-eligibility/v1" })).toBeNull();
  });

  test("snapshot con hash manipulado -> null (integridad, no solo forma)", () => {
    const tampered = { ...buildSnapshot(), heroIds: [1, 2, 3, 999] };
    expect(acceptCmHeroEligibilitySnapshot(tampered)).toBeNull();
  });

  test("snapshot íntegro y bien formado -> aceptado", () => {
    const snapshot = buildSnapshot();
    expect(acceptCmHeroEligibilitySnapshot(snapshot)).toEqual(snapshot);
  });
});

describe("isHeroEligible", () => {
  test("héroe presente en heroIds es elegible", () => {
    expect(isHeroEligible(buildSnapshot(), 2)).toBe(true);
  });

  test("héroe ausente de heroIds no es elegible (nunca cae al catálogo global)", () => {
    expect(isHeroEligible(buildSnapshot(), 999)).toBe(false);
  });
});
