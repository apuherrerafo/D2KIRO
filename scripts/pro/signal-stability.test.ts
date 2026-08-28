import { expect, test } from "bun:test";
import { analyzeSignalContributions, classifyPressurePair, compareSignalSnapshots } from "./signal-stability";

test("compara señales por nombre y marca cambios sobre el umbral", () => {
  const result = compareSignalSnapshots(
    [{ signal: "denial_score", raw: 0.1 }, { signal: "knn_similarity", raw: null }, { signal: "lane_score", raw: 0.4 }],
    [{ signal: "lane_score", raw: 0.48 }, { signal: "denial_score", raw: 0.11 }, { signal: "knn_similarity", raw: 0.9 }],
  );
  expect(result).toEqual([
    { signal: "denial_score", meanAbsoluteDelta: 0.01, changed: false },
    { signal: "knn_similarity", meanAbsoluteDelta: 0, changed: false },
    { signal: "lane_score", meanAbsoluteDelta: 0.08, changed: true },
  ]);
});

test("una señal ausente no se convierte en cambio artificial", () => {
  expect(compareSignalSnapshots([{ signal: "a", raw: null }], [{ signal: "a", raw: null }])).toEqual([{ signal: "a", meanAbsoluteDelta: 0, changed: false }]);
});

test("pondera la inestabilidad por señal y conserva null como ausencia", () => {
  expect(analyzeSignalContributions(
    [[{ signal: "lane", raw: 0.2 }, { signal: "denial", raw: null }]],
    [[{ signal: "lane", raw: 0.5 }, { signal: "denial", raw: 0.9 }]],
    { lane: 0.6, denial: 0.4 },
  )).toEqual([
    { signal: "lane", meanAbsoluteDelta: 0.3, weightedContribution: 0.18, changedPairs: 1 },
    { signal: "denial", meanAbsoluteDelta: 0, weightedContribution: 0, changedPairs: 0 },
  ]);
});

test("clasifica presión de bans con la frontera del benchmark", () => {
  expect(classifyPressurePair(0.149)).toBe("irrelevant");
  expect(classifyPressurePair(0.15)).toBe("pivotal");
});
