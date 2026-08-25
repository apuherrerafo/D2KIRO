import { describe, expect, test } from "bun:test";
import type { DraftState } from "@/features/draft/types";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { cellState, groupHeroesByAttribute, isHeroTaken, isRosterFull } from "./HeroGrid";

function makePicks(radiant: number[], dire: number[]): DraftState["picks"] {
  return { radiant, dire };
}

function makeHero(id: number, primaryAttr: string): HeroMeta {
  return { id, name: `npc_dota_hero_${id}`, localizedName: `Hero ${id}`, imgUrl: "", primaryAttr, attackType: "Melee", roles: [] };
}

describe("groupHeroesByAttribute", () => {
  test("agrupa los 4 atributos reales sin perder ningún héroe", () => {
    const heroes = [makeHero(1, "str"), makeHero(2, "agi"), makeHero(3, "int"), makeHero(4, "all"), makeHero(5, "str")];

    const groups = groupHeroesByAttribute(heroes);

    expect(groups.str.map((h) => h.id)).toEqual([1, 5]);
    expect(groups.agi.map((h) => h.id)).toEqual([2]);
    expect(groups.int.map((h) => h.id)).toEqual([3]);
    expect(groups.all.map((h) => h.id)).toEqual([4]);
  });

  test("un catálogo vacío devuelve las 4 columnas vacías, no columnas faltantes", () => {
    const groups = groupHeroesByAttribute([]);

    expect(groups).toEqual({ str: [], agi: [], int: [], all: [] });
  });
});

describe("cellState", () => {
  test("un héroe sugerido se marca isSuggested sin estar deshabilitado", () => {
    const state = cellState(1, new Set([1]), new Set());

    expect(state).toEqual({ isSuggested: true, isUnavailable: false, isDimmed: false });
  });

  test("un héroe ya baneado/pickeado se marca isUnavailable, aunque también esté sugerido", () => {
    const state = cellState(1, new Set([1]), new Set([1]));

    expect(state).toEqual({ isSuggested: true, isUnavailable: true, isDimmed: false });
  });

  test("un héroe sin ninguna marca no es ni sugerido ni no disponible", () => {
    const state = cellState(1, new Set(), new Set());

    expect(state).toEqual({ isSuggested: false, isUnavailable: false, isDimmed: false });
  });

  test("rosterFull deshabilita incluso un héroe que no está tomado ni sugerido", () => {
    const state = cellState(99, new Set(), new Set(), true);

    expect(state).toEqual({ isSuggested: false, isUnavailable: true, isDimmed: false });
  });

  test("un héroe fuera del pool manual se atenúa sin quedar bloqueado", () => {
    const state = cellState(99, new Set(), new Set(), false, new Set([99]));

    expect(state).toEqual({ isSuggested: false, isUnavailable: false, isDimmed: true });
  });
});

describe("isHeroTaken", () => {
  test("detecta un héroe baneado", () => {
    expect(isHeroTaken(makePicks([], []), [1], 1)).toBe(true);
  });

  test("detecta un héroe pickeado por cualquiera de los dos lados", () => {
    expect(isHeroTaken(makePicks([1], []), [], 1)).toBe(true);
    expect(isHeroTaken(makePicks([], [1]), [], 1)).toBe(true);
  });

  test("un héroe libre no está tomado", () => {
    expect(isHeroTaken(makePicks([2], [3]), [4], 1)).toBe(false);
  });
});

describe("isRosterFull", () => {
  test("con menos de 5 picks, el lado no está lleno", () => {
    expect(isRosterFull(makePicks([1, 2, 3, 4], []), "radiant")).toBe(false);
  });

  test("con 5 picks, el lado está lleno -- mismo umbral que MAX_PICKS_PER_SIDE del motor", () => {
    expect(isRosterFull(makePicks([1, 2, 3, 4, 5], []), "radiant")).toBe(true);
  });

  test("el límite es por lado -- 5 picks de radiant no llenan a dire", () => {
    expect(isRosterFull(makePicks([1, 2, 3, 4, 5], []), "dire")).toBe(false);
  });

  test("sin lado identificado, nunca se reporta lleno", () => {
    expect(isRosterFull(makePicks([1, 2, 3, 4, 5], []), "unknown")).toBe(false);
  });
});
