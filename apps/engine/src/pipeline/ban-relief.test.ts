import { expect, test } from "bun:test";
import { createBanReliefWinrate, createOpportunityWindowScore, createTeamOpeningMatchupWinrate, createPositionalCommitment, POSITION_OVERLAP_GAIN, BETA_OPENING } from "./ban-relief";
import type { HeroMatchupStat } from "../signals/types";
import type { HeroPositions } from "../signals/hero-positions";

const UNFAVORABLE_MATCHUP: Record<number, HeroMatchupStat[]> = {
  1: [{ vsHero: 99, games: 400, wins: 120 }], // wr 0.30 -- adverso para el héroe 1
};

test("candidato sin dato de posición reproduce exactamente el alivio plano actual (el ancla)", () => {
  const winrate = createBanReliefWinrate(UNFAVORABLE_MATCHUP, {});
  // Sin entrada en heroPositions -> distribución uniforme (0.2 en las 5), POSITION_OVERLAP_GAIN=5
  // cancela el 0.2 exactamente a 1.0 -- el resultado es el relief "plano" puro.
  const relief = Math.max(0, 0.5 - 120 / 400);
  for (const position of [1, 2, 3, 4, 5] as const) {
    expect(winrate(1, 99, position)).toBeCloseTo(relief, 9);
  }
});

test("sin fila de matchup -> null", () => {
  const winrate = createBanReliefWinrate({}, {});
  expect(winrate(1, 99, 1)).toBeNull();
});

test("games por debajo del umbral -> null, nunca 0", () => {
  const winrate = createBanReliefWinrate({ 1: [{ vsHero: 99, games: 199, wins: 0 }] }, {});
  expect(winrate(1, 99, 1)).toBeNull();
});

test("matchup favorable (wr >= 0.5) -> relief 0, nunca negativo", () => {
  const winrate = createBanReliefWinrate({ 1: [{ vsHero: 99, games: 400, wins: 280 }] }, {});
  expect(winrate(1, 99, 1)).toBe(0);
});

test("TSK-138: un héroe baneado no aporta matchup directo", () => {
  const direct = createTeamOpeningMatchupWinrate(UNFAVORABLE_MATCHUP, {});
  expect(direct(1, 99, 1)).toBe(0);
});

test("TSK-138: el ban adverso abre una oportunidad positiva y trazable", () => {
  const opportunity = createOpportunityWindowScore(UNFAVORABLE_MATCHUP, {});
  expect(opportunity(1, 99, 1)).toBeCloseTo(0.2, 9);
  expect(opportunity(1, 100, 1)).toBeNull();
});

test("el solapamiento posicional pondera el relief -- posición dominante pesa más que una marginal", () => {
  const heroPositions: HeroPositions = {
    1: [{ position: 1, matches: 900 }, { position: 2, matches: 100 }],
  };
  const winrate = createBanReliefWinrate(UNFAVORABLE_MATCHUP, heroPositions);
  const reliefAtPos1 = winrate(1, 99, 1)!;
  const reliefAtPos5 = winrate(1, 99, 5)!;
  expect(reliefAtPos1).toBeGreaterThan(reliefAtPos5);
  expect(reliefAtPos5).toBe(0); // el candidato nunca jugó pos 5 -- probabilidad 0, relief 0
});

test("POSITION_OVERLAP_GAIN es 1/UNIFORM_PROBABILITY = 5", () => {
  expect(POSITION_OVERLAP_GAIN).toBe(5);
});

test("BETA_OPENING calibrado mantiene la entropía como señal secundaria fuerte", () => {
  expect(BETA_OPENING).toBe(0.5);
});

test("createPositionalCommitment: héroe con una sola posición >=200 partidas -> 1", () => {
  const commitment = createPositionalCommitment({ 1: [{ position: 1, matches: 500 }] });
  expect(commitment(1)).toBeCloseTo(1, 9);
});

test("createPositionalCommitment: sin entrada en hero-positions.json -> 0 exacto (uniforme)", () => {
  const commitment = createPositionalCommitment({});
  expect(commitment(1)).toBeCloseTo(0, 9);
});

test("createPositionalCommitment: nunca negativo, nunca > 1", () => {
  const heroPositions: HeroPositions = {
    1: [{ position: 1, matches: 300 }, { position: 2, matches: 300 }],
  };
  const commitment = createPositionalCommitment(heroPositions);
  const value = commitment(1);
  expect(value).toBeGreaterThanOrEqual(0);
  expect(value).toBeLessThanOrEqual(1);
});
