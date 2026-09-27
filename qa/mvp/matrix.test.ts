import { expect, test } from "bun:test";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import { createProtocolSessionRoutes } from "../../apps/engine/src/server/routes/protocol-sessions";
import { loadHeroPositions } from "../../apps/engine/src/signals/hero-positions";
import type { SuggestionSet } from "../../apps/engine/src/signals/mix";
import { independentlyCredibleForPosition, loadQaPositionEvidence } from "./position-oracle";
import { MVP_SCENARIOS } from "./scenarios/matrix";

function request(body: unknown): Request { return new Request("http://qa.local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }
const QA_EVIDENCE = loadQaPositionEvidence();
const QA_HEROES = QA_EVIDENCE.heroes.map((hero) => hero.hero);

function allHeroSuggestions(sessionId: string, basedOnSeq: number): SuggestionSet {
  return {
    schema: "suggestions/v1", sessionId, basedOnSeq, decisionContext: "team_opening",
    suggestions: QA_HEROES.map((hero, index) => ({ hero, rank: (Math.min(index + 1, 6)) as 1 | 2 | 3 | 4 | 5 | 6, score: QA_HEROES.length - index, signals: [], reason: "QA corpus", confidence: "alta" as const, evidenceCoverage: 1, guessingIndex: 0 })),
    comparison: null, degraded: [], computedInMs: 0,
    functionalEvidence: { metaIsStale: false, signalEvidence: [], heroPositions: [], teamOpening: null, partyPreferredPositions: [] },
  };
}

test("QA-MATRIX-000 corpus has at least 100 useful deterministic scenarios", () => {
  expect(MVP_SCENARIOS.length).toBeGreaterThanOrEqual(100);
  expect(new Set(MVP_SCENARIOS.map((scenario) => scenario.id)).size).toBe(MVP_SCENARIOS.length);
});

for (const scenario of MVP_SCENARIOS) {
  test(`QA-MATRIX ${scenario.id}`, async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, heroPositions: loadHeroPositions(), computeSuggestions: async (state) => allHeroSuggestions(state.sessionId, state.lastSeq) });
    const response = await routes.post(request({
      rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator",
      partyContext: { partySize: scenario.partySize, side: "radiant", controlledSlots: [] }, controlledPositions: scenario.humanPositions,
      humanPosition: scenario.humanPosition, simulatorSeed: scenario.seed,
    }));
    expect(response.status).toBe(201);
    const { sessionId } = await response.json() as { sessionId: string };
    expect(store.metadata(sessionId)?.controlledPositions).toEqual(scenario.expectedControl);
    expect(store.humanOpenPositions(sessionId)).toEqual(scenario.expectedControl);
    const complement = [1, 2, 3, 4, 5].filter((position) => !scenario.expectedControl.includes(position));
    expect(store.allyBotPositions(sessionId)).toEqual(complement);
    store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    const recommendationResponse = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v3`));
    expect(recommendationResponse.status).toBe(200);
    const payload = await recommendationResponse.json() as { recommendationSet: { decision: { controlledSlots: { position?: 1 | 2 | 3 | 4 | 5 }[] }; recommendations: { actions: { hero: number; slot: { position?: 1 | 2 | 3 | 4 | 5 } }[] }[] } };
    for (const slot of payload.recommendationSet.decision.controlledSlots) expect(scenario.expectedControl).toContain(slot.position);
    for (const action of payload.recommendationSet.recommendations.flatMap((recommendation) => recommendation.actions)) {
      expect(action.slot.position).toBeDefined();
      expect(independentlyCredibleForPosition(QA_EVIDENCE, action.hero, action.slot.position!).credible).toBe(true);
    }
  });
}
