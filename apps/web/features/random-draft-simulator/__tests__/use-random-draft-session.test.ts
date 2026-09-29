// Pruebas de las funciones puras exportadas por use-random-draft-session.ts. El resto del hook
// (refs, setInterval, HTTP) se prueba en use-random-draft-session.integration.test.ts con un motor
// falso; la verificación en navegador real vive en el smoke E2E / la aceptación manual.

import { test, expect } from "bun:test";
import type { ProtocolSnapshot } from "../protocol-client";
import { otherSide, ownOpenSlotIndexes, roundSeatOffset, specForRound } from "../use-random-draft-session";

test("otherSide devuelve el lado contrario", () => {
  expect(otherSide("radiant")).toBe("dire");
  expect(otherSide("dire")).toBe("radiant");
});

test("specForRound devuelve la spec exacta para cada ronda (2-2-1, 25s/25s/20s)", () => {
  expect(specForRound(1)).toEqual({ round: 1, picksPerTeam: 2, timerMs: 25000 });
  expect(specForRound(2)).toEqual({ round: 2, picksPerTeam: 2, timerMs: 25000 });
  expect(specForRound(3)).toEqual({ round: 3, picksPerTeam: 1, timerMs: 20000 });
});

test("roundSeatOffset: asiento cronológico 0/2/4 -- nunca una posición", () => {
  expect([1, 2, 3].map((round) => roundSeatOffset(round as 1 | 2 | 3))).toEqual([0, 2, 4]);
});

function snapshot(viewerSide: "radiant" | "dire", legalActions: ProtocolSnapshot["legalActions"]): ProtocolSnapshot {
  return {
    view: {
      schema: "draft-protocol-perspective/v1",
      sessionId: "s",
      status: "ACTIVE",
      viewerSide,
      bannedHeroes: [],
      ownPicks: [],
      enemyPicks: [],
      rankedAp: { phase: "PICK_ROUND_1", banResolutionComplete: true },
      captainsMode: null,
    },
    legalActions,
    simulator: null,
    ownAssignedPositions: [],
    canYield: false,
  };
}

test("ownOpenSlotIndexes devuelve TODOS los asientos propios abiertos, del lado que sea", () => {
  for (const side of ["radiant", "dire"] as const) {
    const enemy = otherSide(side);
    const result = ownOpenSlotIndexes(
      snapshot(side, [
        { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 1 },
        { type: "SUBMIT_SEALED_SELECTION", side: enemy, slotIndex: 0 },
        { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: 0 },
      ]),
    );
    expect(result).toEqual([0, 1]);
  }
});
