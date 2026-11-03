import { describe, expect, test } from "bun:test";
import { orderHeroesByPicks, resolveAggregationPatch, totalPicksInPatch } from "./patch-scope";

// Fixture inline: 3 héroes. Los restos "" (sync vieja) invierten el orden respecto al parche real.
const STATS = {
  1: [{ patch: "", picks: 9000 }, { patch: "7.41e", picks: 100 }],
  2: [{ patch: "", picks: 10 }, { patch: "7.41e", picks: 500 }],
  3: [{ patch: "", picks: 10 }, { patch: "7.41e", picks: 300 }],
};
const IDS = [1, 2, 3];

// Comportamiento ANTERIOR de `heroUniverse` (app.ts): suma todas las filas sin mirar el parche.
function legacyOrder(): number[] {
  const total = (id: number): number => (STATS[id as 1 | 2 | 3] ?? []).reduce((s, r) => s + r.picks, 0);
  return [...IDS].sort((a, b) => total(b) - total(a) || a - b);
}

describe("orderHeroesByPicks", () => {
  test("anterior: los restos del parche vacío mandan el héroe 1 al primer lugar", () => {
    expect(legacyOrder()).toEqual([1, 2, 3]);
  });
  test("corregido: sólo cuenta el parche vigente (7.41e) y el orden refleja el meta actual", () => {
    expect(orderHeroesByPicks(IDS, STATS, "7.41e")).toEqual([2, 3, 1]);
  });
  test("sin parche preferido ignora el vacío y usa el no vacío dominante", () => {
    expect(orderHeroesByPicks(IDS, STATS)).toEqual([2, 3, 1]);
  });
  test("empate de picks: id ascendente", () => {
    expect(orderHeroesByPicks([5, 4], { 4: [{ patch: "x", picks: 7 }], 5: [{ patch: "x", picks: 7 }] }, "x")).toEqual([4, 5]);
  });
  test("héroe sin filas del parche vigente cuenta 0 (no se completa con otro parche)", () => {
    expect(orderHeroesByPicks([1, 9], { 1: [{ patch: "7.41e", picks: 1 }] }, "7.41e")).toEqual([1, 9]);
  });
});

describe("resolveAggregationPatch", () => {
  test("el preferido gana si existe en los datos", () => {
    expect(resolveAggregationPatch({ 1: [{ patch: "a", picks: 1 }, { patch: "b", picks: 1 }, { patch: "b", picks: 1 }] }, "a")).toBe("a");
  });
  test("preferido ausente en los datos -> cae al dominante no vacío", () => {
    expect(resolveAggregationPatch({ 1: [{ patch: "a", picks: 1 }, { patch: "b", picks: 1 }, { patch: "b", picks: 1 }] }, "zzz")).toBe("b");
  });
  test("sólo parche vacío -> null (sin dato, nunca inventado)", () => {
    expect(resolveAggregationPatch({ 1: [{ patch: "", picks: 5 }] })).toBeNull();
    expect(resolveAggregationPatch({})).toBeNull();
  });
  test("totalPicksInPatch con parche null o filas ausentes -> 0", () => {
    expect(totalPicksInPatch(undefined, "x")).toBe(0);
    expect(totalPicksInPatch([{ patch: "x", picks: 3 }], null)).toBe(0);
  });
});
