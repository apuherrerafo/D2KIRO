import { describe, expect, test } from "bun:test";
import { deferredFieldsNotComputed, type Recommendation, type RecommendationSetV2 } from "./types";
import { translateRecommendationSetToLegacySuggestionSet } from "./translate-v1";

function singleAction(hero: number, score: number): Recommendation {
  return {
    actions: [{ slot: { side: "radiant", slotIndex: 0 }, hero }],
    score,
    confidence: "alta",
    evidence: [],
    signalsByHero: { [hero]: [] },
    roleImpact: { [hero]: { status: "UNRESOLVED", position: null, marginals: { 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 }, entropy: 2.32 } },
    risks: [],
    legal: true,
    legacy: { hero, signals: [], evidenceCoverage: 1, guessingIndex: 0, reason: `pick ${hero}`, decisionContext: "team_opening" },
  };
}

function compoundAction(heroA: number, heroB: number, score: number): Recommendation {
  return {
    actions: [
      { slot: { side: "radiant", slotIndex: 0 }, hero: heroA },
      { slot: { side: "radiant", slotIndex: 1 }, hero: heroB },
    ],
    score,
    confidence: "media",
    evidence: [],
    signalsByHero: { [heroA]: [], [heroB]: [] },
    roleImpact: {},
    risks: [],
    legal: true,
    legacy: null,
  };
}

function baseSet(recommendations: Recommendation[]): RecommendationSetV2 {
  return {
    schema: "recommendation-set/v2",
    sessionId: "s1",
    basedOn: {
      protocolId: "dota2/ranked-all-pick",
      protocolVersion: "1.0.0",
      rulesHash: "h",
      heroEligibilityHash: null,
      stateIdentity: "state-hash",
      perspectiveIdentity: "perspective-hash",
      evidenceVersion: "v",
      seed: null,
    },
    decision: { actor: "radiant", actionKind: "PICK", phase: "PICK_ROUND_1", round: 1, step: null, controlledSlots: [], actionCount: 2 },
    recommendations,
    degradations: [],
    deferred: deferredFieldsNotComputed(),
    decisionContext: "team_opening",
  };
}

describe("translateRecommendationSetToLegacySuggestionSet -- proyecta, nunca rescorea", () => {
  test("acciones simples se proyectan verbatim, con rank secuencial", () => {
    const v2 = baseSet([singleAction(10, 90), singleAction(20, 80)]);
    const v1 = translateRecommendationSetToLegacySuggestionSet(v2);
    expect(v1.suggestions).toHaveLength(2);
    expect(v1.suggestions[0]).toMatchObject({ hero: 10, rank: 1, score: 90 });
    expect(v1.suggestions[1]).toMatchObject({ hero: 20, rank: 2, score: 80 });
    // El score viaja tal cual -- el traductor nunca vuelve a sumar/normalizar nada.
    expect(v1.suggestions[0]!.score).toBe(90);
  });

  test("recomendaciones compuestas (legacy: null) se omiten -- nunca se aplanan con una regla inventada", () => {
    const v2 = baseSet([singleAction(10, 90), compoundAction(20, 30, 150)]);
    const v1 = translateRecommendationSetToLegacySuggestionSet(v2);
    expect(v1.suggestions).toHaveLength(1);
    expect(v1.suggestions[0]!.hero).toBe(10);
  });

  test("un set puramente compuesto proyecta una lista vacía, no un error ni un flatten silencioso", () => {
    const v2 = baseSet([compoundAction(20, 30, 150)]);
    const v1 = translateRecommendationSetToLegacySuggestionSet(v2);
    expect(v1.suggestions).toHaveLength(0);
    expect(v1.decisionContext).toBe("no_signal_available");
  });

  test("comparison siempre null -- el traductor nunca inventa una comparación que V2 no calculó", () => {
    const v1 = translateRecommendationSetToLegacySuggestionSet(baseSet([singleAction(10, 90)]));
    expect(v1.comparison).toBeNull();
  });

  test("degradations se proyectan sólo cuando son un DegradationFlag legacy válido", () => {
    const v2 = {
      ...baseSet([singleAction(10, 90)]),
      degradations: [
        { reason: "stale_meta" as const, detail: "x" },
        { reason: "NO_ACTION_FOR_ACTOR" as const, detail: "y" },
      ],
    };
    const v1 = translateRecommendationSetToLegacySuggestionSet(v2);
    expect(v1.degraded).toEqual(["stale_meta"]);
  });
});
