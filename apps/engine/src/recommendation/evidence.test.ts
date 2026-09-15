import { describe, expect, test } from "bun:test";
import { buildSuggestions } from "../signals/mix";
import type { SuggestionSet } from "../signals/mix";
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

// Final evidence-identity repair -- fixtures with MULTIPLE suggestions, needed because the old
// single-suggestion fixture above can't distinguish "per-signal grouping order" (still
// hero-sorted, still irrelevant) from "overall suggestion sequence order" (now functional
// evidence -- see evidence.ts's header doc on `sequence`).
function multiSuggestionSet(scores: Record<number, number> = { 1: 100, 2: 90, 3: 80 }): SuggestionSet {
  const heroes = Object.keys(scores).map(Number);
  return {
    schema: "suggestions/v1",
    sessionId: "s",
    basedOnSeq: 0,
    decisionContext: "team_opening",
    suggestions: heroes.map((hero) => ({
      hero,
      rank: (heroes.indexOf(hero) + 1) as 1 | 2 | 3,
      score: scores[hero]!,
      signals: [{ signal: "counter" as const, raw: 0.05, weighted: 3, explanation: "x", sampleSize: 50, normalized: 60, evidenceConfidence: 0.8 }],
      reason: "r",
      confidence: "alta" as const,
      evidenceCoverage: 0.9,
      guessingIndex: 0.1,
    })),
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

  test("sessionId/basedOnSeq (metadata de transporte, no evidencia) nunca se leen -- mismo hash", () => {
    const a = fixtureSuggestionSet();
    const b = { ...fixtureSuggestionSet(), sessionId: "otra-sesion", basedOnSeq: 42 };
    expect(evidenceIdentityHash(a)).toBe(evidenceIdentityHash(b));
  });

  test("reordenar signals[] DENTRO de una misma suggestion no mueve el hash -- se ordena canónicamente por señal", () => {
    const a = fixtureSuggestionSet();
    const withExtraSignal: SuggestionSet = {
      ...a,
      suggestions: [{ ...a.suggestions[0]!, signals: [...a.suggestions[0]!.signals, { signal: "patch_meta", raw: null, weighted: 0, explanation: "y", sampleSize: 0, normalized: null, evidenceConfidence: 0 }] }],
    };
    const reversedSignals: SuggestionSet = {
      ...withExtraSignal,
      suggestions: [{ ...withExtraSignal.suggestions[0]!, signals: [...withExtraSignal.suggestions[0]!.signals].reverse() }],
    };
    expect(evidenceIdentityHash(withExtraSignal)).toBe(evidenceIdentityHash(reversedSignals));
  });

  // Final evidence-identity repair -- the ORIGINAL single-suggestion fixture made "orden de
  // suggestions no mueve el hash" trivially true (reversing one element changes nothing), which
  // hid the real bug: `evidenceIdentityHash` sorted by hero and dropped which SEQUENCE V6 actually
  // returned. With genuinely different per-hero scores, order IS functional evidence now (team-
  // opening's ban-relief + strategy-diversity pass changes rank/score without touching any
  // `SignalContribution`) -- reversing a real ranking must change the hash, not survive it.
  test("reordenar el arreglo de suggestions con scores distintos SÍ mueve el hash -- ya no es ruido de diversitySeed, es orden real de V6", () => {
    const a = multiSuggestionSet({ 1: 100, 2: 90, 3: 80 });
    const reordered: SuggestionSet = { ...a, suggestions: [...a.suggestions].reverse() };
    expect(evidenceIdentityHash(a)).not.toBe(evidenceIdentityHash(reordered));
  });
});

// R1 S5 final evidence-identity repair -- adversarial reproduction of the exact blocker the
// second independent review reported: same state/patch/party/seed/signal evidence, but changing
// `HeroCapabilities` (consumed only by team-opening's `openingStrategy` -> `recommendTeamOpeners`,
// never by a `SignalContribution`) reordered the final ranking while `basedOn`'s evidence identity
// stayed byte-identical. `build.ts` is `evidenceIdentityHash`'s only caller and always requests
// `computeSuggestions(..., { teamOpening: true })`, so this drives the REAL `buildSuggestions`
// team-opening path -- not a hand-built `SuggestionSet` fixture -- to prove the fix closes the gap
// at the actual mechanism, not just at the hash function in isolation.
describe("evidenceIdentityHash -- team-opening (HeroCapabilities-driven) functional inputs", () => {
  // 6 candidates, no bans/picks/patch data/personal pool/archetype intent -> every SignalScorer
  // (counter/team_synergy/archetype_fit/hero_pool_fit short-circuit on "no data yet"; position_fit
  // has no entry for any of the 6 heroes) returns the SAME raw/normalized/evidenceConfidence for
  // every hero regardless of HeroCapabilities -- isolating strategy/repeat-penalty as the ONLY
  // possible source of any difference between the two runs below.
  function state(): DraftState {
    return {
      sessionId: "s1",
      schema: "draft-state/v1",
      format: "all_pick",
      patch: "7.41e",
      localSide: "radiant",
      phase: "active",
      banned: [],
      picks: { radiant: [], dire: [] },
      lastSeq: 1,
      appliedEventIds: [],
      quality: { unconfirmed: [], captureStatus: "ok" },
      updatedAt: "2026-09-15T00:00:00Z",
      firstPickSide: null,
      turnStartedAt: null,
      reserveRemainingMs: null,
    };
  }

  function snapshot(): MetaSnapshot {
    return {
      heroes: Object.fromEntries([1, 2, 3, 4, 5, 6].map((hero) => [hero, { id: hero, localizedName: `Hero ${hero}` }])),
      matchups: {},
    };
  }

  function teamOpeningSet(capabilities: HeroCapabilities[]): SuggestionSet {
    return buildSuggestions(state(), snapshot(), { teamOpening: true, heroPositions: {}, heroCapabilities: capabilities, heroCounters: new Map() });
  }

  const CAPABILITIES_A: HeroCapabilities[] = [];
  // Only hero 3 gets a real capabilities entry, with structuralDamage "high" -> openingStrategy
  // labels it "push", the ONE bucket distinct from every other hero's null-derived "scaling"
  // default (team-opener.ts's own `strategy ?? "scaling"` bucketing). Every other functional input
  // (state/patch/party/seed/signals) is identical to CAPABILITIES_A.
  const CAPABILITIES_B: HeroCapabilities[] = [
    { hero: 3, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
  ];

  test("blocker reproduction -- misma evidencia por señal, HeroCapabilities distinta -> V6 reordena, evidenceIdentityHash debe distinguirlo", () => {
    const setA = teamOpeningSet(CAPABILITIES_A);
    const setB = teamOpeningSet(CAPABILITIES_B);

    // Root-cause check: per-hero raw/normalized/evidenceConfidence are IDENTICAL between A and B
    // for every one of the 6 heroes -- HeroCapabilities never reaches any SignalScorer here.
    const bySignalA = new Map(setA.suggestions.map((s) => [s.hero, s.signals.map((c) => ({ signal: c.signal, raw: c.raw, normalized: c.normalized ?? null, evidenceConfidence: c.evidenceConfidence ?? null }))]));
    const bySignalB = new Map(setB.suggestions.map((s) => [s.hero, s.signals.map((c) => ({ signal: c.signal, raw: c.raw, normalized: c.normalized ?? null, evidenceConfidence: c.evidenceConfidence ?? null }))]));
    for (const hero of [1, 2, 3, 4, 5, 6]) expect(bySignalA.get(hero)).toEqual(bySignalB.get(hero));

    // The actual bug: V6's ranking genuinely differs (hero 2 and hero 3 swap rank).
    expect(setA.suggestions.map((s) => s.hero)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(setB.suggestions.map((s) => s.hero)).toEqual([1, 3, 2, 4, 5, 6]);
    expect(setA.suggestions.map((s) => s.hero)).not.toEqual(setB.suggestions.map((s) => s.hero));

    // The fix: evidence identity must diverge along with the ranking.
    expect(evidenceIdentityHash(setA)).not.toBe(evidenceIdentityHash(setB));
  });

  test("no over-hash -- HeroCapabilities para un héroe NO presente en el pick actual y sin efecto en el orden no mueve el hash", () => {
    // A third capabilities set, semantically inert here: hero 99 doesn't exist in this snapshot's
    // candidate pool at all, so it can never reach `recommendTeamOpeners`'s candidate list.
    const inertAddition: HeroCapabilities[] = [
      ...CAPABILITIES_A,
      { hero: 99, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: true, structuralDamage: "high", teamfight: "high", scaling: "high" },
    ];
    expect(evidenceIdentityHash(teamOpeningSet(CAPABILITIES_A))).toBe(evidenceIdentityHash(teamOpeningSet(inertAddition)));
  });

  test("semantic order independence -- mismas HeroCapabilities semánticas en distinto orden de construcción -> mismo hash", () => {
    const capsX: HeroCapabilities[] = [
      { hero: 3, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "high", teamfight: "low", scaling: "low" },
      { hero: 5, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "high", scaling: "low" },
    ];
    // Same two entries, reversed insertion order -- `openingStrategy`/`capabilitiesByHero` look up
    // by hero id (a Map/`.find`), so construction order is never semantic.
    const capsY: HeroCapabilities[] = [...capsX].reverse();

    const setX = teamOpeningSet(capsX);
    const setY = teamOpeningSet(capsY);
    expect(setX.suggestions.map((s) => s.hero)).toEqual(setY.suggestions.map((s) => s.hero));
    expect(evidenceIdentityHash(setX)).toBe(evidenceIdentityHash(setY));
  });

  test("runtime noise independence -- mismos inputs funcionales, distinto computedInMs/sessionId -> mismo hash", () => {
    const setB = teamOpeningSet(CAPABILITIES_B);
    const noisy: SuggestionSet = { ...setB, computedInMs: 12345, sessionId: "otra-sesion-cualquiera", basedOnSeq: 999 };
    expect(evidenceIdentityHash(setB)).toBe(evidenceIdentityHash(noisy));
  });

  // Opening-input-change (task's TEST 4): `openingStrategy`/`recommendTeamOpeners` have no runtime
  // "config" input independent of HeroCapabilities in this codebase -- MAX_COUNTER_RELIEF,
  // CURATED_RELIEF and REPEAT_STRATEGY_PENALTY (drafter/team-opener.ts) are frozen module
  // constants, not caller-supplied options, and BuildSuggestionsOptions carries no team-opening
  // config field besides `teamOpening: boolean` itself (already covered: build.ts always passes
  // `true`) and `heroCapabilities` (covered by the blocker-reproduction test above). NOT_APPLICABLE:
  // there is no separate functional input left to test independently of HeroCapabilities.
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
