import { expect, test } from "bun:test";
import { calculateProposedPool } from "./calculate-pool";

const fixedNow = () => "2026-07-29T00:00:00.000Z";

test("descarta héroes con menos de 10 partidas en la ventana", () => {
  const result = calculateProposedPool(
    [
      { heroId: 1, games: 9, wins: 8 },
      { heroId: 2, games: 15, wins: 10 },
    ],
    fixedNow,
  );

  expect(result.proposed.map((entry) => entry.hero)).toEqual([2]);
});

test("el baseline se calcula sobre TODAS las filas, no solo las que pasan el mínimo de 10", () => {
  // Héroe 1 tiene solo 3 partidas (no pasa el filtro) pero 100% de winrate -- si el baseline se
  // calculara solo sobre los héroes elegibles, saldría distinto (inflado o deflado según el caso).
  const result = calculateProposedPool(
    [
      { heroId: 1, games: 3, wins: 3 },
      { heroId: 2, games: 20, wins: 10 },
    ],
    fixedNow,
  );

  // baseline = (3 + 10) wins / (3 + 20) games = 13/23
  expect(result.baselineWinrate).toBeCloseTo(13 / 23, 10);
  expect(result.consideredHeroes).toBe(2);
});

test("shrunk calculado a mano con valores conocidos: 7-en-10 sigue arriba de 25-en-45 con K=10", () => {
  // Mismo par usado en la conversación de /blueprint: baseline = 32/55 = 0.581818...
  // shrunk(7/10)  = (7  + 10*baseline) / (10 + 10) = (7  + 5.818181...) / 20 = 0.640909...
  // shrunk(25/45) = (25 + 10*baseline) / (45 + 10) = (25 + 5.818181...) / 55 = 0.560330...
  const result = calculateProposedPool(
    [
      { heroId: 1, games: 10, wins: 7 },
      { heroId: 2, games: 45, wins: 25 },
    ],
    fixedNow,
  );

  expect(result.baselineWinrate).toBeCloseTo(32 / 55, 10);
  expect(result.proposed.map((entry) => entry.hero)).toEqual([1, 2]);
  expect(result.proposed[0]!.personalWinrate).toBeCloseTo(0.7, 10);
  expect(result.proposed[1]!.personalWinrate).toBeCloseTo(25 / 45, 10);
});

test("toma como máximo los primeros 5 por shrunk descendente", () => {
  const heroRows = Array.from({ length: 8 }, (_, i) => ({
    heroId: i + 1,
    games: 20,
    wins: 10 + i, // wins ascendente: héroe 8 es el mejor, héroe 1 el peor
  }));

  const result = calculateProposedPool(heroRows, fixedNow);

  expect(result.proposed).toHaveLength(5);
  expect(result.proposed.map((entry) => entry.hero)).toEqual([8, 7, 6, 5, 4]);
});

test("desempate por partidas jugadas (personalGames) cuando el shrunk es idéntico", () => {
  const result = calculateProposedPool(
    [
      { heroId: 1, games: 10, wins: 5 },
      { heroId: 2, games: 20, wins: 10 },
    ],
    fixedNow,
  );

  // Mismo winrate (50%) -- con baseline también 50%, shrunk es idéntico para ambos. Gana el que
  // tiene más partidas jugadas.
  expect(result.proposed.map((entry) => entry.hero)).toEqual([2, 1]);
});

test("hasta 5 es un techo, no un piso: menos de 5 elegibles produce una propuesta más corta", () => {
  const result = calculateProposedPool(
    [
      { heroId: 1, games: 20, wins: 10 },
      { heroId: 2, games: 5, wins: 4 },
    ],
    fixedNow,
  );

  expect(result.proposed).toHaveLength(1);
});

test("cero héroes pasan el mínimo -> proposed vacío, no es un error", () => {
  const result = calculateProposedPool(
    [
      { heroId: 1, games: 5, wins: 3 },
      { heroId: 2, games: 2, wins: 1 },
    ],
    fixedNow,
  );

  expect(result.proposed).toEqual([]);
  expect(result.consideredHeroes).toBe(2);
});

test("entrada vacía no lanza y devuelve una propuesta vacía", () => {
  const result = calculateProposedPool([], fixedNow);

  expect(result.proposed).toEqual([]);
  expect(result.baselineWinrate).toBe(0);
  expect(result.consideredHeroes).toBe(0);
});

test("cada entrada propuesta lleva source:'calculated' y el updatedAt inyectado", () => {
  const result = calculateProposedPool([{ heroId: 1, games: 10, wins: 5 }], fixedNow);

  expect(result.proposed[0]).toEqual({
    hero: 1,
    source: "calculated",
    personalWinrate: 0.5,
    personalGames: 10,
    updatedAt: "2026-07-29T00:00:00.000Z",
  });
});
