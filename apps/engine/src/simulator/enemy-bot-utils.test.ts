import { describe, expect, test } from "bun:test";
import type { Suggestion } from "../signals/mix";
import { chooseExternalSuggestion, deriveExternalDecisionSeed, ENEMY_BOT_SELECTION } from "./enemy-bot-utils";

function suggestion(hero: number, score: number, rank: Suggestion["rank"]): Suggestion {
  return { hero, rank, score, signals: [], reason: "fixture", confidence: "alta", evidenceCoverage: 1, guessingIndex: 0 };
}

describe("deriveExternalDecisionSeed", () => {
  test("determinista: mismos (seed, participante, indice) -> misma cadena", () => {
    const a = deriveExternalDecisionSeed("D2K00001", { side: "dire", rosterSlot: 3 }, 7);
    expect(deriveExternalDecisionSeed("D2K00001", { side: "dire", rosterSlot: 3 }, 7)).toBe(a);
  });
  test("distinto rosterSlot / side / indice -> distinta cadena", () => {
    const base = deriveExternalDecisionSeed("D2K00001", { side: "dire", rosterSlot: 3 }, 7);
    expect(deriveExternalDecisionSeed("D2K00001", { side: "dire", rosterSlot: 2 }, 7)).not.toBe(base);
    expect(deriveExternalDecisionSeed("D2K00001", { side: "radiant", rosterSlot: 3 }, 7)).not.toBe(base);
    expect(deriveExternalDecisionSeed("D2K00001", { side: "dire", rosterSlot: 3 }, 8)).not.toBe(base);
  });
});

describe("chooseExternalSuggestion", () => {
  const candidates = [suggestion(1, 100, 1), suggestion(2, 98, 2), suggestion(3, 95, 3), suggestion(4, 94.9, 4)];

  test("misma seed elige igual y nunca sale de Top3 / banda de 5 puntos", () => {
    const seed = deriveExternalDecisionSeed("D2K00001", { side: "dire", rosterSlot: 3 }, 7);
    const first = chooseExternalSuggestion(candidates, seed, ENEMY_BOT_SELECTION);
    expect(chooseExternalSuggestion(candidates, seed, ENEMY_BOT_SELECTION)).toEqual(first);
    expect([1, 2, 3]).toContain(first!.hero);
  });

  test("un candidato claramente peor no entra para fabricar diversidad", () => {
    const pair = [suggestion(1, 100, 1), suggestion(2, 94.99, 2)];
    for (let index = 0; index < 20; index += 1) {
      expect(chooseExternalSuggestion(pair, `seed-${index}`, ENEMY_BOT_SELECTION)?.hero).toBe(1);
    }
  });

  test("respeta los parametros recibidos (maxCandidates / qualityBandPoints), no una constante global", () => {
    for (let index = 0; index < 20; index += 1) {
      expect(chooseExternalSuggestion(candidates, `s-${index}`, { maxCandidates: 1, qualityBandPoints: 100 })?.hero).toBe(1);
    }
    const wide = new Set(
      Array.from({ length: 60 }, (_, index) => chooseExternalSuggestion(candidates, `s-${index}`, { maxCandidates: 4, qualityBandPoints: 100 })?.hero),
    );
    expect(wide.has(4)).toBe(true);
  });

  test("sin candidatos -> null", () => {
    expect(chooseExternalSuggestion([], "x", ENEMY_BOT_SELECTION)).toBeNull();
  });
});
