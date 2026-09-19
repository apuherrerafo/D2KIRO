import { describe, expect, test } from "bun:test";
import type { RecommendationOutputV3 } from "../../coach";
import type { RecommendationSetV2 } from "../../recommendation";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import type { SuggestionSet } from "../../signals/mix";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// AP Ranked Roles V1 / Wave 2 -- `GET .../recommendations?format=v3`: the Coach over the HTTP surface.
// The plain V2 response must stay exactly what it was (RecommendationSetV2 consumers are unchanged).

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

const CREATE_BODY = {
  rulesetId: "dota2/ranked-all-pick",
  patch: "7.41e",
  localSide: "radiant",
  adapterKind: "simulator",
  humanPosition: 2,
  simulatorSeed: "COACH001",
  partyContext: {
    partySize: 5,
    side: "radiant",
    controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: "player" })),
  },
} as const;

function fakeSuggestions(heroIds: number[]): SuggestionSet {
  const functionalEvidence: FunctionalRecommendationEvidence = {
    metaIsStale: false,
    signalEvidence: heroIds.map((hero) => ({ hero, signals: [] })),
    heroPositions: [],
    teamOpening: null,
    partyPreferredPositions: [],
  };
  return {
    schema: "suggestions/v1",
    sessionId: "preview",
    basedOnSeq: 0,
    decisionContext: "team_opening",
    suggestions: heroIds.map((hero, index) => ({
      hero,
      rank: Math.min(index + 1, 6) as 1 | 2 | 3 | 4 | 5 | 6,
      score: 100 - index,
      signals: [{ signal: "position_fit" as const, raw: 0.5, normalized: 50, evidenceConfidence: 1, weighted: 100 - index, explanation: "fixture", sampleSize: 50 }],
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

async function setup() {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1, 2, 3, 4, 5, 6]) });
  const created = await routes.post(jsonRequest(CREATE_BODY));
  const { sessionId } = (await created.json()) as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  const url = (query = "") => new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations${query}`);
  return { store, routes, sessionId, url };
}

describe("GET .../recommendations?format=v3", () => {
  test("devuelve { output: RecommendationOutputV3, recommendationSet: RecommendationSetV2 } con una acción primaria antes del primer pick", async () => {
    const { routes, sessionId, url } = await setup();
    const response = await routes.getRecommendations(sessionId, url("?format=v3"));
    expect(response.status).toBe(200);
    const body = (await response.json()) as { output: RecommendationOutputV3; recommendationSet: RecommendationSetV2 };
    expect(body.output.schema).toBe("recommendation-output/v3");
    expect(body.output.primaryAction.label.length).toBeGreaterThan(0);
    expect(body.output.meta.trigger).toBe("DRAFT_PICKS_STARTED");
    expect(body.recommendationSet.schema).toBe("recommendation-set/v2");
    expect(body.output.meta.basedOn.stateIdentity).toBe(body.recommendationSet.basedOn.stateIdentity);
  });

  test("COMPATIBILIDAD: sin ?format el cuerpo sigue siendo un RecommendationSetV2 plano (sin `output`)", async () => {
    const { routes, sessionId, url } = await setup();
    const body = (await (await routes.getRecommendations(sessionId, url())).json()) as Record<string, unknown>;
    expect(body.schema).toBe("recommendation-set/v2");
    expect(body).not.toHaveProperty("output");
  });

  test("el set embebido en v3 viene del camino SEGURO: mismas recomendaciones que el V2 legacy, sin lookahead (NOT_COMPUTED) ni seed del Simulator", async () => {
    const { routes, sessionId, url } = await setup();
    const plain = (await (await routes.getRecommendations(sessionId, url())).json()) as RecommendationSetV2;
    const embedded = ((await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { recommendationSet: RecommendationSetV2 }).recommendationSet;
    expect(embedded.recommendations).toEqual(plain.recommendations);
    expect(embedded.decision).toEqual(plain.decision);
    expect(embedded.deferred).toEqual({ opponentResponse: "NOT_COMPUTED", steal: "NOT_COMPUTED", lookahead: "NOT_COMPUTED", counterfactual: "NOT_COMPUTED" });
    expect(plain.basedOn.seed).toBe("COACH001"); // legacy path keeps threading the session seed
    expect(embedded.basedOn.seed).toBeNull(); // the Coach path never receives it
  });

  test("tras un pick propio, la siguiente petición recomputa con OWN_PICK_CONFIRMED y nueva identidad de estado", async () => {
    const { routes, store, sessionId, url } = await setup();
    const first = (await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { output: RecommendationOutputV3 };
    store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 });
    const second = (await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { output: RecommendationOutputV3 };
    expect(second.output.meta.trigger).toBe("OWN_PICK_CONFIRMED");
    expect(second.output.meta.basedOn.stateIdentity).not.toBe(first.output.meta.basedOn.stateIdentity);
    expect(second.output.meta.revision).toBeGreaterThan(first.output.meta.revision);
  });

  test("la perspectiva ajena sigue prohibida también en v3", async () => {
    const { routes, sessionId, url } = await setup();
    const response = await routes.getRecommendations(sessionId, url("?format=v3&side=dire"));
    expect(response.status).toBe(403);
  });

  test("el Coach es sólo de Ranked All Pick: una sesión de Captain's Mode responde 422, no un consejo inventado", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1, 2, 3]) });
    const created = await routes.post(
      jsonRequest({
        rulesetId: "dota2/captains-mode",
        patch: "7.41e",
        localSide: "radiant",
        adapterKind: "manual",
        partyContext: { partySize: 5, side: "radiant", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })) },
      }),
    );
    const { sessionId } = (await created.json()) as { sessionId: string };
    const response = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=v3`));
    expect(response.status).toBe(422);
  });

  test("sin decisión abierta (draft completo) output es null, nunca una acción inventada", async () => {
    const { routes, store, sessionId, url } = await setup();
    // Fill every seat of every round for both sides -> COMPLETE.
    const fill = (round: number[], radiant: number[], dire: number[]) => {
      round.forEach((slotIndex, index) => store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId: radiant[index]! }));
      round.forEach((slotIndex, index) => store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex, heroId: dire[index]! }));
    };
    fill([0, 1], [11, 12], [21, 22]);
    fill([0, 1], [13, 14], [23, 24]);
    fill([0], [15], [25]);
    expect(store.get(sessionId)!.status).toBe("COMPLETE");
    const body = (await (await routes.getRecommendations(sessionId, url("?format=v3"))).json()) as { output: unknown };
    expect(body.output).toBeNull();
  });
});
