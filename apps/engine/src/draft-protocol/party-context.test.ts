import { describe, expect, test } from "bun:test";
import { createPartyContext, isValidPartySize } from "./party-context";

// Criterio 8: party sizes 1/2/3/5 PASS, 4 REJECT.
describe("party sizes — H0.1", () => {
  test.each([1, 2, 3, 5] as const)("partySize %d es válido", (size) => {
    expect(isValidPartySize(size)).toBe(true);
    const result = createPartyContext(size, "radiant", []);
    expect(result.error).toBeNull();
    expect(result.context?.partySize).toBe(size);
  });

  test("partySize 4 se rechaza explícitamente", () => {
    expect(isValidPartySize(4)).toBe(false);
    const result = createPartyContext(4, "radiant", []);
    expect(result.error).toBe("INVALID_PARTY_SIZE");
    expect(result.context).toBeNull();
  });

  test("cualquier otro valor también se rechaza (0, negativo, no entero)", () => {
    expect(createPartyContext(0, "radiant", []).error).toBe("INVALID_PARTY_SIZE");
    expect(createPartyContext(6, "radiant", []).error).toBe("INVALID_PARTY_SIZE");
  });
});

describe("controlledSlots — validación estructural", () => {
  test("acepta slots del lado correcto, únicos, dentro de rango", () => {
    const result = createPartyContext(3, "dire", [
      { side: "dire", slotIndex: 0, controllerId: "a" },
      { side: "dire", slotIndex: 2, controllerId: "b" },
    ]);
    expect(result.error).toBeNull();
    expect(result.context?.controlledSlots).toHaveLength(2);
  });

  test("rechaza un slot del lado contrario", () => {
    const result = createPartyContext(2, "radiant", [{ side: "dire", slotIndex: 0, controllerId: "a" }]);
    expect(result.error).toBe("SLOT_SIDE_MISMATCH");
  });

  test("rechaza slotIndex fuera de [0,4]", () => {
    const result = createPartyContext(2, "radiant", [{ side: "radiant", slotIndex: 5, controllerId: "a" }]);
    expect(result.error).toBe("SLOT_INDEX_OUT_OF_RANGE");
  });

  test("rechaza slotIndex duplicado", () => {
    const result = createPartyContext(2, "radiant", [
      { side: "radiant", slotIndex: 0, controllerId: "a" },
      { side: "radiant", slotIndex: 0, controllerId: "b" },
    ]);
    expect(result.error).toBe("DUPLICATE_SLOT_INDEX");
  });

  test("rechaza más slots controlados que el tamaño de party", () => {
    const result = createPartyContext(1, "radiant", [
      { side: "radiant", slotIndex: 0, controllerId: "a" },
      { side: "radiant", slotIndex: 1, controllerId: "b" },
    ]);
    expect(result.error).toBe("TOO_MANY_CONTROLLED_SLOTS");
  });
});
