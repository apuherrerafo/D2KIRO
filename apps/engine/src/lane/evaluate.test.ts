import { expect, test } from "bun:test";
import { evaluateLane2v2, evaluateLaneRoster } from "./evaluate";
import { LANE_DIMENSIONS } from "./profiles";
import type { HeroLineProfile } from "./profiles";

// Fixtures a mano -- evaluateLane2v2 es aritmética pura sobre HeroLineProfile, no depende del
// archivo curado real (mismo criterio S9/S10 que el resto de Fase 5-6).

const STRONG: HeroLineProfile = {
  heroId: 1,
  sustain: 0.8,
  killPressure: 0.8,
  harassRange: 0.8,
  dispelSave: 0.8,
  creepControl: 0.8,
};
const WEAK: HeroLineProfile = {
  heroId: 2,
  sustain: 0.2,
  killPressure: 0.2,
  harassRange: 0.2,
  dispelSave: 0.2,
  creepControl: 0.2,
};
const EQUAL_WEIGHTS: readonly [number, number, number, number, number] = [0.2, 0.2, 0.2, 0.2, 0.2];

test("par propio domina todas las dimensiones -> laneScore > 0.5, confidence full", () => {
  const result = evaluateLane2v2([STRONG, STRONG], [WEAK, WEAK], EQUAL_WEIGHTS);

  expect(result.laneScore).toBeGreaterThan(0.5);
  expect(result.confidence).toBe("full");
});

test("par rival domina -> laneScore < 0.5", () => {
  const result = evaluateLane2v2([WEAK, WEAK], [STRONG, STRONG], EQUAL_WEIGHTS);
  expect(result.laneScore).toBeLessThan(0.5);
});

test("empate exacto en todas las dimensiones -> laneScore exactamente 0.5 (paridad del sigmoide)", () => {
  const mid: HeroLineProfile = {
    heroId: 3,
    sustain: 0.5,
    killPressure: 0.5,
    harassRange: 0.5,
    dispelSave: 0.5,
    creepControl: 0.5,
  };
  const result = evaluateLane2v2([mid, mid], [mid, mid], EQUAL_WEIGHTS);

  expect(result.laneScore).toBe(0.5);
  for (const dimension of LANE_DIMENSIONS) {
    expect(result.perDimension[dimension]).toBe(0);
  }
});

test("laneScore es el sigmoide exacto de la suma ponderada de los 5 Φ_k", () => {
  const result = evaluateLane2v2([STRONG, STRONG], [WEAK, WEAK], EQUAL_WEIGHTS);
  const expectedSum = 5 * 0.2 * 0.6; // 5 dimensiones, peso 0.2 c/u, delta 0.6 (0.8-0.2) c/u
  const expectedScore = 1 / (1 + Math.exp(-expectedSum));

  expect(result.laneScore).toBeCloseTo(expectedScore, 10);
});

test("falta el perfil de un héroe -> confidence partial_signals, se sustituye por neutro 0.5", () => {
  const result = evaluateLane2v2([STRONG, undefined], [WEAK, WEAK], EQUAL_WEIGHTS);

  expect(result.confidence).toBe("partial_signals");
  // sustain: (0.8+0.5)/2 - (0.2+0.2)/2 = 0.65 - 0.2 = 0.45
  expect(result.perDimension.sustain).toBeCloseTo(0.45, 10);
});

test("faltan los dos perfiles de un lado -> partial_signals, nunca lanza", () => {
  const result = evaluateLane2v2([undefined, undefined], [STRONG, STRONG], EQUAL_WEIGHTS);

  expect(result.confidence).toBe("partial_signals");
  expect(Number.isFinite(result.laneScore)).toBe(true);
});

test("pesos que no suman 1 se usan tal cual -- no se normalizan en silencio", () => {
  const onlySustain: readonly [number, number, number, number, number] = [1, 0, 0, 0, 0];
  const result = evaluateLane2v2([STRONG, STRONG], [WEAK, WEAK], onlySustain);
  const expectedScore = 1 / (1 + Math.exp(-0.6)); // solo el delta de sustain (0.6) cuenta

  expect(result.laneScore).toBeCloseTo(expectedScore, 10);
});

test("el orden de los pesos corresponde exactamente al orden de LANE_DIMENSIONS", () => {
  // Solo sustain difiere entre lados; el peso está puesto en la SEGUNDA posición
  // (killPressure, delta 0). Si el código desalinea pesos y dimensiones, este resultado deja
  // de ser 0.5 exacto -- mismo tipo de hallazgo que TSK-036 (un test de una sola dimensión no
  // detecta un desalineamiento entre índice de peso y campo leído).
  const ally: HeroLineProfile = {
    heroId: 10,
    sustain: 1,
    killPressure: 0,
    harassRange: 0,
    dispelSave: 0,
    creepControl: 0,
  };
  const enemyProfile: HeroLineProfile = {
    heroId: 11,
    sustain: 0,
    killPressure: 0,
    harassRange: 0,
    dispelSave: 0,
    creepControl: 0,
  };
  const weightsOnKillPressure: readonly [number, number, number, number, number] = [0, 1, 0, 0, 0];

  const result = evaluateLane2v2([ally, ally], [enemyProfile, enemyProfile], weightsOnKillPressure);

  expect(result.laneScore).toBe(0.5);
});

// evaluateLaneRoster (Gobernanza 2.0, ampliación 5v5): generaliza evaluateLane2v2 a un roster de
// tamaño variable, misma fórmula sigmoide(Σω·Φ) y misma sustitución neutra 0.5.

test("roster de 3 vs 3 promedia sobre TODOS los perfiles confirmados, no solo los primeros 2", () => {
  const result = evaluateLaneRoster([STRONG, STRONG, WEAK], [WEAK, WEAK, WEAK], EQUAL_WEIGHTS);
  // 5 dimensiones idénticas entre STRONG/WEAK: mean aliado (0.8+0.8+0.2)/3=0.6, mean rival 0.2 ->
  // delta 0.4 por dimensión.
  const expectedSum = 5 * 0.2 * 0.4;
  const expectedScore = 1 / (1 + Math.exp(-expectedSum));

  expect(result.laneScore).toBeCloseTo(expectedScore, 10);
  expect(result.confidence).toBe("full");
});

test("roster desparejo (2 aliados vs 1 rival) promedia cada lado por separado -- no exige tamaños iguales", () => {
  const result = evaluateLaneRoster([STRONG, WEAK], [STRONG], EQUAL_WEIGHTS);
  // mean aliado (0.8+0.2)/2=0.5, mean rival 0.8 -> delta -0.3
  const expectedSum = 5 * 0.2 * -0.3;
  const expectedScore = 1 / (1 + Math.exp(-expectedSum));

  expect(result.laneScore).toBeCloseTo(expectedScore, 10);
});

test("lado sin ningún pick confirmado (array vacío) -> neutro 0.5 por dimensión, nunca lanza", () => {
  const result = evaluateLaneRoster([STRONG], [], EQUAL_WEIGHTS);
  const expectedSum = 5 * 0.2 * (0.8 - 0.5); // mean rival vacío -> 0.5 neutro, nunca 0
  const expectedScore = 1 / (1 + Math.exp(-expectedSum));

  expect(result.laneScore).toBeCloseTo(expectedScore, 10);
  expect(Number.isFinite(result.laneScore)).toBe(true);
});

test("falta el perfil de un héroe dentro de un roster más grande -> partial_signals, los demás perfiles reales sí cuentan", () => {
  const result = evaluateLaneRoster([STRONG, undefined, STRONG], [WEAK, WEAK], EQUAL_WEIGHTS);

  expect(result.confidence).toBe("partial_signals");
  // mean aliado (0.8+0.5+0.8)/3=0.7 -- el undefined se sustituye por 0.5 neutro, los otros 2
  // perfiles reales SÍ promedian con su valor real, no se descarta todo el lado por un hueco.
  expect(result.perDimension.sustain).toBeCloseTo(0.7 - 0.2, 10);
});

test("con exactamente 2 aliados y 2 rivales, da el mismo resultado que evaluateLane2v2 (generalización sin regresión)", () => {
  const roster = evaluateLaneRoster([STRONG, STRONG], [WEAK, WEAK], EQUAL_WEIGHTS);
  const fixed = evaluateLane2v2([STRONG, STRONG], [WEAK, WEAK], EQUAL_WEIGHTS);

  expect(roster.laneScore).toBeCloseTo(fixed.laneScore, 10);
  expect(roster.confidence).toBe(fixed.confidence);
});
