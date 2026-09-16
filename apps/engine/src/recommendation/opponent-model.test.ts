import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, computeEligibilityContentHash, createProtocolState } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, DraftProtocolState } from "../draft-protocol/types";
import type { DraftState } from "../draft/reducer";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import type { ComputeSuggestionsForRecommendation } from "./legality";
import { computeOpponentModel, opponentValueFor, topPlausibleAction } from "./opponent-model";

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

function fakeCompute(heroPool: readonly number[]): ComputeSuggestionsForRecommendation {
  return async (state: DraftState, _accountId, options): Promise<SuggestionSet> => {
    const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    const allowed = options?.candidateHeroIds ? new Set(options.candidateHeroIds) : null;
    const suggestions: Suggestion[] = heroPool
      .filter((hero) => !excluded.has(hero) && (allowed === null || allowed.has(hero)))
      .map((hero, index) => ({
        hero,
        rank: (Math.min(index + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6),
        score: 100 - index,
        signals: [],
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
      computedInMs: 1,
      functionalEvidence: {
        metaIsStale: false,
        signalEvidence: suggestions.map((s) => ({ hero: s.hero, signals: [] })),
        heroPositions: [],
        teamOpening: null,
        partyPreferredPositions: [],
      },
    };
  };
}

describe("computeOpponentModel -- mutual visibility (never the opponent's self-aware hidden pick)", () => {
  test("un pick sellado-pero-oculto del rival, en la MISMA ronda, no aparece en el legacyState que ve V6 -- ni como propio ni como excluido", async () => {
    const state = apRound1State("opp-model-mutual");
    // dire seals hero 9 in the current round -- still un-revealed (round not closed: dire's OTHER
    // slot and both radiant slots remain open).
    const withDireSealed = applyProtocolCommand(state, {
      type: "SUBMIT_SEALED_SELECTION",
      side: "dire",
      slotIndex: 0,
      heroId: 9,
    }).state;

    let capturedState: DraftState | undefined;
    const spy: ComputeSuggestionsForRecommendation = async (legacyState, accountId, options) => {
      capturedState = legacyState;
      return fakeCompute([9, 1, 2])(legacyState, accountId, options);
    };

    const model = await computeOpponentModel({ state: withDireSealed, opponentSide: "dire", patch: "7.41e", computeSuggestions: spy });
    expect(capturedState!.picks.dire).toEqual([]); // dire's OWN sealed hero never appears as "known" to itself here
    expect(capturedState!.banned).toEqual([]);
    // Because the mutual model doesn't know dire already holds hero 9, V6 legitimately still
    // ranks it for dire -- collision with their own hidden pick stays reachable (matches the
    // kernel's own isSealedSelectionLegal, which allows this too).
    expect(model.suggestionSet!.suggestions.map((s) => s.hero)).toContain(9);
  });

  test("picks/bans ya CONFIRMADOS (revelados a ambos lados) sí entran al modelo del rival", async () => {
    const created = createProtocolState("opp-model-confirmed", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    let state = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    // Close round 1 entirely (no collision) so radiant's picks become CONFIRMED/REVEALED.
    for (const command of [
      { side: "radiant" as const, slotIndex: 0, heroId: 1 },
      { side: "radiant" as const, slotIndex: 1, heroId: 2 },
      { side: "dire" as const, slotIndex: 0, heroId: 3 },
      { side: "dire" as const, slotIndex: 1, heroId: 4 },
    ]) {
      state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", ...command }).state;
    }
    expect(state.rankedAp!.phase).toBe("PICK_ROUND_2");

    let capturedState: DraftState | undefined;
    const spy: ComputeSuggestionsForRecommendation = async (legacyState, accountId, options) => {
      capturedState = legacyState;
      return fakeCompute([1, 2, 5, 6])(legacyState, accountId, options);
    };
    await computeOpponentModel({ state, opponentSide: "dire", patch: "7.41e", computeSuggestions: spy });
    expect(capturedState!.picks.radiant.sort()).toEqual([1, 2]);
    expect(capturedState!.picks.dire.sort()).toEqual([3, 4]);
  });

  test("héroe baneado nunca aparece en el ranking del rival", async () => {
    const created = createProtocolState("opp-model-banned", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("setup");
    const banned = applyProtocolCommand(created.state, { type: "RECORD_RESOLVED_BANS", heroes: [7] }).state;
    const state = applyProtocolCommand(banned, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const model = await computeOpponentModel({ state, opponentSide: "dire", patch: "7.41e", computeSuggestions: fakeCompute([7, 8]) });
    expect(model.suggestionSet!.suggestions.map((s) => s.hero)).not.toContain(7);
  });
});

describe("computeOpponentModel -- Captain's Mode", () => {
  test("eligibilidad certificada restringe candidateHeroIds ANTES de rankear (LEGAL UNIVERSE FIRST también para el rival)", async () => {
    // Steps 1-2 (BAN_1) are both actor "first" = radiant -- advance past them so step 3 (actor
    // "second" = dire) is the one under test, matching where dire actually has a legal action.
    const ready = cmReadyState("opp-model-cm-eligible", [1, 2, 3, 4, 5]);
    const step1 = applyProtocolCommand(ready, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 4 });
    if (step1.rejected) throw new Error(`fixture rejected: ${step1.rejected}`);
    const step2 = applyProtocolCommand(step1.state, { type: "CM_ACTION", actor: "first", kind: "BAN", heroId: 5 });
    if (step2.rejected) throw new Error(`fixture rejected: ${step2.rejected}`);
    const state = step2.state;
    expect(state.captainsMode!.currentStep).toBe(3);
    let received: readonly number[] | undefined;
    const spy: ComputeSuggestionsForRecommendation = async (legacyState, accountId, options) => {
      received = options?.candidateHeroIds;
      return fakeCompute([1, 2, 3, 4, 5])(legacyState, accountId, options);
    };
    const model = await computeOpponentModel({ state, opponentSide: "dire", patch: "7.41e", computeSuggestions: spy });
    expect(received).toEqual([1, 2, 3]);
    expect(model.suggestionSet!.suggestions.map((s) => s.hero)).toEqual([1, 2, 3]);
  });

  test("sin eligibilidad cargada -- dire no tiene decisión legal todavía (firstPickSide sí confirmado, pero step 1 es 'first'=radiant) -> sin llamada a V6", async () => {
    const created = createProtocolState("opp-model-cm-no-elig", "dota2/captains-mode");
    if (!created.ok) throw new Error("setup");
    const confirmed = applyProtocolCommand(created.state, { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    let calls = 0;
    const spy: ComputeSuggestionsForRecommendation = async (legacyState, accountId, options) => {
      calls += 1;
      return fakeCompute([1, 2])(legacyState, accountId, options);
    };
    const model = await computeOpponentModel({ state: confirmed, opponentSide: "dire", patch: "7.41e", computeSuggestions: spy });
    expect(calls).toBe(0);
    expect(model.suggestionSet).toBeNull();
    expect(model.shortlist).toEqual([]);
    expect(model.failed).toBe(false);
  });
});

describe("computeOpponentModel -- fail-closed", () => {
  test("computeSuggestions que lanza -> failed:true, nunca propaga la excepción", async () => {
    const state = apRound1State("opp-model-throws");
    const throwing: ComputeSuggestionsForRecommendation = async () => {
      throw new Error("boom");
    };
    const model = await computeOpponentModel({ state, opponentSide: "dire", patch: "7.41e", computeSuggestions: throwing });
    expect(model.failed).toBe(true);
    expect(model.suggestionSet).toBeNull();
    expect(model.shortlist).toEqual([]);
  });
});

describe("opponentValueFor", () => {
  test("héroe ausente del ranking -> null, nunca un 0 fabricado", async () => {
    const state = apRound1State("opp-value-absent");
    const model = await computeOpponentModel({ state, opponentSide: "dire", patch: "7.41e", computeSuggestions: fakeCompute([1, 2]) });
    expect(opponentValueFor(model, 999)).toBeNull();
    expect(opponentValueFor(model, 1)).toBe(100);
  });
});

describe("topPlausibleAction -- determinismo y re-chequeo de legalidad", () => {
  test("recorre el shortlist en orden hasta la primera entrada legal contra el estado real", async () => {
    const state = apRound1State("opp-plausible-scan");
    // dire has ALREADY sealed hero 1 in their OTHER slot this round -- invisible to the mutual
    // model (still hidden), so V6 may still rank hero 1 highly for dire, but the kernel's own
    // same-side-duplicate rule makes re-sealing it in slot 0 illegal.
    const withDireSealed = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 1 }).state;
    const model = await computeOpponentModel({ state: withDireSealed, opponentSide: "dire", patch: "7.41e", computeSuggestions: fakeCompute([1, 2]) });
    const action = topPlausibleAction(model, withDireSealed);
    expect(action).not.toBeNull();
    expect(action!.hero).toBe(2); // hero 1 (top-ranked) is rejected by the real legality re-check
    expect(action!.slot).toEqual({ side: "dire", slotIndex: 0 });
  });

  test("shortlist vacío -> null, nunca una acción fabricada", () => {
    const state = apRound1State("opp-plausible-empty");
    const action = topPlausibleAction(
      { decision: { actor: "dire", actionKind: "PICK", phase: "PICK_ROUND_1", round: 1, step: null, controlledSlots: [{ side: "dire", slotIndex: 0 }], actionCount: 1 }, eligibleHeroIds: null, suggestionSet: null, shortlist: [], failed: false },
      state,
    );
    expect(action).toBeNull();
  });
});
