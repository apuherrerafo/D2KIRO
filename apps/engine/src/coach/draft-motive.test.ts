import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import type { CuratedSynergy } from "../signals/hero-synergies";
import type { HeroPositions } from "../signals/hero-positions";
import { deriveCandidateResult } from "./current-human-decision";
import { hidden, known, recSet, resolvedImpact, revealed, roleOnlyHero, signal, view, type HeroFixture } from "./test.fixtures";

// Regla del usuario (2026-11-02): una vez que el draft ya dice algo (un pick revelado), un héroe cuya ÚNICA razón es "juega ese rol" NO
// se recomienda. Motivo = los bans lo abren, le gana a un rival ya revelado, hace pareja con un aliado, está en TU pool, o es la
// intención de draft elegida. En el primer pick (sin picks a la vista) no se filtra: el contexto son los bans y V6 manda.
// Fixtures inline: ningún dato curado real (familia S9/S10).

const ENEMY = 900;
const ALLY = 901;
const BANNED = 902;
const OTHER = 903; // un aliado ya elegido que no hace pareja con nadie del fixture
const POSITIONS: HeroPositions = {
  1: [{ position: 1, matches: 3000 }],
  2: [{ position: 1, matches: 3000 }],
  3: [{ position: 1, matches: 3000 }],
  4: [{ position: 1, matches: 3000 }],
  5: [{ position: 1, matches: 3000 }],
  6: [{ position: 1, matches: 1500 }, { position: 3, matches: 1500 }], // flex: dos posiciones, y nada más
};

const roleOnly = (heroId: number, weighted: number): HeroFixture => roleOnlyHero(heroId, 1, weighted);
const plain = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted)], impact: resolvedImpact(1) });
const withSynergy = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted - 5), signal("team_synergy", 0.7, 5)], impact: resolvedImpact(1) });
const withIntent = (heroId: number, weighted: number): HeroFixture => ({ heroId, signals: [signal("position_fit", 0.7, weighted - 5), signal("archetype_fit", 0.7, 5)], impact: resolvedImpact(1) });

const firstPickView = () => view("PICK_ROUND_1", [], [], [BANNED]);
const withEnemyView = () => view("PICK_ROUND_2", [known(OTHER)], [revealed(ENEMY)]);
const withAllyView = (bans: number[] = []) => view("PICK_ROUND_2", [known(ALLY)], [hidden()], bans);

interface Options {
  view?: ReturnType<typeof view>;
  heroCounters?: ReadonlyMap<number, readonly CuratedCounter[]>;
  heroSynergies?: ReadonlyMap<number, readonly CuratedSynergy[]>;
  activePool?: number[];
}

function derive(heroes: HeroFixture[], options: Options = {}) {
  return deriveCandidateResult({
    targetPosition: 1,
    targetRanking: recSet(heroes),
    view: options.view ?? withEnemyView(),
    heroPositions: POSITIONS,
    heroCounters: options.heroCounters,
    heroSynergies: options.heroSynergies,
    activePool: options.activePool,
    personalPoolApplied: false,
  });
}

function cardsOf(result: ReturnType<typeof derive>): number[] {
  if (result.state !== "RANKED") throw new Error(`esperaba RANKED, salió ${result.state}`);
  return result.cards.map((card) => card.heroId);
}

describe("sin motivo no se recomienda -- una vez que el draft dice algo, el rol solo no alcanza", () => {
  test("PRIMER PICK (sin picks a la vista): no se filtra; manda V6 con el reordenamiento por bans", () => {
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), plain(3, 70)], { view: firstPickView() }))).toEqual([1, 2, 3]);
  });

  test("con un pick a la vista, un héroe cuya única evidencia es la posición NO sale, aunque tenga el mayor puntaje", () => {
    expect(cardsOf(derive([roleOnly(1, 90), withSynergy(2, 50), withSynergy(3, 40)]))).toEqual([2, 3]);
  });

  test("todos con solo el rol (con información del draft) -> 'Sin recomendación con motivo…' y se listan los legales sin orden", () => {
    const result = derive([roleOnly(1, 90), roleOnly(2, 80), plain(3, 70)]);
    expect(result.state).toBe("UNRANKED_POSITIONAL");
    if (result.state !== "UNRANKED_POSITIONAL") return;
    expect(result.reason.startsWith("Sin recomendación con motivo para")).toBe(true);
    expect(result.alternatives.length).toBeGreaterThan(0);
  });

  test("la razón vieja ('No hay un ranking confiable…') no cambia cuando el motivo no es la causa", () => {
    const result = deriveCandidateResult({ targetPosition: 1, targetRanking: recSet([]), view: withEnemyView(), heroPositions: POSITIONS, personalPoolApplied: false });
    if (result.state === "UNRANKED_POSITIONAL") expect(result.reason.startsWith("Sin recomendación con motivo")).toBe(false);
  });

  test("los bans abren al héroe (se baneó lo que lo counterea fuerte) -> tiene motivo; sin ese ban, no", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[2, [{ vs: BANNED, level: "hard", why: "x" }]]]);
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), withSynergy(3, 40)], { view: withAllyView([BANNED]), heroCounters: counters }))).toEqual([2, 3]);
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), withSynergy(3, 40)], { view: withAllyView([]), heroCounters: counters }))).toEqual([3]);
  });

  test("le gana a un rival YA revelado (counter curado) -> tiene motivo; si ese rival no se ve, no", () => {
    const counters: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[ENEMY, [{ vs: 2, level: "hard", why: "x" }]]]);
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), withSynergy(3, 40)], { view: withEnemyView(), heroCounters: counters }))).toEqual([2, 3]);
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), withSynergy(3, 40)], { view: withAllyView(), heroCounters: counters }))).toEqual([3]);
  });

  test("hace pareja curada con un aliado YA elegido -> tiene motivo; sin ese aliado, no", () => {
    const pairs: ReadonlyMap<number, readonly CuratedSynergy[]> = new Map([[2, [{ with: ALLY, why: "combo" }]]]);
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), withSynergy(3, 40)], { view: withAllyView(), heroSynergies: pairs }))).toEqual([2, 3]);
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), withSynergy(3, 40)], { view: withEnemyView(), heroSynergies: pairs }))).toEqual([3]);
  });

  test("la señal de sinergia del motor y la intención de draft elegida valen cada una por sí solas", () => {
    expect(cardsOf(derive([roleOnly(1, 90), withSynergy(2, 50)]))).toEqual([2]);
    expect(cardsOf(derive([roleOnly(1, 90), withIntent(2, 50)]))).toEqual([2]);
  });

  test("pertenecer a TU pool es motivo (es tu héroe); el resto con solo el rol queda fuera", () => {
    expect(cardsOf(derive([roleOnly(1, 90), roleOnly(2, 80), withSynergy(3, 40)], { activePool: [2] }))).toEqual([2, 3]);
  });

  test("ser flex (dos posiciones curadas) NO es un motivo", () => {
    expect(cardsOf(derive([plain(6, 90), withSynergy(2, 50)]))).toEqual([2]);
  });

  test("CANDADO de regresión: con motivo en todos, rank, orden y puntajes son EXACTAMENTE los de V6", () => {
    const result = derive([withSynergy(1, 30), withSynergy(2, 25), withSynergy(3, 20), withIntent(4, 10)]);
    if (result.state !== "RANKED") throw new Error(result.state);
    expect(result.cards.map((card) => card.heroId)).toEqual([1, 2, 3, 4]);
    expect(result.cards.map((card) => card.rank)).toEqual([1, 2, 3, 4]);
    expect(result.cards.map((card) => card.score)).toEqual([30, 25, 20, 10]);
  });
});
