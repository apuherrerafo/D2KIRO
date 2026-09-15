import { describe, expect, test } from "bun:test";
import type { SignalContribution } from "../signals/types";
import type { RoleBeliefEvidence } from "../draft-protocol/roles/role-belief";
import type { RulesetIdentity } from "../draft-protocol/types";
import { deriveRisks, evidenceFromEligibility, evidenceFromRoleBelief, evidenceFromRuleset, evidenceFromSignals } from "./evidence";

function signal(overrides: Partial<SignalContribution> = {}): SignalContribution {
  return { signal: "counter", raw: 0.05, weighted: 2.5, explanation: "fixture explanation", sampleSize: 100, ...overrides };
}

describe("evidenceFromSignals -- cada item traza a un SignalContribution real", () => {
  test("un item por señal, con el reason tomado verbatim de explanation (nunca inventado)", () => {
    const items = evidenceFromSignals(1, [signal({ signal: "counter" }), signal({ signal: "patch_meta", raw: null })]);
    expect(items).toHaveLength(2);
    expect(items[0]!.subject).toBe(1);
    expect(items[0]!.signal).toBe("counter");
    expect(items[0]!.reason).toBe("fixture explanation");
    expect(items[0]!.contribution).toBe(2.5);
  });

  test("raw null cae a normalized si existe, nunca se inventa un 0/0.5", () => {
    const items = evidenceFromSignals(1, [signal({ raw: null, normalized: 42 })]);
    expect(items[0]!.value).toBe(42);
  });

  test("raw y normalized ambos null -> value null, nunca un número fabricado", () => {
    const items = evidenceFromSignals(1, [signal({ raw: null, normalized: null })]);
    expect(items[0]!.value).toBeNull();
  });
});

describe("evidenceFromRoleBelief", () => {
  test("mapea cada RoleBeliefEvidence a un EvidenceItem con source role-belief", () => {
    const entries: RoleBeliefEvidence[] = [{ kind: "HERO_PATCH_DISTRIBUTION", detail: "distribución histórica" }];
    const items = evidenceFromRoleBelief(7, entries);
    expect(items).toHaveLength(1);
    expect(items[0]!.source).toBe("role-belief");
    expect(items[0]!.subject).toBe(7);
    expect(items[0]!.value).toBe("HERO_PATCH_DISTRIBUTION");
    expect(items[0]!.contribution).toBeNull();
  });
});

describe("evidenceFromRuleset / evidenceFromEligibility -- provenance, sin subject de héroe", () => {
  test("evidenceFromRuleset expone rulesHash como value verificable", () => {
    const ruleset: RulesetIdentity = {
      id: "dota2/ranked-all-pick",
      version: "1.0.0",
      rulesHash: "hash-123",
      applicableFromPatch: "7.40",
      verifiedThroughPatch: "7.41e",
      sourceManifestHash: "manifest-hash",
    };
    const item = evidenceFromRuleset(ruleset);
    expect(item.subject).toBeNull();
    expect(item.value).toBe("hash-123");
  });

  test("evidenceFromEligibility expone el contentHash certificado", () => {
    const item = evidenceFromEligibility("content-hash-abc", 120);
    expect(item.value).toBe("content-hash-abc");
    expect(item.reason).toContain("120");
  });
});

describe("deriveRisks -- reutiliza los umbrales YA congelados de V6, no inventa uno nuevo", () => {
  test("confianza baja (umbral existente de evidenceCoverage en mix.ts) produce low_evidence", () => {
    const risks = deriveRisks("baja", [], false);
    expect(risks.some((r) => r.kind === "low_evidence")).toBe(true);
  });

  test("confianza alta sin roles UNRESOLVED y meta fresca -> sin riesgos", () => {
    const risks = deriveRisks("alta", [{ status: "LIKELY", position: 1, marginals: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 }, entropy: 0 }], false);
    expect(risks).toHaveLength(0);
  });

  test("rol UNRESOLVED produce unresolved_role", () => {
    const risks = deriveRisks("alta", [{ status: "UNRESOLVED", position: null, marginals: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 }, entropy: 2.32 }], false);
    expect(risks.some((r) => r.kind === "unresolved_role")).toBe(true);
  });

  test("meta stale produce degraded_meta", () => {
    const risks = deriveRisks("alta", [], true);
    expect(risks.some((r) => r.kind === "degraded_meta")).toBe(true);
  });
});
