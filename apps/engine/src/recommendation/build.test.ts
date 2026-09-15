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
import type { FunctionalRecommendationEvidence } from "./evidence";

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
    const functionalEvidence: FunctionalRecommendationEvidence = {
      metaIsStale: false,
      signalEvidence: suggestions.map((suggestion) => ({
        hero: suggestion.hero,
        signals: suggestion.signals.map((entry) => ({ signal: entry.signal, raw: entry.raw, normalized: entry.normalized ?? null, evidenceConfidence: entry.evidenceConfidence ?? null, explanation: entry.explanation, sampleSize: entry.sampleSize, applicable: entry.applicable ?? null })),
      })),
      heroPositions: [],
      teamOpening: null,
      partyPreferredPositions: [],
    };
    return {
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: "team_opening",
      suggestions,
      comparison: null,
      degraded: [],
      computedInMs: 7,
      functionalEvidence,
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
  test("functional evidence identity propagates to RecommendationSet without changing V6 output", async () => {
    const state = apRound1State("ap-functional-evidence");
    const withCapabilities = (structuralDamage: "high" | "low"): ComputeSuggestionsForRecommendation => async (draftState) => {
      const result = await fakeComputeSuggestions([1, 2, 3])(draftState, null);
      return {
        ...result,
        functionalEvidence: {
          ...result.functionalEvidence!,
          teamOpening: {
            heroCapabilities: [{ hero: 1, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage, teamfight: "low", scaling: "low" }],
            matchups: [], curatedCounters: [], heroNames: [{ hero: 1, name: "Hero 1" }],
          },
        },
      };
    };
    const input = { state, view: project(state, "radiant"), actor: "radiant" as const, patch: "7.41e", heroPositions: HERO_POSITIONS };
    const low = await buildRecommendationSetV2({ ...input, computeSuggestions: withCapabilities("low") });
    const high = await buildRecommendationSetV2({ ...input, computeSuggestions: withCapabilities("high") });
    expect(low.recommendations).toEqual(high.recommendations);
    expect(low.basedOn.evidenceVersion).not.toBe(high.basedOn.evidenceVersion);
  });

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

  test("blocker 4 -- un par IMPOSSIBLE nunca es recomendable aunque tenga el score más alto; el par factible con menor score sobrevive y rankea primero", async () => {
    // Hero 50 (own pick, round 1) and hero 1 (candidate) both concentrate their ENTIRE
    // hero/patch belief on position 1 -- no injective assignment can place both there, so every
    // compound pair containing hero 1 is IMPOSSIBLE_ASSIGNMENT, regardless of its partner. Heroes
    // 2/3/4 each concentrate on a distinct, non-conflicting position.
    const HARD_GATE_POSITIONS: HeroPositions = {
      50: [{ position: 1, matches: 1000 }],
      1: [{ position: 1, matches: 1000 }],
      2: [{ position: 2, matches: 1000 }],
      3: [{ position: 3, matches: 1000 }],
      4: [{ position: 4, matches: 1000 }],
    };
    const created = createProtocolState("ap-joint-gate", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("fixture setup failed");
    let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 50 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 60 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 70 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 71 }).state;
    expect(state.rankedAp!.phase).toBe("PICK_ROUND_2"); // radiant now owns hero 50 (forced pos 1) as an own pick

    // heroPool order [1,2,3,4] -> V6 fixture scores 100/99/98/97: the pairs containing hero 1
    // ((1,2)=199, (1,3)=198, (1,4)=197) would rank ABOVE every feasible pair if score were the
    // only criterion -- (2,3)=197 is the best pair that is actually jointly feasible.
    const set = await buildFor(state, "radiant", [1, 2, 3, 4], { heroPositions: HARD_GATE_POSITIONS });
    const namedHeroes = set.recommendations.flatMap((r) => r.actions.map((a) => a.hero));
    expect(namedHeroes).not.toContain(1); // every pair scoring 199/198/197 that contains hero 1 was eliminated
    expect(set.degradations.some((d) => d.reason === "ROLE_ASSIGNMENT_IMPOSSIBLE")).toBe(true);
    const top = set.recommendations[0]!;
    expect(top.actions.map((a) => a.hero).sort((a, b) => a - b)).toEqual([2, 3]);
    expect(top.score).toBe(197); // the best FEASIBLE pair, not the best-scoring pair overall
  });

  test("ningún héroe baneado o ya pickeado (CONFIRMADO) aparece jamás en una recomendación", async () => {
    // Real bans (RECORD_RESOLVED_BANS) + a fully-closed round 1 (both sides' picks genuinely
    // CONFIRMED, not merely sealed-and-still-hidden) -- see the "hidden twin" test below for the
    // sealed-but-unrevealed case, which is legal to collide with, not "already taken".
    const created = createProtocolState("ap-legal", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("fixture setup failed");
    let state = applyProtocolCommand(created.state, { type: "RECORD_RESOLVED_BANS", heroes: [2] }).state;
    state = applyProtocolCommand(state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 3 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 4 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 6 }).state;
    state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 7 }).state;
    expect(state.rankedAp!.phase).toBe("PICK_ROUND_2"); // round 1 closed -> everything above is CONFIRMED
    const set = await buildFor(state, "radiant", [1, 2, 3, 4, 5, 6, 7]);
    const namedHeroes = set.recommendations.flatMap((r) => r.actions.map((a) => a.hero));
    expect(namedHeroes).not.toContain(2); // banned
    expect(namedHeroes).not.toContain(3); // radiant's own confirmed pick
    expect(namedHeroes).not.toContain(4); // radiant's own confirmed pick
    expect(namedHeroes).not.toContain(6); // dire's now-revealed confirmed pick
    expect(namedHeroes).not.toContain(7); // dire's now-revealed confirmed pick
  });

  test("blocker 2 -- un héroe sellado-pero-oculto por el rival NO es 'ya tomado': colisionar con él es legal", async () => {
    // The exact bug the independent review found: postValidateAction used to treat every
    // currently-sealed hero (either side) as taken, including the opponent's hidden-but-
    // unrevealed selection -- but rulesets/ranked-all-pick.ts's own heroAlreadyTaken never checks
    // the opposing side's sealed entries (a same-hero collision is legal, resolved at round close).
    // Hero 9 must therefore still be nameable for radiant even though dire has it sealed.
    const state = apRound1State("ap-legal-collision");
    const sealed = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 9 }).state;
    const set = await buildFor(sealed, "radiant", [9, 1]);
    const namedHeroes = set.recommendations.flatMap((r) => r.actions.map((a) => a.hero));
    expect(namedHeroes).toContain(9);
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

  test("hidden twin test: rival sellado-oculto X vs Y (X != Y) -> RecommendationSetV2 COMPLETO byte-idéntico antes del reveal, y diverge después", async () => {
    // Same sessionId on purpose (two hypothetical worlds that never coexist) so a full-body
    // JSON.stringify comparison is meaningful -- sessionId itself would otherwise differ for any
    // two real sessions, for reasons that have nothing to do with the hidden-information bug this
    // test targets. X (9) and Y (10) are DIFFERENT hidden heroes -- the earlier basedOn-only test
    // used the SAME hidden hero for both twins, which could never have caught this: identity could
    // coincidentally match while `recommendations`/`degradations`/anything else still leaked.
    const stateX = apRound1State("hidden-twin");
    const stateY = apRound1State("hidden-twin");
    const sealedX = applyProtocolCommand(stateX, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 9 }).state;
    const sealedY = applyProtocolCommand(stateY, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 10 }).state;
    const setX = await buildFor(sealedX, "radiant", [1, 2, 3], { seed: "fixed-twin-seed" });
    const setY = await buildFor(sealedY, "radiant", [1, 2, 3], { seed: "fixed-twin-seed" });
    expect(JSON.stringify(setX)).toBe(JSON.stringify(setY));

    // Reveal: fill ALL FOUR round-1 slots (both radiant slots too -- the round only closes once
    // every slot is filled) so dire's pick genuinely reveals. X's hidden hero (9) is now CONFIRMED
    // taken and excludes it from radiant's own candidates; Y's (10) does not (and vice-versa) --
    // only now are the two worlds legitimately allowed to diverge.
    const step1X = applyProtocolCommand(sealedX, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 4 }).state;
    const step2X = applyProtocolCommand(step1X, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 5 }).state;
    const finalX = applyProtocolCommand(step2X, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 11 }).state;
    const step1Y = applyProtocolCommand(sealedY, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 4 }).state;
    const step2Y = applyProtocolCommand(step1Y, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 5 }).state;
    const finalY = applyProtocolCommand(step2Y, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 12 }).state;
    expect(finalX.rankedAp!.phase).toBe("PICK_ROUND_2"); // round closed -> dire's pick is CONFIRMED now
    const revealedSetX = await buildFor(finalX, "radiant", [9, 10, 1], { seed: "fixed-twin-seed" });
    const revealedSetY = await buildFor(finalY, "radiant", [9, 10, 1], { seed: "fixed-twin-seed" });
    expect(JSON.stringify(revealedSetX)).not.toBe(JSON.stringify(revealedSetY));
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
      return { ...result, computedInMs: 999, functionalEvidence: result.functionalEvidence };
    };
    const fast = await buildRecommendationSetV2({ state, view: project(state, "radiant"), actor: "radiant", patch: "7.41e", computeSuggestions: fakeComputeSuggestions([1, 2]), heroPositions: HERO_POSITIONS });
    const slow = await buildRecommendationSetV2({ state, view: project(state, "radiant"), actor: "radiant", patch: "7.41e", computeSuggestions: slowCompute, heroPositions: HERO_POSITIONS });
    expect(fast.basedOn).toEqual(slow.basedOn);
  });

  test("WAITING_FOR_COLLISION_AUTHORITY -> sin recomendación de pick, degradación explícita, nunca una excepción", async () => {
    // Same 3rd-collision setup as kernel.test.ts's own "resolución autoritativa" scenario: once a
    // hero collides a 3rd time in the same round, the kernel closes both contending slots and
    // waits for an external authoritative resolution -- no gameplay pick is legal for anyone until
    // then, so this recommendation must degrade explicitly rather than name a hero.
    const created = createProtocolState("ap-collision-wait", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("fixture setup failed");
    const commands = [
      { type: "BAN_RESOLUTION_COMPLETE" as const },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "radiant" as const, slotIndex: 0, heroId: 100 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "radiant" as const, slotIndex: 1, heroId: 101 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 0, heroId: 102 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 1, heroId: 100 }, // colisión 1
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "radiant" as const, slotIndex: 0, heroId: 200 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 1, heroId: 200 }, // colisión 2
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "radiant" as const, slotIndex: 0, heroId: 300 },
      { type: "SUBMIT_SEALED_SELECTION" as const, side: "dire" as const, slotIndex: 1, heroId: 300 }, // colisión 3 -> WAITING
    ];
    let state = created.state;
    for (const command of commands) {
      const result = applyProtocolCommand(state, command);
      if (result.rejected) throw new Error(`rechazado: ${result.rejected}`);
      state = result.state;
    }
    expect(state.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    const set = await buildFor(state, "radiant", [1, 2, 3]);
    expect(set.recommendations).toHaveLength(0);
    expect(set.decision.actionCount).toBe(0);
    expect(set.degradations.some((d) => d.reason === "NO_ACTION_FOR_ACTOR")).toBe(true);
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

  test("blocker 3 -- buildRecommendationSetV2 reenvía el universo certificado a computeSuggestions como candidateHeroIds (LEGAL ACTION FIRST real, no post-filtro)", async () => {
    const state = cmReadyState("cm-candidate-universe", [1, 2, 3]);
    let receivedOptions: { candidateHeroIds?: readonly number[] } | undefined;
    const spyCompute: ComputeSuggestionsForRecommendation = async (draftState, accountId, options) => {
      receivedOptions = options;
      return fakeComputeSuggestions([1, 2, 3, 4, 5])(draftState, accountId, options);
    };
    await buildRecommendationSetV2({
      state,
      view: project(state, "radiant"),
      actor: "radiant",
      patch: "7.41e",
      computeSuggestions: spyCompute,
      heroPositions: HERO_POSITIONS,
    });
    expect(receivedOptions?.candidateHeroIds).toEqual([1, 2, 3]);
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
