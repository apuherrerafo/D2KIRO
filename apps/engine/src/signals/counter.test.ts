import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { counterScorer } from "./counter";
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
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

function meta(overrides: Partial<MetaSnapshot> = {}): MetaSnapshot {
  return { heroes: {}, matchups: {}, ...overrides };
}

describe("counterScorer", () => {
  test("0 enemigos conocidos -> raw: null", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({ matchups: { 1: [{ vsHero: 10, games: 500, wins: 300 }] } });

    const result = counterScorer.score(state, 1, snapshot);

    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.signal).toBe("counter");
  });

  test("enemigos conocidos pero todos bajo 200 partidas -> raw: null", () => {
    const state = draftState({ picks: { radiant: [], dire: [10, 11] } });
    const snapshot = meta({
      matchups: {
        1: [
          { vsHero: 10, games: 150, wins: 80 },
          { vsHero: 11, games: 199, wins: 100 },
        ],
      },
    });

    const result = counterScorer.score(state, 1, snapshot);

    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
  });

  test("al menos un enfrentamiento válido -> raw numérico, sampleSize y explanation correctos", () => {
    const state = draftState({ picks: { radiant: [], dire: [10, 11] } });
    const snapshot = meta({
      heroes: { 10: { id: 10, localizedName: "Lina" }, 11: { id: 11, localizedName: "Zeus" } },
      matchups: {
        1: [
          { vsHero: 10, games: 300, wins: 200 }, // válido, winrate 0.6667
          { vsHero: 11, games: 100, wins: 40 }, // bajo umbral, descartado del promedio
          { vsHero: 12, games: 500, wins: 250 }, // no es enemigo conocido, solo aporta a la base
        ],
      },
    });

    const result = counterScorer.score(state, 1, snapshot);

    const baseline = (200 + 40 + 250) / (300 + 100 + 500);
    expect(result.raw).toBeCloseTo(200 / 300 - baseline, 5);
    expect(result.sampleSize).toBe(300);
    expect(result.explanation).toContain("Lina");
    expect(result.explanation).not.toContain("Zeus");
  });

  test("localSide 'unknown' no tiene lado enemigo conocible -> raw: null, nunca lanza", () => {
    const state = draftState({ localSide: "unknown", picks: { radiant: [10], dire: [11] } });
    const snapshot = meta({ matchups: { 1: [{ vsHero: 10, games: 500, wins: 300 }] } });

    const result = counterScorer.score(state, 1, snapshot);

    expect(result.raw).toBeNull();
  });

  test("candidato ausente del snapshot no lanza y es pura (misma entrada, misma salida)", () => {
    const state = draftState({ picks: { radiant: [], dire: [999] } });

    expect(() => counterScorer.score(state, 42, meta())).not.toThrow();
    expect(counterScorer.score(state, 42, meta())).toEqual(counterScorer.score(state, 42, meta()));
  });
});
