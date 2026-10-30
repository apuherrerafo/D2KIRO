import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { banFraction, banOpeningOf, beatsRevealed, contextBonus, crossesInLane, reorderByContext, revealedCounterPenalty, synergiesWithOwn, type ContextReorderInput } from "./context-reorder";

// Fixtures inline (familia S9): ninguna prueba lee hero-counters.json, hero-synergies.json ni hero-positions.json reales.
// Los ejemplos son los del usuario: Anti-Mage carry contra Axe; Oracle lo rescata; Legion ya ocupa la offlane.
const ANTI_MAGE = 1;
const AXE = 2;
const LION = 3;
const ANCIENT = 4;
const PUDGE = 5;
const LEGION = 6;
const ORACLE = 7;
const STORM = 8;
const EMBER = 9;

const POSITIONS: HeroPositions = {
  [AXE]: [{ position: 3, matches: 900 }, { position: 4, matches: 100 }],
  [LEGION]: [{ position: 3, matches: 800 }],
  [LION]: [{ position: 5, matches: 700 }],
  [ANCIENT]: [{ position: 5, matches: 700 }],
  [PUDGE]: [{ position: 4, matches: 700 }],
  [STORM]: [{ position: 2, matches: 900 }],
};

const AM_COUNTERS: CuratedCounter[] = [
  { vs: AXE, level: "hard", why: "Berserker's Call" },
  { vs: LION, level: "medium", why: "a" },
  { vs: ANCIENT, level: "medium", why: "b" },
  { vs: PUDGE, level: "medium", why: "c" },
];
// Una lista LARGA de counters medium (como Ember): banear 3 de 22 no la abre más que a una lista corta bien baneada.
const LONG_LIST: CuratedCounter[] = Array.from({ length: 22 }, (_, index) => ({ vs: 100 + index, level: "medium" as const, why: "x" }));
const COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([
  [ANTI_MAGE, AM_COUNTERS],
  [EMBER, LONG_LIST],
]);
const ORACLE_PAIR: ReadonlyMap<number, readonly CuratedSynergy[]> = new Map([[ANTI_MAGE, [{ with: ORACLE, why: "False Promise lo salva" }]]]);

function ctx(overrides: Partial<ContextReorderInput> = {}): ContextReorderInput {
  return { banned: new Set(), ownPicks: new Set(), revealedEnemies: new Set(), heroCounters: COUNTERS, heroSynergies: new Map(), heroPositions: POSITIONS, targetPosition: 1, ...overrides };
}

describe("bans (todas las rondas): abren héroes por la fracción de su lista de counters baneada", () => {
  test("fuertes pesan el doble, con denominador mínimo", () => {
    expect(banFraction(ANTI_MAGE, ctx({ banned: new Set([AXE]) }))).toBe(2 / 10);
    expect(banFraction(ANTI_MAGE, ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]) }))).toBe(5 / 10);
  });

  test("una lista larga de medium no se abre más por ser larga", () => {
    expect(banFraction(EMBER, ctx({ banned: new Set([100, 101, 102]) }))).toBeCloseTo(3 / 22);
  });

  test("con Axe baneado: 'Se abre: Axe…' y avisa los medium que siguen libres", () => {
    const opening = banOpeningOf(ANTI_MAGE, ctx({ banned: new Set([AXE]) }));
    expect(opening.openedBy.map((note) => note.heroId)).toEqual([AXE]);
    expect(opening.stillFree.map((note) => note.heroId)).toEqual([LION, ANCIENT, PUDGE]);
  });

  test("con Axe (fuerte) libre no se dice 'Se abre' y los bans no lo suben: se avisa de Axe", () => {
    const input = ctx({ banned: new Set([LION, ANCIENT, PUDGE]) });
    expect(banOpeningOf(ANTI_MAGE, input)).toEqual({ openedBy: [], stillFree: [{ heroId: AXE, level: "hard" }] });
    expect(contextBonus(ANTI_MAGE, input)).toBe(0);
  });

  test("un ban por CHOQUE (Radiant y Dire eligieron el mismo) cuenta como cualquier ban", () => {
    expect(contextBonus(ANTI_MAGE, ctx({ banned: new Set([LION, ANCIENT, PUDGE]) }))).toBe(0);
    expect(contextBonus(ANTI_MAGE, ctx({ banned: new Set([LION, ANCIENT, PUDGE, AXE]) }))).toBeCloseTo(3);
  });
});

describe("Axe todavía no sale pero el rival ya tiene Legion de offlane: pesa menos, y se avisa", () => {
  test("el aviso dice que Axe es menos probable (ya tienen offlane)", () => {
    const opening = banOpeningOf(ANTI_MAGE, ctx({ banned: new Set([LION, ANCIENT, PUDGE]), revealedEnemies: new Set([LEGION]) }));
    expect(opening.stillFree).toEqual([{ heroId: AXE, level: "hard", takenPosition: 3 }]);
  });

  test("y como pesa menos, ya no bloquea que los bans lo abran", () => {
    expect(contextBonus(ANTI_MAGE, ctx({ banned: new Set([LION, ANCIENT, PUDGE]), revealedEnemies: new Set([LEGION]) }))).toBeCloseTo(1.8);
  });
});

describe("el rival YA sacó un counter: baja, pero no al fondo de oficio", () => {
  test("se cruzan en línea según la tabla del usuario (carry con offlane y pos4)", () => {
    expect(crossesInLane(AXE, { targetPosition: 1, heroPositions: POSITIONS })).toBe(true);
    expect(crossesInLane(AXE, { targetPosition: 2, heroPositions: POSITIONS })).toBe(false);
    expect(crossesInLane(STORM, { targetPosition: 2, heroPositions: POSITIONS })).toBe(true);
  });

  test("Axe fuerte en tu línea baja mucho; fuera de tu línea baja la mitad; un medium baja poco", () => {
    expect(revealedCounterPenalty(ANTI_MAGE, ctx({ revealedEnemies: new Set([AXE]) }))).toBe(12);
    expect(revealedCounterPenalty(ANTI_MAGE, ctx({ revealedEnemies: new Set([AXE]), targetPosition: 2 }))).toBe(6);
    expect(revealedCounterPenalty(ANTI_MAGE, ctx({ revealedEnemies: new Set([PUDGE]) }))).toBe(4); // Pudge pos4 cruza al carry
  });

  test("con Oracle en tu equipo (sinergia), Anti-Mage vuelve cerca de su lugar aunque esté Axe", () => {
    const withOracle = ctx({ revealedEnemies: new Set([AXE]), ownPicks: new Set([ORACLE]), heroSynergies: ORACLE_PAIR });
    expect(revealedCounterPenalty(ANTI_MAGE, withOracle)).toBe(3);
    expect(contextBonus(ANTI_MAGE, withOracle)).toBe(0); // +3 por la sinergia, −3 por el Axe rescatado
  });

  test("le gana a un rival que ya salió: sube", () => {
    const beats = new Map<number, CuratedCounter[]>([[STORM, [{ vs: ANTI_MAGE, level: "hard", why: "Mana Break" }]]]);
    expect(beatsRevealed(ANTI_MAGE, { revealedEnemies: new Set([STORM]), heroCounters: beats }).map((note) => note.heroId)).toEqual([STORM]);
    expect(contextBonus(ANTI_MAGE, ctx({ heroCounters: beats, revealedEnemies: new Set([STORM]) }))).toBe(3);
  });

  test("la sinergia cuenta solo con aliados YA elegidos y una sola vez", () => {
    expect(synergiesWithOwn(ANTI_MAGE, { ownPicks: new Set(), heroSynergies: ORACLE_PAIR })).toEqual([]);
    expect(contextBonus(ANTI_MAGE, ctx({ ownPicks: new Set([ORACLE]), heroSynergies: ORACLE_PAIR }))).toBe(3);
  });
});

describe("reorderByContext", () => {
  const V6 = [
    { heroId: ANTI_MAGE, score: 80 },
    { heroId: 50, score: 76 },
    { heroId: 51, score: 70 },
    { heroId: 52, score: 60 },
  ];

  test("CANDADO: sin contexto que toque a nadie, el orden es EXACTAMENTE el de V6", () => {
    expect(reorderByContext(V6, ctx()).map((c) => c.heroId)).toEqual([ANTI_MAGE, 50, 51, 52]);
    expect(reorderByContext(V6, ctx({ heroCounters: undefined, revealedEnemies: new Set([AXE]) })).map((c) => c.heroId)).toEqual([ANTI_MAGE, 50, 51, 52]);
  });

  test("Axe en su línea: Anti-Mage baja varios lugares pero NO al fondo", () => {
    expect(reorderByContext(V6, ctx({ revealedEnemies: new Set([AXE]) })).map((c) => c.heroId)).toEqual([50, 51, ANTI_MAGE, 52]); // 80 − 12 = 68
  });

  test("Axe en su línea pero con Oracle en tu equipo: Anti-Mage se queda arriba", () => {
    const withOracle = ctx({ revealedEnemies: new Set([AXE]), ownPicks: new Set([ORACLE]), heroSynergies: ORACLE_PAIR });
    expect(reorderByContext(V6, withOracle)[0]?.heroId).toBe(ANTI_MAGE);
  });

  test("el bono positivo tiene tope: los bans no pasan a un héroe que V6 tenía muy arriba", () => {
    const far = [{ heroId: 50, score: 90 }, { heroId: ANTI_MAGE, score: 80 }];
    expect(reorderByContext(far, ctx({ banned: new Set([AXE, LION, ANCIENT, PUDGE]) })).map((c) => c.heroId)).toEqual([50, ANTI_MAGE]);
  });

  test("estable y determinista", () => {
    const input = ctx({ banned: new Set([AXE]) });
    expect(reorderByContext(V6, input)).toEqual(reorderByContext(V6, input));
  });
});
