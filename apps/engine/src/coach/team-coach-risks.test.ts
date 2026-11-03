import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import { risksOf } from "./team-coach-board";

const HERO = 1;
const AXE = 2;
const LINA = 3;
const PUDGE = 4;

function counters(entries: CuratedCounter[]): ReadonlyMap<number, readonly CuratedCounter[]> {
  return new Map([[HERO, entries]]);
}

describe("risksOf -- qué rivales ya revelados counterean a un candidato", () => {
  test("un rival revelado que lo counterea aparece con su porqué, sin punto final", () => {
    const map = counters([{ vs: AXE, level: "hard", why: "Berserker's Call lo obliga a pelear. " }]);
    expect(risksOf(HERO, [AXE], map)).toEqual([{ vsHeroId: AXE, why: "Berserker's Call lo obliga a pelear" }]);
  });

  test("un rival que NO está revelado nunca aparece (no se filtra un asiento sellado)", () => {
    const map = counters([{ vs: AXE, level: "hard", why: "razon" }]);
    expect(risksOf(HERO, [LINA], map)).toEqual([]);
  });

  test("hasta 2, con los fuertes primero aunque vengan después en los datos", () => {
    const map = counters([
      { vs: LINA, level: "medium", why: "medio" },
      { vs: PUDGE, level: "medium", why: "otro medio" },
      { vs: AXE, level: "hard", why: "fuerte" },
    ]);
    expect(risksOf(HERO, [LINA, PUDGE, AXE], map).map((risk) => risk.vsHeroId)).toEqual([AXE, LINA]);
  });

  test("un aliado YA elegido que counterea a ese rival se anota (por eso baja menos); una sinergia no cuenta", () => {
    const ABADDON = 5;
    const map = new Map<number, readonly CuratedCounter[]>([
      [HERO, [{ vs: AXE, level: "hard", why: "fuerte" }]],
      [AXE, [{ vs: ABADDON, level: "medium", why: "le gana a Axe" }]],
    ]);
    expect(risksOf(HERO, [AXE], map, new Set([ABADDON]))).toEqual([{ vsHeroId: AXE, why: "fuerte", answeredBy: [ABADDON] }]);
    expect(risksOf(HERO, [AXE], map, new Set([LINA]))).toEqual([{ vsHeroId: AXE, why: "fuerte" }]);
  });

  test("sin counters curados o sin rivales revelados -> lista vacía, nunca lanza", () => {
    expect(risksOf(HERO, [AXE], undefined)).toEqual([]);
    expect(risksOf(HERO, [], counters([{ vs: AXE, level: "hard", why: "razon" }]))).toEqual([]);
    expect(risksOf(99, [AXE], counters([{ vs: AXE, level: "hard", why: "razon" }]))).toEqual([]);
  });
});
