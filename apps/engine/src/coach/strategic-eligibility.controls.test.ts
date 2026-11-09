import { describe, expect, test } from "bun:test";
import type { CuratedCounter } from "../signals/hero-counters";
import { deriveCandidateResult } from "./current-human-decision";

// CONTROLES ESTRATÉGICOS (P0-04B). Certifican la elegibilidad REAL del Coach y por eso NO usan ningún fundamento sintético: ni el harness de sesión, ni
// `strongOpenerCounters`, ni `neutralSynergies`. Cada fundamento es una relación curada con porqué contra un rival ya revelado, escrita en la propia prueba.
// Todos los héroes llevan el mismo winrate global alto (65 %, 5.000 partidas) con peso 0: el winrate está disponible y no decide.
// (Las pruebas que sí usan fundamentos sintéticos verifican mecanismos de software: flujo de pools, transporte, paridad.)

const POOL_HERO = 201; // en tu pool, con solo un counter medium
const OUTSIDE_HERO = 202; // fuera de tu pool, con un counter duro justificado
const NO_GROUND_HERO = 203; // solo winrate alto
const ENEMY_A = 40;
const ENEMY_B = 41;

function ranking() {
  const recommendations = [POOL_HERO, OUTSIDE_HERO, NO_GROUND_HERO].map((hero, index) => ({
    actions: [{ hero }],
    roleImpact: { [hero]: { status: "LIKELY", position: 1, marginals: { 1: 1, 2: 0, 3: 0, 4: 0, 5: 0 }, entropy: 0 } },
    signalsByHero: { [hero]: [{ signal: "position_fit", raw: 1, weighted: 100 - index, explanation: `Encaja ${hero}`, sampleSize: 10, applicable: true }, { signal: "patch_meta", raw: 0.65, weighted: 0, explanation: "Winrate de 65.0% este parche", sampleSize: 5000, applicable: true }] },
    risks: [],
    confidence: "media",
  }));
  return { recommendations, degradations: [] } as never;
}

const view = (enemy: number[]) => ({ bannedHeroes: [], ownPicks: [], enemyPicks: enemy.map((heroId) => ({ heroId, visibility: "REVEALED" })) }) as never;
// La clave es la víctima (el rival revelado); `vs` es el héroe que le gana.
const MEDIUM_ONLY: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([[ENEMY_A, [{ vs: POOL_HERO, level: "medium", why: "Su stun interrumpe parte de su combo" }]]]);
const MEDIUM_AND_HARD: ReadonlyMap<number, readonly CuratedCounter[]> = new Map([...MEDIUM_ONLY, [ENEMY_B, [{ vs: OUTSIDE_HERO, level: "hard", why: "Lo silencia y no puede lanzar nada" }]]]);

function derive(enemy: number[], heroCounters: ReadonlyMap<number, readonly CuratedCounter[]> | undefined, activePool?: number[]) {
  const result = deriveCandidateResult({ targetPosition: 1, targetRanking: ranking(), view: view(enemy), heroPositions: {}, heroCounters, personalPoolApplied: false, activePool, shortlistSize: 5 });
  if (result.state !== "RANKED") throw new Error(`esperaba RANKED, salió ${result.state}`);
  return result.cards;
}

describe("controles estratégicos reales (sin fundamentos sintéticos)", () => {
  test("draft sin fundamento: cero tarjetas, aunque todos tengan 65 % de winrate", () => {
    expect(derive([], undefined)).toEqual([]);
    expect(derive([ENEMY_A], new Map())).toEqual([]);
  });

  test("winrate alto sin fundamento: el héroe no aparece aunque otros sí tengan tarjeta", () => {
    expect(derive([ENEMY_A, ENEMY_B], MEDIUM_AND_HARD).map((card) => card.heroId)).not.toContain(NO_GROUND_HERO);
  });

  test("counter medium contextual: tarjeta WEAK", () => {
    const cards = derive([ENEMY_A], MEDIUM_ONLY);
    expect(cards.map((card) => [card.heroId, card.evidenceStrength])).toEqual([[POOL_HERO, "WEAK"]]);
  });

  test("counter hard justificado: tarjeta STRONG", () => {
    const cards = derive([ENEMY_B], MEDIUM_AND_HARD);
    expect(cards.map((card) => [card.heroId, card.evidenceStrength])).toEqual([[OUTSIDE_HERO, "STRONG"]]);
  });

  test("héroe externo STRONG junto a un héroe del pool solo WEAK: el externo es OUTSIDE_POOL, el del pool IN_POOL y sigue WEAK", () => {
    const cards = derive([ENEMY_A, ENEMY_B], MEDIUM_AND_HARD, [POOL_HERO]);
    const byHero = new Map(cards.map((card) => [card.heroId, card]));
    expect(byHero.get(OUTSIDE_HERO)).toMatchObject({ evidenceStrength: "STRONG", poolMembership: "OUTSIDE_POOL" });
    expect(byHero.get(POOL_HERO)).toMatchObject({ evidenceStrength: "WEAK", poolMembership: "IN_POOL" });
    expect(byHero.has(NO_GROUND_HERO)).toBe(false);
  });

  test("sin ningún STRONG (solo el counter medium): no hay tarjeta STRONG que pueda sostener ELIGE AHORA", () => {
    const cards = derive([ENEMY_A], MEDIUM_ONLY, [POOL_HERO]);
    expect(cards.filter((card) => card.evidenceStrength === "STRONG")).toEqual([]);
  });
});
