import { describe, expect, test } from "bun:test";
import { ProtocolSessionStore } from "./protocol-session";
import { createProtocolSessionRoutes } from "./routes/protocol-sessions";
import type { SuggestionSet } from "../signals/mix";

// MVP P0.1 -- Live Companion: a "manual" adapterKind session has no Enemy Bot at all. The Player
// (the sole observer of a REAL match) reports BOTH sides' sealed selections and the actually
// observed bans by hand. These tests prove the exact authorization boundary this mode needs,
// and -- just as important -- that a "simulator" session keeps its EXACT prior behavior
// (SIMULATION must never regress).

function fakeSuggestions(): SuggestionSet {
  return {
    schema: "suggestions/v1",
    sessionId: "preview",
    basedOnSeq: 0,
    decisionContext: "blind_second_pick",
    suggestions: [],
    comparison: null,
    degraded: [],
    computedInMs: 0,
  };
}

function manualPartyContext(side: "radiant" | "dire") {
  return {
    partySize: 5 as const,
    side,
    controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side, slotIndex, controllerId: `p${slotIndex}` })),
  };
}

describe("ProtocolSessionStore -- manual adapterKind (Live Companion)", () => {
  test("SUBMIT_SEALED_SELECTION for the ENEMY side is authorized on a manual session", () => {
    const store = new ProtocolSessionStore();
    const created = store.create({
      sessionId: "s1",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "manual",
      partyContext: manualPartyContext("radiant"),
    });
    expect(created.ok).toBe(true);
    store.applyAtomically("s1", [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);

    const enemyCommand = { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 1 } as const;
    expect(store.isCommandAuthorized("s1", enemyCommand)).toBe(true);
    const result = store.apply("s1", enemyCommand);
    expect(result?.rejected).toBeUndefined();

    const legal = store.authorizedLegalActions("s1")!;
    expect(legal.some((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === "dire")).toBe(true);
    expect(legal.some((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === "radiant")).toBe(true);
  });

  test("SUBMIT_SEALED_SELECTION for the ENEMY side stays FORBIDDEN on a simulator session (SIMULATION unchanged)", () => {
    const store = new ProtocolSessionStore();
    store.create({
      sessionId: "s2",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "simulator",
      partyContext: manualPartyContext("radiant"),
      humanPosition: 1,
      simulatorSeed: "SEED0001",
    });
    // AP Simulator bans come only from the server-side policy -- record directly to reach Round 1.
    store.applyAtomically("s2", [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }]);

    const enemyCommand = { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 1 } as const;
    expect(store.isCommandAuthorized("s2", enemyCommand)).toBe(false);
    const legal = store.authorizedLegalActions("s2")!;
    expect(legal.some((action) => action.type === "SUBMIT_SEALED_SELECTION" && action.side === "dire")).toBe(false);
  });

  test("own-side SUBMIT_SEALED_SELECTION remains authorized on a manual session (unchanged for the Player's own team)", () => {
    const store = new ProtocolSessionStore();
    store.create({
      sessionId: "s3",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "dire",
      adapterKind: "manual",
      partyContext: manualPartyContext("dire"),
    });
    store.applyAtomically("s3", [{ type: "RECORD_RESOLVED_BANS", heroes: [1, 2] }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    const ownCommand = { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 10 } as const;
    expect(store.isCommandAuthorized("s3", ownCommand)).toBe(true);
  });

  test("RECORD_RESOLVED_BANS / BAN_RESOLUTION_COMPLETE are authorized on a manual (non-AP-Simulator) session", () => {
    const store = new ProtocolSessionStore();
    store.create({
      sessionId: "s4",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "manual",
      partyContext: manualPartyContext("radiant"),
    });
    expect(store.isCommandAuthorized("s4", { type: "RECORD_RESOLVED_BANS", heroes: [5] })).toBe(true);
    expect(store.isCommandAuthorized("s4", { type: "BAN_RESOLUTION_COMPLETE" })).toBe(true);
  });
});

describe("createProtocolSessionRoutes -- Enemy Bot routes stay structurally closed for manual sessions", () => {
  test("POST auto-drive on a manual session -> 403 ap_simulator_required (never drives an Enemy Bot)", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions() });
    store.create({
      sessionId: "s5",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "manual",
      partyContext: manualPartyContext("radiant"),
    });
    const response = await routes.postAutoDrive("s5");
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("ap_simulator_required");
  });

  test("POST resolve-bans on a manual session -> 403 ap_simulator_required (never invents bans from a seed)", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions() });
    store.create({
      sessionId: "s6",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "manual",
      partyContext: manualPartyContext("radiant"),
    });
    const request = new Request("http://127.0.0.1/x", {
      method: "POST",
      body: JSON.stringify({ playerBanPreferences: [] }),
      headers: { "content-type": "application/json" },
    });
    const response = await routes.postResolveBans(request, "s6");
    expect(response.status).toBe(403);
  });

  test("POST bot-selection on a manual session -> 403 bot_selection_forbidden", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({ store, computeSuggestions: async () => fakeSuggestions() });
    store.create({
      sessionId: "s7",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      localSide: "radiant",
      adapterKind: "manual",
      partyContext: manualPartyContext("radiant"),
    });
    const request = new Request("http://127.0.0.1/x", { method: "POST", body: "{}", headers: { "content-type": "application/json" } });
    const response = await routes.postBotSelection(request, "s7");
    expect(response.status).toBe(403);
    const body = (await response.json()) as { error: string };
    expect(body.error).toBe("bot_selection_forbidden");
  });
});
