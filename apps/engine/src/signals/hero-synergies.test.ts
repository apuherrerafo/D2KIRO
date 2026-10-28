import { expect, test } from "bun:test";
import { loadHeroSynergies, parseHeroSynergies } from "./hero-synergies";

// Smoke estructural contra el archivo real (familia S9): forma válida, nunca una pareja puntual.
test("loadHeroSynergies() carga el archivo real con forma válida y simétrica", () => {
  const synergies = loadHeroSynergies();
  for (const [hero, list] of synergies) {
    const seen = new Set<number>();
    for (const entry of list) {
      expect(entry.with).not.toBe(hero);
      expect(entry.why.trim().length).toBeGreaterThan(0);
      expect(seen.has(entry.with)).toBe(false);
      seen.add(entry.with);
      expect(synergies.get(entry.with)?.some((back) => back.with === hero)).toBe(true);
    }
  }
});

// El resto, con fixtures sintéticos -- nunca el archivo real.

test("parseHeroSynergies devuelve cada pareja en los dos sentidos", () => {
  const map = parseHeroSynergies([{ a: 97, b: 39, why: "Reverse Polarity junta a los rivales para Sonic Wave" }]);
  expect(map.get(97)).toEqual([{ with: 39, why: "Reverse Polarity junta a los rivales para Sonic Wave" }]);
  expect(map.get(39)).toEqual([{ with: 97, why: "Reverse Polarity junta a los rivales para Sonic Wave" }]);
});

test("parseHeroSynergies descarta entradas inválidas sin lanzar", () => {
  const map = parseHeroSynergies([
    { a: 97, b: 97, why: "consigo mismo" },
    { a: 97, b: 999999, why: "héroe desconocido" },
    { a: 97, b: 39, why: "   " },
    { a: "97", b: 39, why: "id como texto" },
    null,
    { a: 97, b: 39, why: "válida" },
    { a: 39, b: 97, why: "repetida al revés: se conserva la primera" },
  ]);
  expect(map.get(97)).toEqual([{ with: 39, why: "válida" }]);
  expect(map.get(39)).toEqual([{ with: 97, why: "válida" }]);
  expect(map.size).toBe(2);
});

test("parseHeroSynergies con raíz que no es lista -> mapa vacío", () => {
  expect(parseHeroSynergies({ "97": [39] }).size).toBe(0);
  expect(parseHeroSynergies(null).size).toBe(0);
  expect(parseHeroSynergies("basura").size).toBe(0);
});
