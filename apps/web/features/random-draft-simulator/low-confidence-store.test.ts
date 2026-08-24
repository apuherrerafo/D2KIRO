import { beforeEach, describe, expect, test } from "bun:test";
import { useLowConfidenceStore } from "./low-confidence-store";

// Mismo patrón que features/draft/store.test.ts -- se prueba el store directo vía getState(),
// nunca renderHook/testing-library (no existe en este proyecto, ver testing-seams.md).

beforeEach(() => {
  useLowConfidenceStore.getState().reset();
});

describe("useLowConfidenceStore", () => {
  test("record agrega un héroe nuevo al mapa de avistamientos", () => {
    useLowConfidenceStore.getState().record({ hero: 1, heroName: "Anti-Mage", rank: 1 });

    const { sightings } = useLowConfidenceStore.getState();
    expect(sightings.size).toBe(1);
    expect(sightings.get(1)).toEqual({ hero: 1, heroName: "Anti-Mage", rank: 1 });
  });

  test("un segundo avistamiento del MISMO héroe pisa el rank anterior -- una sola fila por héroe", () => {
    useLowConfidenceStore.getState().record({ hero: 1, heroName: "Anti-Mage", rank: 3 });
    useLowConfidenceStore.getState().record({ hero: 1, heroName: "Anti-Mage", rank: 1 });

    const { sightings } = useLowConfidenceStore.getState();
    expect(sightings.size).toBe(1);
    expect(sightings.get(1)?.rank).toBe(1);
  });

  test("reset vacía el mapa por completo", () => {
    useLowConfidenceStore.getState().record({ hero: 1, heroName: "Anti-Mage", rank: 1 });
    useLowConfidenceStore.getState().reset();

    expect(useLowConfidenceStore.getState().sightings.size).toBe(0);
  });
});
