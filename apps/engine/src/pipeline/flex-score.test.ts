import { expect, test } from "bun:test";
import { adjustOpeningFlexScore, flexScore, revealPenalty } from "./flex-score";

test("FlexScore normaliza entropía: especialista 0, distribución uniforme 1", () => {
  expect(flexScore(1, { 1: [{ position: 1, matches: 100 }] })).toBeCloseTo(0, 9);
  expect(flexScore(2, {})).toBeCloseTo(1, 9);
});

test("RevealPenalty penaliza especialistas y no penaliza datos desconocidos", () => {
  expect(revealPenalty(1, { 1: [{ position: 1, matches: 100 }] })).toBeCloseTo(1, 9);
  expect(revealPenalty(2, {})).toBeCloseTo(0, 9);
});

test("la apertura favorece flex sobre especialista", () => {
  expect(adjustOpeningFlexScore(50, 2, {})).toBeGreaterThan(adjustOpeningFlexScore(50, 1, { 1: [{ position: 1, matches: 100 }] }));
});
