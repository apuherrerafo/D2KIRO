import { describe, expect, test } from "bun:test";
import { authoritativeStateHash } from "../draft-protocol";
import { resolveSimulatorCollisionAuthority } from "../draft-protocol/adapters/simulator-authority";
import { ProtocolSessionStore } from "./protocol-session";
import type { ControlledSlot } from "../draft-protocol";

// R1 S2 acceptance -- exercises the FULL new stack (ProtocolSessionStore -> kernel ->
// perspective), not the kernel in isolation (already covered exhaustively by S1's own suite).
// This is the layer S1 never had: session lifecycle, party-size threading at creation, and
// multiple simulated callers driving the same session to completion.

function fillRound(store: ProtocolSessionStore, sessionId: string, heroesBySlot: Record<string, number>): void {
  const state = store.get(sessionId)!;
  const openSlots = state.rankedAp!.round!.openSlots;
  for (const slot of openSlots) {
    const key = `${slot.side}:${slot.slotIndex}`;
    const heroId = heroesBySlot[key];
    if (heroId === undefined) throw new Error(`no hero configured for ${key}`);
    store.apply(sessionId, { type: "SUBMIT_SEALED_SELECTION", side: slot.side, slotIndex: slot.slotIndex, heroId });
  }
}

function playFullApDraft(store: ProtocolSessionStore, sessionId: string, heroPool: { round1: number[]; round2: number[]; round3: number[] }): void {
  store.apply(sessionId, { type: "BAN_RESOLUTION_COMPLETE" });
  fillRound(store, sessionId, {
    "radiant:0": heroPool.round1[0]!,
    "radiant:1": heroPool.round1[1]!,
    "dire:0": heroPool.round1[2]!,
    "dire:1": heroPool.round1[3]!,
  });
  fillRound(store, sessionId, {
    "radiant:0": heroPool.round2[0]!,
    "radiant:1": heroPool.round2[1]!,
    "dire:0": heroPool.round2[2]!,
    "dire:1": heroPool.round2[3]!,
  });
  fillRound(store, sessionId, { "radiant:0": heroPool.round3[0]!, "dire:0": heroPool.round3[1]! });
}

describe("S2 acceptance -- Ranked All Pick through ProtocolSessionStore", () => {
  test.each([1, 2, 3, 5] as const)("party size %d: draft solo/en equipo completa con 5 héroes únicos por lado", (partySize) => {
    const store = new ProtocolSessionStore();
    const controlledSlots: ControlledSlot[] = Array.from({ length: partySize }, (_, i) => ({
      side: "radiant" as const,
      slotIndex: i,
      controllerId: `p${i}`,
    }));
    const created = store.create({
      sessionId: `party-${partySize}`,
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      partyContext: { partySize, side: "radiant", controlledSlots },
    });
    expect(created.ok).toBe(true);
    if (!created.ok) return;

    playFullApDraft(store, created.sessionId, {
      round1: [1, 2, 3, 4],
      round2: [5, 6, 7, 8],
      round3: [9, 10],
    });

    const finalState = store.get(created.sessionId)!;
    expect(finalState.status).toBe("COMPLETE");
    expect(finalState.rankedAp!.confirmedPicks.filter((p) => p.side === "radiant")).toHaveLength(5);
    expect(finalState.rankedAp!.confirmedPicks.filter((p) => p.side === "dire")).toHaveLength(5);
    const radiantHeroes = finalState.rankedAp!.confirmedPicks.filter((p) => p.side === "radiant").map((p) => p.heroId);
    expect(new Set(radiantHeroes).size).toBe(5);
  });

  test("party size 4 se rechaza en la creación -- ningún draft arranca", () => {
    const store = new ProtocolSessionStore();
    const result = store.create({
      sessionId: "party-4",
      rulesetId: "dota2/ranked-all-pick",
      patch: "7.41e",
      partyContext: { partySize: 4, side: "radiant", controlledSlots: [] },
    });
    expect(result.ok).toBe(false);
    expect(store.get("party-4")).toBeNull();
  });

  test("hidden twin a través de la sesión: la elección oculta del rival no cambia la vista propia ni las acciones legales", () => {
    const storeA = new ProtocolSessionStore();
    const storeB = new ProtocolSessionStore();
    storeA.create({ sessionId: "twin", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    storeB.create({ sessionId: "twin", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    storeA.apply("twin", { type: "BAN_RESOLUTION_COMPLETE" });
    storeB.apply("twin", { type: "BAN_RESOLUTION_COMPLETE" });

    // Both radiant slots sealed identically in both stores; dire seals DIFFERENT heroes -- the
    // "twin" difference is entirely on the hidden side.
    storeA.apply("twin", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 11 });
    storeB.apply("twin", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 11 });
    storeA.apply("twin", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 21 });
    storeB.apply("twin", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 22 });

    const radiantViewA = storeA.view("twin", "radiant");
    const radiantViewB = storeB.view("twin", "radiant");
    expect(radiantViewA).toEqual(radiantViewB);
    expect(storeA.legalActions("twin")).toEqual(storeB.legalActions("twin"));

    // Enemy pick is genuinely invisible while sealed.
    expect(radiantViewA?.enemyPicks[0]).toEqual({ visibility: "HIDDEN" });
  });

  test("reveal: tras cerrar la ronda, el pick antes oculto pasa a REVEALED", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "reveal", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    store.apply("reveal", { type: "BAN_RESOLUTION_COMPLETE" });
    store.apply("reveal", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 30 });

    const beforeClose = store.view("reveal", "radiant");
    expect(beforeClose?.enemyPicks[0]).toEqual({ visibility: "HIDDEN" });

    fillRound(store, "reveal", { "radiant:0": 1, "radiant:1": 2, "dire:0": 30, "dire:1": 31 });

    const afterClose = store.view("reveal", "radiant");
    expect(afterClose?.enemyPicks.some((slot) => slot.visibility === "REVEALED" && slot.heroId === 30)).toBe(true);
  });

  test("colisiones 1, 2 y 3 -- la tercera pausa el draft hasta que un authority externo resuelve", () => {
    const store = new ProtocolSessionStore();
    store.create({ sessionId: "collisions", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    store.apply("collisions", { type: "BAN_RESOLUTION_COMPLETE" });

    const collidingHeroes = [401, 402, 403];
    let uniqueCounter = 900;
    for (const heroId of collidingHeroes) {
      const state = store.get("collisions")!;
      const openSlots = state.rankedAp!.round!.openSlots;
      for (const slot of openSlots) {
        const submitHeroId = slot.slotIndex === 0 ? heroId : (uniqueCounter += 1);
        store.apply("collisions", { type: "SUBMIT_SEALED_SELECTION", side: slot.side, slotIndex: slot.slotIndex, heroId: submitHeroId });
      }
      if (store.get("collisions")!.status === "WAITING_FOR_COLLISION_AUTHORITY") break;
    }
    expect(store.get("collisions")!.status).toBe("WAITING_FOR_COLLISION_AUTHORITY");

    // Collision 1 and 2 banned the hero; collision 3's hero must NOT be banned once resolved.
    const resolution = resolveSimulatorCollisionAuthority(store.get("collisions")!, "TESTSEED")!;
    expect(resolution.command.heroId).toBe(403);
    const result = store.apply("collisions", resolution.command);
    expect(result?.rejected).toBeUndefined();
    expect(result?.state.status).not.toBe("WAITING_FOR_COLLISION_AUTHORITY");
    expect(result?.state.rankedAp?.bannedHeroes).not.toContain(403);
    expect(result?.state.rankedAp?.bannedHeroes).toContain(401);
    expect(result?.state.rankedAp?.bannedHeroes).toContain(402);
  });
});

describe("S2 -- adapter parity (SPEC: 'la misma secuencia observada por simulator/manual adapter debe producir el mismo canonical core state')", () => {
  test("dos sesiones que reciben el MISMO batch de un round en orden de llegada distinto terminan con el mismo hash canónico", () => {
    // Simula un "manual adapter" (envía radiant primero, luego dire) y un "simulator adapter"
    // (interleaved) observando la MISMA decisión lógica -- solo cambia el orden de transporte.
    const manualAdapterStore = new ProtocolSessionStore();
    const simulatorAdapterStore = new ProtocolSessionStore();
    manualAdapterStore.create({ sessionId: "parity", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    simulatorAdapterStore.create({ sessionId: "parity", rulesetId: "dota2/ranked-all-pick", patch: "7.41e" });
    manualAdapterStore.apply("parity", { type: "BAN_RESOLUTION_COMPLETE" });
    simulatorAdapterStore.apply("parity", { type: "BAN_RESOLUTION_COMPLETE" });

    // Manual adapter: radiant slot0, radiant slot1, dire slot0, dire slot1.
    manualAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 });
    manualAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 2 });
    manualAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 3 });
    manualAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 4 });

    // Simulator adapter: dire slot1, radiant slot0, dire slot0, radiant slot1 -- same set, reversed/interleaved arrival.
    simulatorAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 1, heroId: 4 });
    simulatorAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 0, heroId: 1 });
    simulatorAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: 0, heroId: 3 });
    simulatorAdapterStore.apply("parity", { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: 1, heroId: 2 });

    const manualState = manualAdapterStore.get("parity")!;
    const simulatorState = simulatorAdapterStore.get("parity")!;
    expect(authoritativeStateHash(manualState)).toBe(authoritativeStateHash(simulatorState));
  });
});
