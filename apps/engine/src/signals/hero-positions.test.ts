import { expect, test } from "bun:test";
import { MIN_POSITION_MATCHES, loadHeroPositions, parseHeroPositions } from "./hero-positions";

// Smoke test contra el archivo real -- estructural, no de contenido (S10, testing-seams.md):
// verifica que carga y es válido, nunca un valor exacto de un héroe puntual (eso se rompería en
// silencio cada vez que se regenera el archivo tras un parche).
test("loadHeroPositions() carga el archivo real: entradas válidas, sin héroes duplicados", () => {
  const positions = loadHeroPositions();
  const heroIds = Object.keys(positions).map(Number);

  expect(heroIds.length).toBeGreaterThan(0);
  expect(new Set(heroIds).size).toBe(heroIds.length);
  for (const shares of Object.values(positions)) {
    expect(shares.length).toBeGreaterThan(0);
    for (const share of shares) {
      expect(share.position).toBeGreaterThanOrEqual(1);
      expect(share.position).toBeLessThanOrEqual(5);
      expect(share.matches).toBeGreaterThanOrEqual(MIN_POSITION_MATCHES);
    }
  }
});

// El resto de los casos usa parseHeroPositions con fixtures sintéticos -- nunca el archivo real
// (costura S10): la lógica de filtrado no puede depender de qué héroes existan hoy en el meta.

test("parseHeroPositions descarta entradas inválidas sin lanzar y conserva las válidas", () => {
  const raw = [
    { hero: 1, positions: [{ position: 1, matches: 500 }] }, // válida
    { hero: 2, positions: [{ position: 0, matches: 500 }] }, // position fuera de rango (bajo)
    { hero: 3, positions: [{ position: 6, matches: 500 }] }, // position fuera de rango (alto)
    { hero: 4, positions: [{ position: 2, matches: 150 }] }, // matches < umbral
    { hero: 5, positions: [{ position: 2, matches: "500" }] }, // matches no entero
    { hero: 6, positions: [] }, // sin posiciones -- inválida, no aporta nada
    "not an object",
    null,
    42,
    { hero: "not a number", positions: [{ position: 1, matches: 500 }] },
    { hero: -1, positions: [{ position: 1, matches: 500 }] },
    {},
  ];

  const result = parseHeroPositions(raw);

  expect(result).toEqual({ 1: [{ position: 1, matches: 500 }] });
});

test("parseHeroPositions descarta héroes duplicados (conserva la primera aparición)", () => {
  const raw = [
    { hero: 7, positions: [{ position: 3, matches: 1000 }] },
    { hero: 7, positions: [{ position: 4, matches: 2000 }] },
  ];

  const result = parseHeroPositions(raw);

  expect(result).toEqual({ 7: [{ position: 3, matches: 1000 }] });
});

test("parseHeroPositions con el archivo entero corrupto devuelve {} sin lanzar", () => {
  expect(parseHeroPositions(null)).toEqual({});
  expect(parseHeroPositions(undefined)).toEqual({});
  expect(parseHeroPositions("not an array")).toEqual({});
  expect(parseHeroPositions({ hero: 1 })).toEqual({});
  expect(parseHeroPositions(42)).toEqual({});
});

test("parseHeroPositions filtra shares inválidos dentro de una entrada por lo demás válida", () => {
  const raw = [
    {
      hero: 8,
      positions: [
        { position: 1, matches: 500 },
        { position: 9, matches: 500 }, // inválida, se descarta -- la entrada sigue viva
        { position: 2, matches: 50 }, // por debajo del umbral, se descarta
      ],
    },
  ];

  const result = parseHeroPositions(raw);

  expect(result).toEqual({ 8: [{ position: 1, matches: 500 }] });
});

test("MIN_POSITION_MATCHES es una constante nombrada, no un número suelto (200)", () => {
  expect(MIN_POSITION_MATCHES).toBe(200);
});
