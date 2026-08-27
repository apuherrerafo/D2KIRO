import { expect, test } from "bun:test";
import { calculateDenialScore } from "./denial-score";
import type { FlexInferenceResult } from "./flex-inference";
import type { HeroId } from "../draft/reducer";

// Fixtures a mano, construidas directamente (no vía inferFlexPick/deriveFlexDistribution) para
// mantener este archivo aislado de 7.1/7.2 -- mismo criterio S3/testing-seams.md: un cambio en
// position-prior nunca debería poder romper este archivo.

const SPLIT_ENTROPY = -(0.8 * Math.log2(0.8) + 0.2 * Math.log2(0.2)); // ~0.7219

const FLEX_HERO: FlexInferenceResult = {
  rivalHeroId: 99,
  distribution: {
    heroId: 99,
    probabilities: { 1: 0.8, 2: 0.2, 3: 0, 4: 0, 5: 0 },
    entropy: SPLIT_ENTROPY,
  },
  isFlex: true,
};

const WINRATE_TABLE: Record<1 | 2 | 3 | 4 | 5, number> = { 1: 0.55, 2: 0.45, 3: 0.5, 4: 0.5, 5: 0.5 };
const winrateStub = (_a: HeroId, _b: HeroId, position: 1 | 2 | 3 | 4 | 5) => WINRATE_TABLE[position];

test("calcula el número exacto con matchupWinrate y earlyPressure fijos", () => {
  const score = calculateDenialScore(7, FLEX_HERO, winrateStub, () => 0.3, 0.5);
  // matchupTerm = 0.8*0.55 + 0.2*0.45 (posiciones 3-5 pesan 0) = 0.53
  // pressureTerm = 0.5 * 0.3 * SPLIT_ENTROPY
  const expected = 0.53 + 0.5 * 0.3 * SPLIT_ENTROPY;

  expect(score).toBeCloseTo(expected, 10);
});

test("matchupWinrate null en todas las posiciones -- solo aporta presión temprana * entropía", () => {
  const alwaysNull = () => null;
  const score = calculateDenialScore(7, FLEX_HERO, alwaysNull, () => 0.3, 0.5);
  const expected = 0.5 * 0.3 * SPLIT_ENTROPY; // matchupTerm excluido, nunca 0 disfrazado de dato

  expect(score).toBeCloseTo(expected, 10);
});

test("beta=0 anula por completo el término de presión/entropía", () => {
  const score = calculateDenialScore(7, FLEX_HERO, winrateStub, () => 0.3, 0);
  const expected = 0.53; // solo matchupTerm

  expect(score).toBeCloseTo(expected, 10);
});

test("el escalón de beta incrementa linealmente la presión de entropía", () => {
  const low = calculateDenialScore(7, FLEX_HERO, () => null, () => 0.3, 0.5);
  const high = calculateDenialScore(7, FLEX_HERO, () => null, () => 0.3, 0.7);
  expect(high / low).toBeCloseTo(1.4, 10);
});

test("exclusión mixta con probabilidad no nula DESPUÉS de una posición null -- nunca corta el resto", () => {
  // Guarda contra un bug real y plausible: cortar el bucle en el primer null (`break`) en vez de
  // saltarlo y seguir (`continue`) -- mismo tipo de hallazgo que TSK-036. Acá la probabilidad no
  // nula vive en la posición 5, después de un null en la posición 1: si el código corta temprano,
  // pierde esa contribución real.
  const spreadFlexHero: FlexInferenceResult = {
    rivalHeroId: 50,
    distribution: {
      heroId: 50,
      probabilities: { 1: 0.5, 2: 0, 3: 0, 4: 0, 5: 0.5 },
      entropy: 1, // -(0.5*log2(0.5) + 0.5*log2(0.5)) = 1, exacto
    },
    isFlex: true,
  };
  const nullAtPos1 = (_a: HeroId, _b: HeroId, position: 1 | 2 | 3 | 4 | 5) =>
    position === 1 ? null : position === 5 ? 0.7 : 0.5;

  const score = calculateDenialScore(3, spreadFlexHero, nullAtPos1, () => 0.2, 0.4);
  const expected = 0.5 * 0.7 + 0.4 * 0.2 * 1; // posición 1 excluida, posición 5 sí contribuye

  expect(score).toBeCloseTo(expected, 10);
});

test("earlyPressure se evalúa sobre candidateHero, no sobre el héroe rival", () => {
  const earlyPressureSpy = (heroId: HeroId) => (heroId === 777 ? 1 : 0);
  const score = calculateDenialScore(777, FLEX_HERO, () => null, earlyPressureSpy, 1);
  const expected = 1 * 1 * SPLIT_ENTROPY;

  expect(score).toBeCloseTo(expected, 10);
});

test("matchupWinrate se llama con (candidateHero, rivalHeroId, position) en ese orden", () => {
  const calls: Array<[HeroId, HeroId, number]> = [];
  const spy = (a: HeroId, b: HeroId, position: 1 | 2 | 3 | 4 | 5) => {
    calls.push([a, b, position]);
    return 0;
  };

  calculateDenialScore(11, FLEX_HERO, spy, () => 0, 0);

  expect(calls).toContainEqual([11, FLEX_HERO.rivalHeroId, 1]);
  expect(calls).toContainEqual([11, FLEX_HERO.rivalHeroId, 2]);
});
