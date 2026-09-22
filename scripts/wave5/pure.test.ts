import { describe, expect, test } from "bun:test";
import { hasDistinctPositionAssignment, percentile, seededIndex } from "./pure";

describe("wave5 pure helpers", () => {
  test("percentile is nearest-rank on a sorted sample (hand-computed)", () => {
    const sample = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    expect(percentile(sample, 50)).toBe(5); // ceil(0.5 * 10) = 5th value
    expect(percentile(sample, 95)).toBe(10); // ceil(9.5) = 10th value
    expect(percentile(sample, 99)).toBe(10);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile(sample, 0)).toBe(1); // rank clamps to the first value
    expect(Number.isNaN(percentile([], 95))).toBe(true);
  });

  test("percentile distinguishes p95 from the maximum on a sample with an outlier (the outlier is not hidden, and not the p95)", () => {
    const sample = Array.from({ length: 100 }, (_, i) => i + 1);
    sample[99] = 5000; // one outlier
    expect(percentile(sample, 95)).toBe(95);
    expect(percentile(sample, 99)).toBe(99);
    expect(sample.at(-1)).toBe(5000);
  });

  test("seededIndex is deterministic, stays in range, and depends on the key", () => {
    expect(seededIndex("a:b:c", 7)).toBe(seededIndex("a:b:c", 7));
    for (const key of ["x", "AUDIT001", "follow-coach:AUDIT083:dire:3"]) expect(seededIndex(key, 5)).toBeLessThan(5);
    expect(seededIndex("k", 0)).toBe(0); // modulo is clamped: never NaN, never a crash
    expect(new Set(Array.from({ length: 40 }, (_, i) => seededIndex(`key-${i}`, 10))).size).toBeGreaterThan(3);
  });

  test("hasDistinctPositionAssignment: two Pos1-only carries are infeasible; a flex hero can resolve the clash", () => {
    const positions = {
      1: [{ position: 1, matches: 100 }],
      2: [{ position: 1, matches: 100 }],
      3: [{ position: 1, matches: 50 }, { position: 2, matches: 50 }],
    };
    expect(hasDistinctPositionAssignment([1], positions)).toBe(true);
    expect(hasDistinctPositionAssignment([1, 2], positions)).toBe(false); // Luna + Sven style clash
    expect(hasDistinctPositionAssignment([1, 3], positions)).toBe(true); // the flex hero takes Pos2
    expect(hasDistinctPositionAssignment([1, 2, 3], positions)).toBe(false);
    expect(hasDistinctPositionAssignment([1, 99], positions)).toBe(false); // a hero with no curated position cannot be placed
    expect(hasDistinctPositionAssignment([], positions)).toBe(true);
  });
});
