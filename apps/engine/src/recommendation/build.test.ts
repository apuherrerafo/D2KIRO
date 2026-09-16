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
import { buildSuggestions } from "../signals/mix";
import type { MetaHeroInfo, MetaSnapshot } from "../signals/types";
import { buildRecommendationSetV2, type ComputeSuggestionsForRecommendation } from "./build";
import { evidenceIdentityHash } from "./evidence";
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

  test("R1 S6: opponentResponse/steal/lookahead/counterfactual quedan estructurados para recommendations[0], nunca una probabilidad numérica", async () => {
    // Round 1, both radiant slots open + heroPool with exactly 2 heroes -> a single compound
    // recommendation (see build.ts's own compound branch). After hypothetically sealing both
    // radiant slots, dire's own 2 round-1 slots are STILL open (round only resolves once every
    // slot across both sides is filled) -- a real, reachable one-ply opponent decision point.
    const state = apRound1State("ap-s6");
    const set = await buildFor(state, "radiant", [1, 2]);
    expect(set.deferred.opponentResponse).not.toBe("NOT_COMPUTED");
    expect(set.deferred.steal).not.toBe("NOT_COMPUTED");
    expect(set.deferred.lookahead).not.toBe("NOT_COMPUTED");
    expect(set.deferred.counterfactual).not.toBe("NOT_COMPUTED");
    if (
      set.deferred.opponentResponse === "NOT_COMPUTED" ||
      set.deferred.steal === "NOT_COMPUTED" ||
      set.deferred.lookahead === "NOT_COMPUTED" ||
      set.deferred.counterfactual === "NOT_COMPUTED"
    ) {
      throw new Error("unreachable -- narrowed above");
    }
    // Same-hero collision remains legal pre-reveal (S1's own frozen contract): dire cannot yet
    // see radiant's sealed picks, so V6 still ranks hero 1 for dire too -- the plausible response
    // legitimately names an already-radiant-sealed hero.
    expect(set.deferred.opponentResponse.status).toBe("PLAUSIBLE_RESPONSE");
    expect(set.deferred.opponentResponse.actor).toBe("dire");
    expect(typeof set.deferred.opponentResponse.score).toBe("number");
    expect(set.deferred.steal.status).toBe("STILL_CONTESTABLE"); // hidden, not yet actually removed
    expect(set.deferred.lookahead.depth).toBe(1);
    // NO probability claim anywhere in the S6 payload -- structural guarantee, not a convention.
    expect(JSON.stringify(set.deferred)).not.toMatch(/probab/i);
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

  test("statistical matchup order has one V6, legacy, RecommendationSet, and identity output", async () => {
    const rows = [
      { vsHero: 2, games: 200, wins: 76 },
      { vsHero: 3, games: 200, wins: 76 },
    ];
    const meta = (matchups: MetaSnapshot["matchups"]): MetaSnapshot => ({
      heroes: Object.fromEntries(Array.from({ length: 10 }, (_, index) => {
        const hero = index + 1;
        return [hero, { id: hero, localizedName: ["One", "Two", "Three"][index] ?? `Hero ${hero}` }];
      })),
      matchups,
    });
    const state = cmReadyState("cm-statistical-order", Array.from({ length: 10 }, (_, index) => index + 1));
    const banCommands = [
      { actor: "first" as const, heroId: 2 },
      { actor: "first" as const, heroId: 3 },
      { actor: "second" as const, heroId: 4 },
      { actor: "second" as const, heroId: 5 },
      { actor: "first" as const, heroId: 6 },
      { actor: "second" as const, heroId: 7 },
      { actor: "second" as const, heroId: 8 },
    ];
    let pickState = state;
    for (const command of banCommands) {
      const result = applyProtocolCommand(pickState, { type: "CM_ACTION", actor: command.actor, kind: "BAN", heroId: command.heroId });
      if (result.rejected) throw new Error(`fixture ban rejected: ${result.rejected}`);
      pickState = result.state;
    }

    const compute = (matchups: MetaSnapshot["matchups"]) => {
      // R1 S6: buildRecommendationSetV2 now also calls computeSuggestions for the OPPONENT's own
      // perspective (baseline + after, one-ply lookahead) once radiant's own call already
      // resolved -- capture only the FIRST call here (radiant's own, which this test's assertions
      // are actually about) so this fixture stays correct regardless of how many further calls
      // S6 makes.
      let suggestionSet: SuggestionSet | undefined;
      const computeSuggestions: ComputeSuggestionsForRecommendation = async (legacyState, _accountId, options) => {
        const result = buildSuggestions(legacyState, meta(matchups), {
          ...options,
          heroPositions: HERO_POSITIONS,
          heroCapabilities: [],
          heroCounters: new Map(),
        });
        if (suggestionSet === undefined) suggestionSet = result;
        return result;
      };
      return { computeSuggestions, suggestionSet: () => suggestionSet! };
    };

    const ordered = compute({ 1: rows });
    const reversed = compute({ 1: [...rows].reverse() });
    const input = { state: pickState, view: project(pickState, "radiant"), actor: "radiant" as const, patch: "7.41e", heroPositions: HERO_POSITIONS };
    const left = await buildRecommendationSetV2({ ...input, computeSuggestions: ordered.computeSuggestions });
    const right = await buildRecommendationSetV2({ ...input, computeSuggestions: reversed.computeSuggestions });

    expect(evidenceIdentityHash(ordered.suggestionSet().functionalEvidence!)).toBe(evidenceIdentityHash(reversed.suggestionSet().functionalEvidence!));
    expect(ordered.suggestionSet().suggestions).toEqual(reversed.suggestionSet().suggestions);
    expect(ordered.suggestionSet().suggestions.find((suggestion) => suggestion.hero === 1)!.reason).toContain("Two y Three");
    expect(left.recommendations.find((recommendation) => recommendation.actions[0]!.hero === 1)!.legacy!.reason).toBe(
      right.recommendations.find((recommendation) => recommendation.actions[0]!.hero === 1)!.legacy!.reason,
    );
    expect(JSON.stringify(left)).toBe(JSON.stringify(right));
    expect(left.basedOn.evidenceVersion).toBe(right.basedOn.evidenceVersion);

    const changed = compute({ 1: [{ vsHero: 2, games: 200, wins: 75 }, rows[1]!] });
    const changedSet = await buildRecommendationSetV2({ ...input, computeSuggestions: changed.computeSuggestions });
    expect(changedSet.basedOn.evidenceVersion).not.toBe(left.basedOn.evidenceVersion);
    expect(JSON.stringify(changedSet)).not.toBe(JSON.stringify(left));
  });
});

// R1 S6 BLOCKER REPAIR (Blocker 3) -- integration-level performance test against the REAL
// canonical V6 path. The pre-repair version of this contract lived in lookahead.test.ts and timed
// `fakeCompute` (a plain array filter/map, no real scoring) -- it would have kept passing even if
// the real V6 calls were removed or replaced with a stub, which proves nothing about the actual
// 500ms hard-cutoff contract. This test wires `computeSuggestions` straight to `buildSuggestions`
// (the same function `computeSuggestionsForState`, the real production entry point in
// server/app.ts, delegates to) -- no mock, no stub, anywhere in the path it measures.
describe("buildRecommendationSetV2 -- rendimiento real (V6 real, sin mocks, Blocker 3)", () => {
  const HERO_COUNT = 110;
  const PERF_HERO_IDS = Array.from({ length: HERO_COUNT }, (_, index) => index + 1);
  const PERF_META: MetaSnapshot = {
    heroes: Object.fromEntries(PERF_HERO_IDS.map((id): [number, MetaHeroInfo] => [id, { id, localizedName: `Hero ${id}`, roles: ["Carry"] }])),
    matchups: {},
  };

  const realComputeSuggestions: ComputeSuggestionsForRecommendation = async (state, _accountId, options) =>
    buildSuggestions(state, PERF_META, { ...options, heroPositions: HERO_POSITIONS, heroCapabilities: [], heroCounters: new Map() });

  /** Captain's Mode, step 2 (actor "first"=radiant, same as step 1) -- our own top recommendation
   * is evaluated here, so applying it (inside buildRecommendationSetV2's S6 lookahead) advances
   * into step 3 ("second"=dire), a REAL legal decision point for the opponent. This is the only
   * step pairing that exercises BOTH S6 V6 calls in one build: the baseline against the pre-action
   * state (dire cannot act yet) and the after-state call against the real post-action state (dire
   * can). */
  function representativeState(sessionId: string): DraftProtocolState {
    const ready = cmReadyState(sessionId, PERF_HERO_IDS);
    const step1 = applyProtocolCommand(ready, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: PERF_HERO_IDS[0]! });
    if (step1.rejected) throw new Error(`fixture rejected: ${step1.rejected}`);
    return step1.state;
  }

  async function buildOnce(sessionId: string) {
    const state = representativeState(sessionId);
    return buildRecommendationSetV2({ state, view: project(state, "radiant"), actor: "radiant", patch: "7.41e", computeSuggestions: realComputeSuggestions });
  }

  test("warm-up + 3 corridas medidas, cada una bajo 500ms -- RecommendationSet build -> S6 baseline V6 -> contrafactual -> S6 after V6 -> respuesta plausible/steal, todo con V6 real", async () => {
    const warmup = await buildOnce("s6-perf-warmup"); // not measured -- JIT/module warm-up only
    expect(warmup.recommendations.length).toBeGreaterThan(0);

    const durations: number[] = [];
    for (let run = 0; run < 3; run += 1) {
      const start = performance.now();
      const result = await buildOnce(`s6-perf-run-${run}`);
      durations.push(performance.now() - start);

      // Proves the REAL V6 path actually ran end to end (a stub standing in for V6 could still be
      // fast, but could never legitimately produce these): real recommendations, and S6 actually
      // reaching a concrete, scored opponent decision point.
      expect(result.recommendations.length).toBeGreaterThan(0);
      if (result.deferred.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
      expect(result.deferred.opponentResponse.status).toBe("PLAUSIBLE_RESPONSE");
      expect(result.deferred.opponentResponse.score).not.toBeNull();
    }

    const max = Math.max(...durations);
    const median = [...durations].sort((a, b) => a - b)[1]!;
    console.log(`S6 real-V6 perf (${HERO_COUNT} heroes): runs=${durations.map((d) => d.toFixed(1)).join(",")}ms max=${max.toFixed(1)}ms median=${median.toFixed(1)}ms`);

    // H0 hard compute budget -- a TEST/GATE property (this assertion), never a wall-clock branch
    // inside RecommendationSetV2 itself (that would make semantic output depend on elapsed time).
    for (const duration of durations) expect(duration).toBeLessThan(500);
  });
});
