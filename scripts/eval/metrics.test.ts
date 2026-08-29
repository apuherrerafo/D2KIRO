import { describe, expect, test } from "bun:test";
import {
  badPickRateAt5,
  jaccardAtK,
  kendallTau,
  mrr,
  ndcg5,
  pairwiseAccuracy,
  recallAtK,
  type Grade,
  type GoldenLabels,
} from "./metrics";

const near = (a: number, b: number, eps = 1e-4): boolean => Math.abs(a - b) < eps;

describe("ndcg5 — relevancia graduada (S16)", () => {
  test("orden ideal -> 1.0", () => {
    const graded = new Map<number, Grade>([
      [1, 2],
      [2, 1],
    ]);
    expect(near(ndcg5([1, 2, 3, 4, 5], graded), 1)).toBe(true);
  });

  test("caso que detecta un denominador de normalización equivocado", () => {
    // ranking pone acceptable(1) antes que excellent(2): orden subóptimo pero no pésimo.
    // DCG  = 1/log2(2) + 2/log2(3)           = 1 + 1.2618595  = 2.2618595
    // IDCG = 2/log2(2) + 1/log2(3)           = 2 + 0.6309298  = 2.6309298
    // NDCG = 2.2618595 / 2.6309298           = 0.8597...
    // Un IDCG mal calculado (p.ej. == DCG, o con descuento lineal 1/pos) daría 1.0 o != 0.8597.
    const graded = new Map<number, Grade>([
      [10, 1], // acceptable
      [20, 2], // excellent
    ]);
    const v = ndcg5([10, 20], graded);
    expect(near(v, 0.859713, 1e-5)).toBe(true);
    expect(v).toBeLessThan(1);
  });

  test("un héroe no etiquetado en el top cuenta como ganancia 0, no se excluye", () => {
    const graded = new Map<number, Grade>([
      [1, 2],
      [2, 2],
    ]);
    // ranking mete un desconocido (99) en el medio -> baja el NDCG (no lo saltea)
    const withUnknown = ndcg5([1, 99, 2], graded);
    const clean = ndcg5([1, 2], graded);
    expect(withUnknown).toBeLessThan(clean);
  });

  test("sin ninguna ganancia > 0 -> 0", () => {
    const graded = new Map<number, Grade>([[1, 0]]);
    expect(ndcg5([1, 2, 3], graded)).toBe(0);
  });
});

describe("recallAtK / mrr", () => {
  test("target en la posición 3", () => {
    const ranking = [10, 20, 30, 40];
    expect(recallAtK(ranking, 30, 1)).toBe(0);
    expect(recallAtK(ranking, 30, 3)).toBe(1);
    expect(recallAtK(ranking, 30, 5)).toBe(1);
    expect(near(mrr(ranking, 30), 1 / 3)).toBe(true);
  });

  test("target ausente -> Recall 0, MRR 0", () => {
    expect(recallAtK([1, 2, 3], 99, 10)).toBe(0);
    expect(mrr([1, 2, 3], 99)).toBe(0);
  });
});

describe("badPickRateAt5", () => {
  const labels: GoldenLabels = { excellent: [1], acceptable: [2], bad: [8, 9] };

  test("top-5 con 2 bad + 1 conocido-no-bad + 2 desconocidos -> 2/3 (desconocidos fuera del denominador)", () => {
    // top-5 = [8, 9, 1, 50, 51] -> conocidos: 8,9,1 ; bad: 8,9 -> 2/3, no 2/5
    expect(near(badPickRateAt5([8, 9, 1, 50, 51], labels), 2 / 3)).toBe(true);
  });

  test("un desconocido nunca se cuenta como bad", () => {
    // top-5 = [99, 1] -> 99 desconocido se excluye; 1 es excellent -> 0 bad de 1 conocido
    expect(badPickRateAt5([99, 1, 2, 3, 4], labels)).toBe(0);
  });

  test("ningún héroe etiquetado en el top-5 -> 0", () => {
    expect(badPickRateAt5([50, 51, 52, 53, 54], labels)).toBe(0);
  });
});

describe("pairwiseAccuracy", () => {
  test("un par mal ordenado sobre 3 pares posibles -> 2/3", () => {
    // etiquetas: excellent [1], acceptable [2], bad [3]
    // pares comparables: (1>2), (1>3), (2>3) = 3
    // ranking [2, 1, 3]: 1 va después de 2 -> par (1>2) mal; (1>3) ok; (2>3) ok  -> 2/3
    const labels: GoldenLabels = { excellent: [1], acceptable: [2], bad: [3] };
    expect(near(pairwiseAccuracy([2, 1, 3], labels), 2 / 3)).toBe(true);
  });

  test("un héroe etiquetado ausente del ranking cuenta como el peor", () => {
    const labels: GoldenLabels = { excellent: [1], acceptable: [], bad: [2] };
    // ranking sólo tiene [1]; 2 (bad) está ausente -> se lo trata como peor -> par (1>2) ok -> 1
    expect(pairwiseAccuracy([1], labels)).toBe(1);
  });

  test("sin pares comparables -> 1", () => {
    const labels: GoldenLabels = { excellent: [1, 2], acceptable: [], bad: [] };
    expect(pairwiseAccuracy([2, 1], labels)).toBe(1);
  });
});

describe("jaccardAtK / kendallTau", () => {
  test("jaccard@3: 2 en común de 4 distintos -> 2/4", () => {
    expect(near(jaccardAtK([1, 2, 3], [2, 3, 9], 3), 2 / 4)).toBe(true);
  });

  test("jaccard@3 idénticos -> 1", () => {
    expect(jaccardAtK([1, 2, 3, 4], [1, 2, 3, 9], 3)).toBe(1);
  });

  test("kendall-τ: un swap sobre 3 elementos comunes -> 1/3", () => {
    // a = [1,2,3], b = [2,1,3]: pares (1,2) discordante, (1,3) concordante, (2,3) concordante
    // (2 - 1) / 3 = 1/3
    expect(near(kendallTau([1, 2, 3], [2, 1, 3]), 1 / 3)).toBe(true);
  });

  test("kendall-τ: orden inverso -> -1; menos de 2 comunes -> 1", () => {
    expect(kendallTau([1, 2, 3], [3, 2, 1])).toBe(-1);
    expect(kendallTau([1, 2, 3], [9])).toBe(1);
  });
});
