import { expect, test } from "bun:test";
import { deriveContinuousPipelineWeights, deriveDynamicPipelineWeights, openingBlend, OPENING_SPAN, OPENING_LANE_WEIGHT } from "./phase-decay";
import type { PipelineWeights } from "./weight-loader";

const SUM_EPSILON = 1e-9;
const BASE: PipelineWeights = { knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25 };

test("openingBlend: 1.0 con tablero vacío, 0.0 con 4 o más picks confirmados", () => {
  expect(openingBlend(0, 0)).toBe(1);
  expect(openingBlend(0, 4)).toBe(0);
  expect(openingBlend(2, 2)).toBe(0);
  expect(openingBlend(3, 3)).toBe(0);
});

test("tabla exacta de la Fase 6 (SPEC.md §13.4)", () => {
  const cases: [number, number, number][] = [
    [0, 0.0, 0.9],
    [1, 0.1, 0.7375],
    [2, 0.2, 0.575],
    [3, 0.3, 0.4125],
    [4, 0.4, 0.25],
  ];
  for (const [confirmed, expectedKnn, expectedDenial] of cases) {
    const own = Math.floor(confirmed / 2);
    const enemy = confirmed - own;
    const result = deriveContinuousPipelineWeights(BASE, own, enemy);
    expect(result.knn_similarity).toBeCloseTo(expectedKnn, 9);
    expect(result.lane_score).toBeCloseTo(confirmed === 0 ? 0.1 : 0.35 - (0.25 * (1 - confirmed / 4)), 9);
    expect(result.denial_score).toBeCloseTo(expectedDenial, 9);
  }
});

test("con own+enemy >= 4, devuelve exactamente base -- fase media/tardía no cambia", () => {
  const result = deriveContinuousPipelineWeights(BASE, 2, 2);
  expect(result).toEqual(BASE);
});

test("la apertura reserva 10% al factor posicional y 90% a la evidencia de bans", () => {
  const result = deriveContinuousPipelineWeights(BASE, 0, 0);
  expect(OPENING_LANE_WEIGHT).toBe(0.1);
  expect(result.lane_score).toBe(OPENING_LANE_WEIGHT);
  expect(result.denial_score).toBeCloseTo(0.9, 9);
});

test("los 3 pesos suman 1.0 para toda combinación de (own, enemy) en 0..5 x 0..5", () => {
  for (let own = 0; own <= 5; own++) {
    for (let enemy = 0; enemy <= 5; enemy++) {
      const result = deriveContinuousPipelineWeights(BASE, own, enemy);
      const sum = result.knn_similarity + result.lane_score + result.denial_score;
      expect(Math.abs(sum - 1)).toBeLessThanOrEqual(SUM_EPSILON);
    }
  }
});

test("TSK-139: fase 1 prioriza flex/rol 55%, oportunidad 25% y sinergia 20%", () => {
  expect(deriveDynamicPipelineWeights(BASE, 0, 0)).toEqual({
    knn_similarity: 0.2,
    lane_score: 0.55,
    denial_score: 0.25,
  });
});

test("TSK-139: fase 2 prioriza matchup 45%, control 30% y sinergia 25%", () => {
  expect(deriveDynamicPipelineWeights(BASE, 2, 2)).toEqual({
    knn_similarity: 0.25,
    lane_score: 0.3,
    denial_score: 0.45,
  });
});

test("OPENING_SPAN es 4, mismo criterio que deriveDecisionContext", () => {
  expect(OPENING_SPAN).toBe(4);
});
