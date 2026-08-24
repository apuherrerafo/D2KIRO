import { expect, test } from "bun:test";
import { inferFlexPick } from "./flex-inference";
import type { HeroPositions } from "../signals/hero-positions";

// Fixtures a mano, nunca el hero-positions.json real (S10, testing-seams.md) -- mismo criterio
// que position-prior.test.ts (7.1).

const SPECIALIST: HeroPositions = { 1: [{ position: 3, matches: 500 }] }; // entropía 0
const SPLIT: HeroPositions = {
  2: [
    { position: 1, matches: 800 },
    { position: 2, matches: 200 },
  ],
}; // entropía ~0.7219
const SPLIT_ENTROPY = -(0.8 * Math.log2(0.8) + 0.2 * Math.log2(0.2));
const UNIFORM_HERO: HeroPositions = {
  3: ([1, 2, 3, 4, 5] as const).map((position) => ({ position, matches: 200 })),
}; // entropía log2(5)

test("entropía baja (especialista de una sola posición) -> isFlex false", () => {
  const result = inferFlexPick(1, SPECIALIST, 1.0);

  expect(result.distribution.entropy).toBe(0);
  expect(result.isFlex).toBe(false);
});

test("entropía alta (distribución uniforme) -> isFlex true", () => {
  const result = inferFlexPick(3, UNIFORM_HERO, 1.0);

  expect(result.distribution.entropy).toBeCloseTo(Math.log2(5), 10);
  expect(result.isFlex).toBe(true);
});

test("caso límite: entropía exactamente igual al umbral -> isFlex false (estrictamente mayor, no >=)", () => {
  const result = inferFlexPick(2, SPLIT, SPLIT_ENTROPY);
  expect(result.isFlex).toBe(false);
});

test("mismo héroe, umbral distinto -> el resultado responde exactamente al parámetro", () => {
  const below = inferFlexPick(2, SPLIT, SPLIT_ENTROPY - 0.001);
  const above = inferFlexPick(2, SPLIT, SPLIT_ENTROPY + 0.001);

  expect(below.isFlex).toBe(true);
  expect(above.isFlex).toBe(false);
});

test("rivalHeroId y distribution reflejan exactamente deriveFlexDistribution", () => {
  const result = inferFlexPick(2, SPLIT, 1.0);

  expect(result.rivalHeroId).toBe(2);
  expect(result.distribution.heroId).toBe(2);
  expect(result.distribution.probabilities[1]).toBeCloseTo(0.8, 10);
  expect(result.distribution.probabilities[2]).toBeCloseTo(0.2, 10);
});

test("umbral 0 -- cualquier entropía positiva es flex", () => {
  const result = inferFlexPick(2, SPLIT, 0);
  expect(result.isFlex).toBe(true);
});
