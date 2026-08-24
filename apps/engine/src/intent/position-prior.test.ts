import { expect, test } from "bun:test";
import { deriveFlexDistribution } from "./position-prior";
import type { HeroPositions } from "../signals/hero-positions";

// Fixtures a mano, nunca el hero-positions.json real (S10, testing-seams.md): la lógica de
// normalización/entropía no puede depender de qué héroes existan hoy en la curación real.

test("heroId se conserva en el resultado", () => {
  expect(deriveFlexDistribution(55, {}).heroId).toBe(55);
});

test("una sola posición con datos -> probabilidad 1 ahí, entropía exactamente 0", () => {
  const heroPositions: HeroPositions = { 42: [{ position: 3, matches: 500 }] };

  const result = deriveFlexDistribution(42, heroPositions);

  expect(result.probabilities).toEqual({ 1: 0, 2: 0, 3: 1, 4: 0, 5: 0 });
  expect(result.entropy).toBe(0);
});

test("partidas iguales en las 5 posiciones -> distribución uniforme, entropía exactamente log2(5)", () => {
  const heroPositions: HeroPositions = {
    7: ([1, 2, 3, 4, 5] as const).map((position) => ({ position, matches: 200 })),
  };

  const result = deriveFlexDistribution(7, heroPositions);

  for (const p of Object.values(result.probabilities)) expect(p).toBeCloseTo(0.2, 10);
  expect(result.entropy).toBeCloseTo(Math.log2(5), 10);
});

test("split parcial entre dos posiciones calcula probabilidades y entropía exactas", () => {
  const heroPositions: HeroPositions = {
    3: [
      { position: 1, matches: 800 },
      { position: 2, matches: 200 },
    ],
  };

  const result = deriveFlexDistribution(3, heroPositions);

  expect(result.probabilities[1]).toBeCloseTo(0.8, 10);
  expect(result.probabilities[2]).toBeCloseTo(0.2, 10);
  expect(result.probabilities[3]).toBe(0);
  const expectedEntropy = -(0.8 * Math.log2(0.8) + 0.2 * Math.log2(0.2));
  expect(result.entropy).toBeCloseTo(expectedEntropy, 10);
});

test("las probabilidades siempre suman 1, incluso con un split parcial", () => {
  const heroPositions: HeroPositions = {
    9: [
      { position: 4, matches: 300 },
      { position: 5, matches: 900 },
    ],
  };

  const result = deriveFlexDistribution(9, heroPositions);
  const sum = Object.values(result.probabilities).reduce((a, b) => a + b, 0);

  expect(sum).toBeCloseTo(1, 10);
});

test("héroe ausente de heroPositions -> fallback uniforme, entropía log2(5), nunca lanza", () => {
  const result = deriveFlexDistribution(999, {});

  expect(result.probabilities).toEqual({ 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 });
  expect(result.entropy).toBeCloseTo(Math.log2(5), 10);
});

test("héroe con matches en 0 en todas sus posiciones -> mismo fallback uniforme que ausente", () => {
  const heroPositions: HeroPositions = { 5: [{ position: 1, matches: 0 }] };

  const result = deriveFlexDistribution(5, heroPositions);

  expect(result.probabilities).toEqual({ 1: 0.2, 2: 0.2, 3: 0.2, 4: 0.2, 5: 0.2 });
  expect(result.entropy).toBeCloseTo(Math.log2(5), 10);
});
