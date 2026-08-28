import { expect, test } from "bun:test";
import { scaleBanWeight } from "./ban-relevance";

test("atenúa bans de bajo pick-rate y llega al peso completo al 5%", () => {
  expect(scaleBanWeight(1, 0)).toBe(0);
  expect(scaleBanWeight(1, 0.01)).toBeCloseTo(0.2);
  expect(scaleBanWeight(1, 0.05)).toBe(1);
  expect(scaleBanWeight(1, 0.2)).toBe(1);
});

test("rechaza valores inválidos y nunca amplifica el peso base", () => {
  expect(scaleBanWeight(-1, 0.1)).toBe(0);
  expect(scaleBanWeight(2, -0.1)).toBe(0);
  expect(scaleBanWeight(2, 0.01, 0.1)).toBeCloseTo(0.2);
});
