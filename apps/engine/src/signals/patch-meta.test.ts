import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import { patchMetaScorer } from "./patch-meta";
import type { HeroPatchBracketStat, MetaSnapshot } from "./types";

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

function meta(patchStats: Record<number, HeroPatchBracketStat[]>): MetaSnapshot {
  return { heroes: {}, matchups: {}, patchStats };
}

describe("patchMetaScorer", () => {
  test("menos de 500 partidas en bracket bajo/medio -> raw: null", () => {
    const state = draftState({ patch: "7.36" });
    const snapshot = meta({
      1: [
        { patch: "7.36", bracket: "herald", picks: 150, wins: 70 },
        { patch: "7.36", bracket: "archon", picks: 200, wins: 90 },
      ],
    });

    const result = patchMetaScorer.score(state, 1, snapshot);

    expect(result.raw).toBeNull();
    expect(result.sampleSize).toBe(0);
    expect(result.signal).toBe("patch_meta");
  });

  test(">=500 partidas en bracket bajo/medio -> raw numérico, sampleSize y explanation coherentes", () => {
    const state = draftState({ patch: "7.36" });
    const snapshot = meta({
      1: [
        { patch: "7.36", bracket: "herald", picks: 300, wins: 150 },
        { patch: "7.36", bracket: "archon", picks: 250, wins: 130 },
        { patch: "7.35", bracket: "herald", picks: 9000, wins: 8000 }, // parche viejo, descartado
      ],
    });

    const result = patchMetaScorer.score(state, 1, snapshot);

    expect(result.raw).toBeCloseTo(280 / 550, 5);
    expect(result.sampleSize).toBe(550);
    expect(result.explanation).toContain("%");
  });

  test("usa el bracket bajo/medio agregado, nunca el de MMR alto aunque el fixture tenga datos de ambos", () => {
    const state = draftState({ patch: "7.36" });
    const snapshot = meta({
      1: [
        { patch: "7.36", bracket: "herald", picks: 300, wins: 150 },
        { patch: "7.36", bracket: "archon", picks: 250, wins: 130 },
        { patch: "7.36", bracket: "immortal", picks: 10000, wins: 9000 },
      ],
    });

    const result = patchMetaScorer.score(state, 1, snapshot);

    expect(result.raw).toBeCloseTo(280 / 550, 5);
    expect(result.sampleSize).toBe(550);
  });

  test("candidato sin datos no lanza excepción y es pura", () => {
    const state = draftState();
    const snapshot = meta({});

    expect(() => patchMetaScorer.score(state, 42, snapshot)).not.toThrow();
    expect(patchMetaScorer.score(state, 42, snapshot)).toEqual(patchMetaScorer.score(state, 42, snapshot));
  });
});
