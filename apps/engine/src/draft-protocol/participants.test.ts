import { describe, expect, test } from "bun:test";
import { createPartyContext } from "./party-context";
import { deriveOwnSideParticipantSlots, isControlledSlot } from "./participants";

describe("participants -- controlled vs external (S2.5/S4.4)", () => {
  test("partySize 1 -- solo el slot 0 es controlled, los otros cuatro external", () => {
    const { context } = createPartyContext(1, "radiant", [{ side: "radiant", slotIndex: 0, controllerId: "me" }]);
    const slots = deriveOwnSideParticipantSlots(context!);
    expect(slots).toHaveLength(5);
    expect(slots[0]).toEqual({ side: "radiant", slotIndex: 0, control: "controlled", controllerId: "me" });
    for (const slot of slots.slice(1)) {
      expect(slot.control).toBe("external");
      expect(slot.controllerId).toBeNull();
    }
  });

  test("partySize 3 -- tres controlled, dos external, controllerId preservado", () => {
    const { context } = createPartyContext(3, "dire", [
      { side: "dire", slotIndex: 0, controllerId: "me" },
      { side: "dire", slotIndex: 2, controllerId: "friend-a" },
      { side: "dire", slotIndex: 4, controllerId: "friend-b" },
    ]);
    const slots = deriveOwnSideParticipantSlots(context!);
    const controlled = slots.filter((s) => s.control === "controlled");
    const external = slots.filter((s) => s.control === "external");
    expect(controlled).toHaveLength(3);
    expect(external).toHaveLength(2);
    expect(controlled.map((s) => s.controllerId).sort()).toEqual(["friend-a", "friend-b", "me"]);
    expect(external.map((s) => s.slotIndex).sort()).toEqual([1, 3]);
  });

  test("partySize 5 -- los cinco slots son controlled", () => {
    const { context } = createPartyContext(
      5,
      "radiant",
      [0, 1, 2, 3, 4].map((slotIndex) => ({ side: "radiant" as const, slotIndex, controllerId: `p${slotIndex}` })),
    );
    const slots = deriveOwnSideParticipantSlots(context!);
    expect(slots.every((s) => s.control === "controlled")).toBe(true);
  });

  describe("isControlledSlot", () => {
    test("true para un slot controlado del lado correcto", () => {
      const { context } = createPartyContext(2, "radiant", [{ side: "radiant", slotIndex: 1, controllerId: "me" }]);
      expect(isControlledSlot(context, "radiant", 1)).toBe(true);
      expect(isControlledSlot(context, "radiant", 2)).toBe(false);
    });

    test("false para el lado contrario, incluso con el mismo slotIndex", () => {
      const { context } = createPartyContext(1, "radiant", [{ side: "radiant", slotIndex: 0, controllerId: "me" }]);
      expect(isControlledSlot(context, "dire", 0)).toBe(false);
    });

    test("false cuando partyContext es null (sesión sin party context configurado)", () => {
      expect(isControlledSlot(null, "radiant", 0)).toBe(false);
    });
  });
});
