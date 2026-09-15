import { describe, expect, test } from "bun:test";
import type { RecommendationSetV2 } from "../../recommendation";
import type { SuggestionSet } from "../../signals/mix";
import type { FunctionalRecommendationEvidence } from "../../recommendation/evidence";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// R1 S5 -- HTTP surface for RecommendationSet/v2. Same trust-boundary discipline as `get()`
// (protocol-sessions.test.ts): a caller can only ever request ITS OWN side's recommendations.

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });
}

const CREATE_BODY = {
  rulesetId: "dota2/ranked-all-pick",
  patch: "7.41e",
  localSide: "radiant",
  adapterKind: "manual",
  partyContext: {
    partySize: 5,
    side: "radiant",
    controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant", slotIndex, controllerId: `p${slotIndex}` })),
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
      rank: (Math.min(index + 1, 6)) as 1 | 2 | 3 | 4 | 5 | 6,
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

async function createSession(routes: ReturnType<typeof createProtocolSessionRoutes>): Promise<string> {
  const response = await routes.post(jsonRequest(CREATE_BODY));
  const body = (await response.json()) as { sessionId: string };
  return body.sessionId;
}

describe("createProtocolSessionRoutes -- GET .../recommendations (R1 S5)", () => {
  test("devuelve un RecommendationSet/v2 válido con basedOn/decision/recommendations", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1, 2, 3]) });
    const sessionId = await createSession(routes);
    // Ranked All Pick needs BAN_RESOLUTION_COMPLETE before any sealed slot is open.
    await routes.postCommand(jsonRequest({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), sessionId);

    const response = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations`));
    expect(response.status).toBe(200);
    const body = (await response.json()) as RecommendationSetV2;
    expect(body.schema).toBe("recommendation-set/v2");
    expect(body.decision.actor).toBe("radiant");
    expect(body.recommendations.length).toBeGreaterThan(0);
  });

  test("una petición pidiendo la perspectiva del OTRO lado se rechaza -- el navegador no puede inyectar una perspectiva ajena", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1, 2, 3]) });
    const sessionId = await createSession(routes);

    const response = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?side=dire`));
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("perspective_forbidden");
  });

  test("sesión inexistente -> 404, nunca una recomendación fabricada", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1, 2, 3]) });
    const response = await routes.getRecommendations("no-such-session", new URL("http://127.0.0.1/api/session/protocol/no-such-session/recommendations"));
    expect(response.status).toBe(404);
  });

  test("?format=legacy proyecta a suggestions/v1 SIN rescorear -- mismo score que la recomendación V2", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions([1, 2, 3]) });
    const sessionId = await createSession(routes);
    await routes.postCommand(jsonRequest({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), sessionId);
    // Seal one of the two round-1 slots so the remaining decision is single-action (V1 has no
    // compound shape to translate into).
    await routes.postCommand(jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 99 } }), sessionId);

    const v2Response = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations`));
    const v2 = (await v2Response.json()) as RecommendationSetV2;

    const legacyResponse = await routes.getRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/recommendations?format=legacy`));
    expect(legacyResponse.status).toBe(200);
    const legacy = (await legacyResponse.json()) as SuggestionSet;
    expect(legacy.schema).toBe("suggestions/v1");
    expect(legacy.suggestions[0]!.hero).toBe(v2.recommendations[0]!.actions[0]!.hero);
    expect(legacy.suggestions[0]!.score).toBe(v2.recommendations[0]!.score);
  });
});
