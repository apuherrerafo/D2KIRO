import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { buildSuggestions, mixScore } from "./mix";
import type { MetaHeroInfo, MetaSnapshot, SignalContribution } from "./types";
import { SCORING_WEIGHTS_V1, SCORING_WEIGHTS_V2 } from "./weights";

function draftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "s1",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.36",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 7,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

function meta(heroes: Record<number, MetaHeroInfo>, overrides: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return { heroes, matchups: {}, ...overrides };
}

describe("SCORING_WEIGHTS_V1", () => {
  test("los 4 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V1).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });
});

// TSK-023 (fase 1b, SPEC.md §9.3): las dos pruebas obligatorias del candado de regresión cero --
// no una, ambas. La segunda es el candado real: prueba que la promesa de D8 es un hecho verificado
// con números exactos, no una afirmación de comentario.
describe("SCORING_WEIGHTS_V2 — candado de regresión cero", () => {
  test("los 5 pesos suman exactamente 1.0", () => {
    const sum = Object.values(SCORING_WEIGHTS_V2).reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 10);
  });

  test("con hero_pool_fit no aplicable, mixScore redistribuye a exactamente los pesos de V1 (0.40/0.25/0.20/0.15)", () => {
    // raw elegidos para que cada señal normalice a un número distinto y verificable a mano:
    // counter->100 (tope de su rango), patch_meta->0 (piso), team_synergy->75, role_gap->50.
    const signals: SignalContribution[] = [
      { signal: "counter", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "patch_meta", raw: 0.3, weighted: 0, explanation: "", sampleSize: 10 },
      { signal: "team_synergy", raw: 0.75, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "role_gap", raw: -0.5, weighted: 0, explanation: "", sampleSize: 0 },
      { signal: "hero_pool_fit", raw: null, weighted: 0, explanation: "", sampleSize: 0, applicable: false },
    ];

    const score = mixScore(signals);

    // Esperado usando los pesos ORIGINALES de V1, no V2 crudo -- esto es lo que demuestra que la
    // redistribución proporcional reproduce V1 exactamente, no una aproximación.
    const expected = 100 * SCORING_WEIGHTS_V1.counter + 0 * SCORING_WEIGHTS_V1.patch_meta + 75 * SCORING_WEIGHTS_V1.team_synergy + 50 * SCORING_WEIGHTS_V1.role_gap;
    expect(score).toBeCloseTo(expected, 10);
  });

  test("un héroe en el pool con winrate alto recibe un score mayor que uno idéntico fuera del pool", () => {
    const state = draftState();
    const snapshot = meta(
      { 1: { id: 1, localizedName: "En el pool" }, 2: { id: 2, localizedName: "Fuera del pool" } },
      { heroPool: [{ hero: 1, source: "calculated", personalWinrate: 0.9, personalGames: 50, updatedAt: "2026-07-29" }] },
    );

    const result = buildSuggestions(state, snapshot);
    const inPool = result.suggestions.find((s) => s.hero === 1);
    const outOfPool = result.suggestions.find((s) => s.hero === 2);

    expect(inPool).toBeDefined();
    expect(outOfPool).toBeDefined();
    expect(inPool!.score).toBeGreaterThan(outOfPool!.score);
  });

  test("con el pool nunca configurado, hero_pool_fit aparece siempre en signals[] pero no baja la confianza (applicable:false != raw:null)", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Candidato" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] } },
    );

    const result = buildSuggestions(state, snapshot);
    const suggestion = result.suggestions.find((s) => s.hero === 1);
    const poolSignal = suggestion?.signals.find((s) => s.signal === "hero_pool_fit");

    expect(poolSignal).toBeDefined();
    expect(poolSignal?.raw).toBeNull();
    expect(poolSignal?.applicable).toBe(false);
    // Mismo resultado que el test "señal en null" de arriba (2 nulls reales: patch_meta,
    // team_synergy) -- hero_pool_fit no aplicable no suma un tercer null a la cuenta.
    expect(suggestion?.confidence).toBe("baja");
  });
});

describe("buildSuggestions", () => {
  test("candidatos excluyen baneados y ya elegidos de ambos lados", () => {
    const state = draftState({ banned: [2], picks: { radiant: [3], dire: [4] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "A" },
      2: { id: 2, localizedName: "B" },
      3: { id: 3, localizedName: "C" },
      4: { id: 4, localizedName: "D" },
    });

    const result = buildSuggestions(state, snapshot);

    const suggestedHeroes = result.suggestions.map((s) => s.hero);
    expect(suggestedHeroes).toEqual([1]);
  });

  test("señal en null: el peso se redistribuye proporcionalmente, no se trata como 0", () => {
    // Equipo propio vacío -> team_synergy siempre null. Sin patchStats -> patch_meta null.
    // counter y role_gap normalizan ambos a exactamente 100 (ver cálculo abajo) -- si el peso se
    // redistribuye bien, el score final debe ser 100 (no 55, que sería tratar null como 0 y seguir
    // dividiendo por el peso total original de 1.0).
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta({
      1: { id: 1, localizedName: "Candidato" },
      50: { id: 50, localizedName: "Enemigo" },
    }, {
      matchups: {
        1: [
          { vsHero: 50, games: 300, wins: 280 }, // winrate vs 50 = 0.9333
          { vsHero: 60, games: 300, wins: 20 }, // baseline = (280+20)/600 = 0.5 -> delta = 0.4333, clamp a 0.3 -> normaliza a 100
        ],
      },
    });

    const result = buildSuggestions(state, snapshot);
    const suggestion = result.suggestions.find((s) => s.hero === 1);

    expect(suggestion).toBeDefined();
    expect(suggestion?.score).toBeCloseTo(100, 5);
    expect(suggestion?.confidence).toBe("baja"); // 2 señales en null (patch_meta, team_synergy)
    const nonNullSignals = suggestion?.signals.filter((s) => s.raw !== null) ?? [];
    expect(nonNullSignals.map((s) => s.signal).sort()).toEqual(["counter", "role_gap"]);
  });

  test("Suggestion.reason es trazable a los signals de esa sugerencia", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Candidato" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] } },
    );

    const result = buildSuggestions(state, snapshot);
    const suggestion = result.suggestions[0];

    const explanations = suggestion?.signals.filter((s) => s.raw !== null).map((s) => s.explanation) ?? [];
    for (const explanation of explanations) {
      expect(suggestion?.reason).toContain(explanation);
    }
  });

  test("computedInMs queda bajo 300ms en el caso normal (~130 héroes candidatos)", () => {
    const heroes: Record<number, MetaHeroInfo> = {};
    for (let id = 1; id <= 130; id++) heroes[id] = { id, localizedName: `Hero ${id}`, roles: ["Carry"] };
    const state = draftState();
    const snapshot = meta(heroes);

    const result = buildSuggestions(state, snapshot);

    expect(result.computedInMs).toBeLessThan(300);
    expect(result.suggestions.length).toBeLessThanOrEqual(3);
  });

  test("sin candidatos válidos -> suggestions: [] sin lanzar (nunca un error del sistema)", () => {
    const state = draftState({ picks: { radiant: [1], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Único héroe, ya elegido" } });

    expect(() => buildSuggestions(state, snapshot)).not.toThrow();
    expect(buildSuggestions(state, snapshot).suggestions).toEqual([]);
  });

  test("degraded incluye unknown_format y unconfirmed_state cuando aplica", () => {
    const state = draftState({ format: "unknown", quality: { unconfirmed: [1], captureStatus: "ok" } });
    const snapshot = meta({ 1: { id: 1, localizedName: "A" } });

    const result = buildSuggestions(state, snapshot);

    expect(result.degraded).toContain("unknown_format");
    expect(result.degraded).toContain("unconfirmed_state");
  });

  test("meta.isStale -> degraded incluye stale_meta y confidence nunca es 'alta'", () => {
    const state = draftState({ picks: { radiant: [], dire: [50] } });
    const snapshot = meta(
      { 1: { id: 1, localizedName: "Candidato" }, 50: { id: 50, localizedName: "Enemigo" } },
      { matchups: { 1: [{ vsHero: 50, games: 300, wins: 280 }, { vsHero: 60, games: 300, wins: 20 }] } },
    );

    const result = buildSuggestions(state, snapshot, { metaIsStale: true });

    expect(result.degraded).toContain("stale_meta");
    expect(result.suggestions.every((s) => s.confidence !== "alta")).toBe(true);
  });
});
