import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildSuggestions } from "../signals/mix";
import type { DraftState } from "../draft/reducer";
import type { HeroCapabilities } from "../draft-paths/types";
import type { MetaSnapshot, SignalContribution } from "../signals/types";
import type { RoleBeliefEvidence } from "../draft-protocol/roles/role-belief";
import type { RulesetIdentity } from "../draft-protocol/types";
import {
  deriveRisks,
  evidenceFromEligibility,
  evidenceFromRoleBelief,
  evidenceFromRuleset,
  evidenceFromSignals,
  evidenceIdentityHash,
  type FunctionalRecommendationEvidence,
} from "./evidence";

function signal(overrides: Partial<SignalContribution> = {}): SignalContribution {
  return { signal: "counter", raw: 0.05, weighted: 2.5, explanation: "fixture explanation", sampleSize: 100, ...overrides };
}

describe("structured evidence", () => {
  test("traces each signal and preserves raw:null honestly", () => {
    const items = evidenceFromSignals(1, [signal(), signal({ raw: null, normalized: 42 })]);
    expect(items[0]!.reason).toBe("fixture explanation");
    expect(items[1]!.value).toBe(42);
  });

  test("keeps role, ruleset, and eligibility provenance", () => {
    const role: RoleBeliefEvidence[] = [{ kind: "HERO_PATCH_DISTRIBUTION", detail: "historical distribution" }];
    expect(evidenceFromRoleBelief(7, role)[0]!.source).toBe("role-belief");
    const ruleset: RulesetIdentity = { id: "dota2/ranked-all-pick", version: "1.0.0", rulesHash: "hash-123", applicableFromPatch: "7.40", verifiedThroughPatch: "7.41e", sourceManifestHash: "manifest-hash" };
    expect(evidenceFromRuleset(ruleset).value).toBe("hash-123");
    expect(evidenceFromEligibility("content-hash", 120).value).toBe("content-hash");
  });
});

function state(banned: number[] = []): DraftState {
  return {
    sessionId: "s1", schema: "draft-state/v1", format: "all_pick", patch: "7.41e", localSide: "radiant", phase: "active",
    banned, picks: { radiant: [], dire: [] }, lastSeq: 1, appliedEventIds: [], quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-09-15T00:00:00Z", firstPickSide: null, turnStartedAt: null, reserveRemainingMs: null,
  };
}

function snapshot(heroIds: number[], matchups: MetaSnapshot["matchups"] = {}): MetaSnapshot {
  return { heroes: Object.fromEntries(heroIds.map((hero) => [hero, { id: hero, localizedName: `Hero ${hero}` }])), matchups };
}

function functional(set: ReturnType<typeof buildSuggestions>): FunctionalRecommendationEvidence {
  expect(set.functionalEvidence).toBeDefined();
  return set.functionalEvidence!;
}

function opening(heroIds: number[], capabilities: HeroCapabilities[], options: Parameters<typeof buildSuggestions>[2] = {}, meta = snapshot(heroIds)) {
  return buildSuggestions(state(), meta, { teamOpening: true, heroPositions: {}, heroCapabilities: capabilities, heroCounters: new Map(), ...options });
}

describe("evidenceIdentityHash -- complete functional inputs", () => {
  test("same-score capability reason change changes identity without hashing the final reason", () => {
    const absent = opening([1], []);
    const push = opening([1], [{ hero: 1, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" }]);
    expect(absent.suggestions[0]!.score).toBe(push.suggestions[0]!.score);
    expect(absent.suggestions[0]!.reason).not.toBe(push.suggestions[0]!.reason);
    expect(evidenceIdentityHash(functional(absent))).not.toBe(evidenceIdentityHash(functional(push)));
  });

  test("meta stale changes confidence/degradation/risk inputs and identity", () => {
    const positionEvidence = { heroPositions: { 1: [{ position: 1 as const, matches: 1000 }] } };
    const fresh = opening([1], [], positionEvidence);
    const stale = opening([1], [], { ...positionEvidence, metaIsStale: true });
    expect(fresh.suggestions[0]!.confidence).toBe("alta");
    expect(stale.suggestions[0]!.confidence).toBe("media");
    expect(stale.degraded).toContain("stale_meta");
    expect(evidenceIdentityHash(functional(fresh))).not.toBe(evidenceIdentityHash(functional(stale)));
  });

  test("same numeric ban relief with a different counter source changes identity", () => {
    const matchupsA = { 1: [{ vsHero: 2, games: 200, wins: 76 }] }; // relief 0.12
    const matchupsB = { 1: [{ vsHero: 3, games: 200, wins: 76 }] }; // same relief, distinct cause
    const a = buildSuggestions(state([2, 3]), snapshot([1, 2, 3], matchupsA), { teamOpening: true, heroPositions: {}, heroCapabilities: [], heroCounters: new Map() });
    const b = buildSuggestions(state([2, 3]), snapshot([1, 2, 3], matchupsB), { teamOpening: true, heroPositions: {}, heroCapabilities: [], heroCounters: new Map() });
    expect(a.suggestions[0]!.score).toBe(b.suggestions[0]!.score);
    expect(a.suggestions[0]!.reason).not.toBe(b.suggestions[0]!.reason);
    expect(evidenceIdentityHash(functional(a))).not.toBe(evidenceIdentityHash(functional(b)));
  });

  test("the original ranking attack changes identity through capabilities, not final order", () => {
    const a = opening([1, 2, 3, 4, 5, 6], []);
    const b = opening([1, 2, 3, 4, 5, 6], [{ hero: 3, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" }]);
    expect(a.suggestions.map((s) => s.hero)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(b.suggestions.map((s) => s.hero)).toEqual([1, 3, 2, 4, 5, 6]);
    expect(evidenceIdentityHash(functional(a))).not.toBe(evidenceIdentityHash(functional(b)));
  });

  test("canonicalizes non-semantic capability, signal, and matchup insertion order", () => {
    const base = functional(opening([1, 2], [
      { hero: 1, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
      { hero: 2, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: true, structuralDamage: "low", teamfight: "high", scaling: "low" },
    ]));
    const reordered: FunctionalRecommendationEvidence = {
      ...base,
      signalEvidence: base.signalEvidence.map((candidate) => ({ ...candidate, signals: [...candidate.signals].reverse() })).reverse(),
      heroPositions: [...base.heroPositions].reverse(),
      teamOpening: base.teamOpening && { ...base.teamOpening, heroCapabilities: [...base.teamOpening.heroCapabilities].reverse(), matchups: [...base.teamOpening.matchups].reverse(), curatedCounters: [...base.teamOpening.curatedCounters].reverse() },
    };
    expect(evidenceIdentityHash(base)).toBe(evidenceIdentityHash(reordered));
  });

  test("runtime and transport noise never move identity", () => {
    const evidence = functional(opening([1], []));
    const noisy = {
      ...JSON.parse(JSON.stringify(evidence)),
      computedInMs: 12345,
      timestamp: "2099-01-01T00:00:00.000Z",
      sessionId: "other-session",
      requestId: "other-request",
      transport: { traceId: "other-trace" },
    } as FunctionalRecommendationEvidence;
    expect(evidenceIdentityHash(evidence)).toBe(evidenceIdentityHash(noisy));
  });

  test("API-level guard: evidenceIdentityHash accepts only FunctionalRecommendationEvidence", () => {
    const source = readFileSync(join(__dirname, "evidence.ts"), "utf8");
    expect(source).not.toMatch(/evidenceIdentityHash\(suggestionSet/i);
    expect(source).not.toMatch(/import type \{ SuggestionSet \}/);
  });
});

describe("deriveRisks", () => {
  test("names existing low-evidence, unresolved-role, and stale-meta conditions", () => {
    const risks = deriveRisks("baja", [{ status: "UNRESOLVED", position: null, marginals: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 }, entropy: 2.32 }], true);
    expect(risks.map((risk) => risk.kind)).toEqual(["low_evidence", "unresolved_role", "degraded_meta"]);
  });
});
