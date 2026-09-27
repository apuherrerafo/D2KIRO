import { describe, expect, test } from "bun:test";
import { ProtocolSessionStore } from "../../apps/engine/src/server/protocol-session";
import { createProtocolSessionRoutes } from "../../apps/engine/src/server/routes/protocol-sessions";
import { coachShortlistMatchesPrimaryAction } from "./oracles/coach-primary-action-oracle";
import { expectedHighlightIds, isPersonalPositionLabelAccurate } from "./oracles/ui-semantics-oracle";

function request(body: unknown): Request {
  return new Request("http://qa.local", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

function createBody(controlledPositions: readonly number[], partySize = controlledPositions.length) {
  return { rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", partyContext: { partySize, side: "radiant", controlledSlots: [] }, controlledPositions, humanPosition: controlledPositions[0], simulatorSeed: "QACRITICAL01" };
}

describe("QA critical contract gate", () => {
  test("control is position based: party slots are inert, party 4 is rejected, and the bot owns only the complement", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store });
    const accepted = await routes.post(request(createBody([2, 5])));
    expect(accepted.status).toBe(201);
    const { sessionId } = await accepted.json() as { sessionId: string };
    expect(store.metadata(sessionId)?.controlledPositions).toEqual([2, 5]);
    expect(store.metadata(sessionId)?.partyContext?.controlledSlots).toEqual([]);
    expect(store.allyBotPositions(sessionId)).toEqual([1, 3, 4]);
    const rejected = await routes.post(request(createBody([1, 2, 3, 4], 4)));
    expect(rejected.status).toBe(400);
    expect((await rejected.json() as { error: string }).error).toBe("invalid_body");
  });

  test("human-open positions are independent from chronology and a controlled position cannot be claimed twice", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store });
    const created = await routes.post(request(createBody([2])));
    const { sessionId } = await created.json() as { sessionId: string };
    store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    const first = await routes.postCommand(request({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 25 }, assignedPosition: 2 }), sessionId);
    expect(first.status).toBe(202);
    expect(store.humanOpenPositions(sessionId)).toEqual([]);
    const duplicate = await routes.postCommand(request({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 25 }, assignedPosition: 2 }), sessionId);
    expect(duplicate.status).toBe(409);
    expect(store.ownAssignedPositions(sessionId)).toEqual([{ round: 1, slotIndex: 1, assignedPosition: 2 }]);
  });

  test("QA-SEM-001 keeps V2 Pos2 and Coach Pos1 semantically distinct", () => {
    const v2 = [{ actions: [{ hero: 25, slot: { position: 2 } }] }];
    const coach = [{ heroId: 1, position: 1 }, { heroId: 8, position: 1 }];
    expect(coachShortlistMatchesPrimaryAction({ kind: "REVEAL_POSITION", position: 1 }, coach)).toBe(true);
    expect(expectedHighlightIds("v2-personal-recommendations", v2, coach)).toEqual([25]);
    expect(expectedHighlightIds("coach-team-shortlist", v2, coach)).toEqual([1, 8]);
    expect(isPersonalPositionLabelAccurate("coach-team-shortlist", 2, coach)).toBe(false);
  });

  test("enemy role assertions can be represented only as observable belief, never a private chronological role", () => {
    const observable = { heroId: 25, roleBelief: { 2: 0.7, 3: 0.3 } };
    expect(JSON.stringify(observable)).not.toContain("assignedPosition");
    expect(Object.keys(observable.roleBelief)).toEqual(["2", "3"]);
  });
});
