import { expect, test } from "bun:test";
import { calibrateRolePressure, profileDistance, rolePressure } from "./role-pressure";

test("rolePressure produce un perfil normalizado de cinco posiciones", () => {
  expect(rolePressure([1], { 1: [{ position: 1, matches: 100 }] })).toEqual([1, 0, 0, 0, 0]);
});

test("calibración distingue bans irrelevantes de bans pivotales", () => {
  const metrics = calibrateRolePressure([
    { banPressureDelta: 0.05, outputPressureDelta: 0.01 },
    { banPressureDelta: 0.4, outputPressureDelta: 0.2 },
  ]);
  expect(metrics.stableIrrelevantRate).toBe(1);
  expect(metrics.dynamicPivotalRate).toBe(1);
});

test("profileDistance es cero para la misma presión", () => {
  expect(profileDistance([0.2, 0.2, 0.2, 0.2, 0.2], [0.2, 0.2, 0.2, 0.2, 0.2])).toBe(0);
});
