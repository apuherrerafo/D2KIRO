import { describe, expect, test } from "bun:test";
import type { Suggestion } from "../signals/mix";
import {
  chooseExternalSuggestion,
  deriveExternalDecisionSeed,
  participantForRoundSlot,
  rosterSlotForRoundSlot,
} from "./solo-mid-policy";

function suggestion(hero: number, score: number, rank: Suggestion["rank"]): Suggestion {
  return {
    hero,
    rank,
    score,
    signals: [],
    reason: "fixture",
    confidence: "alta",
    evidenceCoverage: 1,
    guessingIndex: 0,
  };
}

describe("AP Solo Mid SIMULATOR POLICY", () => {
  test("mapea 2+2+1 a roster 0..4 y deja al humano Mid en el ultimo slot Radiant", () => {
    expect([rosterSlotForRoundSlot(1, 0), rosterSlotForRoundSlot(1, 1)]).toEqual([0, 1]);
    expect([rosterSlotForRoundSlot(2, 0), rosterSlotForRoundSlot(2, 1)]).toEqual([2, 3]);
    expect(rosterSlotForRoundSlot(3, 0)).toBe(4);
    expect(participantForRoundSlot("radiant", 3, 0)).toEqual({
      side: "radiant",
      rosterSlot: 4,
      position: 2,
      control: "human",
    });
    expect(participantForRoundSlot("dire", 2, 1)?.position).toBe(2);
  });

  test("misma seed derivada elige igual y nunca sale de Top3/banda de 5 puntos", () => {
    const candidates = [suggestion(1, 100, 1), suggestion(2, 98, 2), suggestion(3, 95, 3), suggestion(4, 94.9, 4)];
    const seed = deriveExternalDecisionSeed("D2K00001", { side: "dire", rosterSlot: 3 }, 7);
    const first = chooseExternalSuggestion(candidates, seed);
    const replay = chooseExternalSuggestion(candidates, seed);
    expect(replay).toEqual(first);
    expect(first).not.toBeNull();
    expect([1, 2, 3]).toContain(first!.hero);
  });

  test("un candidato claramente peor no entra para fabricar diversidad", () => {
    const candidates = [suggestion(1, 100, 1), suggestion(2, 94.99, 2)];
    for (let index = 0; index < 20; index += 1) {
      expect(chooseExternalSuggestion(candidates, `seed-${index}`)?.hero).toBe(1);
    }
  });
});
