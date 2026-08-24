import { expect, test } from "bun:test";
import { evaluateLane2v2 } from "./evaluate";
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
