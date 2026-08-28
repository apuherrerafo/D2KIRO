import { expect, test } from "bun:test";
import { shrinkEstimate } from "./shrinkage";

test("rechaza muestras débiles y no fabrica un voto neutro", () => {
  expect(shrinkEstimate(1, 9)).toBeNull();
  expect(shrinkEstimate(0.8, 10)).not.toBeNull();
});

test("acerca estimaciones pequeñas al prior y converge con más datos", () => {
  const small = shrinkEstimate(1, 10)!;
  const large = shrinkEstimate(1, 300)!;
  expect(small).toBeCloseTo(0.625, 6);
  expect(large).toBeGreaterThan(small);
  expect(large).toBeLessThanOrEqual(1);
});
