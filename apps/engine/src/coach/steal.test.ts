import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { cardContextOf, hasCardContext } from "./card-context";
import { contextBonus, reorderByContext, stealsOf, type ContextReorderInput } from "./context-reorder";
import { deriveCandidateResult } from "./current-human-decision";
import { NEUTRAL_ALLY, neutralSynergies } from "./neutral-ground.fixtures";

// El "robo" del segundo pick (decisión del usuario 2026-11-02, estándar de un experto de Dota): un héroe LIBRE que counterea a un pick
// TUYO ya elegido sube, porque si lo eliges tú el rival no lo tiene. Fixtures inline (familia S9): ninguna prueba lee
// hero-counters.json, hero-synergies.json ni hero-positions.json reales. Los números de héroe son de mentira.
const STORM = 8; // tu pick 1
const OTHER_OWN = 9; // tu otro pick
const ANTI_MAGE = 1; // counter DURO de Storm, carry
const SILENCER = 2; // counter MEDIO de Storm, soporte (el ejemplo del usuario: "para mí es un counter duro de Storm")
const UNREASONED = 3; // counter medio de Storm, pero la base solo dice "Lo dicen: …"
const NICHE = 4; // counter duro de Storm que casi nadie juega (< 1500 partidas)
const LION = 5; // pareja de Storm, no lo counterea
const PAIR_AND_HARD = 6; // pareja de Storm Y counter duro
const PAIR_AND_MEDIUM = 7; // pareja de Storm Y counter medio
const ENEMY = 70; // un rival ya revelado

const POSITIONS: HeroPositions = {
  [STORM]: [{ position: 2, matches: 3000 }],
  [ANTI_MAGE]: [{ position: 1, matches: 3000 }, { position: 3, matches: 100 }],
  [SILENCER]: [{ position: 5, matches: 1800 }, { position: 4, matches: 1100 }],
  [UNREASONED]: [{ position: 3, matches: 3000 }],
  [NICHE]: [{ position: 1, matches: 900 }],
  [LION]: [{ position: 5, matches: 3000 }],
  [PAIR_AND_HARD]: [{ position: 1, matches: 3000 }],
  [PAIR_AND_MEDIUM]: [{ position: 1, matches: 3000 }],
};

const STORM_COUNTERS: CuratedCounter[] = [
  { vs: ANTI_MAGE, level: "hard", why: "Mana Break vacía tu recurso central y Mana Void castiga el gasto de Ball Lightning." },
  { vs: SILENCER, level: "medium", why: "Global Silence bloquea Ball Lightning desde cualquier punto" },
  { vs: UNREASONED, level: "medium", why: "Lo dicen: DotaCoach (7.41f)" },
  { vs: NICHE, level: "hard", why: "razón real, pero casi nadie lo juega" },
  { vs: PAIR_AND_HARD, level: "hard", why: "lo anula en la pelea" },
  { vs: PAIR_AND_MEDIUM, level: "medium", why: "lo incomoda en la línea" },
];
const COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[STORM, STORM_COUNTERS]]);
const PAIRS: ReadonlyMap<number, readonly CuratedSynergy[]> = new Map([
  [LION, [{ with: STORM, why: "Hex y Finger lo dejan quieto" }]],
  [PAIR_AND_HARD, [{ with: STORM, why: "combo" }]],
  [PAIR_AND_MEDIUM, [{ with: STORM, why: "combo" }]],
]);

function ctx(overrides: Partial<ContextReorderInput> = {}): ContextReorderInput {
  return { banned: new Set(), ownPicks: new Set([STORM]), revealedEnemies: new Set(), heroCounters: COUNTERS, heroSynergies: PAIRS, heroPositions: POSITIONS, targetPosition: 1, ...overrides };
}

describe("stealsOf: qué héroes libres le quitan un counter a un pick tuyo", () => {
  test("un counter duro libre es robo, con el porqué curado y sin el punto final", () => {
    expect(stealsOf(ANTI_MAGE, ctx())).toEqual([{ protectsHeroId: STORM, level: "hard", why: "Mana Break vacía tu recurso central y Mana Void castiga el gasto de Ball Lightning" }]);
  });

  test("un counter MEDIO también cuenta (Silencer, el ejemplo del usuario), en la posición que se juega de verdad", () => {
    expect(stealsOf(SILENCER, ctx({ targetPosition: 5 })).map((note) => [note.protectsHeroId, note.level])).toEqual([[STORM, "medium"]]);
  });

  test("una razón que solo dice 'Lo dicen: …' no cuenta como robo", () => {
    expect(stealsOf(UNREASONED, ctx({ targetPosition: 3 }))).toEqual([]);
  });

  test("una pareja que no counterea a tu pick NO es robo", () => {
    expect(stealsOf(LION, ctx({ targetPosition: 5 }))).toEqual([]);
  });

  test("un héroe de nicho (menos de 1500 partidas) no es robo: nadie lo sacaría", () => {
    expect(stealsOf(NICHE, ctx())).toEqual([]);
  });

  test("sin datos de posición no se puede decir que se juega: no hay robo (nunca se inventa)", () => {
    expect(stealsOf(ANTI_MAGE, ctx({ heroPositions: undefined }))).toEqual([]);
  });

  test("solo vale en una posición que ese héroe juega en al menos 1/4 de sus partidas", () => {
    expect(stealsOf(ANTI_MAGE, ctx({ targetPosition: 1 }))).toHaveLength(1);
    expect(stealsOf(ANTI_MAGE, ctx({ targetPosition: 3 }))).toEqual([]); // 100 de 3100 partidas
    expect(stealsOf(ANTI_MAGE, ctx({ targetPosition: undefined }))).toHaveLength(1); // sin posición elegida solo cuentan las partidas
  });

  test("si ya no está libre (baneado, tuyo o ya en el rival) no hay nada que robar", () => {
    expect(stealsOf(ANTI_MAGE, ctx({ banned: new Set([ANTI_MAGE]) }))).toEqual([]);
    expect(stealsOf(ANTI_MAGE, ctx({ ownPicks: new Set([STORM, ANTI_MAGE]) }))).toEqual([]);
    expect(stealsOf(ANTI_MAGE, ctx({ revealedEnemies: new Set([ANTI_MAGE]) }))).toEqual([]);
  });

  test("sin picks tuyos no hay a quién proteger", () => {
    expect(stealsOf(ANTI_MAGE, ctx({ ownPicks: new Set() }))).toEqual([]);
  });

  test("si un rival ya revelado lo counterea, el robo calla (no tapa ese riesgo)", () => {
    const withRival = new Map<number, readonly CuratedCounter[]>([...COUNTERS, [ANTI_MAGE, [{ vs: ENEMY, level: "hard", why: "lo deshace" }]]]);
    expect(stealsOf(ANTI_MAGE, ctx({ heroCounters: withRival, revealedEnemies: new Set([ENEMY]) }))).toEqual([]);
    expect(stealsOf(ANTI_MAGE, ctx({ heroCounters: withRival }))).toHaveLength(1); // sin ese rival a la vista, sigue siendo robo
  });

  test("un robo que protege a dos picks tuyos se nombra una vez con los dos, el duro primero", () => {
    const both = new Map<number, readonly CuratedCounter[]>([
      [STORM, [{ vs: ANTI_MAGE, level: "medium", why: "a Storm lo vacía" }]],
      [OTHER_OWN, [{ vs: ANTI_MAGE, level: "hard", why: "al otro lo mata" }]],
    ]);
    const notes = stealsOf(ANTI_MAGE, ctx({ heroCounters: both, ownPicks: new Set([STORM, OTHER_OWN]) }));
    expect(notes.map((note) => [note.protectsHeroId, note.level])).toEqual([[OTHER_OWN, "hard"], [STORM, "medium"]]);
  });
});

describe("el robo ordena: pareja + robo primero, luego una sola de las dos", () => {
  test("bonos: robo duro 4, robo medium 2, pareja sola 3, pareja + robo con tope 6", () => {
    expect(contextBonus(ANTI_MAGE, ctx())).toBe(4);
    expect(contextBonus(SILENCER, ctx({ targetPosition: 5 }))).toBe(2);
    expect(contextBonus(LION, ctx({ targetPosition: 5 }))).toBe(3);
    expect(contextBonus(PAIR_AND_HARD, ctx())).toBe(6); // 3 + 4 = 7, tope 6
    expect(contextBonus(PAIR_AND_MEDIUM, ctx())).toBe(5); // 3 + 2
  });

  test("a igual puntaje de V6, en la posición de cada grupo: pareja+robo duro, pareja+robo medio, robo duro; y pareja sola antes que robo medio solo", () => {
    const carries = [ANTI_MAGE, PAIR_AND_MEDIUM, PAIR_AND_HARD].map((heroId) => ({ heroId, score: 80 }));
    expect(reorderByContext(carries, ctx({ targetPosition: 1 })).map((c) => c.heroId)).toEqual([PAIR_AND_HARD, PAIR_AND_MEDIUM, ANTI_MAGE]);
    const supports = [SILENCER, LION].map((heroId) => ({ heroId, score: 80 }));
    expect(reorderByContext(supports, ctx({ targetPosition: 5 })).map((c) => c.heroId)).toEqual([LION, SILENCER]);
  });

  test("CANDADO: el robo desempata, no pisa a V6: un héroe 20 puntos abajo no pasa al que V6 puso arriba", () => {
    const far = [{ heroId: 50, score: 90 }, { heroId: ANTI_MAGE, score: 70 }];
    expect(reorderByContext(far, ctx()).map((c) => c.heroId)).toEqual([50, ANTI_MAGE]);
  });

  test("CANDADO de regresión: sin picks tuyos, o sin counters curados, el orden es EXACTAMENTE el de V6", () => {
    const v6 = [ANTI_MAGE, PAIR_AND_HARD, 50, SILENCER].map((heroId, index) => ({ heroId, score: 80 - index }));
    expect(reorderByContext(v6, ctx({ ownPicks: new Set() })).map((c) => c.heroId)).toEqual(v6.map((c) => c.heroId));
    expect(reorderByContext(v6, ctx({ heroCounters: undefined, heroSynergies: undefined })).map((c) => c.heroId)).toEqual(v6.map((c) => c.heroId));
  });
});

describe("la tarjeta cuenta el robo", () => {
  test("cardContextOf trae los robos y hasCardContext los toma como razón real del draft", () => {
    const context = cardContextOf(ANTI_MAGE, ctx());
    expect(context.steals.map((note) => note.protectsHeroId)).toEqual([STORM]);
    expect(hasCardContext(context)).toBe(true);
    expect(cardContextOf(50, ctx()).steals).toEqual([]);
  });
});

describe("contra el pipeline completo (deriveCandidateResult)", () => {
  // Ocho héroes de V6; el último (108) es el counter duro de Storm y V6 lo tenía a 1 punto del primero.
  const V6_ORDER = [101, 102, 103, 104, 105, 106, 107, 108];
  function ranking() {
    const recommendations = V6_ORDER.map((hero, index) => ({
      actions: [{ hero }],
      roleImpact: { [hero]: { status: "LIKELY", position: 1, marginals: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 }, entropy: 0 } },
      signalsByHero: { [hero]: [{ signal: "position_fit", raw: 1, weighted: 100 - Math.floor(index / 4), explanation: `Encaja ${hero}`, sampleSize: 10, applicable: true }, { signal: "patch_meta", raw: 0.6, weighted: 0, explanation: `Winrate ${hero}`, sampleSize: 5000, applicable: true }] },
      risks: [],
      confidence: "media",
    }));
    return { recommendations, degradations: [] } as never;
  }
  const view = (own: number[]) => ({ bannedHeroes: [], ownPicks: own.map((heroId) => ({ heroId, visibility: "REVEALED" })), enemyPicks: [] }) as never;
  const positions: HeroPositions = { 108: [{ position: 1, matches: 3000 }], 107: [{ position: 1, matches: 3000 }] };
  const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[STORM, [{ vs: 108, level: "hard", why: "Le quita el maná" }]]]);

  // `neutral`: P0-04 -- el winrate ya no habilita tarjetas. Para probar "el orden es EXACTAMENTE el de V6" los 8 necesitan un fundamento que no sea un robo: una
  // pareja neutral uniforme con un aliado ya elegido (sintética, no es conocimiento de Dota; no mueve el orden entre ellos).
  function derive(own: number[], heroCounters: ReadonlyMap<number, readonly CuratedCounter[]> | undefined, neutral = false) {
    return deriveCandidateResult({ targetPosition: 1, targetRanking: ranking(), view: view(neutral ? [...own, NEUTRAL_ALLY] : own), heroPositions: positions, heroCounters, ...(neutral ? { heroSynergies: neutralSynergies(V6_ORDER) } : {}), personalPoolApplied: false });
  }

  function ids(result: ReturnType<typeof derive>): number[] {
    if (result.state !== "RANKED") throw new Error(`esperaba RANKED, salió ${result.state}`);
    return result.cards.map((card) => card.heroId);
  }

  test("sensibilidad: el counter libre de tu pick 1, último de V6 a 1 punto, pasa a ser el primero y la tarjeta dice a quién protege", () => {
    const result = derive([STORM], counters);
    expect(ids(result)[0]).toBe(108);
    if (result.state !== "RANKED") throw new Error("esperaba RANKED");
    expect(result.cards[0]?.context?.steals.map((note) => [note.protectsHeroId, note.level])).toEqual([[STORM, "hard"]]);
    expect(result.cards.slice(1).every((card) => card.context?.steals.length === 0)).toBe(true);
  });

  test("CANDADO: sin tu pick 1 (ronda 1) o sin counters curados, el orden es EXACTAMENTE el de V6 y nadie trae robo", () => {
    for (const result of [derive([], counters, true), derive([STORM], undefined, true), derive([STORM], new Map(), true)]) {
      expect(ids(result)).toEqual([101, 102, 103, 104, 105]);
      if (result.state !== "RANKED") throw new Error("esperaba RANKED");
      expect(result.cards.every((card) => card.context?.steals.length === 0)).toBe(true);
    }
  });

  // Solo la señal de posición (que NUNCA cuenta como motivo): ni pareja ni intención. Aquí lo único que respalda a 108 es ser un robo.
  function bareRanking() {
    const recommendations = [107, 108].map((hero, index) => ({
      actions: [{ hero }],
      roleImpact: { [hero]: { status: "LIKELY", position: 1, marginals: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 }, entropy: 0 } },
      signalsByHero: { [hero]: [{ signal: "position_fit", raw: 1, weighted: 99 - index, explanation: `Encaja ${hero}`, sampleSize: 10, applicable: true }] },
      risks: [],
      confidence: "media",
    }));
    return { recommendations, degradations: [] } as never;
  }

  test("el robo es un MOTIVO real: con el draft ya diciendo algo, un héroe con solo el rol como razón no se recomienda, salvo que sea un robo", () => {
    const withSteal = deriveCandidateResult({ targetPosition: 1, targetRanking: bareRanking(), view: view([STORM]), heroPositions: positions, heroCounters: counters, personalPoolApplied: false });
    if (withSteal.state !== "RANKED") throw new Error(`esperaba RANKED, salió ${withSteal.state}`);
    expect(withSteal.cards.map((card) => card.heroId)).toEqual([108]); // 107 solo tiene el rol: fuera; 108 es robo: entra
    const withoutSteal = deriveCandidateResult({ targetPosition: 1, targetRanking: bareRanking(), view: view([STORM]), heroPositions: positions, heroCounters: undefined, personalPoolApplied: false });
    expect(withoutSteal.cards).toEqual([]); // sin el robo, nadie tiene motivo
  });
});
