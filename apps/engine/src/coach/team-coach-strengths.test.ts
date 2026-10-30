import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import { strengthIndexOf, strengthsOf } from "./team-coach-board";

// Un counter curado se guarda por VÍCTIMA: "victim -> quién la counterea". Las fortalezas son lo inverso:
// "counterer -> a quién le gana". Solo se ofrecen contra héroes que el rival YA tiene a la vista: contar contra quién
// gana sobre algo que nadie ha sacado es suponer. Fixtures inline: ninguna prueba lee hero-counters.json real.
const HERO = 1;
const AXE = 2;
const LINA = 3;
const PUDGE = 4;
const DOOM = 5;

function curated(rows: Array<[victim: number, entry: CuratedCounter]>): ReadonlyMap<number, readonly CuratedCounter[]> {
  const map = new Map<number, CuratedCounter[]>();
  for (const [victim, entry] of rows) map.set(victim, [...(map.get(victim) ?? []), entry]);
  return map;
}

describe("strengthsOf -- a quién le gana un candidato, solo entre lo que el rival ya tiene", () => {
  test("invierte los counters curados y deja el porqué sin punto final", () => {
    const index = strengthIndexOf(curated([[AXE, { vs: HERO, level: "hard", why: "Orchid lo silencia. " }]]));
    expect(strengthsOf(HERO, index, new Set(), new Set([AXE]))).toEqual([{ vsHeroId: AXE, level: "hard", why: "Orchid lo silencia", revealed: true }]);
  });

  test("un héroe que el rival NO tiene a la vista nunca se ofrece (no se supone lo que va a sacar)", () => {
    const index = strengthIndexOf(curated([[AXE, { vs: HERO, level: "hard", why: "razon" }]]));
    expect(strengthsOf(HERO, index, new Set(), new Set())).toEqual([]);
    expect(strengthsOf(HERO, index, new Set(), new Set([LINA]))).toEqual([]);
  });

  test("hasta 3, los fuertes primero aunque vengan después en los datos", () => {
    const index = strengthIndexOf(
      curated([
        [LINA, { vs: HERO, level: "medium", why: "a" }],
        [PUDGE, { vs: HERO, level: "medium", why: "b" }],
        [AXE, { vs: HERO, level: "hard", why: "c" }],
        [DOOM, { vs: HERO, level: "medium", why: "d" }],
      ]),
    );
    expect(strengthsOf(HERO, index, new Set(), new Set([LINA, PUDGE, AXE, DOOM])).map((entry) => entry.vsHeroId)).toEqual([AXE, LINA, PUDGE]);
  });

  test("un héroe baneado o ya elegido por tu equipo no se ofrece como razón", () => {
    const index = strengthIndexOf(
      curated([
        [AXE, { vs: HERO, level: "hard", why: "razon" }],
        [LINA, { vs: HERO, level: "hard", why: "razon" }],
      ]),
    );
    expect(strengthsOf(HERO, index, new Set([AXE]), new Set([AXE, LINA])).map((entry) => entry.vsHeroId)).toEqual([LINA]);
  });

  test("sin counters curados o sin entradas del héroe -> lista vacía, nunca lanza", () => {
    expect(strengthsOf(HERO, strengthIndexOf(undefined), new Set(), new Set([AXE]))).toEqual([]);
    expect(strengthsOf(99, strengthIndexOf(curated([[AXE, { vs: HERO, level: "hard", why: "razon" }]])), new Set(), new Set([AXE]))).toEqual([]);
  });
});
