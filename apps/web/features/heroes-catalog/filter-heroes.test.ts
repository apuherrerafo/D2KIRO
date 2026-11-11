import { describe, expect, test } from "bun:test";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import { filterHeroes } from "./HeroesPage";

const HEROES = [
  { id: 1, localizedName: "Anti-Mage" },
  { id: 2, localizedName: "Axe" },
  { id: 3, localizedName: "Crystal Maiden" },
] as unknown as HeroMeta[];

describe("filterHeroes", () => {
  test("sin búsqueda devuelve todos; con búsqueda ignora mayúsculas y espacios", () => {
    expect(filterHeroes(HEROES, "")).toHaveLength(3);
    expect(filterHeroes(HEROES, "  AX ").map((hero) => hero.id)).toEqual([2]);
    expect(filterHeroes(HEROES, "maiden").map((hero) => hero.id)).toEqual([3]);
    expect(filterHeroes(HEROES, "zzz")).toEqual([]);
  });
});
