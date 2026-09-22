import { expect, test } from "bun:test";
import {
  CAPABILITY_DATA_UNAVAILABLE,
  getCapabilityAvailability,
  getCapabilityCoverageSemantic,
  isHeroCapabilities,
  loadHeroCapabilities,
  UNCURATED_CAPABILITY_HERO_IDS,
  UNKNOWN_CAPABILITY_HERO_IDS,
} from "./capabilities";

test("capabilities.json carga 124 entradas válidas y sin héroes duplicados", () => {
  const capabilities = loadHeroCapabilities();
  const ids = capabilities.map((entry) => entry.hero);

  expect(capabilities.length).toBe(124);
  expect(ids.length).toBe(new Set(ids).size);
  expect(capabilities.every(isHeroCapabilities)).toBe(true);

  // Ninguno de los 124 héroes curados es un héroe de la lista no curada
  for (const uncuratedId of UNCURATED_CAPABILITY_HERO_IDS) {
    expect(ids.includes(uncuratedId)).toBe(false);
  }
});

test("UNCURATED_CAPABILITY_HERO_IDS identifica Ringmaster (131), Kez (145) y Largo (155) como no curados", () => {
  expect(UNCURATED_CAPABILITY_HERO_IDS.has(131)).toBe(true);
  expect(UNCURATED_CAPABILITY_HERO_IDS.has(145)).toBe(true);
  expect(UNCURATED_CAPABILITY_HERO_IDS.has(155)).toBe(true);
  expect(UNCURATED_CAPABILITY_HERO_IDS.size).toBe(3);

  // Alias retrocompatible
  expect(UNKNOWN_CAPABILITY_HERO_IDS).toBe(UNCURATED_CAPABILITY_HERO_IDS);
});

test("getCapabilityAvailability reporta 'unavailable' para 131, 145 y 155, y 'available' para héroes cubiertos", () => {
  const capabilities = loadHeroCapabilities();

  expect(getCapabilityAvailability(131, capabilities)).toBe("unavailable");
  expect(getCapabilityAvailability(145, capabilities)).toBe("unavailable");
  expect(getCapabilityAvailability(155, capabilities)).toBe("unavailable");

  // Héroes cubiertos estándar
  expect(getCapabilityAvailability(1, capabilities)).toBe("available");
  expect(getCapabilityAvailability(2, capabilities)).toBe("available");
  expect(getCapabilityAvailability(14, capabilities)).toBe("available");
});

test("getCapabilityCoverageSemantic describe 131, 145 y 155 como CAPABILITY_DATA_UNAVAILABLE y héroes curados como CURATED", () => {
  const capabilities = loadHeroCapabilities();

  expect(getCapabilityCoverageSemantic(131, capabilities)).toBe(CAPABILITY_DATA_UNAVAILABLE);
  expect(getCapabilityCoverageSemantic(145, capabilities)).toBe(CAPABILITY_DATA_UNAVAILABLE);
  expect(getCapabilityCoverageSemantic(155, capabilities)).toBe(CAPABILITY_DATA_UNAVAILABLE);

  // Héroes cubiertos estándar
  expect(getCapabilityCoverageSemantic(1, capabilities)).toBe("CURATED");
  expect(getCapabilityCoverageSemantic(2, capabilities)).toBe("CURATED");
  expect(getCapabilityCoverageSemantic(14, capabilities)).toBe("CURATED");
});
