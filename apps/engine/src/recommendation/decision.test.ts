import { describe, expect, test } from "bun:test";
import { applyProtocolCommand, computeEligibilityContentHash, createProtocolState } from "../draft-protocol";
import type { CmHeroEligibilitySnapshot, DraftProtocolState } from "../draft-protocol/types";
import { deriveLegalDecision } from "./decision";

function eligibilitySnapshot(heroIds: number[]): CmHeroEligibilitySnapshot {
  const base = {
    schema: "cm-hero-eligibility/v1" as const,
    appId: 570 as const,
    patch: "7.41e",
    buildId: "b",
    depotManifests: { "570": "fixture-manifest" },
    sourceHashes: { npc_heroes: "fixture" },
    provenance: {
      kind: "OFFICIAL_DEPOT" as const,
      appId: 570 as const,
      buildId: "b",
      depotId: "fixture-depot",
      manifestId: "fixture-manifest",
      sourcePath: "scripts/npc/npc_heroes.txt",
      sourceHash: "fixture",
    },
    heroIds,
  };
  return { ...base, contentHash: computeEligibilityContentHash(base) };
}

function apFreshState(): DraftProtocolState {
  const created = createProtocolState("s1", "dota2/ranked-all-pick");
  if (!created.ok) throw new Error("fixture setup failed");
  return created.state;
}

function cmFreshState(): DraftProtocolState {
  const created = createProtocolState("s1", "dota2/captains-mode");
  if (!created.ok) throw new Error("fixture setup failed");
  return created.state;
}

describe("deriveLegalDecision -- Ranked All Pick", () => {
  test("BAN_RESOLUTION: sin ronda abierta -> actionCount 0, degradación explícita NO_ACTION_FOR_ACTOR", () => {
    const legal = deriveLegalDecision(apFreshState(), "radiant");
    expect(legal.decision.actionCount).toBe(0);
    expect(legal.decision.actionKind).toBeNull();
    expect(legal.eligibleHeroIds).toBeNull();
    expect(legal.degradations.some((d) => d.reason === "NO_ACTION_FOR_ACTOR")).toBe(true);
  });

  test("ronda 1 recién abierta: ambos slots del actor están controlados -> actionCount 2", () => {
    const opened = applyProtocolCommand(apFreshState(), { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const legal = deriveLegalDecision(opened, "radiant");
    expect(legal.decision.actionCount).toBe(2);
    expect(legal.decision.actionKind).toBe("PICK");
    expect(legal.decision.round).toBe(1);
    expect(legal.decision.controlledSlots.map((s) => s.slotIndex).sort()).toEqual([0, 1]);
    expect(legal.eligibleHeroIds).toBeNull();
    expect(legal.degradations).toHaveLength(0);
  });

  test("un slot ya sellado por el actor -> actionCount cae a 1 (el otro slot)", () => {
    const opened = applyProtocolCommand(apFreshState(), { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const sealedOne = applyProtocolCommand(opened, {
      type: "SUBMIT_SEALED_SELECTION",
      side: "radiant",
      slotIndex: 0,
      heroId: 1,
    }).state;
    const legal = deriveLegalDecision(sealedOne, "radiant");
    expect(legal.decision.actionCount).toBe(1);
    expect(legal.decision.controlledSlots).toEqual([{ side: "radiant", slotIndex: 1 }]);
  });

  test("blocker 5 -- Party1 (1 slot controlado) en una ronda con 2 slots abiertos -> actionCount 1, nunca compound", () => {
    const created = createProtocolState("party1", "dota2/ranked-all-pick", {
      partyContext: { partySize: 1, side: "radiant", controlledSlots: [{ side: "radiant", slotIndex: 0, controllerId: "p0" }] },
    });
    if (!created.ok) throw new Error("fixture setup failed");
    const opened = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const legal = deriveLegalDecision(opened, "radiant");
    // Round 1 genuinely has 2 open slots for radiant -- Party1 controls only 1 of them, and this
    // recommendation must never propose an action for the one it doesn't control (an "external"
    // slot, participants.ts's own term), even though that slot IS open right now.
    expect(legal.decision.actionCount).toBe(1);
    expect(legal.decision.controlledSlots).toHaveLength(1);
  });

  test("blocker 5 -- Party3 con 2 slots controlados en una ronda con 2 slots abiertos -> actionCount 2, compound", () => {
    const created = createProtocolState("party3", "dota2/ranked-all-pick", {
      partyContext: {
        partySize: 3,
        side: "radiant",
        controlledSlots: [
          { side: "radiant", slotIndex: 0, controllerId: "p0" },
          { side: "radiant", slotIndex: 1, controllerId: "p1" },
        ],
      },
    });
    if (!created.ok) throw new Error("fixture setup failed");
    const opened = applyProtocolCommand(created.state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const legal = deriveLegalDecision(opened, "radiant");
    expect(legal.decision.actionCount).toBe(2);
    expect(legal.decision.controlledSlots).toHaveLength(2);
  });

  test("blocker 5 -- sin PartyContext (legacy/no-party session), el actor controla todos los slots abiertos de su lado -- byte-idéntico a antes de este fix", () => {
    const opened = applyProtocolCommand(apFreshState(), { type: "BAN_RESOLUTION_COMPLETE" }).state;
    const legal = deriveLegalDecision(opened, "radiant");
    expect(legal.decision.actionCount).toBe(2);
  });

  test("draft completo (status COMPLETE) no dispara NO_ACTION_FOR_ACTOR -- es el fin esperado, no una degradación", () => {
    let state = apFreshState();
    state = applyProtocolCommand(state, { type: "BAN_RESOLUTION_COMPLETE" }).state;
    // Cierra las 3 rondas con héroes distintos por lado, sin colisiones.
    let heroId = 1;
    for (let round = 0; round < 3; round += 1) {
      const capacity = round === 2 ? 1 : 2;
      for (let slot = 0; slot < capacity; slot += 1) {
        state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "radiant", slotIndex: slot, heroId: heroId++ }).state;
        state = applyProtocolCommand(state, { type: "SUBMIT_SEALED_SELECTION", side: "dire", slotIndex: slot, heroId: heroId++ }).state;
      }
    }
    expect(state.status).toBe("COMPLETE");
    const legal = deriveLegalDecision(state, "radiant");
    expect(legal.decision.actionCount).toBe(0);
    expect(legal.degradations.some((d) => d.reason === "NO_ACTION_FOR_ACTOR")).toBe(false);
  });
});

describe("deriveLegalDecision -- Captain's Mode", () => {
  test("UNCONFIRMED_STATE (sin firstPickSide) -> actionCount 0, degradación explícita", () => {
    const legal = deriveLegalDecision(cmFreshState(), "radiant");
    expect(legal.decision.actionCount).toBe(0);
    expect(legal.degradations.some((d) => d.reason === "NO_ACTION_FOR_ACTOR")).toBe(true);
  });

  test("firstPickSide confirmado pero SIN eligibilidad certificada -> hero universe vacío, nunca la elección legacy de héroes", () => {
    const confirmed = applyProtocolCommand(cmFreshState(), { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    const legal = deriveLegalDecision(confirmed, "radiant");
    expect(legal.decision.actionKind).toBe("BAN");
    expect(legal.eligibleHeroIds).toEqual([]);
    expect(legal.degradations.some((d) => d.reason === "NO_LEGAL_HERO_UNIVERSE")).toBe(true);
  });

  test("con eligibilidad cargada, el universo legal es EXACTAMENTE el snapshot certificado -- nunca el catálogo global", () => {
    let state = applyProtocolCommand(cmFreshState(), { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    state = applyProtocolCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibilitySnapshot([1, 2, 3]) }).state;
    const legal = deriveLegalDecision(state, "radiant");
    expect(legal.decision.actionKind).toBe("BAN");
    expect(legal.decision.step).toBe(1);
    expect(legal.eligibleHeroIds).toEqual([1, 2, 3]);
    expect(legal.degradations).toHaveLength(0);
  });

  test("no es el turno del actor -> actionCount 0, degradación explícita (nunca se le atribuye la acción del otro lado)", () => {
    let state = applyProtocolCommand(cmFreshState(), { type: "CONFIRM_FIRST_PICK_SIDE", side: "radiant" }).state;
    state = applyProtocolCommand(state, { type: "LOAD_CM_ELIGIBILITY", snapshot: eligibilitySnapshot([1, 2, 3]) }).state;
    const legal = deriveLegalDecision(state, "dire");
    expect(legal.decision.actionCount).toBe(0);
    expect(legal.degradations.some((d) => d.reason === "NO_ACTION_FOR_ACTOR")).toBe(true);
  });
});
