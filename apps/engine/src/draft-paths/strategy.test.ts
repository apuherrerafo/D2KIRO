import { expect, test } from "bun:test";
import { openingStrategy } from "./strategy";
import type { HeroCapabilities } from "./types";

function capability(overrides: Partial<HeroCapabilities> & { hero: number }): HeroCapabilities {
  return {
    damageType: "physical",
    hasInitiation: false,
    hasCatch: false,
    hasWaveclear: false,
    structuralDamage: "low",
    teamfight: "low",
    scaling: "low",
    ...overrides,
  };
}

test("sin entrada en capabilities -> scaling", () => {
  expect(openingStrategy(999, [])).toBe("scaling");
});

test("structuralDamage alto -> push", () => {
  const caps = [capability({ hero: 1, structuralDamage: "high" })];
  expect(openingStrategy(1, caps)).toBe("push");
});

test("teamfight alto (sin push) -> teamfight", () => {
  const caps = [capability({ hero: 2, teamfight: "high" })];
  expect(openingStrategy(2, caps)).toBe("teamfight");
});

test("iniciación + catch (sin push/teamfight) -> pickoff", () => {
  const caps = [capability({ hero: 3, hasInitiation: true, hasCatch: true })];
  expect(openingStrategy(3, caps)).toBe("pickoff");
});

test("sin ninguna capacidad marcada -> scaling", () => {
  const caps = [capability({ hero: 4 })];
  expect(openingStrategy(4, caps)).toBe("scaling");
});

test("structuralDamage alto gana sobre teamfight alto (orden de precedencia)", () => {
  const caps = [capability({ hero: 5, structuralDamage: "high", teamfight: "high" })];
  expect(openingStrategy(5, caps)).toBe("push");
});
