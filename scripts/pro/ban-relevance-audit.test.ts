import { expect, test } from "bun:test";
import { classifyBanRelevance } from "./ban-relevance-audit";

test("requiere presión de rol o matchup con evidencia para marcar pivotal", () => {
  expect(classifyBanRelevance({ rolePressureDelta: 0.149, matchupDelta: null })).toBe("irrelevant");
  expect(classifyBanRelevance({ rolePressureDelta: 0.149, matchupDelta: 0.11 })).toBe("pivotal");
  expect(classifyBanRelevance({ rolePressureDelta: 0.15 })).toBe("pivotal");
});

test("datos inválidos no elevan artificialmente la relevancia", () => {
  expect(classifyBanRelevance({ rolePressureDelta: Number.NaN, matchupDelta: 1 })).toBe("irrelevant");
  expect(classifyBanRelevance({ rolePressureDelta: -1, matchupDelta: 1 })).toBe("irrelevant");
});
