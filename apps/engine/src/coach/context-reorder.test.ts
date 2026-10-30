import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { banOpeningOf, beatsRevealed, contextPoints, reorderByContext, synergiesWithOwn, type ContextReorderInput } from "./context-reorder";

// Fixtures inline (familia S9): ninguna prueba lee hero-counters.json ni hero-synergies.json reales.
// Ejemplo del usuario: Morphling lo counterean Axe, Lion y Ancient Apparition. Si los tres están baneados, Morphling se abre.
const MORPHLING = 10;
const AXE = 20;
const LION = 21;
const ANCIENT = 22;
const PUDGE = 23;
const OTHER_A = 30;
const OTHER_B = 31;
const OTHER_C = 32;

function counters(rows: Array<[victim: number, entries: CuratedCounter[]]>): ReadonlyMap<number, readonly CuratedCounter[]> {
  return new Map(rows);
}

const MORPH_COUNTERS = counters([
  [
    MORPHLING,
    [
      { vs: AXE, level: "hard", why: "a" },
      { vs: LION, level: "hard", why: "b" },
      { vs: ANCIENT, level: "medium", why: "c" },
      { vs: PUDGE, level: "medium", why: "d" },
    ],
  ],
]);

function ctx(overrides: Partial<ContextReorderInput> = {}): ContextReorderInput {
  return { banned: new Set(), ownPicks: new Set(), revealedEnemies: new Set(), heroCounters: MORPH_COUNTERS, heroSynergies: new Map(), ...overrides };
}

describe("banOpeningOf -- qué abrieron los bans y qué riesgo queda", () => {
  test("Axe, Lion y Ancient baneados: se abrieron los tres y queda libre Pudge", () => {
    const opening = banOpeningOf(MORPHLING, ctx({ banned: new Set([AXE, LION, ANCIENT]) }));
    expect(opening.openedBy.map((note) => note.heroId)).toEqual([AXE, LION, ANCIENT]);
    expect(opening.stillFree.map((note) => note.heroId)).toEqual([PUDGE]);
  });

  test("sin bans de sus counters no se abrió nada, y todos siguen libres (se listan hasta 3, los fuertes primero)", () => {
    const opening = banOpeningOf(MORPHLING, ctx());
    expect(opening.openedBy).toEqual([]);
    expect(opening.stillFree.map((note) => note.heroId)).toEqual([AXE, LION, ANCIENT]);
  });

  test("un counter que es TU pick o que el rival YA tiene no cuenta como 'sigue libre'", () => {
    const opening = banOpeningOf(MORPHLING, ctx({ ownPicks: new Set([PUDGE]), revealedEnemies: new Set([AXE]) }));
    expect(opening.stillFree.map((note) => note.heroId)).toEqual([LION, ANCIENT]);
  });
});

describe("contextPoints -- los bans suman: todos los counters baneados, los fuertes pesan más", () => {
  test("hard vale 2 y medium 1 (suma, no combo)", () => {
    expect(contextPoints(MORPHLING, ctx({ banned: new Set([AXE]) }))).toBe(2);
    expect(contextPoints(MORPHLING, ctx({ banned: new Set([AXE, ANCIENT]) }))).toBe(3);
    expect(contextPoints(MORPHLING, ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]) }))).toBe(6);
  });

  test("un héroe al que le ganas y que el rival YA tiene vale el doble que un ban", () => {
    const beats = counters([[OTHER_A, [{ vs: MORPHLING, level: "hard", why: "x" }]]]);
    expect(beatsRevealed(MORPHLING, { revealedEnemies: new Set([OTHER_A]), heroCounters: beats }).map((note) => note.heroId)).toEqual([OTHER_A]);
    expect(contextPoints(MORPHLING, ctx({ heroCounters: beats, revealedEnemies: new Set([OTHER_A]) }))).toBe(4);
  });

  test("la sinergia cuenta solo con aliados que YA elegiste", () => {
    const synergies = new Map<number, CuratedSynergy[]>([[MORPHLING, [{ with: OTHER_B, why: "combo" }]]]);
    expect(synergiesWithOwn(MORPHLING, { ownPicks: new Set(), heroSynergies: synergies })).toEqual([]);
    expect(synergiesWithOwn(MORPHLING, { ownPicks: new Set([OTHER_B]), heroSynergies: synergies })).toEqual([{ with: OTHER_B, why: "combo" }]);
    expect(contextPoints(MORPHLING, ctx({ heroSynergies: synergies, ownPicks: new Set([OTHER_B]) }))).toBe(2);
  });
});

describe("reorderByContext", () => {
  const V6_ORDER = [OTHER_A, OTHER_B, OTHER_C, MORPHLING].map((heroId) => ({ heroId }));

  test("CANDADO: sin bans ni picks ni sinergias que toquen a nadie, el orden es EXACTAMENTE el de V6", () => {
    expect(reorderByContext(V6_ORDER, ctx()).map((c) => c.heroId)).toEqual([OTHER_A, OTHER_B, OTHER_C, MORPHLING]);
    expect(reorderByContext(V6_ORDER, ctx({ heroCounters: undefined, banned: new Set([AXE, LION, ANCIENT]) })).map((c) => c.heroId)).toEqual([OTHER_A, OTHER_B, OTHER_C, MORPHLING]);
  });

  test("Axe, Lion y Ancient baneados: Morphling (último en V6) sube porque se abrió", () => {
    const result = reorderByContext(V6_ORDER, ctx({ banned: new Set([AXE, LION, ANCIENT]) })).map((c) => c.heroId);
    expect(result[0]).toBe(MORPHLING);
  });

  test("un solo counter medium baneado mueve poco: sube un lugar, no salta a todos (el empate lo gana V6)", () => {
    const longList = [OTHER_A, OTHER_B, OTHER_C, 33, 34, 35, MORPHLING].map((heroId) => ({ heroId }));
    const result = reorderByContext(longList, ctx({ banned: new Set([PUDGE]) })).map((c) => c.heroId);
    expect(result.indexOf(MORPHLING)).toBe(5); // lugar efectivo 6 - (1 punto × 2) = 4, pero el héroe que ya iba 5.º en V6 gana el empate
  });

  test("estable y determinista: dos corridas dan lo mismo y los empates conservan el orden de V6", () => {
    const input = ctx({ banned: new Set([AXE]) });
    expect(reorderByContext(V6_ORDER, input)).toEqual(reorderByContext(V6_ORDER, input));
    const noPoints = [OTHER_C, OTHER_A, OTHER_B].map((heroId) => ({ heroId }));
    expect(reorderByContext(noPoints, input).map((c) => c.heroId)).toEqual([OTHER_C, OTHER_A, OTHER_B]);
  });
});
