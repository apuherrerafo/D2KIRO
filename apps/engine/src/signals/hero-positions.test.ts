import { expect, test } from "bun:test";
import {
  isCandidateAdmittedForPosition,
  loadHeroPositions,
  MID_CANDIDATE_MIN_MATCHES,
  MID_CANDIDATE_MIN_SHARE,
  MIN_POSITION_MATCHES,
  parseHeroPositions,
  positionShare,
} from "./hero-positions";

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

test("MID_CANDIDATE_MIN_MATCHES es 3x MIN_POSITION_MATCHES -- derivado del propio piso del archivo, no inventado", () => {
  expect(MID_CANDIDATE_MIN_MATCHES).toBe(MIN_POSITION_MATCHES * 3);
});

test("admisión Mid acepta posición dominante o share >= 25%, exige evidencia absoluta y excluye uso marginal", () => {
  const positions = {
    // Share 22%, muy por debajo de MID_CANDIDATE_MIN_SHARE -- rechazado en share, no en evidencia.
    1: [{ position: 2 as const, matches: 660 }, { position: 4 as const, matches: 2340 }],
    // Share exactamente 25% Y por encima del piso de evidencia absoluta -- admitido.
    2: [{ position: 2 as const, matches: 750 }, { position: 4 as const, matches: 2250 }],
    // Dominante (con una alternativa real de la que ser dominante) Y por encima del piso -- admitido.
    3: [{ position: 2 as const, matches: 900 }, { position: 1 as const, matches: 700 }],
  };

  expect(MID_CANDIDATE_MIN_SHARE).toBe(0.25);
  expect(positionShare(1, 2, positions)).toBe(0.22);
  expect(isCandidateAdmittedForPosition(1, 2, positions)).toBe(false);
  expect(isCandidateAdmittedForPosition(2, 2, positions)).toBe(true);
  expect(isCandidateAdmittedForPosition(3, 2, positions)).toBe(true);
});

// AP Solo Mid data/signal repair (Dota Judge root cause 2, hallazgo RC1): `hero-positions.json`
// sólo registra una posición si superó MIN_POSITION_MATCHES -- una posición que sobrevive SOLA no
// tiene con qué compararse, así que "dominante" era vacuamente cierto sin importar cuán marginal
// fuera la evidencia real. Caso medido: un héroe con 285 partidas totales, todas en Mid, leía como
// 100% de share y "dominante" -- exactamente el mismo shape que produce este fixture sintético.
test("un único sobreviviente con volumen fino (100% de share) NO alcanza el piso de evidencia absoluta -> rechazado", () => {
  const positions = { 1: [{ position: 2 as const, matches: 285 }] };

  expect(positionShare(1, 2, positions)).toBe(1); // share vacuamente perfecto -- el bug real
  expect(isCandidateAdmittedForPosition(1, 2, positions)).toBe(false);
});

test("un único sobreviviente con volumen sustancial (100% de share) SÍ alcanza el piso -> admitido", () => {
  const positions = { 1: [{ position: 2 as const, matches: 3000 }] };

  expect(isCandidateAdmittedForPosition(1, 2, positions)).toBe(true);
});

test("evidencia absoluta insuficiente en la posición objetivo rechaza aunque sea la posición dominante", () => {
  // Dominante entre sus 2 posiciones listadas (300 > 250), pero ninguna cruza el piso absoluto --
  // ambas son, en términos absolutos, evidencia marginal.
  const positions = { 1: [{ position: 2 as const, matches: 300 }, { position: 4 as const, matches: 250 }] };

  expect(isCandidateAdmittedForPosition(1, 2, positions)).toBe(false);
});

test("targetPosition distinto de 2 conserva el comportamiento previo: cualquier presencia curada admite", () => {
  // El piso de evidencia absoluta es exclusivo de Mid (alcance congelado de esta fase: Ranked
  // All Pick · Solo · Radiant · Position 2). Otras posiciones no cambian.
  const positions = { 1: [{ position: 1 as const, matches: 201 }] };

  expect(isCandidateAdmittedForPosition(1, 1, positions)).toBe(true);
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
