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

function derive(input: { banned?: number[]; own?: number[]; enemy?: number[]; heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>; heroSynergies?: ReadonlyMap<number, readonly CuratedSynergy[]>; activePool?: number[]; poolShortlistSize?: number }) {
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

  test("CANDADO RB-4: si un rival YA revelado lo counterea fuerte, va al fondo aunque los bans lo hayan abierto", () => {
    // 101 es el primero de V6. Lion y Ancient están baneados (lo abren), pero Axe ya está en el rival.
    const result = derive({ banned: [LION, ANCIENT], enemy: [AXE], heroCounters: COUNTERS });
    expect(result.cards.map((card) => card.heroId)).not.toContain(101);
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
