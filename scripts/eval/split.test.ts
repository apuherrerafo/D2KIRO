import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { buildSplit, foldOf, loadOrCreateSplit } from "./split";

const tmpPath = (): string => join(tmpdir(), `d2k-split-${Math.random().toString(36).slice(2)}.json`);

describe("split — GroupKFold congelado por torneo", () => {
  test("determinista: mismas ligas + misma semilla -> misma asignación", () => {
    const a = buildSplit([10, 20, 30, 40, 50], { folds: 5, seed: 7 });
    const b = buildSplit([50, 40, 30, 20, 10], { folds: 5, seed: 7 });
    expect(a.assignment).toEqual(b.assignment);
  });

  test("ningún torneo cae fuera de [0, folds)", () => {
    const s = buildSplit([1, 2, 3, 100, 101, 999, 12345], { folds: 5, seed: 1 });
    for (const v of Object.values(s.assignment)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(5);
    }
  });

  test("loadOrCreateSplit: crea el archivo la primera vez, lo LEE (no regenera) después", () => {
    const path = tmpPath();
    try {
      const first = loadOrCreateSplit([10, 20, 30], { folds: 3, seed: 42, path });
      // segunda llamada con ligas DISTINTAS: el archivo existente manda, la asignación no cambia
      const second = loadOrCreateSplit([10, 20, 30, 99], { folds: 3, seed: 42, path });
      expect(second.assignment).toEqual(first.assignment);
      expect("99" in second.assignment).toBe(false); // torneo nuevo queda fuera, no altera el split
    } finally {
      rmSync(path, { force: true });
    }
  });

  test("foldOf devuelve null para un torneo no asignado", () => {
    const s = buildSplit([1, 2], { folds: 2, seed: 0 });
    expect(foldOf(s, 999)).toBeNull();
    expect(typeof foldOf(s, 1)).toBe("number");
  });
});
