import { expect, test } from "bun:test";
import { parseCoachOutput } from "../../apps/web/features/random-draft-simulator/coach-client";
import { parseRecommendationSet } from "../../apps/web/features/random-draft-simulator/protocol-client";
import { useRandomDraftStore } from "../../apps/web/features/random-draft-simulator/store";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import { createProtocolSessionRoutes } from "../../apps/engine/src/server/routes/protocol-sessions";
import { expectedHighlightIds } from "./oracles/ui-semantics-oracle";

function request(body: unknown): Request { return new Request("http://qa.local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); }

test("contract:engine-web preserves V2 Pos2 and Coach team semantics through HTTP, parser, store, and highlight source", async () => {
  const store = new ProtocolSessionStore();
  const routes = createProtocolSessionRoutes({ store });
  const created = await routes.post(request({
    rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator",
    partyContext: { partySize: 1, side: "radiant", controlledSlots: [] }, controlledPositions: [2], humanPosition: 2, simulatorSeed: "QACONTRACT01",
  }));
  expect(created.status).toBe(201);
  const { sessionId } = await created.json() as { sessionId: string };
  store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
  const response = await routes.getRecommendations(sessionId, new URL(`http://qa.local/${sessionId}/recommendations?format=v3`));
  expect(response.status).toBe(200);
  const body = await response.json() as { recommendationSet: unknown; output: unknown };
  const v2 = parseRecommendationSet(body.recommendationSet);
  expect(v2).not.toBeNull();
  expect(v2!.decision.controlledSlots.map((slot) => slot.position)).toEqual([2]);
  useRandomDraftStore.getState().setRecommendations(v2);
  expect(useRandomDraftStore.getState().recommendations?.decision.controlledSlots.map((slot) => slot.position)).toEqual([2]);

  const coach = body.output === null ? null : parseCoachOutput(body.output);
  expect(body.output === null || coach !== null).toBe(true);
  useRandomDraftStore.getState().setCoach(coach);
  const displayed = expectedHighlightIds(
    coach ? "coach-team-shortlist" : "v2-personal-recommendations",
    v2!.recommendations,
    coach?.shortlist ?? null,
  );
  const source = coach?.shortlist.map((card) => card.heroId) ?? v2!.recommendations.flatMap((entry) => entry.actions.map((action) => action.hero));
  expect(displayed).toEqual(source);
});
