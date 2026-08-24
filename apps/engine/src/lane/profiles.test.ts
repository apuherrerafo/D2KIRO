import { expect, test } from "bun:test";
import { loadHeroLineProfiles, parseHeroLineProfiles } from "./profiles";

// Smoke test contra el archivo real -- estructural, no de contenido (mismo criterio S9/S10,
// testing-seams.md): el seed es un dato incompleto a propósito (ver profiles.ts), un test atado a
// un héroe puntual se rompería en silencio al ampliar la curación.
test("loadHeroLineProfiles() carga el archivo real: dimensiones en [0,1], sin héroes duplicados", () => {
  const profiles = loadHeroLineProfiles();

  expect(profiles.size).toBeGreaterThan(0);
  for (const [heroId, profile] of profiles) {
    expect(profile.heroId).toBe(heroId);
    for (const value of [
      profile.sustain,
      profile.killPressure,
      profile.harassRange,
      profile.dispelSave,
      profile.creepControl,
    ]) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  }
});

// El resto de los casos usa parseHeroLineProfiles con fixtures sintéticos -- nunca el archivo
// real: la lógica de validación no puede depender de qué héroes existan hoy en la curación.

test("parseHeroLineProfiles descarta entradas inválidas sin lanzar y conserva las válidas", () => {
  const valid = {
    heroId: 1,
    sustain: 0.5,
    killPressure: 0.5,
    harassRange: 0.5,
    dispelSave: 0.5,
    creepControl: 0.5,
  };
  const raw = [
    valid,
    { ...valid, heroId: 2, sustain: 1.5 }, // fuera de rango (alto)
    { ...valid, heroId: 3, killPressure: -0.1 }, // fuera de rango (bajo)
    { ...valid, heroId: 4, harassRange: "0.5" }, // no numérico
    { ...valid, heroId: 5, dispelSave: undefined }, // dimensión faltante
    { ...valid, heroId: -1 }, // heroId inválido
    { ...valid, heroId: "not a number" },
    "not an object",
    null,
    42,
    {},
  ];

  const result = parseHeroLineProfiles(raw);

  expect(result.size).toBe(1);
  expect(result.get(1)).toEqual(valid);
});

test("parseHeroLineProfiles acepta los límites exactos 0 y 1 como válidos", () => {
  const atBounds = {
    heroId: 7,
    sustain: 0,
    killPressure: 1,
    harassRange: 0,
    dispelSave: 1,
    creepControl: 0,
  };

  const result = parseHeroLineProfiles([atBounds]);

  expect(result.get(7)).toEqual(atBounds);
});

test("parseHeroLineProfiles descarta héroe duplicado (conserva la primera aparición)", () => {
  const first = {
    heroId: 8,
    sustain: 0.2,
    killPressure: 0.2,
    harassRange: 0.2,
    dispelSave: 0.2,
    creepControl: 0.2,
  };
  const second = { ...first, sustain: 0.9 };

  const result = parseHeroLineProfiles([first, second]);

  expect(result.get(8)).toEqual(first);
});

test("parseHeroLineProfiles con el archivo entero corrupto devuelve un Map vacío sin lanzar", () => {
  expect(parseHeroLineProfiles(null).size).toBe(0);
  expect(parseHeroLineProfiles(undefined).size).toBe(0);
  expect(parseHeroLineProfiles("not an array").size).toBe(0);
  expect(parseHeroLineProfiles({ heroId: 1 }).size).toBe(0);
  expect(parseHeroLineProfiles(42).size).toBe(0);
});
