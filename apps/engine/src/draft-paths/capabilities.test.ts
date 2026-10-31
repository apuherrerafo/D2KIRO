import { expect, test } from "bun:test";
import { CURATED_HERO_IDS } from "../signals/curated-hero-ids";
import {
  CAPABILITY_DATA_UNAVAILABLE,
  getCapabilityAvailability,
  getCapabilityCoverageSemantic,
  isHeroCapabilities,
  loadHeroCapabilities,
  UNCURATED_CAPABILITY_HERO_IDS,
  UNKNOWN_CAPABILITY_HERO_IDS,
} from "./capabilities";

test("capabilities.json carga 127 entradas válidas y sin héroes duplicados", () => {
  const capabilities = loadHeroCapabilities();
  const ids = capabilities.map((entry) => entry.hero);

  expect(capabilities.length).toBe(127);
  expect(ids.length).toBe(new Set(ids).size);
  expect(capabilities.every(isHeroCapabilities)).toBe(true);

  // Ninguno de los héroes curados es un héroe de la lista no curada
  for (const uncuratedId of UNCURATED_CAPABILITY_HERO_IDS) {
    expect(ids.includes(uncuratedId)).toBe(false);
  }
});

test("UNCURATED_CAPABILITY_HERO_IDS está vacío: Ringmaster (131), Kez (145) y Largo (155) ya tienen ficha", () => {
  expect(UNCURATED_CAPABILITY_HERO_IDS.size).toBe(0);

  // Alias retrocompatible
  expect(UNKNOWN_CAPABILITY_HERO_IDS).toBe(UNCURATED_CAPABILITY_HERO_IDS);
});

test("todo héroe del censo activo (CURATED_HERO_IDS) tiene ficha de capacidades", () => {
  const covered = new Set(loadHeroCapabilities().map((entry) => entry.hero));
  const missing = [...CURATED_HERO_IDS].filter((id) => !covered.has(id));

  expect(missing).toEqual([]);
  expect(covered.size).toBe(CURATED_HERO_IDS.size);
});

test("Ringmaster (131), Kez (145) y Largo (155) tienen una ficha válida y distinta de un héroe sin datos", () => {
  const capabilities = loadHeroCapabilities();

  for (const heroId of [131, 145, 155]) {
    const entry = capabilities.find((c) => c.hero === heroId);
    expect(entry).toBeDefined();
    expect(isHeroCapabilities(entry)).toBe(true);
    expect(getCapabilityAvailability(heroId, capabilities)).toBe("available");
    expect(getCapabilityCoverageSemantic(heroId, capabilities)).toBe("CURATED");
  }
});

test("getCapabilityAvailability reporta unavailable para un héroe sin ficha, y available para héroes cubiertos", () => {
  const capabilities = loadHeroCapabilities();

  // Un id sin ficha (inexistente) sigue reportándose como no disponible: el mecanismo no se pierde
  expect(getCapabilityAvailability(9999, capabilities)).toBe("unavailable");

  // Héroes cubiertos estándar
  expect(getCapabilityAvailability(1, capabilities)).toBe("available");
  expect(getCapabilityAvailability(2, capabilities)).toBe("available");
  expect(getCapabilityAvailability(14, capabilities)).toBe("available");
});

test("getCapabilityCoverageSemantic describe un héroe sin ficha como CAPABILITY_DATA_UNAVAILABLE y héroes curados como CURATED", () => {
  const capabilities = loadHeroCapabilities();

  expect(getCapabilityCoverageSemantic(9999, capabilities)).toBe(CAPABILITY_DATA_UNAVAILABLE);

  // Héroes cubiertos estándar
  expect(getCapabilityCoverageSemantic(1, capabilities)).toBe("CURATED");
  expect(getCapabilityCoverageSemantic(2, capabilities)).toBe("CURATED");
  expect(getCapabilityCoverageSemantic(14, capabilities)).toBe("CURATED");
});
