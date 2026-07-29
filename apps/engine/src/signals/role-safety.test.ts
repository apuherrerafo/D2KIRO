import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { roleSafetyScorer } from "./role-safety";
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

function meta(heroes: MetaSnapshot["heroes"] = {}): MetaSnapshot {
  return { heroes, matchups: {} };
}

describe("roleSafetyScorer", () => {
  test("candidato Support en el pick propio 1 (0 picks propios todavía) -> raw: 1", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Support A", roles: ["Support"] } });

    const result = roleSafetyScorer.score(state, 1, snapshot);

    expect(result.raw).toBe(1);
    expect(result.signal).toBe("role_safety");
  });

  test("candidato no-Support en el pick propio 1 -> raw: 0 (no penalizado, solo no empujado)", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Carry A", roles: ["Carry"] } });

    const result = roleSafetyScorer.score(state, 1, snapshot);

    expect(result.raw).toBe(0);
  });

  test("candidato Support en el pick propio 2 (1 pick propio ya hecho) -> raw: 1, sigue en ventana", () => {
    const state = draftState({ picks: { radiant: [5], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Support A", roles: ["Support"] } });

    const result = roleSafetyScorer.score(state, 1, snapshot);

    expect(result.raw).toBe(1);
  });

  test("candidato en el pick propio 3 (2 picks propios ya hechos) -> raw: null, la ventana ya pasó", () => {
    const state = draftState({ picks: { radiant: [5, 6], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Support A", roles: ["Support"] } });

    const result = roleSafetyScorer.score(state, 1, snapshot);

    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
  });

  test("héroe sin roles[] conocido -> no es Support, raw: 0, nunca lanza", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({});

    expect(() => roleSafetyScorer.score(state, 999, snapshot)).not.toThrow();
    expect(roleSafetyScorer.score(state, 999, snapshot).raw).toBe(0);
  });

  test("localSide desconocido -> se trata como 0 picks propios, sigue en ventana", () => {
    const state = draftState({ localSide: "unknown" });
    const snapshot = meta({ 1: { id: 1, localizedName: "Support A", roles: ["Support"] } });

    const result = roleSafetyScorer.score(state, 1, snapshot);

    expect(result.raw).toBe(1);
  });

  test("función pura: misma entrada, misma salida", () => {
    const state = draftState({ picks: { radiant: [], dire: [] } });
    const snapshot = meta({ 1: { id: 1, localizedName: "Support A", roles: ["Support"] } });

    expect(roleSafetyScorer.score(state, 1, snapshot)).toEqual(roleSafetyScorer.score(state, 1, snapshot));
  });
});
