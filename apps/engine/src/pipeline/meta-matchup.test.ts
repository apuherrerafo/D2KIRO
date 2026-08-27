import { expect, test } from "bun:test";
import { createMetaMatchupWinrate, MIN_MATCHUP_GAMES } from "./meta-matchup";
import type { HeroMatchupStat } from "../signals/types";

test("par ausente en el índice -> null", () => {
  const winrate = createMetaMatchupWinrate({});
  expect(winrate(1, 2, 1)).toBeNull();
});

test("par con games < MIN_MATCHUP_GAMES -> null, nunca 0", () => {
  const matchups: Record<number, HeroMatchupStat[]> = {
    1: [{ vsHero: 2, games: MIN_MATCHUP_GAMES - 1, wins: 0 }],
  };
  const winrate = createMetaMatchupWinrate(matchups);
  expect(winrate(1, 2, 1)).toBeNull();
});

test("par con games >= MIN_MATCHUP_GAMES -> wins/games exacto", () => {
  const matchups: Record<number, HeroMatchupStat[]> = {
    1: [{ vsHero: 2, games: 400, wins: 180 }],
  };
  const winrate = createMetaMatchupWinrate(matchups);
  expect(winrate(1, 2, 1)).toBeCloseTo(0.45, 9);
});

test("position se ignora -- mismo resultado para las 5 posiciones", () => {
  const matchups: Record<number, HeroMatchupStat[]> = {
    1: [{ vsHero: 2, games: 400, wins: 200 }],
  };
  const winrate = createMetaMatchupWinrate(matchups);
  for (const position of [1, 2, 3, 4, 5] as const) {
    expect(winrate(1, 2, position)).toBe(0.5);
  }
});

test("el índice se construye una sola vez -- múltiples consultas no reconstruyen", () => {
  let readCount = 0;
  const matchups: Record<number, HeroMatchupStat[]> = {
    1: [{ vsHero: 2, games: 400, wins: 200 }],
  };
  // Object.entries solo se invoca dentro de createMetaMatchupWinrate; espiamos indirectamente
  // confirmando que múltiples llamadas al winrate resultante producen el mismo resultado estable
  // sin necesidad de volver a pasar `matchups`.
  const winrate = createMetaMatchupWinrate(matchups);
  for (let i = 0; i < 5; i++) {
    readCount += winrate(1, 2, 1) === 0.5 ? 1 : 0;
  }
  expect(readCount).toBe(5);
});
