import { describe, expect, test } from "bun:test";
import { ProtocolSessionStore } from "./protocol-session";

describe("ProtocolSessionStore -- S2.1/S2.5/S3 session layer", () => {
  test("create + get -- estado inicial ACTIVE para Ranked All Pick", () => {
    const store = new ProtocolSessionStore();
    const created = store.create({ sessionId: "s1", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    expect(created.ok).toBe(true);
    expect(store.get("s1")?.status).toBe("ACTIVE");
    expect(store.metadata("s1")?.patch).toBe("7.41e");
  });

  test("sesión inexistente -> get/view/legalActions/apply devuelven null, nunca lanzan", () => {
    const store = new ProtocolSessionStore();
    expect(store.get("ghost")).toBeNull();
    expect(store.view("ghost")).toBeNull();
    expect(store.legalActions("ghost")).toBeNull();
    expect(store.apply("ghost", { type: "BAN_RESOLUTION_COMPLETE" })).toBeNull();
  });

  test("crear dos veces el mismo sessionId se rechaza", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "dup", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const second = store.create({ sessionId: "dup", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.reason).toBe("SESSION_ALREADY_EXISTS");
  });

  test("party size 4 se rechaza en la creación (delegando a createPartyContext de S1)", () => {
    const store = new ProtocolSessionStore();
    const result = store.create({
      sessionId: "party4",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      partyContext: { partySize: 4, side: "radiant", controlledSlots: [] },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("INVALID_PARTY_CONTEXT");
  });

  test("Captain's Mode exige partySize 5 -- 2/3 se rechazan, 5 se acepta", () => {
    const store = new ProtocolSessionStore();
    const rejected = store.create({
      sessionId: "cm-party3",
      rulesetId: "dota2/captains-mode",
      patch: "7.40",
      partyContext: { partySize: 3, side: "radiant", controlledSlots: [] },
    });
    expect(rejected.ok).toBe(false);
    if (!rejected.ok) expect(rejected.reason).toBe("CM_REQUIRES_PARTY_SIZE_5");

    const accepted = store.create({
      sessionId: "cm-party5",
      rulesetId: "dota2/captains-mode",
      patch: "7.40",
      partyContext: {
        partySize: 5,
        side: "radiant",
        controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant" as const, slotIndex, controllerId: `p${slotIndex}` })),
      },
    });
    expect(accepted.ok).toBe(true);
    expect(store.partyContext("cm-party5")?.partySize).toBe(5);
  });

  test("Captain's Mode sin partyContext se rechaza", () => {
    const store = new ProtocolSessionStore();
    const result = store.create({ sessionId: "cm-no-party", rulesetId: "dota2/captains-mode", patch: "7.40" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("CM_REQUIRES_PARTY_SIZE_5");
    expect(store.partyContext("cm-no-party")).toBeNull();
  });

  test("apply actualiza el estado de la sesión y view() proyecta desde el estado nuevo", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "flow", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const result = store.apply("flow", { type: "BAN_RESOLUTION_COMPLETE" });
    expect(result?.rejected).toBeUndefined();
    expect(store.get("flow")?.rankedAp?.phase).toBe("PICK_ROUND_1");

    store.apply("flow", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 55 });
    const radiantView = store.view("flow");
    expect(radiantView?.ownPicks[0]).toEqual({ visibility: "KNOWN", heroId: 55 });
  });

  test("un comando rechazado no rompe la sesión -- el estado sigue siendo el anterior", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "reject", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const before = store.get("reject");
    const result = store.apply("reject", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 });
    expect(result?.rejected).toBe("WRONG_PHASE"); // still BAN_RESOLUTION
    expect(store.get("reject")).toBe(before);
  });

  test("legalActions refleja el estado actual de la sesión", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "legal", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const banPhaseActions = store.legalActions("legal");
    expect(banPhaseActions).toEqual([{ type: "RECORD_RESOLVED_BANS" }, { type: "BAN_RESOLUTION_COMPLETE" }]);
    store.apply("legal", { type: "BAN_RESOLUTION_COMPLETE" });
    const pickPhaseActions = store.legalActions("legal");
    expect(pickPhaseActions?.length).toBeGreaterThan(0);
  });

  test("evictStale elimina sesiones inactivas más allá del TTL, respeta las recientes", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "old", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" }, 0);
    store.create({ sessionId: "fresh", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" }, 1_000_000);
    store.evictStale(2_000_000, 1_500_000);
    expect(store.get("old")).toBeNull();
    expect(store.get("fresh")).not.toBeNull();
  });
});
