import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { isReasonedWhy, reasonedCounters, reasonedSynergies } from "./context-reorder";
import { risksOf } from "./team-coach-board";

// Regla 4 del contrato (2026-11-04): una relación "Lo dicen: …" no es razón en NINGUNA parte que el Coach muestre: riesgos, ventana de counter,
// Safe Core, card dorada, "Ojo". Fixtures inline.

const UNREASONED = "Lo dicen: DotaCoach (7.41f), wiki Fandom (antes de 7.41)";
const WHY = "Orchid lo silencia y no puede hacer nada";

describe("isReasonedWhy", () => {
  test("un porqué de Dota sí; una atribución, vacío o solo espacios no", () => {
    expect(isReasonedWhy(WHY)).toBe(true);
    expect(isReasonedWhy(UNREASONED)).toBe(false);
    expect(isReasonedWhy("   Lo dicen: x")).toBe(false);
    expect(isReasonedWhy("")).toBe(false);
    expect(isReasonedWhy("  ")).toBe(false);
  });
});

describe("reasonedCounters / reasonedSynergies", () => {
  test("quitan solo las atribuciones, conservan el resto y no tocan el mapa original", () => {
    const original = new Map<number, CuratedCounter[]>([[1, [{ vs: 2, level: "hard", why: UNREASONED }, { vs: 3, level: "medium", why: WHY }]], [4, [{ vs: 5, level: "hard", why: UNREASONED }]]]);
    const filtered = reasonedCounters(original)!;
    expect(filtered.get(1)).toEqual([{ vs: 3, level: "medium", why: WHY }]);
    expect(filtered.has(4)).toBe(false); // todo atribución: el héroe desaparece
    expect(original.get(1)).toHaveLength(2);
    expect(reasonedCounters(original)).toBe(filtered); // cacheado por mapa
    expect(reasonedCounters(undefined)).toBeUndefined();
    const pairs = new Map<number, CuratedSynergy[]>([[1, [{ with: 2, why: UNREASONED }, { with: 3, why: WHY }]]]);
    expect(reasonedSynergies(pairs)!.get(1)).toEqual([{ with: 3, why: WHY }]);
  });
});

describe("riesgos del tablero", () => {
  test("'Riesgo (X te counterea): Lo dicen: …' ya no se muestra; con porqué de Dota sí", () => {
    const counters = new Map<number, CuratedCounter[]>([[5, [{ vs: 9, level: "hard", why: UNREASONED }, { vs: 10, level: "hard", why: WHY }]]]);
    expect(risksOf(5, [9], reasonedCounters(counters), new Set())).toEqual([]);
    expect(risksOf(5, [9, 10], reasonedCounters(counters), new Set()).map((risk) => risk.vsHeroId)).toEqual([10]);
  });
});
