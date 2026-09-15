import { describe, expect, test } from "bun:test";
import {
  applyProtocolCommand,
  computeEligibilityContentHash,
  createProtocolState,
  project,
} from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, DraftProtocolState, TeamSide } from "../draft-protocol/types";
import type { DraftState } from "../draft/reducer";
import type { HeroPositions } from "../signals/hero-positions";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import { buildRecommendationSetV2, type ComputeSuggestionsForRecommendation } from "./build";

const HERO_POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 1000 }],
  2: [{ position: 5, matches: 1000 }],
  3: [{ position: 4, matches: 1000 }],
  4: [{ position: 2, matches: 1000 }],
  5: [{ position: 3, matches: 1000 }],
};

function eligibilitySnapshot(heroIds: number[]): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "b",
    depotManifests: { "570": "fixture-manifest" },
    sourceHashes: { npc_heroes: "fixture" },
    provenance: {
      kind: "OFFICIAL_DEPOT" as const,
      appId: 570 as const,
      buildId: "b",
      depotId: "fixture-depot",
      manifestId: "fixture-manifest",
      sourcePath: "scripts/npc/npc_heroes.txt",
      sourceHash: "fixture",
    },
    heroIds,
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

function fakeComputeSuggestions(heroPool: readonly number[]): ComputeSuggestionsForRecommendation {
  return async (state: DraftState): Promise<SuggestionSet> => {
    const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    const suggestions: Suggestion[] = heroPool
      .filter((hero) => !excluded.has(hero))
      .map((hero, index) => ({
        hero,
        rank: (Math.min(index + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6),
        score: 100 - index,
        signals: [{ signal: "counter", raw: 0.05, weighted: 3, explanation: `fixture para ${hero}`, sampleSize: 50 }],
        reason: `fixture reason ${hero}`,
        confidence: "alta",
        evidenceCoverage: 0.9,
        guessingIndex: 0.1,
      }));
    return {
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: "team_opening",
      suggestions,
      comparison: null,
      degraded: [],
      computedInMs: 7,
    };
  };
}

function apRound1State(sessionId: string): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("fixture setup failed");
  return applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
}

function cmReadyState(sessionId: string, heroIds: number[]): DraftProtocolState {
  const created = createProtocolState(sessionId, "dota2/captains-mode");
  if (!created.ok) throw new Error("fixture setup failed");
  const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
  return applyProtocolCommand(confirmed, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibilitySnapshot(heroIds) }).state;
}

async function buildFor(
  state: DraftProtocolState,
  actor: TeamSide,
  heroPool: readonly number[],
  extra: Partial<Parameters<typeof buildRecommendationSetV2>[0]> = {},
) {
  return buildRecommendationSetV2({
    state,
    view: project(state, actor),
    actor,
    patch: "7.41e",
    computeSuggestions: fakeComputeSuggestions(heroPool),
    heroPositions: HERO_POSITIONS,
    ...extra,
  });
}

describe("buildRecommendationSetV2 -- Ranked All Pick", () => {
  test("un solo slot abierto (ronda 3 o tras sellar uno) -> recomendaciones single-action, legacy poblado", async () => {
    let state = apRound1State("ap-1");
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 }).state;
    const set = await buildFor(state, "radiant", [2, 3, 4]);
    expect(set.decision.actionCount).toBe(1);
    for (const recommendation of set.recommendations) {
      expect(recommendation.actions).toHaveLength(1);
      expect(recommendation.legacy).not.toBeNull();
    }
  });

  test("dos slots abiertos (party2) -> compound recommendations con 2 héroes distintos, nunca repetidos", async () => {
    const state = apRound1State("ap-party2");
    const set = await buildFor(state, "radiant", [1, 2, 3, 4]);
    expect(set.decision.actionCount).toBe(2);
    expect(set.recommendations.length).toBeGreaterThan(0);
    for (const recommendation of set.recommendations) {
      expect(recommendation.actions).toHaveLength(2);
      const [a, b] = recommendation.actions;
      expect(a!.hero).not.toBe(b!.hero);
      expect(recommendation.legacy).toBeNull();
      expect(recommendation.score).toBe(
        (100 - [1, 2, 3, 4].indexOf(a!.hero)) + (100 - [1, 2, 3, 4].indexOf(b!.hero)),
      );
    }
  });

  test("party3 (mismo mecanismo: actionCount lo fija la ronda, no el tamaño de la party)", async () => {
    const state = apRound1State("ap-party3");
    const set = await buildFor(state, "radiant", [1, 2, 3, 4], {});
    expect(set.decision.actionCount).toBe(2);
    expect(set.recommendations.every((r) => r.actions.length === 2)).toBe(true);
  });

  test("ningún héroe baneado o ya pickeado aparece jamás en una recomendación", async () => {
    let state = apRound1State("ap-legal");
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 2 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 3 }).state;
    const set = await buildFor(state, "radiant", [1, 2, 3, 4, 5]);
    const namedHeroes = set.recommendations.flatMap((r) => r.actions.map((a) => a.hero));
    expect(namedHeroes).not.toContain(2);
    expect(namedHeroes).not.toContain(3);
  });

  test("preferencia de posición del solicitante influye el roleImpact sin forzarlo", async () => {
    const round1 = apRound1State("ap-pref");
    const state = applyProtocolCommand(round1, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 9 }).state;
    const withoutPref = await buildFor(state, "radiant", [5]);
    const withPref = await buildFor(state, "radiant", [5], { partyPreferredPositions: [1] });
    const before = withoutPref.recommendations[0]!.roleImpact[5]!.marginals[1];
    const after = withPref.recommendations[0]!.roleImpact[5]!.marginals[1];
    expect(after).toBeGreaterThan(before);
    expect(after).toBeLessThan(1);
  });

  test("hidden twins: dos sesiones con el mismo pick propio y el mismo rival sellado-pero-oculto son idénticas en basedOn -- y divergen tras el reveal", async () => {
    const stateA = apRound1State("twin-a");
    const stateB = apRound1State("twin-b");
    const sealedA = applyProtocolCommand(stateA, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 9 }).state;
    const sealedB = applyProtocolCommand(stateB, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 9 }).state;
    const setA = await buildFor(sealedA, "radiant", [1, 2]);
    const setB = await buildFor(sealedB, "radiant", [1, 2]);
    expect(setA.basedOn.stateIdentity).toBe(setB.basedOn.stateIdentity);

    // Reveal round 1 for both sides -- now dire's hero is confirmed and radiant made a different
    // pick in each session, so the two states genuinely diverge post-reveal.
    const revealedA = applyProtocolCommand(sealedA, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 10 }).state;
    const finalA = applyProtocolCommand(revealedA, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 }).state;
    const finalA2 = applyProtocolCommand(finalA, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 2 }).state;
    const revealedB = applyProtocolCommand(sealedB, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 11 }).state;
    const finalB = applyProtocolCommand(revealedB, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 3 }).state;
    const finalB2 = applyProtocolCommand(finalB, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 4 }).state;
    const revealedSetA = await buildFor(finalA2, "radiant", [5, 6]);
    const revealedSetB = await buildFor(finalB2, "radiant", [5, 6]);
    expect(revealedSetA.basedOn.stateIdentity).not.toBe(revealedSetB.basedOn.stateIdentity);
  });

  test("determinismo: mismo estado/perspectiva/semilla -> RecommendationSetV2 byte-idéntico (serialización canónica)", async () => {
    const state = apRound1State("ap-determinism");
    const first = await buildFor(state, "radiant", [1, 2, 3, 4], { seed: "fixed-seed" });
    const second = await buildFor(state, "radiant", [1, 2, 3, 4], { seed: "fixed-seed" });
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
  });

  test("basedOn cambia cuando el estado relevante cambia (stale-recommendation detectable)", async () => {
    const before = apRound1State("ap-stale");
    const after = applyProtocolCommand(before, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 }).state;
    const setBefore = await buildFor(before, "radiant", [1, 2, 3]);
    const setAfter = await buildFor(after, "radiant", [2, 3]);
    expect(setBefore.basedOn.stateIdentity).not.toBe(setAfter.basedOn.stateIdentity);
  });

  test("metadata irrelevante de la corrida (computedInMs de V6) no altera basedOn", async () => {
    const state = apRound1State("ap-irrelevant-metadata");
    const slowCompute: ComputeSuggestionsForRecommendation = async (draftState) => {
      const inner = fakeComputeSuggestions([1, 2])(draftState, null);
      const result = await inner;
      return { ...result, computedInMs: 999 };
    };
    const fast = await buildRecommendationSetV2({ state, view: project(state, "radiant"), actor: "radiant", patch: "7.41e", computeSuggestions: fakeComputeSuggestions([1, 2]), heroPositions: HERO_POSITIONS });
    const slow = await buildRecommendationSetV2({ state, view: project(state, "radiant"), actor: "radiant", patch: "7.41e", computeSuggestions: slowCompute, heroPositions: HERO_POSITIONS });
    expect(fast.basedOn).toEqual(slow.basedOn);
  });

  test("no hay acción legal -> degradación explícita y determinista, nunca una excepción", async () => {
    const state = createProtocolState("ap-no-action", "dota2/ranked-all-pick");
    if (!state.ok) throw new Error("setup");
    const set1 = await buildFor(state.state, "radiant", [1, 2]);
    const set2 = await buildFor(state.state, "radiant", [1, 2]);
    expect(set1.recommendations).toHaveLength(0);
    expect(set1.degradations.some((d) => d.reason === "NO_ACTION_FOR_ACTOR")).toBe(true);
    expect(set1).toEqual(set2);
  });

  test("S6 y campos derivados nunca contienen una probabilidad de oponente -- siempre NOT_COMPUTED", async () => {
    const state = apRound1State("ap-s6");
    const set = await buildFor(state, "radiant", [1, 2]);
    expect(set.deferred).toEqual({
      opponentResponse: "NOT_COMPUTED",
      steal: "NOT_COMPUTED",
      lookahead: "NOT_COMPUTED",
      counterfactual: "NOT_COMPUTED",
    });
  });

  test("camino V6 canónico: score/signals de la recomendación single-action son EXACTAMENTE los de V6, sin reescalar", async () => {
    const state = apRound1State("ap-v6-canonical");
    state.rankedAp; // touch for readability
    const oneSlot = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 }).state;
    const set = await buildFor(oneSlot, "radiant", [2, 3]);
    const top = set.recommendations[0]!;
    expect(top.score).toBe(100);
    expect(top.legacy!.signals[0]!.explanation).toBe("fixture para 2");
  });
});

describe("buildRecommendationSetV2 -- Captain's Mode", () => {
  test("con eligibilidad certificada: sólo héroes del snapshot pueden ser recomendados", async () => {
    const state = cmReadyState("cm-eligible", [1, 2, 3]);
    const set = await buildFor(state, "radiant", [1, 2, 3, 4, 5]);
    const named = set.recommendations.flatMap((r) => r.actions.map((a) => a.hero));
    expect(named.every((hero) => [1, 2, 3].includes(hero))).toBe(true);
    expect(named).not.toContain(4);
  });

  test("sin eligibilidad cargada: ninguna recomendación de héroe -- fail closed, nunca el catálogo global", async () => {
    const created = createProtocolState("cm-no-eligibility", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    const set = await buildFor(confirmed, "radiant", [1, 2, 3]);
    expect(set.recommendations).toHaveLength(0);
    expect(set.degradations.some((d) => d.reason === "NO_LEGAL_HERO_UNIVERSE")).toBe(true);
  });

  test("basedOn.heroEligibilityHash refleja el contentHash certificado del snapshot cargado", async () => {
    const snapshot = eligibilitySnapshot([1, 2, 3]);
    const created = createProtocolState("cm-hash", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    const loaded = applyProtocolCommand(confirmed, { type: "LOAD_CM_ELIGIBILITY", snapshot }).state;
    const set = await buildFor(loaded, "radiant", [1, 2, 3]);
    expect(set.basedOn.heroEligibilityHash).toBe(snapshot.contentHash);
  });
});
