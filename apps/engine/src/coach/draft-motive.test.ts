import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCandidateResult } from "./current-human-decision";
import { known, recSet, resolvedImpact, revealed, roleOnlyHero, signal, view, type HeroFixture } from "./test.fixtures";

// Regla del usuario (2026-11-02, opción A): un héroe cuya ÚNICA razón es "juega ese rol" NO se recomienda. Tiene motivo cuando algo
// más lo respalda en ESTE draft: counter contra un rival ya revelado, sinergia con un aliado, fuerza en el parche, pertenecer a TU pool
// o la intención de draft elegida. Fixtures inline: ningún dato curado real (familia S9/S10).

const ENEMY = 900;
const ALLY = 901;
const POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 3000 }],
  2: [{ position: 1, matches: 3000 }],
  3: [{ position: 1, matches: 3000 }],
  4: [{ position: 1, matches: 3000 }],
  5: [{ position: 1, matches: 3000 }],
  6: [{ position: 1, matches: 1500 }, { position: 3, matches: 1500 }], // flex: dos posiciones, y nada más
};

const roleOnly = (heroId: number, weighted: number): HeroFixture => roleOnlyHero(heroId, 1, weighted);
const withMeta = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted - 5), signal("patch_meta", 0.6, 5)], impact: resolvedImpact(1) });
const withSynergy = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted - 5), signal("team_synergy", 0.7, 5)], impact: resolvedImpact(1) });
const withCounter = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted - 5), signal("counter", 0.8, 5)], impact: resolvedImpact(1) });
const withIntent = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted - 5), signal("archetype_fit", 0.7, 5)], impact: resolvedImpact(1) });
const withWeakMeta = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted - 5), signal("patch_meta", 0.45, 5)], impact: resolvedImpact(1) });
const plain = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted)], impact: resolvedImpact(1) });

const openView = () => view("PICK_ROUND_1", [], []);
const enemyRevealedView = () => view("PICK_ROUND_2", [known(1)], [revealed(ENEMY)]);

function derive(heroes: HeroFixture[], options: { view?: ReturnType<typeof view>; heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>; activePool?: number[]; heroPositions?: HeroPositions } = {}) {
  return deriveCandidateResult({
    targetPosition: 1,
    targetRanking: recSet(heroes),
    view: options.view ?? openView(),
    heroPositions: options.heroPositions ?? POSITIONS,
    heroCounters: options.heroCounters,
    activePool: options.activePool,
    personalPoolApplied: false,
  });
}

function cardsOf(result: ReturnType<typeof derive>): number[] {
  if (result.state !== "RANKED") throw new Error(`esperaba RANKED, salió ${result.state}`);
  return result.cards.map((card) => card.heroId);
}

describe("sin motivo no se recomienda -- el rol solo no alcanza", () => {
  test("un héroe cuya única evidencia es la posición NO sale en las tarjetas, aunque tenga el mayor puntaje", () => {
    const result = derive([roleOnly(1, 90), withMeta(2, 50), withMeta(3, 40)]);
    expect(cardsOf(result)).toEqual([2, 3]);
  });

  test("todos con solo el rol -> 'Sin recomendación con motivo para esta posición' y se listan los legales sin orden", () => {
    const result = derive([roleOnly(1, 90), roleOnly(2, 80), plain(3, 70)]);
    expect(result.state).toBe("UNRANKED_POSITIONAL");
    if (result.state !== "UNRANKED_POSITIONAL") return;
    expect(result.reason.startsWith("Sin recomendación con motivo para")).toBe(true);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  test("la razón vieja ('No hay un ranking confiable…') sigue siendo la de siempre cuando el motivo no es la causa", () => {
    const result = deriveCandidateResult({ targetPosition: 1, targetRanking: recSet([], { degradations: [{ kind: "no_candidates" } as never] }), view: openView(), heroPositions: POSITIONS, personalPoolApplied: false });
    if (result.state === "UNRANKED_POSITIONAL") expect(result.reason.startsWith("Sin recomendación con motivo")).toBe(false);
  });

  test("cada motivo vale por sí solo: fuerza en el parche, sinergia con un aliado y la intención de draft", () => {
    expect(cardsOf(derive([roleOnly(1, 90), withMeta(2, 50)]))).toEqual([2]);
    expect(cardsOf(derive([roleOnly(1, 90), withSynergy(2, 50)]))).toEqual([2]);
    expect(cardsOf(derive([roleOnly(1, 90), withIntent(2, 50)]))).toEqual([2]);
  });

  test("un counter curado fuerte contra un rival YA revelado es motivo; el mismo héroe sin ese rival a la vista no lo tiene", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[ENEMY, [{ vs: 2, level: "hard", why: "x" }]]]);
    expect(cardsOf(derive([roleOnly(1, 90), withCounter(2, 80), withMeta(3, 40)], { view: enemyRevealedView(), heroCounters: counters }))).toEqual([2, 3]);
    // sin el rival a la vista, el mismo héroe (aunque su señal `counter` traiga un número) no tiene motivo: el counter debe ser contra alguien que SE VE
    expect(cardsOf(derive([roleOnly(1, 90), withCounter(2, 80), withMeta(3, 40)], { view: openView(), heroCounters: counters }))).toEqual([3]);
  });

  test("pertenecer a TU pool es motivo (es tu héroe); el resto con solo el rol queda fuera", () => {
    const result = derive([roleOnly(1, 90), roleOnly(2, 80), withMeta(3, 40)], { activePool: [2] });
    expect(cardsOf(result)).toEqual([2, 3]);
  });

  test("un meta que solo 'vota' no es motivo: hay que ganar más de lo que se pierde (winrate > 50 %) -- sin números inventados", () => {
    expect(cardsOf(derive([withWeakMeta(1, 90), withMeta(2, 50)]))).toEqual([2]);
  });

  test("ser flex (dos posiciones curadas) NO es un motivo", () => {
    const result = derive([plain(6, 90), withMeta(2, 50)]);
    expect(cardsOf(result)).toEqual([2]);
  });

  test("CANDADO de regresión: con motivo en todos, rank, orden y puntajes son EXACTAMENTE los de V6", () => {
    const result = derive([withMeta(1, 30), withMeta(2, 25), withSynergy(3, 20), withIntent(4, 10)]);
    if (result.state !== "RANKED") throw new Error(result.state);
    expect(result.cards.map((card) => card.heroId)).toEqual([1, 2, 3, 4]);
    expect(result.cards.map((card) => card.rank)).toEqual([1, 2, 3, 4]);
    expect(result.cards.map((card) => card.score)).toEqual([30, 25, 20, 10]);
  });
});
