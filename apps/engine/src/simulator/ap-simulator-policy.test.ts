import { describe, expect, test } from "bun:test";
import { roundForPhase, rosterSlotForRoundSlot } from "./ap-simulator-policy";

describe("AP Ranked Roles V1 -- seat utilities (no position, no side hardcode)", () => {
  test("mapea 2+2+1 a seats 0..4 (identidad de asiento cronologica, NO una posicion)", () => {
    expect([rosterSlotForRoundSlot(1, 0), rosterSlotForRoundSlot(1, 1)]).toEqual([0, 1]);
    expect([rosterSlotForRoundSlot(2, 0), rosterSlotForRoundSlot(2, 1)]).toEqual([2, 3]);
    expect(rosterSlotForRoundSlot(3, 0)).toBe(4);
    expect(rosterSlotForRoundSlot(3, 1)).toBeNull();
    expect(rosterSlotForRoundSlot(1, 2)).toBeNull();
  });

  test("roundForPhase", () => {
    expect(roundForPhase("PICK_ROUND_1")).toBe(1);
    expect(roundForPhase("PICK_ROUND_3")).toBe(3);
    expect(roundForPhase("BAN_RESOLUTION")).toBeNull();
    expect(roundForPhase("COMPLETE")).toBeNull();
  });
});
