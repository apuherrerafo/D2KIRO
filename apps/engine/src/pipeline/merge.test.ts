import { expect, test } from "bun:test";
import { mergePipelineSignals } from "./merge";
import type { PipelineSignalContribution } from "./merge";
import type { PipelineWeights } from "./weight-loader";

// Fixture de pesos a mano -- no depende de pro-drafter-weights-v6.json real (mismo criterio S9/
// S10 que el resto del motor): la lógica de mezcla no puede depender de qué valores tenga hoy el
// seed de 8.2.
const WEIGHTS: PipelineWeights = { knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25 };

test("calcula el número exacto con las 3 señales presentes", () => {
  const signals: PipelineSignalContribution[] = [
    { signal: "knn_similarity", raw: 0.6 }, // rango [0,1] -> normalize 60
    { signal: "lane_score", raw: 0.8 }, // rango [0,1] -> normalize 80
    { signal: "denial_score", raw: 1.0 }, // rango [0,2] -> normalize 50
  ];

  const score = mergePipelineSignals(signals, WEIGHTS);
  const expected = 60 * 0.4 + 80 * 0.35 + 50 * 0.25; // 64.5

  expect(score).toBeCloseTo(expected, 10);
});

test("redistribución proporcional exacta cuando una señal es null", () => {
  const signals: PipelineSignalContribution[] = [
    { signal: "knn_similarity", raw: 0.6 },
    { signal: "lane_score", raw: 0.8 },
    { signal: "denial_score", raw: null },
  ];

  const score = mergePipelineSignals(signals, WEIGHTS);
  const totalWeight = WEIGHTS.knn_similarity + WEIGHTS.lane_score; // denial_score excluida
  const expected = (60 * WEIGHTS.knn_similarity + 80 * WEIGHTS.lane_score) / totalWeight;

  expect(score).toBeCloseTo(expected, 10);
});

test("las 3 señales null -> valor neutro 50, nunca 0", () => {
  const signals: PipelineSignalContribution[] = [
    { signal: "knn_similarity", raw: null },
    { signal: "lane_score", raw: null },
    { signal: "denial_score", raw: null },
  ];

  expect(mergePipelineSignals(signals, WEIGHTS)).toBe(50);
});

test("un raw por encima del máximo del rango se recorta (clamp) antes de normalizar", () => {
  const signals: PipelineSignalContribution[] = [{ signal: "denial_score", raw: 5 }]; // máximo real: 2
  const score = mergePipelineSignals(signals, WEIGHTS);

  expect(score).toBe(100); // única señal con dato -- su share es 1, clamp a 2 -> normalize 100
});

test("un raw por debajo del mínimo del rango se recorta (clamp) al piso", () => {
  const signals: PipelineSignalContribution[] = [{ signal: "knn_similarity", raw: -0.5 }]; // mínimo real: 0
  const score = mergePipelineSignals(signals, WEIGHTS);

  expect(score).toBe(0);
});

test("lista de señales vacía -> valor neutro 50, mismo camino que las 3 en null", () => {
  expect(mergePipelineSignals([], WEIGHTS)).toBe(50);
});
