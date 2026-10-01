import { describe, expect, test } from "bun:test";
import { deriveHumanActionability, humanDecisionSlots, roundCoveringPositions } from "./human-actionability";

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

  // PD-001 -- A. Party2 Pos2+Pos5: eligibility is whole, the round slots are positionless.
  test("Party2 Pos2+Pos5 (no contiguas): eligiblePositions [2,5], capacidad 2, slots SIN `position`", () => {
    const actionability = deriveHumanActionability({ humanOpenPositions: [2, 5], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    expect(actionability).toEqual({ eligiblePositions: [2, 5], roundCapacity: 2, hasHumanAction: true, noActionReason: null });
    const result = humanDecisionSlots(actionability, slots(2));
    expect(result).toEqual([{ side: "radiant", slotIndex: 0 }, { side: "radiant", slotIndex: 1 }]);
    for (const slot of result) expect("position" in slot).toBe(false);
  });

  // PD-001 -- D. Solo Pos3.
  test("Solo Pos3: eligiblePositions [3], capacidad 1, el slot de ronda sigue SIN `position`", () => {
    const actionability = deriveHumanActionability({ humanOpenPositions: [3], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    expect(actionability).toEqual({ eligiblePositions: [3], roundCapacity: 1, hasHumanAction: true, noActionReason: null });
    const result = humanDecisionSlots(actionability, slots(2));
    expect(result).toEqual([{ side: "radiant", slotIndex: 0 }]);
    expect("position" in result[0]!).toBe(false);
  });

  test("Party3: ninguna combinación de elegibles/capacidad etiqueta un slot", () => {
    for (const open of [[1, 4], [1, 3, 5], [2, 3, 4, 5]] as const) {
      const actionability = deriveHumanActionability({ humanOpenPositions: open, openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
      for (const slot of humanDecisionSlots(actionability, slots(2))) expect("position" in slot).toBe(false);
    }
  });

  // PD-001 -- E. Reordering the open own slots changes neither eligibility nor tags.
  test("metamórfico: reordenar los slots propios abiertos no cambia la elegibilidad ni introduce posiciones", () => {
    const open = [5, 2] as const;
    const ordered = [{ side: "radiant" as const, slotIndex: 0 }, { side: "radiant" as const, slotIndex: 1 }];
    const reversed = [...ordered].reverse();
    const a = deriveHumanActionability({ humanOpenPositions: open, openOwnRoundSlots: ordered.length, yieldedCurrentRound: false, draftComplete: false });
    const b = deriveHumanActionability({ humanOpenPositions: open, openOwnRoundSlots: reversed.length, yieldedCurrentRound: false, draftComplete: false });
    expect(a).toEqual(b);
    expect(a.eligiblePositions).toEqual([2, 5]);
    const fromOrdered = humanDecisionSlots(a, ordered);
    const fromReversed = humanDecisionSlots(b, reversed);
    expect(fromOrdered).toEqual(fromReversed);
    for (const slot of [...fromOrdered, ...fromReversed]) expect("position" in slot).toBe(false);
  });

  // PD-001 -- F. Input position order.
  test("metamórfico: [5,2] vs [2,5] dan la misma HumanActionability y slots sin etiqueta", () => {
    const fromDescending = deriveHumanActionability({ humanOpenPositions: [5, 2], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    const fromAscending = deriveHumanActionability({ humanOpenPositions: [2, 5], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    expect(fromDescending).toEqual(fromAscending);
    expect(fromDescending.eligiblePositions).toEqual([2, 5]);
    expect(humanDecisionSlots(fromDescending, slots(2))).toEqual(humanDecisionSlots(fromAscending, slots(2)));
    for (const slot of humanDecisionSlots(fromDescending, slots(2))) expect("position" in slot).toBe(false);
  });

  test("sin acción humana: ningún slot", () => {
    const actionability = deriveHumanActionability({ humanOpenPositions: [2, 5], openOwnRoundSlots: 2, yieldedCurrentRound: true, draftComplete: false });
    expect(humanDecisionSlots(actionability, slots(2))).toEqual([]);
  });
});

describe("roundCoveringPositions (conjunto de elegibilidad, nunca un mapa slot -> posición)", () => {
  test("lo elegible cabe entero en la ronda: devuelve el conjunto; si no cabe (Party5) o no hay acción: undefined", () => {
    const fits = deriveHumanActionability({ humanOpenPositions: [5, 2], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    const party5 = deriveHumanActionability({ humanOpenPositions: [1, 2, 3, 4, 5], openOwnRoundSlots: 2, yieldedCurrentRound: false, draftComplete: false });
    const yielded = deriveHumanActionability({ humanOpenPositions: [2, 5], openOwnRoundSlots: 2, yieldedCurrentRound: true, draftComplete: false });
    expect(roundCoveringPositions(fits)).toEqual([2, 5]);
    expect(roundCoveringPositions(party5)).toBeUndefined();
    expect(roundCoveringPositions(yielded)).toBeUndefined();
    expect(roundCoveringPositions(null)).toBeUndefined();
  });
});
