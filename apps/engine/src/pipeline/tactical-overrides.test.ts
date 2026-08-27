import { expect, test } from "bun:test";
import { applyTacticalOverrides, type TacticalOverrideConfig } from "./tactical-overrides";

const config: TacticalOverrideConfig = {
  tier1Flex: [1, 2, 3], earlyAggressors: [4], macroStrategies: [{ pillars: [5, 6], remaining: 7 }], saveSupports: [8, 9, 10],
};
const candidates = [1, 4, 7, 8, 10].map((heroId) => ({ heroId, score: 10 }));

test("anti-flex penaliza flex y eleva agresor cuando hay dos bans flex", () => {
  const result = applyTacticalOverrides(candidates, [1, 2], config);
  expect(result.find((c) => c.heroId === 1)?.score).toBe(5);
  expect(result.find((c) => c.heroId === 4)?.score).toBe(11.5);
});

test("win condition denial duplica el pilar restante", () => {
  expect(applyTacticalOverrides(candidates, [5, 6], config).find((c) => c.heroId === 7)?.score).toBe(20);
});

test("save safeguard prioriza el último soporte disponible", () => {
  expect(applyTacticalOverrides(candidates, [8, 9], config).find((c) => c.heroId === 10)?.score).toBe(20);
});
