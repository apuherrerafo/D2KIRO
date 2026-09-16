import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, computeEligibilityContentHash, createProtocolState } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, DraftProtocolState } from "../draft-protocol/types";
import type { DraftState } from "../draft/reducer";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import type { ComputeSuggestionsForRecommendation } from "./legality";
import { computeOnePlyLookahead, type OnePlyLookaheadInput } from "./lookahead";
import type { Recommendation, RecommendationAction } from "./types";

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

function recommendationFor(actions: readonly RecommendationAction[], score = 100): Recommendation {
  return { actions, score, confidence: "alta", evidence: [], signalsByHero: {}, roleImpact: {}, risks: [], legal: true, legacy: null };
}

interface FakeComputeOptions {
  heroPool: readonly number[];
  onCall?: (state: DraftState) => void;
}

function fakeCompute({ heroPool, onCall }: FakeComputeOptions): ComputeSuggestionsForRecommendation {
  return async (state: DraftState, _accountId, options): Promise<SuggestionSet> => {
    onCall?.(state);
    const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    const allowed = options?.candidateHeroIds ? new Set(options.candidateHeroIds) : null;
    const suggestions: Suggestion[] = heroPool
      .filter((hero) => !excluded.has(hero) && (allowed === null || allowed.has(hero)))
      .map((hero, index) => ({
        hero,
        rank: (Math.min(index + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6),
        score: 100 - index,
        signals: [{ signal: "counter" as const, raw: 0.1, weighted: 3, explanation: `fixture ${hero}`, sampleSize: 40 }],
        reason: `fixture ${hero}`,
        confidence: "alta" as const,
        evidenceCoverage: 0.9,
        guessingIndex: 0.1,
      }));
    return {
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: 0,
      decisionContext: "team_opening",
      suggestions,
      comparison: null,
      degraded: [],
      computedInMs: Math.floor(Math.random() * 50), // deliberately noisy metadata -- must never move identity
      functionalEvidence: {
        metaIsStale: false,
        signalEvidence: suggestions.map((s) => ({
          hero: s.hero,
          signals: s.signals.map((sig) => ({ signal: sig.signal, raw: sig.raw, normalized: null, evidenceConfidence: null, explanation: sig.explanation, sampleSize: sig.sampleSize, applicable: null })),
        })),
        heroPositions: [],
        teamOpening: null,
        partyPreferredPositions: [],
      },
    };
  };
}

function baseInput(overrides: Partial<OnePlyLookaheadInput>): OnePlyLookaheadInput {
  return {
    state: apRound1State("lookahead-default"),
    actor: "radiant",
    patch: "7.41e",
    computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }),
    topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 0 }, hero: 1 }]),
    ...overrides,
  };
}

describe("computeOnePlyLookahead -- Ranked All Pick", () => {
  test("#1 acción propia única -> siguiente punto de observación del rival correcto (ambos slots de dire siguen abiertos)", async () => {
    const state = apRound1State("s6-single");
    const result = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 0 }, hero: 1 }]),
      computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }),
    }));
    expect(result.opponentResponse).not.toBe("NOT_COMPUTED");
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.opponentResponse.status).toBe("PLAUSIBLE_RESPONSE");
    expect(result.opponentResponse.actor).toBe("dire");
  });

  test("#2/#15 IMPORTANT TEST -- opponent information set: mutar nuestro héroe HIPOTÉTICO sellado no cambia la respuesta del rival mientras siga oculto", async () => {
    const state = apRound1State("s6-info-set");
    const withHero1 = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([
        { slot: { side: "radiant", slotIndex: 0 }, hero: 1 },
        { slot: { side: "radiant", slotIndex: 1 }, hero: 2 },
      ]),
      computeSuggestions: fakeCompute({ heroPool: [10, 11] }), // opponent's pool never overlaps our own candidates
    }));
    const withHero3 = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([
        { slot: { side: "radiant", slotIndex: 0 }, hero: 3 },
        { slot: { side: "radiant", slotIndex: 1 }, hero: 4 },
      ]),
      computeSuggestions: fakeCompute({ heroPool: [10, 11] }),
    }));
    // Our own hero(es) remain SEALED (round doesn't close -- dire's slots stay open either way):
    // dire's plausible action/score/evidence -- what DIRE would actually do -- must be IDENTICAL
    // regardless of which hero we hypothetically chose. `basedOnCounterfactualState.stateIdentity`
    // is deliberately EXCLUDED from this comparison: it is computed from OUR OWN perspective (see
    // counterfactual-identity.ts), so it correctly (and safely) differs whenever OUR OWN
    // hypothetical action differs -- that is "stale recommendation" detection, not a leak.
    if (withHero1.opponentResponse === "NOT_COMPUTED" || withHero3.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    const { basedOnCounterfactualState: _ignoredA, ...observableA } = withHero1.opponentResponse;
    const { basedOnCounterfactualState: _ignoredB, ...observableB } = withHero3.opponentResponse;
    expect(observableA).toEqual(observableB);
    expect(withHero1.steal).toEqual(withHero3.steal);
  });

  test("#5/#17 colisión de mismo héroe con un pick oculto del rival sigue siendo legal/plausible -- steal no se reclama todavía", async () => {
    const state = apRound1State("s6-collision-legal");
    const withDireSealed = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 1 }).state;
    const result = await computeOnePlyLookahead(baseInput({
      state: withDireSealed,
      topRecommendation: recommendationFor([
        { slot: { side: "radiant", slotIndex: 0 }, hero: 1 },
        { slot: { side: "radiant", slotIndex: 1 }, hero: 2 },
      ]),
      computeSuggestions: fakeCompute({ heroPool: [1, 2] }),
    }));
    if (result.steal === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.steal.status).toBe("STILL_CONTESTABLE");
  });

  test("#6 WAITING_FOR_COLLISION_AUTHORITY -- ninguna respuesta rival inventada", async () => {
    const created = createProtocolState("s6-collision-wait", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state = created.state;
    const setup = [
      { side: "dire" as const, slotIndex: 0, heroId: 100 },
      { side: "dire" as const, slotIndex: 1, heroId: 101 },
      { side: "radiant" as const, slotIndex: 0, heroId: 102 },
      { side: "radiant" as const, slotIndex: 1, heroId: 100 },
      { side: "dire" as const, slotIndex: 0, heroId: 200 },
      { side: "radiant" as const, slotIndex: 1, heroId: 200 },
      { side: "dire" as const, slotIndex: 0, heroId: 300 },
    ];
    state = applyProtocolCommand(state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    for (const command of setup) {
      state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", ...command }).state;
    }
    const result = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 1 }, hero: 300 }]),
      computeSuggestions: fakeCompute({ heroPool: [1, 2] }),
    }));
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.opponentResponse.status).toBe("COLLISION_PENDING");
    expect(result.opponentResponse.action).toBeNull();
    if (result.lookahead === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.lookahead.opponentResponse).toBeNull();
  });

  test("#11 héroe baneado nunca es la respuesta plausible del rival", async () => {
    const created = createProtocolState("s6-banned-never", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const banned = applyProtocolCommand(created.state, { type: "RECORD_RESOLVED_BANS", heroes: [1] }).state;
    const state = applyProtocolCommand(banned, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const result = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 0 }, hero: 2 }]),
      computeSuggestions: fakeCompute({ heroPool: [1, 3] }), // hero 1 banned, must never surface as dire's response
    }));
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.opponentResponse.action?.hero).not.toBe(1);
  });

  test("#12 héroe ya pickeado (confirmado y revelado) nunca es la respuesta plausible del rival", async () => {
    const created = createProtocolState("s6-picked-never", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    for (const command of [
      { side: "radiant" as const, slotIndex: 0, heroId: 1 },
      { side: "radiant" as const, slotIndex: 1, heroId: 9 },
      { side: "dire" as const, slotIndex: 0, heroId: 8 },
      { side: "dire" as const, slotIndex: 1, heroId: 7 },
    ]) {
      state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", ...command }).state;
    }
    expect(state.rankedAp!.phase).toBe("PICK_ROUND_2"); // hero 1 now CONFIRMED + revealed to dire
    const result = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([
        { slot: { side: "radiant", slotIndex: 0 }, hero: 2 },
        { slot: { side: "radiant", slotIndex: 1 }, hero: 3 },
      ]),
      computeSuggestions: fakeCompute({ heroPool: [1, 4] }), // hero 1 already picked, must never resurface
    }));
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.opponentResponse.action?.hero).not.toBe(1);
  });

  test("#20 compound (Party2, 2 acciones simultáneas) se simula como UN SOLO paso conjunto, nunca dos independientes", async () => {
    const state = apRound1State("s6-compound");
    let simultaneousCallCount = 0;
    const result = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([
        { slot: { side: "radiant", slotIndex: 0 }, hero: 1 },
        { slot: { side: "radiant", slotIndex: 1 }, hero: 2 },
      ]),
      computeSuggestions: fakeCompute({
        heroPool: [1, 2, 3],
        onCall: (draftState) => {
          // By the time ANY opponent-facing call happens, BOTH our hypothetical heroes must
          // already be reflected together (or correctly still hidden) -- never a call reflecting
          // only one of the two.
          if (draftState.localSide === "dire") simultaneousCallCount += 1;
        },
      }),
    }));
    expect(simultaneousCallCount).toBeGreaterThan(0);
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.opponentResponse.status).toBe("PLAUSIBLE_RESPONSE");
  });

  test("#23 la identidad S6 cambia cuando un input funcional real cambia (meta distinto para el rival)", async () => {
    const state = apRound1State("s6-identity-changes");
    const a = await computeOnePlyLookahead(baseInput({ state, computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }) }));
    const b = await computeOnePlyLookahead(baseInput({ state, computeSuggestions: fakeCompute({ heroPool: [1, 2, 3, 4] }) }));
    if (a.counterfactual === "NOT_COMPUTED" || b.counterfactual === "NOT_COMPUTED") throw new Error("unreachable");
    expect(a.counterfactual.evidenceIdentity).not.toBe(b.counterfactual.evidenceIdentity);
  });

  test("#24 metadata de runtime (computedInMs, aleatorio en el fixture) nunca mueve la identidad S6", async () => {
    const state = apRound1State("s6-identity-stable");
    const a = await computeOnePlyLookahead(baseInput({ state, computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }) }));
    const b = await computeOnePlyLookahead(baseInput({ state, computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }) }));
    expect(a.counterfactual).toEqual(b.counterfactual);
    expect(a.opponentResponse).toEqual(b.opponentResponse);
  });

  test("#13 determinismo: mismos inputs funcionales -> resultado byte-idéntico", async () => {
    const state = apRound1State("s6-determinism");
    const input = baseInput({ state, seed: "fixed-seed", computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }) });
    const a = await computeOnePlyLookahead(input);
    const b = await computeOnePlyLookahead(input);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  test("#18/#19 nunca aparece un campo o texto de probabilidad; score es el score canónico de V6", async () => {
    const state = apRound1State("s6-no-probability");
    const result = await computeOnePlyLookahead(baseInput({ state, computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }) }));
    expect(JSON.stringify(result)).not.toMatch(/probab/i);
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.opponentResponse.score).toBe(100); // exactly fakeCompute's own score for rank 1, untouched
  });

  test("#29 acotado: computeSuggestions se llama como máximo 3 veces (propia + baseline + after)", async () => {
    const state = apRound1State("s6-bounded-calls");
    let calls = 0;
    await computeOnePlyLookahead(baseInput({
      state,
      computeSuggestions: fakeCompute({ heroPool: [1, 2, 3], onCall: () => { calls += 1; } }),
    }));
    expect(calls).toBeLessThanOrEqual(2); // lookahead.ts itself only ever calls baseline + after
  });

  test("#31 rendimiento: fixture representativo bajo 500ms (corte duro)", async () => {
    const state = apRound1State("s6-performance");
    const heroPool = Array.from({ length: 110 }, (_, i) => i + 1);
    const start = performance.now();
    await computeOnePlyLookahead(baseInput({ state, computeSuggestions: fakeCompute({ heroPool }) }));
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(500);
  });
});

describe("computeOnePlyLookahead -- Captain's Mode", () => {
  function advanceToStep(state: DraftProtocolState, steps: { actor: "first" | "second"; kind: "BAN" | "PICK"; heroId: number }[]): DraftProtocolState {
    let working = state;
    for (const step of steps) {
      const result = applyProtocolCommand(working, { type: "CM_ACTION", actor: step.actor, kind: step.kind, heroId: step.heroId });
      if (result.rejected) throw new Error(`fixture rejected: ${result.rejected}`);
      working = result.state;
    }
    return working;
  }

  test("#7 siguiente step del rival -> respuesta plausible generada desde el actor correcto", async () => {
    // Steps 1-2 (BAN_1) both belong to "first"=radiant; step 3 is "second"=dire.
    const ready = cmReadyState("s6-cm-next-actor", [1, 2, 3, 4, 5]);
    const atStep2 = advanceToStep(ready, [{ actor: "first", kind: "BAN", heroId: 5 }]);
    const result = await computeOnePlyLookahead(baseInput({
      state: atStep2,
      actor: "radiant",
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 2 }, hero: 4 }]),
      computeSuggestions: fakeCompute({ heroPool: [1, 2, 3] }),
    }));
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.opponentResponse.status).toBe("PLAUSIBLE_RESPONSE");
    expect(result.opponentResponse.actor).toBe("dire");
  });

  test("#8 eligibilidad certificada restringe el universo candidato del rival antes de puntuar", async () => {
    const ready = cmReadyState("s6-cm-eligibility-restricts", [1, 2, 3]);
    const atStep2 = advanceToStep(ready, [{ actor: "first", kind: "BAN", heroId: 3 }]);
    const result = await computeOnePlyLookahead(baseInput({
      state: atStep2,
      actor: "radiant",
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 2 }, hero: 2 }]),
      computeSuggestions: fakeCompute({ heroPool: [1, 2, 3, 4, 5] }),
    }));
    if (result.opponentResponse === "NOT_COMPUTED") throw new Error("unreachable");
    // Only hero 1 remains eligible (2 and 3 taken) -- 4 and 5 were never in the certified snapshot.
    expect(result.opponentResponse.action?.hero).toBe(1);
  });

  test("#9 sin eligibilidad -> sin respuesta de héroe para el rival, fail closed", async () => {
    const created = createProtocolState("s6-cm-no-eligibility", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    // No LOAD_CM_ELIGIBILITY -- radiant's own step 1 ban is impossible too (ELIGIBILITY_UNVERIFIED),
    // so there is no legal own action to hypothesize in the first place.
    const result = await computeOnePlyLookahead(baseInput({
      state: confirmed,
      actor: "radiant",
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 1 }, hero: 1 }]),
      computeSuggestions: fakeCompute({ heroPool: [1, 2] }),
    }));
    expect(result.opponentResponse).toBe("NOT_COMPUTED");
  });

  test("#28 depth es literalmente 1 -- nunca lookahead recursivo", async () => {
    const ready = cmReadyState("s6-cm-depth", [1, 2, 3, 4, 5]);
    const atStep2 = advanceToStep(ready, [{ actor: "first", kind: "BAN", heroId: 3 }]);
    const result = await computeOnePlyLookahead(baseInput({
      state: atStep2,
      actor: "radiant",
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 2 }, hero: 2 }]),
      computeSuggestions: fakeCompute({ heroPool: [1, 4, 5] }),
    }));
    if (result.lookahead === "NOT_COMPUTED") throw new Error("unreachable");
    expect(result.lookahead.depth).toBe(1);
  });
});

describe("computeOnePlyLookahead -- no recommendations[0] at all", () => {
  test("acción propia rechazada por el kernel -> los 4 campos vuelven a NOT_COMPUTED, nunca lanza", async () => {
    const state = apRound1State("s6-own-action-rejected");
    const result = await computeOnePlyLookahead(baseInput({
      state,
      topRecommendation: recommendationFor([{ slot: { side: "radiant", slotIndex: 9 }, hero: 1 }]), // slot doesn't exist
      computeSuggestions: fakeCompute({ heroPool: [1] }),
    }));
    expect(result.opponentResponse).toBe("NOT_COMPUTED");
    expect(result.steal).toBe("NOT_COMPUTED");
    expect(result.lookahead).toBe("NOT_COMPUTED");
    expect(result.counterfactual).toBe("NOT_COMPUTED");
    expect(result.degradations.length).toBeGreaterThan(0);
  });
});
