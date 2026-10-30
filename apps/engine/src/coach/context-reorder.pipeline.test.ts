import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { deriveCandidateResult } from "./current-human-decision";

// Candados del reordenamiento por contexto contra el pipeline completo de candidatos (deriveCandidateResult), no la
// función suelta: el orden que ven el Team Coach y el Copilot sale de aquí. Fixtures inline: ningún dato curado real.
const V6_ORDER = [101, 102, 103, 104, 105, 106, 107, 108];
const AXE = 20;
const LION = 21;
const ANCIENT = 22;
const ALLY = 900;

function ranking() {
  const recommendations = V6_ORDER.map((hero, index) => ({
    actions: [{ hero }],
    roleImpact: { [hero]: { status: "LIKELY", position: 1, marginals: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 }, entropy: 0 } },
    signalsByHero: { [hero]: [{ signal: "position_fit", raw: 1, weighted: 100 - index * 0.5, explanation: `Encaja ${hero}`, sampleSize: 10, applicable: true }] },
    risks: [],
    confidence: "media",
  }));
  return { recommendations, degradations: [] } as never;
}

function view(options: { banned?: number[]; own?: number[]; enemy?: number[] } = {}) {
  return {
    bannedHeroes: options.banned ?? [],
    ownPicks: (options.own ?? []).map((heroId) => ({ heroId, visibility: "REVEALED" })),
    enemyPicks: (options.enemy ?? []).map((heroId) => ({ heroId, visibility: "REVEALED" })),
  } as never;
}

// El último de V6 (108) lo counterean Axe y Lion (fuertes) y Ancient (medium).
const COUNTERS: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([
  [108, [{ vs: AXE, level: "hard", why: "a" }, { vs: LION, level: "hard", why: "b" }, { vs: ANCIENT, level: "medium", why: "c" }]],
  [101, [{ vs: AXE, level: "hard", why: "a" }, { vs: LION, level: "hard", why: "b" }, { vs: ANCIENT, level: "medium", why: "c" }]],
]);

function derive(input: { banned?: number[]; own?: number[]; enemy?: number[]; heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>; heroSynergies?: ReadonlyMap<number, readonly CuratedSynergy[]>; activePool?: number[]; poolShortlistSize?: number; shortlistSize?: number }) {
  const result = deriveCandidateResult({
    targetPosition: 1,
    targetRanking: ranking(),
    view: view(input),
    heroPositions: {},
    heroCounters: input.heroCounters,
    heroSynergies: input.heroSynergies,
    personalPoolApplied: false,
    activePool: input.activePool,
    poolShortlistSize: input.poolShortlistSize,
    shortlistSize: input.shortlistSize,
  });
  if (result.state !== "RANKED") throw new Error(`esperaba RANKED, salió ${result.state}`);
  return result;
}

describe("reordenamiento por contexto sobre deriveCandidateResult", () => {
  test("CANDADO: sin counters, sinergias ni bans que toquen a nadie, cartas, ranks y scores son EXACTAMENTE los de V6", () => {
    for (const result of [derive({}), derive({ heroCounters: COUNTERS }), derive({ banned: [999], heroCounters: COUNTERS })]) {
      expect(result.cards.map((card) => card.heroId)).toEqual([101, 102, 103, 104, 105]);
      expect(result.cards.map((card) => card.rank)).toEqual([1, 2, 3, 4, 5]);
      expect(result.cards.map((card) => card.score)).toEqual([100, 99.5, 99, 98.5, 98]);
    }
  });

  test("sensibilidad (ronda 1): Axe, Lion y Ancient baneados -> 108 (último de V6, a 3,5 puntos) entra al top-5", () => {
    const result = derive({ banned: [AXE, LION, ANCIENT], heroCounters: COUNTERS });
    expect(result.cards.map((card) => card.heroId)).toContain(108);
  });

  test("rondas 2 y 3: con un rival a la vista los mismos bans siguen abriendo a 108", () => {
    const result = derive({ banned: [AXE, LION, ANCIENT], enemy: [555], heroCounters: COUNTERS });
    expect(result.cards.map((card) => card.heroId)).toContain(108);
  });

  test("un counter fuerte YA revelado baja al héroe y lo saca del 1.º lugar", () => {
    // 101 es el primero de V6 (100) y Axe (counter fuerte) ya está en el rival: 100 − 12 = 88.
    const alone = derive({ enemy: [AXE], heroCounters: COUNTERS, shortlistSize: 8 }).cards.map((card) => card.heroId);
    expect(alone.slice(-2)).toEqual([101, 108]); // 108 también lo counterea Axe en este fixture
  });

  test("S05 del juez de Dota en V4 (decisión del usuario 2026-10-30): el héroe que el rival counterea fuerte baja 12, sin ir al fondo de oficio", () => {
    // Meepo-like 30 (90) contra Axe-like 40 revelado; alternativas 31 (50) y 32 (40). RB-4 ya no aplica en Team Coach/Copilot:
    // Meepo baja 12 (90 → 78) y sigue primero porque V6 le saca más de 12 a las alternativas. RB-4 sigue en V3.
    const ranking = { recommendations: [[30, 90], [31, 50], [32, 40]].map(([hero, score]) => ({ actions: [{ hero }], roleImpact: { [hero!]: { status: "LIKELY", position: 2, marginals: { 1: 0, 2: 1, 3: 0, 4: 0, 5: 0 }, entropy: 0 } }, signalsByHero: { [hero!]: [{ signal: "position_fit", raw: 1, weighted: score, explanation: "x", sampleSize: 1, applicable: true }] }, risks: [], confidence: "media" })), degradations: [] } as never;
    const result = deriveCandidateResult({ targetPosition: 2, targetRanking: ranking, view: view({ enemy: [40] }), heroPositions: {}, heroCounters: new Map([[30, [{ vs: 40, level: "hard", why: "x" }]]]), personalPoolApplied: false });
    if (result.state !== "RANKED") throw new Error(result.state);
    expect(result.cards.map((card) => card.heroId)).toEqual([30, 31, 32]);
  });

  test("CANDADO: la lista del pool es la general filtrada a tus héroes, en el MISMO orden", () => {
    const result = derive({ enemy: [AXE], banned: [LION], heroCounters: COUNTERS, activePool: [101, 103, 105, 107], poolShortlistSize: 3, shortlistSize: 8 });
    const generalInPool = result.cards.map((card) => card.heroId).filter((hero) => [101, 103, 105, 107].includes(hero));
    expect(result.poolCards.map((card) => card.heroId)).toEqual(generalInPool.slice(0, 3));
  });

  test("una pareja curada con un aliado YA elegido sube al héroe; sin ese aliado no se mueve", () => {
    const synergies: ReadonlyMap<number, readonly CuratedSynergy[]> = new Map([[107, [{ with: ALLY, why: "combo" }]]]);
    expect(derive({ heroSynergies: synergies }).cards.map((card) => card.heroId)).not.toContain(107);
    expect(derive({ heroSynergies: synergies, own: [ALLY] }).cards.map((card) => card.heroId)).toContain(107);
  });

  test("lista del pool: solo héroes del pool, en el orden reordenado, con su propio rank y su tope", () => {
    const result = derive({ activePool: [107, 104, 106, 102], poolShortlistSize: 3 });
    expect(result.poolCards.map((card) => card.heroId)).toEqual([102, 104, 106]);
    expect(result.poolCards.map((card) => card.rank)).toEqual([1, 2, 3]);
    expect(result.poolCards.every((card) => card.poolMembership === "IN_POOL")).toBe(true);
  });

  test("sin poolShortlistSize (el Copilot) no se arma lista de pool", () => {
    expect(derive({ activePool: [104] }).poolCards).toEqual([]);
  });
});
