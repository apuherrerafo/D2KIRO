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

// R0.3 / Task 15 (design §4.3 Data Models (d), requisito 3.5, CP9 / Property 9): un héroe sin
// entrada en capabilities.json NO tiene estrategia de apertura medible -> `null`, nunca un valor
// fabricado ("sin dato, nunca un valor"). Antes de Task 15 esta prueba fijaba el bug: esperaba
// `"scaling"`.
test("sin entrada en capabilities -> null (nunca un valor fabricado)", () => {
  expect(openingStrategy(999, [])).toBeNull();
});

// CP9 candado null != zero: "no hay observación" (sin entrada) NO es lo mismo que "hay una entrada
// real cuyas capacidades son todas bajas" (deriva "scaling" legítimamente). Una refactorización
// futura no puede volver a colapsar ambos casos en el mismo valor.
test("null (sin entrada) se distingue de 'scaling' (entrada real todo-bajo)", () => {
  const missing = openingStrategy(4, []);
  const realLowEntry = openingStrategy(4, [capability({ hero: 4 })]);
  expect(missing).toBeNull();
  expect(realLowEntry).toBe("scaling");
  expect(missing).not.toBe(realLowEntry);
});

// Ausencia de dato no fabrica una afirmación estratégica: `openingStrategy` no cae a `"scaling"`
// (ni a ningún arquetipo) por un `?? "scaling"` / `|| "scaling"` interno.
test("un héroe presente en la lista pero no en el estado consultado sigue dando null", () => {
  const caps = [capability({ hero: 1, structuralDamage: "high" })];
  expect(openingStrategy(2, caps)).toBeNull();
  expect(openingStrategy(1, caps)).toBe("push");
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
