import { expect, test } from "bun:test";
import {
  HERO_POSITION_OBSERVATIONS_SCHEMA,
  isCandidateAdmittedForPosition,
  isCredibleForPosition,
  loadHeroPositions,
  MID_CANDIDATE_MIN_MATCHES,
  MID_CANDIDATE_MIN_SHARE,
  MIN_POSITION_MATCHES,
  parseHeroPositionObservations,
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

// ---------------------------------------------------------------------------------------------------------------
// Certification remediation (Phase A, A2): the share denominator is the hero's COMPLETE observed total, built from
// every retained observation -- INCLUDING those below MIN_POSITION_MATCHES. The admission floor is a separate,
// later step. Fixtures are inline (S10): none of these read hero-positions.json.
// ---------------------------------------------------------------------------------------------------------------
const observationsFile = (heroes: unknown[]) => ({ schema: HERO_POSITION_OBSERVATIONS_SCHEMA, heroes });

test("v2: el denominador incluye las observaciones bajo el piso; las posiciones admitidas no", () => {
  const positions = parseHeroPositionObservations(
    observationsFile([
      // 1026 at Pos3 + 2969 at Pos1 survive the floor; Pos2 (199) and Pos5 (199) do not -- they still count in the denominator.
      { hero: 7, observations: [{ position: 1, matches: 2969 }, { position: 3, matches: 1026 }, { position: 2, matches: 199 }, { position: 5, matches: 199 }] },
    ]),
  );

  expect(positions[7]!.map((share) => share.position)).toEqual([1, 3]); // admitted view: floor applied AFTER the denominator
  expect(positions[7]!.every((share) => share.heroTotalMatches === 2969 + 1026 + 199 + 199)).toBe(true);
  expect(positionShare(7, 3, positions)).toBeCloseTo(1026 / 4393, 10);
});

test("v2 vs v1: la MISMA evidencia admite un secundario en v1 (denominador de sobrevivientes) y lo rechaza en v2 (denominador completo)", () => {
  // Real-shaped case (Earthshaker-like): 1026/3995 = 25.7% of survivors, but 1026/4393 = 23.4% of everything observed.
  const survivorsOnly = { 7: [{ position: 1 as const, matches: 2969 }, { position: 3 as const, matches: 1026 }] };
  const complete = parseHeroPositionObservations(
    observationsFile([{ hero: 7, observations: [{ position: 1, matches: 2969 }, { position: 3, matches: 1026 }, { position: 2, matches: 199 }, { position: 5, matches: 199 }] }]),
  );

  expect(positionShare(7, 3, survivorsOnly)).toBeGreaterThanOrEqual(MID_CANDIDATE_MIN_SHARE);
  expect(isCredibleForPosition(7, 3, survivorsOnly)).toBe(true); // the inflated admission
  expect(positionShare(7, 3, complete)).toBeLessThan(MID_CANDIDATE_MIN_SHARE);
  expect(isCredibleForPosition(7, 3, complete)).toBe(false); // the corrected one
  expect(isCredibleForPosition(7, 1, complete)).toBe(true); // the dominant position is unaffected by the denominator
});

test("v2: un héroe sin ninguna posición >= piso (Chen) queda SIN evidencia -- no se le inventa una posición", () => {
  const positions = parseHeroPositionObservations(
    observationsFile([{ hero: 66, observations: [{ position: 5, matches: 150 }, { position: 4, matches: 120 }, { position: 1, matches: 10 }] }]),
  );

  expect(66 in positions).toBe(false);
  expect(isCredibleForPosition(66, 5, positions)).toBe(false);
  expect(isCandidateAdmittedForPosition(66, 5, positions)).toBe(false);
});

test("v2: filas malformadas o posición duplicada descartan al héroe entero; otro schema -> {}; nunca lanza", () => {
  const positions = parseHeroPositionObservations(
    observationsFile([
      { hero: 1, observations: [{ position: 1, matches: 900 }, { position: 1, matches: 300 }] }, // duplicate position: ambiguous denominator
      { hero: 2, observations: [{ position: 6, matches: 900 }] }, // position out of range
      { hero: 3, observations: [{ position: 1, matches: -5 }] }, // negative count
      { hero: 4, observations: [{ position: 1, matches: 900.5 }] }, // non-integer
      { hero: 5, observations: [{ position: 1, matches: 900 }] }, // the only valid hero
      { hero: 5, observations: [{ position: 2, matches: 900 }] }, // duplicate hero: first one wins
      null,
    ]),
  );

  expect(Object.keys(positions)).toEqual(["5"]);
  expect(positions[5]![0]!.position).toBe(1);
  expect(parseHeroPositionObservations({ schema: "something-else/v9", heroes: [] })).toEqual({});
  expect(parseHeroPositionObservations(null)).toEqual({});
  expect(parseHeroPositionObservations([])).toEqual({});
});

test("v2: el orden de las posiciones admitidas es determinista (matches desc, luego posición asc)", () => {
  const positions = parseHeroPositionObservations(
    observationsFile([{ hero: 9, observations: [{ position: 5, matches: 400 }, { position: 4, matches: 400 }, { position: 1, matches: 800 }] }]),
  );

  expect(positions[9]!.map((share) => share.position)).toEqual([1, 4, 5]);
});

test("sin heroTotalMatches (fixture / v1 legacy) positionShare cae a la suma de las posiciones listadas -- comportamiento previo intacto", () => {
  const legacy = { 1: [{ position: 2 as const, matches: 660 }, { position: 4 as const, matches: 2340 }] };

  expect(positionShare(1, 2, legacy)).toBe(0.22);
});
