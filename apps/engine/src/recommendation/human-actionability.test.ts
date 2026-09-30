import { describe, expect, test } from "bun:test";
import { deriveHumanActionability, humanDecisionSlots } from "./human-actionability";

// WP1 -- the pure projection. Eligibility (which positions) is never truncated by capacity (how many).

const slots = (count: number) => Array.from({ length: count }, (_, slotIndex) => ({ side: "radiant" as const, slotIndex }));

describe("deriveHumanActionability", () => {
  test("Party5 ronda 1: eligiblePositions = [1..5], roundCapacity = 2 -- NUNCA [1, 2]", () => {
    const actionability = deriveHumanActionability({ humanOpenPositions: [1, 2, 3, 4, 5], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    expect(actionability).toEqual({ eligiblePositions: [1, 2, 3, 4, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    expect(actionability.eligiblePositions).not.toEqual([1, 2]);
  });

  test("Solo Pos3 con 2 slots propios abiertos: capacidad 1 (el otro slot es del Ally Bot)", () => {
    expect(deriveHumanActionability({ humanOpenPositions: [3], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false }))
      .toEqual({ eligiblePositions: [3], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
  });

  test("yield: sin acción humana aunque queden posiciones humanas sin sellar", () => {
    expect(deriveHumanActionability({ humanOpenPositions: [2, 5], openOwnRoundSlots: 2, yieldedCurrentRound: true, draftComplete: false }))
      .toEqual({ eligiblePositions: [], roundCapacity: 0, hasHumanAction: false, noActionReason: "YIELDED" });
  });

  test("sin slots propios abiertos o sin posiciones humanas pendientes: ROUND_COMPLETE", () => {
    expect(deriveHumanActionability({ humanOpenPositions: [2], openOwnRoundSlots: 0, yieldedCurrentRound: false, draftComplete: false }).noActionReason).toBe("ROUND_COMPLETE");
    expect(deriveHumanActionability({ humanOpenPositions: [], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false }).noActionReason).toBe("ROUND_COMPLETE");
  });

  test("draft completo gana sobre cualquier otra razón", () => {
    expect(deriveHumanActionability({ humanOpenPositions: [2], openOwnRoundSlots: 0, yieldedCurrentRound: true, draftComplete: true }).noActionReason).toBe("DRAFT_COMPLETE");
  });

  test("metamórfico: el orden de entrada de las posiciones no cambia el resultado", () => {
    const a = deriveHumanActionability({ humanOpenPositions: [5, 2, 3], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    const b = deriveHumanActionability({ humanOpenPositions: [3, 5, 2], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    expect(a).toEqual(b);
    expect(a.eligiblePositions).toEqual([2, 3, 5]);
  });
});

describe("humanDecisionSlots", () => {
  test("más elegibles que capacidad: exactamente roundCapacity slots, SIN etiqueta de posición", () => {
    const actionability = deriveHumanActionability({ humanOpenPositions: [1, 2, 3, 4, 5], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    expect(humanDecisionSlots(actionability, slots(2))).toEqual([{ side: "radiant", slotIndex: 0 }, { side: "radiant", slotIndex: 1 }]);
  });

  test("lo elegible cabe entero en la ronda: la etiqueta ES el conjunto elegible (Party2 Pos2+Pos5 no contiguas)", () => {
    const actionability = deriveHumanActionability({ humanOpenPositions: [5, 2], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    const tagged = humanDecisionSlots(actionability, slots(2)).map((slot) => slot.position);
    expect(new Set(tagged)).toEqual(new Set([2, 5]));
  });

  test("sin acción humana: ningún slot", () => {
    const actionability = deriveHumanActionability({ humanOpenPositions: [2, 5], openOwnRoundSlots: 2, yieldedCurrentRound: true, draftComplete: false });
    expect(humanDecisionSlots(actionability, slots(2))).toEqual([]);
  });
});
