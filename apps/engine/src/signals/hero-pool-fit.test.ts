import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { heroPoolFitScorer } from "./hero-pool-fit";
import type { MetaSnapshot } from "./types";

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
    lastSeq: 0,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-07-27T00:00:00Z",
    ...overrides,
  };
}

function meta(overrides: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return { heroes: {}, matchups: {}, ...overrides };
}

describe("heroPoolFitScorer", () => {
  test("meta.heroPool ausente -> raw: null, applicable: false", () => {
    const result = heroPoolFitScorer.score(draftState(), 1, meta());

    expect(result.raw).toBeNull();
    expect(result.applicable).toBe(false);
    expect(result.sampleSize).toBe(0);
    expect(result.signal).toBe("hero_pool_fit");
  });

  test("meta.heroPool vacío (configurado explícitamente sin entradas) -> mismo resultado que ausente", () => {
    const result = heroPoolFitScorer.score(draftState(), 1, meta({ heroPool: [] }));

    expect(result.raw).toBeNull();
    expect(result.applicable).toBe(false);
  });

  test("candidato fuera de un pool no vacío -> raw: 0.20, applicable: true (dato real, no null)", () => {
    const snapshot = meta({
      heroPool: [{ hero: 99, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }],
    });

    const result = heroPoolFitScorer.score(draftState(), 1, snapshot);

    expect(result.raw).toBe(0.2);
    expect(result.applicable).toBe(true);
    expect(result.sampleSize).toBe(0);
  });

  test("candidato en el pool sin winrate registrado (manual, recién añadido) -> raw: 0.50", () => {
    const snapshot = meta({
      heroPool: [{ hero: 1, source: "manual", personalWinrate: null, personalGames: 0, updatedAt: "2026-07-28" }],
    });

    const result = heroPoolFitScorer.score(draftState(), 1, snapshot);

    expect(result.raw).toBe(0.5);
    expect(result.applicable).toBe(true);
    expect(result.sampleSize).toBe(0);
  });

  test("candidato en el pool con winrate: shrunk calculado a mano contra el baseline por defecto (0.5)", () => {
    // personalWinrate 0.7 en 20 partidas, baseline por defecto 0.5 (meta.personalBaselineWinrate ausente).
    // personalWins = 14. shrunk = (14 + 10*0.5) / (20+10) = 19/30 = 0.633333...
    // raw = clamp(0.5 + (0.633333 - 0.5) * 2, 0.5, 1.0) = 0.5 + 0.266666... = 0.766666...
    const snapshot = meta({
      heroPool: [{ hero: 1, source: "calculated", personalWinrate: 0.7, personalGames: 20, updatedAt: "2026-07-28" }],
    });

    const result = heroPoolFitScorer.score(draftState(), 1, snapshot);

    expect(result.raw).toBeCloseTo(0.5 + ((14 + 5) / 30 - 0.5) * 2, 10);
    expect(result.sampleSize).toBe(20);
    expect(result.explanation).toContain("70");
  });

  test("usa meta.personalBaselineWinrate cuando está presente, no el default de 0.5", () => {
    // Mismo héroe que arriba, pero baseline explícito de 0.6.
    // shrunk = (14 + 10*0.6) / 30 = (14+6)/30 = 20/30 = 0.666666...
    const snapshot = meta({
      heroPool: [{ hero: 1, source: "calculated", personalWinrate: 0.7, personalGames: 20, updatedAt: "2026-07-28" }],
      personalBaselineWinrate: 0.6,
    });

    const result = heroPoolFitScorer.score(draftState(), 1, snapshot);

    expect(result.raw).toBeCloseTo(0.5 + (20 / 30 - 0.6) * 2, 10);
  });

  test("clamp superior: un winrate personal muy alto nunca supera 1.0", () => {
    const snapshot = meta({
      heroPool: [{ hero: 1, source: "calculated", personalWinrate: 1.0, personalGames: 50, updatedAt: "2026-07-28" }],
    });

    const result = heroPoolFitScorer.score(draftState(), 1, snapshot);

    expect(result.raw).toBe(1.0);
  });

  test("clamp inferior: un winrate personal muy bajo nunca baja de 0.5 (estar en tu pool solo suma)", () => {
    const snapshot = meta({
      heroPool: [{ hero: 1, source: "calculated", personalWinrate: 0.0, personalGames: 50, updatedAt: "2026-07-28" }],
    });

    const result = heroPoolFitScorer.score(draftState(), 1, snapshot);

    expect(result.raw).toBe(0.5);
  });

  test("función pura: misma entrada, misma salida, nunca lanza", () => {
    const snapshot = meta({
      heroPool: [{ hero: 1, source: "calculated", personalWinrate: 0.6, personalGames: 15, updatedAt: "2026-07-28" }],
    });
    const state = draftState();

    expect(() => heroPoolFitScorer.score(state, 1, snapshot)).not.toThrow();
    expect(heroPoolFitScorer.score(state, 1, snapshot)).toEqual(heroPoolFitScorer.score(state, 1, snapshot));
  });
});
