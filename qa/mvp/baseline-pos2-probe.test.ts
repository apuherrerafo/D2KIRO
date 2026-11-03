import { expect, test } from "bun:test";
import { createProtocolSessionRoutes } from "../../apps/engine/src/server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import { loadHeroPositions } from "../../apps/engine/src/signals/hero-positions";
import type { SuggestionSet } from "../../apps/engine/src/signals/mix";
import { independentlyCredibleForPosition, loadQaPositionEvidence } from "./position-oracle";

const CARRY_IDS = [1, 8, 12] as const; // Anti-Mage, Juggernaut, Phantom Lancer.
const MID_ID = 25; // Lina; substantial Pos2 evidence in the shipped artifact.

function request(body: unknown): Request {
  return new Request("http://qa.local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

test("QA-P0-001 baseline probe: Solo Pos2 does not serialize carry-only candidates as Pos2 Coach options", async () => {
  const positions = loadHeroPositions();
  const evidence = loadQaPositionEvidence();
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({
    store,
    heroPositions: positions,
    computeSuggestions: async (state): Promise<SuggestionSet> => ({
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: "team_opening",
      suggestions: [...CARRY_IDS, MID_ID].map((hero, index) => ({ hero, rank: (index + 1) as 1 | 2 | 3 | 4, score: 100 - index, signals: [], reason: "QA probe", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 })),
      comparison: null,
      degraded: [],
      computedInMs: 0,
      functionalEvidence: { metaIsStale: false, signalEvidence: [], heroPositions: [], teamOpening: null, partyPreferredPositions: [] },
    }),
  });
  const created = await routes.post(request({
    rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator",
    partyContext: { partySize: 1, side: "radiant", controlledSlots: [] }, controlledPositions: [2], humanPosition: 2, simulatorSeed: "QAP00001",
  }));
  expect(created.status).toBe(201);
  const { sessionId } = await created.json() as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v3`));
  expect(response.status).toBe(200);
  const body = await response.json() as { recommendationSet: { decision: { controlledSlots: { position?: number }[]; humanActionability?: { eligiblePositions: number[]; roundCapacity: number } }; recommendations: { actions: { hero: number }[] }[] }; output: { shortlist: { heroId: number }[] } | null };
  expect(store.metadata(sessionId)?.controlledPositions).toEqual([2]);
  expect(store.humanOpenPositions(sessionId)).toEqual([2]);
  // PD-001: eligibility lives on humanActionability; the generic round slot carries NO position.
  expect(body.recommendationSet.decision.humanActionability).toMatchObject({ eligiblePositions: [2], roundCapacity: 1 });
  expect(body.recommendationSet.decision.controlledSlots.map((slot) => slot.position)).toEqual([undefined]);
  const serialized = body.recommendationSet.recommendations.flatMap((entry) => entry.actions.map((action) => action.hero));
  const coach = body.output?.shortlist.map((card) => card.heroId) ?? [];
  expect(serialized).toEqual([MID_ID]);
  expect(coach).toEqual([MID_ID]);
  for (const carry of CARRY_IDS) {
    expect(independentlyCredibleForPosition(evidence, carry, 2).credible).toBe(false);
    expect(serialized).not.toContain(carry);
    expect(coach).not.toContain(carry);
  }
});
