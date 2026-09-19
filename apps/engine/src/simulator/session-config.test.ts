import { describe, expect, test } from "bun:test";
import { buildOwnTeamPartyContext, buildOwnTeamRoleAssignments, isApSimulatorMetadata } from "./session-config";

describe("isApSimulatorMetadata", () => {
  test("true para Dire + posicion 1 (no exige Radiant/Mid/ultimo slot)", () => {
    expect(isApSimulatorMetadata({ adapterKind: "simulator", simulatorSeed: "D2K00001" })).toBe(true);
  });
  test("true para Radiant + posicion 5", () => {
    expect(isApSimulatorMetadata({ adapterKind: "simulator", simulatorSeed: "ABCDEFGH" })).toBe(true);
  });
  test("false si adapterKind no es simulator", () => {
    expect(isApSimulatorMetadata({ adapterKind: "manual", simulatorSeed: "D2K00001" })).toBe(false);
  });
  test("false si simulatorSeed es null o undefined", () => {
    expect(isApSimulatorMetadata({ adapterKind: "simulator", simulatorSeed: null })).toBe(false);
    expect(isApSimulatorMetadata({ adapterKind: "simulator", simulatorSeed: undefined })).toBe(false);
  });
});

describe("Own Team model", () => {
  test("exactamente cinco roles conocidos, uno de cada", () => {
    expect(Object.keys(buildOwnTeamRoleAssignments()).sort()).toEqual(["1", "2", "3", "4", "5"]);
  });
  test("party de 5 con los 5 asientos controlados, para cualquier lado", () => {
    for (const side of ["radiant", "dire"] as const) {
      const party = buildOwnTeamPartyContext(side);
      expect(party.partySize).toBe(5);
      expect(party.side).toBe(side);
      expect(party.controlledSlots.map((slot) => slot.slotIndex)).toEqual([0, 1, 2, 3, 4]);
      expect(party.controlledSlots.every((slot) => slot.side === side)).toBe(true);
    }
  });
});
