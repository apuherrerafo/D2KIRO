import { describe, expect, test } from "bun:test";
import { ProtocolSessionStore } from "./protocol-session";

// AP Ranked Roles V1 / Wave 1 Task 12 -- the timer / gold-penalty layer lives in the session store
// (Simulator layer), driven by an INJECTED clock: no test here depends on wall time.

const T0 = 5_000_000;

function apSession(store: ProtocolSessionStore, sessionId = "t"): string {
  const created = store.create({
    sessionId,
    rulesetId: "dota2/ranked-all-pick",
    patch: "7.41e",
    localSide: "dire",
    adapterKind: "simulator",
    humanPosition: 3,
    simulatorSeed: "D2K00001",
    partyContext: { partySize: 5, side: "dire", controlledSlots: [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "dire" as const, slotIndex, controllerId: "player" })) },
  });
  if (!created.ok) throw new Error("setup");
  const applied = store.applyAtomically(sessionId, [{ type: "RECORD_RESOLVED_BANS", heroes: [] }, { type: "BAN_RESOLUTION_COMPLETE" }], T0);
  if (!applied?.ok) throw new Error("bans");
  return sessionId;
}

describe("simulator timer inside ProtocolSessionStore", () => {
  test("no hay timer hasta que el Simulator entrega la ronda al Player; el kernel nunca recibe tiempo", () => {
    const store = new ProtocolSessionStore();
    const id = apSession(store);
    expect(store.simulatorTimerView(id, T0)).toBeNull();
    const before = JSON.stringify(store.get(id));
    store.ensureSimulatorTimer(id, T0);
    expect(JSON.stringify(store.get(id))).toBe(before); // timer state is NOT part of DraftProtocolState
  });

  test("la penalizacion es por asiento pendiente: confirmar uno detiene el suyo, el otro sigue", () => {
    const store = new ProtocolSessionStore();
    const id = apSession(store);
    store.ensureSimulatorTimer(id, T0);
    // Seat 0 confirms 2 s after the 25 s deadline; seat 1 stays pending.
    store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 10 }, T0 + 27_000);
    const view = store.simulatorTimerView(id, T0 + 30_000)!;
    expect(view.pendingSeats).toEqual([1]);
    expect(view.goldPenaltyBySlot[0]).toBe(4);
    expect(view.goldPenaltyBySlot[1]).toBe(10);
    expect(view.penaltyActive).toBe(true);
    const later = store.simulatorTimerView(id, T0 + 40_000)!;
    expect(later.goldPenaltyBySlot[0]).toBe(4);
    expect(later.goldPenaltyBySlot[1]).toBe(30);
  });

  test("al vencer NO se asigna ningun heroe: el asiento sigue abierto y el Player todavia puede elegir", () => {
    const store = new ProtocolSessionStore();
    const id = apSession(store);
    store.ensureSimulatorTimer(id, T0);
    expect(store.simulatorTimerView(id, T0 + 120_000)!.penaltyActive).toBe(true);
    const ranked = store.get(id)!.rankedAp!;
    expect(ranked.round?.sealed).toHaveLength(0);
    expect(ranked.confirmedPicks).toHaveLength(0);
    const late = store.apply(id, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 11 }, T0 + 120_000);
    expect(late?.rejected).toBeUndefined();
    expect(store.simulatorTimerView(id, T0 + 121_000)!.pendingSeats).toEqual([0]);
  });

  test("el timer de una sesion no AP-Simulator es siempre null", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "manual", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    expect(store.ensureSimulatorTimer("manual", T0)).toBeNull();
    expect(store.simulatorTimerView("manual", T0)).toBeNull();
  });
});

describe("ProtocolSessionStore.applyAtomically", () => {
  test("si el kernel rechaza un comando, no queda ningun cambio a medias", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "atomic", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    const before = JSON.stringify(store.get("atomic"));
    const result = store.applyAtomically("atomic", [{ type: "RECORD_RESOLVED_BANS", heroes: [5] }, { type: "RECORD_RESOLVED_BANS", heroes: [5] }]);
    expect(result).toMatchObject({ ok: false, index: 1 });
    expect(JSON.stringify(store.get("atomic"))).toBe(before);
  });
});

describe("test-only clock seam", () => {
  test("advanceTestClock mueve SOLO el reloj del timer de esa sesion; sin llamarlo el offset es 0", () => {
    const store = new ProtocolSessionStore();
    const id = apSession(store);
    store.ensureSimulatorTimer(id, T0);
    const before = store.simulatorTimerView(id, T0 + 1000)!;
    expect(store.advanceTestClock(id, 30_000)).toBe(true);
    // The explicit-clock path (used by every other test) is unaffected by the offset.
    expect(store.simulatorTimerView(id, T0 + 1000)).toEqual(before);
    expect(store.advanceTestClock("missing", 1000)).toBe(false);
    expect(store.advanceTestClock(id, -5)).toBe(false);
  });

  test("la ruta test-advance-clock es 404 salvo que el seam de construccion este activo (produccion: nunca)", async () => {
    const { createProtocolSessionRoutes } = await import("./routes/protocol-sessions");
    const store = new ProtocolSessionStore();
    const id = apSession(store);
    const request = () => new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ ms: 1000 }) });
    const off = createProtocolSessionRoutes({ store, computeSuggestions: async () => { throw new Error("unused"); } });
    expect((await off.postTestAdvanceClock(request(), id)).status).toBe(404);
    const explicitFalse = createProtocolSessionRoutes({ store, computeSuggestions: async () => { throw new Error("unused"); }, allowTestClockControl: false });
    expect((await explicitFalse.postTestAdvanceClock(request(), id)).status).toBe(404);
    const on = createProtocolSessionRoutes({ store, computeSuggestions: async () => { throw new Error("unused"); }, allowTestClockControl: true });
    expect((await on.postTestAdvanceClock(request(), id)).status).toBe(200);
  });

  test("index.ts (entrypoint de produccion) jamas activa el seam", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
    expect(text).not.toContain("allowTestClockControl");
  });
});
