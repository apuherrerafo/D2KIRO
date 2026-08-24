import { describe, expect, test } from "bun:test";
import { loadPipelineWeights, parsePipelineWeights } from "./weight-loader";

// Smoke test contra el archivo real -- estructural (S9/S10, testing-seams.md): confirma que
// carga y valida, nunca un valor exacto puntual (ese es el trabajo de parsePipelineWeights con
// fixtures).
test("loadPipelineWeights() carga el archivo real: las 3 claves suman 1.0", () => {
  const weights = loadPipelineWeights();
  const sum = weights.knn_similarity + weights.lane_score + weights.denial_score;

  expect(sum).toBeCloseTo(1, 10);
});

// El resto de los casos usa parsePipelineWeights con fixtures sintéticos -- nunca el archivo
// real, mismo criterio que el resto del motor.

describe("parsePipelineWeights -- carga válida", () => {
  test("JSON válido con suma exacta 1.0 carga sin lanzar", () => {
    const raw = { knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25 };
    const weights = parsePipelineWeights(raw);

    expect(weights).toEqual(raw);
  });

  test("ignora claves adicionales fuera de las 3 requeridas", () => {
    const raw = { knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25, futuro: 99 };
    const weights = parsePipelineWeights(raw);

    expect(weights).toEqual({ knn_similarity: 0.4, lane_score: 0.35, denial_score: 0.25 });
  });
});

describe("parsePipelineWeights -- falla explícita, nunca en silencio", () => {
  test("lanza si la suma de pesos no da 1.0", () => {
    const raw = { knn_similarity: 0.5, lane_score: 0.35, denial_score: 0.25 }; // suma 1.1
    expect(() => parsePipelineWeights(raw)).toThrow();
  });

  test("lanza si falta cualquiera de las 3 claves requeridas", () => {
    expect(() => parsePipelineWeights({ lane_score: 0.5, denial_score: 0.5 })).toThrow();
    expect(() => parsePipelineWeights({ knn_similarity: 0.5, denial_score: 0.5 })).toThrow();
    expect(() => parsePipelineWeights({ knn_similarity: 0.5, lane_score: 0.5 })).toThrow();
  });

  test("lanza si una clave requerida no es numérica", () => {
    const raw = { knn_similarity: "0.4", lane_score: 0.35, denial_score: 0.25 };
    expect(() => parsePipelineWeights(raw)).toThrow();
  });

  test("lanza ante un archivo entero corrupto (no es un objeto)", () => {
    expect(() => parsePipelineWeights(null)).toThrow();
    expect(() => parsePipelineWeights(undefined)).toThrow();
    expect(() => parsePipelineWeights("not an object")).toThrow();
    expect(() => parsePipelineWeights(42)).toThrow();
    expect(() => parsePipelineWeights([])).toThrow();
  });
});
