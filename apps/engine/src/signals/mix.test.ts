import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { buildSuggestions } from "./mix";
import type { MetaHeroInfo, MetaSnapshot } from "./types";
import { SCORING_WEIGHTS_V1 } from "./weights";

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
