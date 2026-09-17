import { describe, expect, test } from "bun:test";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import type { DraftState } from "../../draft/reducer";
import type { SuggestionSet } from "../../signals/mix";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes, type ComputeSuggestionsForDraftState } from "./protocol-sessions";

function request(body: unknown): Request {
  return new Request("http://127.0.0.1/x", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const SOLO_MID_BODY = {
  rulesetId: "dota2/ranked-all-pick",
  patch: "7.41e",
  localSide: "radiant",
  adapterKind: "simulator",
  partyContext: {
    partySize: 1,
    side: "radiant",
    controlledSlots: [{ side: "radiant", slotIndex: 4, controllerId: "julio" }],
  },
  humanPosition: 2,
  humanRosterSlot: 4,
  simulatorSeed: "D2K00001",
} as const;

function suggestionsFor(state: DraftState, options: Parameters<ComputeSuggestionsForDraftState>[2]): SuggestionSet {
  const target = options?.targetPosition ?? 2;
  const sideOffset = state.localSide === "dire" ? 60 : 0;
  const start = sideOffset + target * 6 + 1;
  const heroes = Array.from({ length: 6 }, (_, index) => start + index);
  const functionalEvidence: FunctionalRecommendationEvidence = {
    metaIsStale: false,
    signalEvidence: heroes.map((hero) => ({ hero, signals: [] })),
    heroPositions: [],
    teamOpening: null,
    partyPreferredPositions: [],
  };
  return {
    schema: "suggestions/v1",
    sessionId: state.sessionId,
    basedOnSeq: 0,
    decisionContext: "closing_pick",
    suggestions: heroes.map((hero, index) => ({
      hero,
      rank: (index + 1) as 1 | 2 | 3 | 4 | 5 | 6,
      score: 100 - index,
      signals: [],
      reason: "fixture",
      confidence: "alta" as const,
      evidenceCoverage: 1,
      guessingIndex: 0,
    })),
    comparison: null,
    degraded: [],
    computedInMs: 0,
    functionalEvidence,
  };
}

describe("AP Solo Mid recovery product path", () => {
  test("autoriza un solo pick humano, auto-conduce 9 externos y pasa targetPosition=2 sin teamOpening", async () => {
    const calls: { state: DraftState; options: Parameters<ComputeSuggestionsForDraftState>[2] }[] = [];
    const computeSuggestions: ComputeSuggestionsForDraftState = async (state, _accountId, options) => {
      calls.push({ state, options });
      return suggestionsFor(state, options);
    };
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions });
    const createdResponse = await routes.post(request(SOLO_MID_BODY));
    expect(createdResponse.status).toBe(201);
    const { sessionId } = (await createdResponse.json()) as { sessionId: string };
    await routes.postCommand(request({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), sessionId);

    const forbidden = await routes.postCommand(request({
      command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 120 },
    }), sessionId);
    expect(forbidden.status).toBe(403);

    const round1 = await routes.postAutoDrive(sessionId);
    const round1Body = await round1.json() as { stopReason: string; externalPicks: unknown[] };
    expect(round1Body.stopReason).toBe("round_revealed");
    expect(round1Body.externalPicks).toHaveLength(4);
    const round2 = await routes.postAutoDrive(sessionId);
    const round2Body = await round2.json() as { stopReason: string; externalPicks: unknown[] };
    expect(round2Body.stopReason).toBe("round_revealed");
    expect(round2Body.externalPicks).toHaveLength(8);
    const humanPause = await routes.postAutoDrive(sessionId);
    const humanBody = await humanPause.json() as {
      stopReason: string;
      legalActions: { type: string; side: string; slotIndex: number }[];
    };
    expect(humanBody.stopReason).toBe("human_input");
    expect(humanBody.legalActions).toEqual([{ type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0 }]);

    const recommendationResponse = await routes.getRecommendations(
      sessionId,
      new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations`),
    );
    const recommendation = await recommendationResponse.json() as { recommendations: { actions: { hero: number }[] }[] };
    expect(recommendation.recommendations).toHaveLength(6);
    const humanCall = calls.findLast((call) => call.state.localSide === "radiant"
      && call.state.picks.radiant.length === 4
      && call.state.picks.dire.length === 4);
    expect(humanCall?.options?.targetPosition).toBe(2);
    expect(humanCall?.options?.teamOpening).toBe(false);

    const humanHero = recommendation.recommendations[0]!.actions[0]!.hero;
    const accepted = await routes.postCommand(request({
      command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: humanHero },
    }), sessionId);
    expect(accepted.status).toBe(202);
    expect((await accepted.json() as { accepted: boolean }).accepted).toBe(true);

    const final = await routes.postAutoDrive(sessionId);
    const finalBody = await final.json() as { view: { status: string; ownPicks: unknown[]; enemyPicks: unknown[] }; externalPicks: unknown[] };
    expect(finalBody.view.status).toBe("COMPLETE");
    expect(finalBody.view.ownPicks).toHaveLength(5);
    expect(finalBody.view.enemyPicks).toHaveLength(5);
    expect(finalBody.externalPicks).toHaveLength(9);
  });
});
