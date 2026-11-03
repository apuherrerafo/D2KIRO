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
import type { HeroCapabilities } from "./types";

// Fixtures inline (familia S9): estas pruebas no dependen del contenido de capabilities.json real, que se cura por parche.
const FIXTURE: HeroCapabilities[] = [
  { hero: 1, damageType: "physical", hasInitiation: false, hasCatch: false, hasWaveclear: false, structuralDamage: "low", teamfight: "low", scaling: "high" },
  { hero: 2, damageType: "physical", hasInitiation: true, hasCatch: false, hasWaveclear: true, structuralDamage: "low", teamfight: "medium", scaling: "medium" },
  { hero: 14, damageType: "magical", hasInitiation: true, hasCatch: true, hasWaveclear: false, structuralDamage: "low", teamfight: "medium", scaling: "medium" },
];

test("capabilities.json real carga entradas válidas, sin duplicados y sin héroes de la lista no curada", () => {
  const capabilities = loadHeroCapabilities();
  const ids = capabilities.map((entry) => entry.hero);
  expect(capabilities.length).toBeGreaterThan(0);
  expect(ids.length).toBe(new Set(ids).size);
  expect(capabilities.every(isHeroCapabilities)).toBe(true);
  for (const uncuratedId of UNCURATED_CAPABILITY_HERO_IDS) {
    expect(ids.includes(uncuratedId)).toBe(false);
  }
});

test("UNCURATED_CAPABILITY_HERO_IDS identifica solo a Largo (155) como no curado (Ringmaster y Kez ya se curaron)", () => {
  expect(UNCURATED_CAPABILITY_HERO_IDS.has(155)).toBe(true);
  expect(UNCURATED_CAPABILITY_HERO_IDS.has(131)).toBe(false);
  expect(UNCURATED_CAPABILITY_HERO_IDS.has(145)).toBe(false);
  expect(UNCURATED_CAPABILITY_HERO_IDS.size).toBe(1);

  // Alias retrocompatible
  expect(UNKNOWN_CAPABILITY_HERO_IDS).toBe(UNCURATED_CAPABILITY_HERO_IDS);
});

test("getCapabilityAvailability reporta 'unavailable' para un héroe sin entrada y 'available' para los cubiertos", () => {
  expect(getCapabilityAvailability(155, FIXTURE)).toBe("unavailable");
  expect(getCapabilityAvailability(1, FIXTURE)).toBe("available");
  expect(getCapabilityAvailability(2, FIXTURE)).toBe("available");
  expect(getCapabilityAvailability(14, FIXTURE)).toBe("available");
});

test("getCapabilityCoverageSemantic describe a un héroe sin entrada como CAPABILITY_DATA_UNAVAILABLE y a los cubiertos como CURATED", () => {
  expect(getCapabilityCoverageSemantic(155, FIXTURE)).toBe(CAPABILITY_DATA_UNAVAILABLE);
  expect(getCapabilityCoverageSemantic(1, FIXTURE)).toBe("CURATED");
  expect(getCapabilityCoverageSemantic(2, FIXTURE)).toBe("CURATED");
  expect(getCapabilityCoverageSemantic(14, FIXTURE)).toBe("CURATED");
});
