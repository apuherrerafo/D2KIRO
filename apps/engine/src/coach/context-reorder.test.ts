import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { banFraction, banOpeningOf, beatsRevealed, contextBonus, reorderByContext, synergiesWithOwn, type ContextReorderInput } from "./context-reorder";

// Fixtures inline (familia S9): ninguna prueba lee hero-counters.json ni hero-synergies.json reales.
// Ejemplo del usuario: a Morphling lo counterean Axe, Lion y Ancient Apparition. Si están baneados, Morphling se abre.
const MORPHLING = 10;
const EMBER = 11;
const AXE = 20;
const LION = 21;
const ANCIENT = 22;
const PUDGE = 23;
const ENEMY = 30;
const ALLY = 31;

const MORPH: CuratedCounter[] = [
  { vs: AXE, level: "hard", why: "a" },
  { vs: LION, level: "hard", why: "b" },
  { vs: ANCIENT, level: "medium", why: "c" },
  { vs: PUDGE, level: "medium", why: "d" },
];
// Un héroe con una lista LARGA de counters medium (como Ember): banear 3 no lo abre más que a uno con lista corta.
const LONG_LIST: CuratedCounter[] = Array.from({ length: 22 }, (_, index) => ({ vs: 100 + index, level: "medium" as const, why: "x" }));
const COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([
  [MORPHLING, MORPH],
  [EMBER, LONG_LIST],
]);

function ctx(overrides: Partial<ContextReorderInput> = {}): ContextReorderInput {
  return { banned: new Set(), ownPicks: new Set(), revealedEnemies: new Set(), heroCounters: COUNTERS, heroSynergies: new Map(), ...overrides };
}

describe("ronda 1 -- los bans abren héroes (fracción de su lista de counters, los fuertes pesan el doble)", () => {
  test("cuenta todos los counters, los fuertes pesan el doble, con denominador mínimo", () => {
    expect(banFraction(MORPHLING, ctx({ banned: new Set([AXE]) }))).toBe(2 / 10); // lista de peso 6 < 10
    expect(banFraction(MORPHLING, ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]) }))).toBe(6 / 10);
  });

  test("una lista larga de medium NO se abre más por tenerla larga: 3 baneados de 22 pesan poco", () => {
    const longBans = ctx({ banned: new Set([100, 101, 102]) });
    expect(banFraction(EMBER, longBans)).toBeCloseTo(3 / 22);
    expect(contextBonus(EMBER, longBans)).toBeLessThan(contextBonus(MORPHLING, ctx({ banned: new Set([AXE, LION, ANCIENT]) })));
  });

  test("Axe, Lion, Ancient y Pudge baneados: la tarjeta dice qué se abrió", () => {
    const opening = banOpeningOf(MORPHLING, ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]) }));
    expect(opening.openedBy.map((note) => note.heroId)).toEqual([AXE, LION, ANCIENT]);
    expect(opening.stillFree).toEqual([]);
  });

  test("si le queda un counter FUERTE libre no se dice 'Se abre': se avisa de ese counter", () => {
    const opening = banOpeningOf(MORPHLING, ctx({ banned: new Set([LION, ANCIENT]) }));
    expect(opening.openedBy).toEqual([]);
    expect(opening.stillFree).toEqual([{ heroId: AXE, level: "hard" }]);
  });

  test("con un counter FUERTE libre los bans no lo suben (el orden dice lo mismo que el 'Ojo' de la tarjeta)", () => {
    expect(contextBonus(MORPHLING, ctx({ banned: new Set([LION, ANCIENT, PUDGE]) }))).toBe(0); // Axe sigue libre
    expect(contextBonus(MORPHLING, ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]) }))).toBeCloseTo(3.6);
  });

  test("con pocos counters baneados (menos de un cuarto y ninguno fuerte) no se dice nada: sería ruido", () => {
    expect(banOpeningOf(EMBER, ctx({ banned: new Set([100, 101]) }))).toEqual({ openedBy: [], stillFree: [] });
  });
});

describe("rondas 2 y 3 -- los bans siguen contando y se suma lo que el rival YA tiene", () => {
  test("con un rival a la vista los bans siguen sumando y la tarjeta sigue diciendo qué se abrió", () => {
    const withEnemy = ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]), revealedEnemies: new Set([ENEMY]) });
    expect(contextBonus(MORPHLING, withEnemy)).toBeCloseTo(3.6);
    expect(banOpeningOf(MORPHLING, withEnemy).openedBy.map((note) => note.heroId)).toEqual([AXE, LION, ANCIENT]);
  });

  test("un héroe baneado por CHOQUE (Radiant y Dire eligieron el mismo) cuenta como cualquier ban", () => {
    // El núcleo suma el héroe del choque a la misma lista de baneados: para el coach es un ban más.
    const before = ctx({ banned: new Set([LION, ANCIENT, PUDGE]), revealedEnemies: new Set([ENEMY]) });
    const afterCollision = ctx({ banned: new Set([LION, ANCIENT, PUDGE, AXE]), revealedEnemies: new Set([ENEMY]) });
    expect(contextBonus(MORPHLING, before)).toBe(0); // Axe (fuerte) seguía libre
    expect(contextBonus(MORPHLING, afterCollision)).toBeCloseTo(3.6);
  });

  test("un counter que el rival YA tiene no se lista como 'sigue libre' (eso es un riesgo, otro aviso)", () => {
    const opening = banOpeningOf(MORPHLING, ctx({ banned: new Set([AXE, LION]), revealedEnemies: new Set([PUDGE]) }));
    expect(opening.stillFree.map((note) => note.heroId)).toEqual([ANCIENT]);
  });

  test("le gana a un rival que ya se ve: sube (fuerte más que medium)", () => {
    const beats = new Map<number, CuratedCounter[]>([[ENEMY, [{ vs: MORPHLING, level: "hard", why: "x" }]]]);
    expect(beatsRevealed(MORPHLING, { revealedEnemies: new Set([ENEMY]), heroCounters: beats }).map((note) => note.heroId)).toEqual([ENEMY]);
    expect(contextBonus(MORPHLING, ctx({ heroCounters: beats, revealedEnemies: new Set([ENEMY]) }))).toBe(3);
  });

  test("un rival que ya se ve y lo counterea medium lo baja", () => {
    expect(contextBonus(MORPHLING, ctx({ revealedEnemies: new Set([ANCIENT]) }))).toBe(-3);
  });

  test("la sinergia cuenta solo con aliados que YA elegiste, y una sola vez aunque haya varias parejas", () => {
    const synergies = new Map<number, CuratedSynergy[]>([[MORPHLING, [{ with: ALLY, why: "combo" }, { with: ALLY + 1, why: "otro" }]]]);
    expect(synergiesWithOwn(MORPHLING, { ownPicks: new Set(), heroSynergies: synergies })).toEqual([]);
    expect(contextBonus(MORPHLING, ctx({ heroSynergies: synergies, ownPicks: new Set([ALLY]) }))).toBe(3);
    expect(contextBonus(MORPHLING, ctx({ heroSynergies: synergies, ownPicks: new Set([ALLY, ALLY + 1]) }))).toBe(3);
  });
});

describe("reorderByContext -- desempata, no pisa a V6", () => {
  const V6 = [
    { heroId: 1, score: 80 },
    { heroId: 2, score: 76 },
    { heroId: MORPHLING, score: 74 },
  ];

  test("CANDADO: sin contexto que toque a nadie, el orden es EXACTAMENTE el de V6", () => {
    expect(reorderByContext(V6, ctx()).map((c) => c.heroId)).toEqual([1, 2, MORPHLING]);
    expect(reorderByContext(V6, ctx({ heroCounters: undefined, banned: new Set([AXE, LION]) })).map((c) => c.heroId)).toEqual([1, 2, MORPHLING]);
  });

  test("Morphling pasa a uno que V6 tenía a 2 puntos, pero no a uno que tenía a 6 o más", () => {
    const result = reorderByContext(V6, ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]) })).map((c) => c.heroId);
    expect(result).toEqual([1, MORPHLING, 2]); // bono 3.6: pasa al de 76, no al de 80
  });

  test("el bono tiene tope: ni con todo a favor pasa a un héroe que V6 tenía muy arriba", () => {
    const far = [{ heroId: 1, score: 90 }, { heroId: MORPHLING, score: 80 }];
    const everything = new Map<number, CuratedCounter[]>([[ENEMY, [{ vs: MORPHLING, level: "hard", why: "x" }]], [ENEMY + 1, [{ vs: MORPHLING, level: "hard", why: "y" }]]]);
    const input = ctx({ heroCounters: everything, revealedEnemies: new Set([ENEMY, ENEMY + 1]), heroSynergies: new Map([[MORPHLING, [{ with: ALLY, why: "c" }]]]), ownPicks: new Set([ALLY]) });
    expect(contextBonus(MORPHLING, input)).toBe(6);
    expect(reorderByContext(far, input).map((c) => c.heroId)).toEqual([1, MORPHLING]);
  });

  test("estable y determinista", () => {
    const input = ctx({ banned: new Set([AXE]) });
    expect(reorderByContext(V6, input)).toEqual(reorderByContext(V6, input));
  });
});
