import { describe, expect, test } from "bun:test";
import { authoritativeStateHash, createProtocolState } from "../draft-protocol";
import { applyManualObservation, type ManualProtocolObservation } from "../draft-protocol/adapters/manual-observation";
import { resolveSimulatorCollisionAuthority } from "../draft-protocol/adapters/simulator-authority";
import type { DraftProtocolState } from "../draft-protocol";
import type { SuggestionSet } from "../signals/mix";
import { ProtocolSessionStore } from "./protocol-session";
import { createProtocolSessionRoutes } from "./routes/protocol-sessions";

function jsonRequest(body: unknown): Request {
  return new Request("http://127.0.0.1/x", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json" },
  });
}

function suggestions(heroId: number): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "adapter-parity",
    basedOnSeq: 0,
    decisionContext: "blind_second_pick",
    suggestions: [{ hero: heroId, rank: 1, score: 1, signals: [], reason: "parity", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 }],
    comparison: null,
    degraded: [],
    computedInMs: 0,
  };
}

function observe(state: DraftProtocolState, observation: ManualProtocolObservation): DraftProtocolState {
  const result = applyManualObservation(state, observation);
  expect(result).not.toBeNull();
  expect(result?.rejected).toBeUndefined();
  return result!.state;
}

describe("adapter parity real -- manual observations vs simulator HTTP routes", () => {
  test("AP sealed/reveal/collision produce el mismo estado y hash canónicos", async () => {
    const created = createProtocolState("adapter-parity", "dota2/ranked-all-pick");
    if (!created.ok) throw new Error("manual setup failed");
    let manualState = observe(created.state, { type: "AP_BAN_RESOLUTION_OBSERVED" });

    const botQueue = [401, 902, 402, 403];
    const simulatorStore = new ProtocolSessionStore();
    simulatorStore.create({
      sessionId: "adapter-parity",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
    });
    const routes = createProtocolSessionRoutes({
      store: simulatorStore,
      computeSuggestions: async () => suggestions(botQueue.shift()!),
    });
    await routes.postCommand(jsonRequest({ command: { type: "BAN_RESOLUTION_COMPLETE" } }), "adapter-parity");

    const local = async (slotIndex: number, heroId: number) => {
      manualState = observe(manualState, { type: "AP_SEALED_SELECTION_OBSERVED", side: "radiant", slotIndex, heroId });
      const response = await routes.postCommand(
        jsonRequest({ command: { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex, heroId } }),
        "adapter-parity",
      );
      expect(response.status).toBe(202);
    };
    const bot = async (slotIndex: number, heroId: number) => {
      manualState = observe(manualState, { type: "AP_SEALED_SELECTION_OBSERVED", side: "dire", slotIndex, heroId });
      const response = await routes.postBotSelection(jsonRequest({}), "adapter-parity");
      expect(response.status).toBe(200);
    };

    await local(0, 401);
    await local(1, 901);
    await bot(0, 401);
    await bot(1, 902);
    await local(0, 402);
    await bot(0, 402);
    await local(0, 403);
    await bot(0, 403);

    expect(manualState.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    expect(simulatorStore.get("adapter-parity")!.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");
    const resolution = resolveSimulatorCollisionAuthority(manualState, "ABCDEFGH");
    if (!resolution) throw new Error("missing parity resolution");
    manualState = observe(manualState, {
      type: "AP_COLLISION_RESOLUTION_OBSERVED",
      round: resolution.command.round,
      heroId: resolution.command.heroId,
      winner: resolution.command.winner,
    });
    const response = await routes.postSimulatorAuthority(jsonRequest({ seed: "ABCDEFGH" }), "adapter-parity");
    expect(response.status).toBe(200);

    const simulatorState = simulatorStore.get("adapter-parity")!;
    expect(authoritativeStateHash(manualState)).toBe(authoritativeStateHash(simulatorState));
    expect(manualState.rankedAp!.confirmedPicks.some((pick) => pick.heroId === 901)).toBe(true);
    expect(manualState.rankedAp!.bannedHeroes).toEqual(expect.arrayContaining([401, 402]));
  });
});
