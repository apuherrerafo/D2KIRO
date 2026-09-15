import { describe, expect, test } from "bun:test";
import type { SuggestionSet } from "../signals/mix";
import type { SignalContribution } from "../signals/types";
import type { RoleBeliefEvidence } from "../draft-protocol/roles/role-belief";
import type { RulesetIdentity } from "../draft-protocol/types";
import {
  deriveRisks,
  evidenceFromEligibility,
  evidenceFromRoleBelief,
  evidenceFromRuleset,
  evidenceFromSignals,
  evidenceIdentityHash,
} from "./evidence";

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

function fixtureSuggestionSet(overrides: Partial<SuggestionSet["suggestions"][number]["signals"][number]> = {}): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "s",
    basedOnSeq: 0,
    decisionContext: "team_opening",
    suggestions: [
      {
        hero: 1,
        rank: 1,
        score: 100,
        signals: [{ signal: "counter", raw: 0.05, weighted: 3, explanation: "x", sampleSize: 50, normalized: 60, evidenceConfidence: 0.8, ...overrides }],
        reason: "r",
        confidence: "alta",
        evidenceCoverage: 0.9,
        guessingIndex: 0.1,
      },
    ],
    comparison: null,
    degraded: [],
    computedInMs: 5,
  };
}

describe("evidenceIdentityHash -- blocker 7: identidad funcional de la evidencia real de V6", () => {
  test("mismos raw/normalized/evidenceConfidence -> mismo hash", () => {
    expect(evidenceIdentityHash(fixtureSuggestionSet())).toBe(evidenceIdentityHash(fixtureSuggestionSet()));
  });

  test("un raw distinto (la evidencia real cambió) -> hash distinto", () => {
    expect(evidenceIdentityHash(fixtureSuggestionSet({ raw: 0.99 }))).not.toBe(evidenceIdentityHash(fixtureSuggestionSet()));
  });

  test("computedInMs (metadata de runtime) nunca se lee -- dos SuggestionSet con distinto computedInMs pero misma evidencia -> mismo hash", () => {
    const a = fixtureSuggestionSet();
    const b = { ...fixtureSuggestionSet(), computedInMs: 999 };
    expect(evidenceIdentityHash(a)).toBe(evidenceIdentityHash(b));
  });

  test("orden de suggestions/signals (p. ej. por diversitySeed) no mueve el hash -- se ordena canónicamente por hero y por señal", () => {
    const a = fixtureSuggestionSet();
    const reordered: SuggestionSet = { ...a, suggestions: [...a.suggestions].reverse() };
    expect(evidenceIdentityHash(a)).toBe(evidenceIdentityHash(reordered));
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
