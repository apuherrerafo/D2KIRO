// Pruebas de las funciones puras exportadas por use-random-draft-session.ts. El resto del hook
// (refs, setInterval, WebSocket) depende de renderizar un componente React -- no hay
// `renderHook`/testing-library en este proyecto (ver testing-seams.md), así que esa parte se
// verifica en un navegador real contra apps/engine (tarea 16.2), no aquí.

import { test, expect } from "bun:test";
import { otherSide, randomPickForSlots, specForRound } from "../use-random-draft-session";
import { createSeededRng } from "../seeded-rng";
import type { HeroId } from "../types";

test("otherSide devuelve el lado contrario", () => {
  expect(otherSide("radiant")).toBe("dire");
  expect(otherSide("dire")).toBe("radiant");
});

test("specForRound devuelve la spec exacta para cada ronda (2-2-1, 25s/25s/20s)", () => {
  expect(specForRound(1)).toEqual({ round: 1, picksPerTeam: 2, timerMs: 25000 });
  expect(specForRound(2)).toEqual({ round: 2, picksPerTeam: 2, timerMs: 25000 });
  expect(specForRound(3)).toEqual({ round: 3, picksPerTeam: 1, timerMs: 20000 });
});

test("randomPickForSlots nunca elige un héroe baneado, ya tomado, o repetido (100 casos)", () => {
  const allHeroIds: HeroId[] = Array.from({ length: 20 }, (_, i) => i + 1);

  for (let caseIndex = 0; caseIndex < 100; caseIndex++) {
    const rng = createSeededRng("ABCDEFGH");
    const resolvedBans = allHeroIds.slice(0, 5);
    const alreadyTaken = allHeroIds.slice(5, 8);
    const count = caseIndex % 3; // 0, 1, 2

    const picks = randomPickForSlots(count, rng, resolvedBans, alreadyTaken, allHeroIds);

    expect(picks).toHaveLength(count);
    expect(new Set(picks).size).toBe(picks.length);
    for (const heroId of picks) {
      expect(resolvedBans.includes(heroId)).toBe(false);
      expect(alreadyTaken.includes(heroId)).toBe(false);
    }
  }
});

test("randomPickForSlots retorna menos picks que los pedidos si el pool se agota", () => {
  const allHeroIds: HeroId[] = [1, 2, 3];
  const rng = createSeededRng("ABCDEFGH");

  const picks = randomPickForSlots(5, rng, [1], [2], allHeroIds);

  expect(picks).toEqual([3]);
});
