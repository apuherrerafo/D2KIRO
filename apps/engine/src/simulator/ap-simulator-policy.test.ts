import { describe, expect, test } from "bun:test";
import { participantForRoundSlot, roundForPhase, rosterSlotForRoundSlot } from "./ap-simulator-policy";

describe("AP Ranked Roles V1 -- seat utilities (no position, no side hardcode)", () => {
  test("mapea 2+2+1 a seats 0..4 (identidad de asiento cronologica, NO una posicion)", () => {
    expect([rosterSlotForRoundSlot(1, 0), rosterSlotForRoundSlot(1, 1)]).toEqual([0, 1]);
    expect([rosterSlotForRoundSlot(2, 0), rosterSlotForRoundSlot(2, 1)]).toEqual([2, 3]);
    expect(rosterSlotForRoundSlot(3, 0)).toBe(4);
    expect(rosterSlotForRoundSlot(3, 1)).toBeNull();
    expect(rosterSlotForRoundSlot(1, 2)).toBeNull();
  });

  test("el Player controla TODOS los asientos de su lado, sea Radiant o Dire", () => {
    for (const humanSide of ["radiant", "dire"] as const) {
      const enemy = humanSide === "radiant" ? "dire" : "radiant";
      for (const [round, capacity] of [[1, 2], [2, 2], [3, 1]] as const) {
        for (let slot = 0; slot < capacity; slot += 1) {
          expect(participantForRoundSlot(humanSide, round, slot, humanSide)?.control).toBe("human");
          expect(participantForRoundSlot(enemy, round, slot, humanSide)?.control).toBe("external");
        }
      }
    }
  });

  test("un participante no lleva posicion: la posicion no depende de cuando se pica", () => {
    const participant = participantForRoundSlot("radiant", 1, 0, "radiant");
    expect(participant).toEqual({ side: "radiant", rosterSlot: 0, control: "human" });
    expect(participant).not.toHaveProperty("position");
  });

  test("roundForPhase", () => {
    expect(roundForPhase("PICK_ROUND_1")).toBe(1);
    expect(roundForPhase("PICK_ROUND_3")).toBe(3);
    expect(roundForPhase("BAN_RESOLUTION")).toBeNull();
    expect(roundForPhase("COMPLETE")).toBeNull();
  });
});
