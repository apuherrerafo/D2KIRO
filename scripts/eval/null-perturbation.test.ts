import { describe, expect, test } from "bun:test";
import { createIdleDraftState } from "../../apps/engine/src/draft/reducer";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { toleranceFromGolden, toleranceFromReplays } from "./null-perturbation";
import { loadGoldenDataset, GOLDEN_SCHEMA_VERSION, type GoldenCase } from "./golden";
import type { ReplayCase } from "./types";

function fixtureMeta(): MetaSnapshot {
  const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
  for (let i = 1; i <= 30; i++) heroes[i] = { id: i, localizedName: `H${i}`, roles: [] };
  const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
  for (let i = 1; i <= 30; i++) patchStats[i] = [{ patch: "60", bracket: "immortal", picks: i * 10, wins: i * 5 }];
  return { heroes, matchups: {}, patchStats, heroPool: [], personalBaselineWinrate: null } as unknown as MetaSnapshot;
}

function goldenCases(): GoldenCase[] {
  const raw = [1, 2, 3].map((k) => ({
    id: `g${k}`,
    source: { kind: "synthetic", note: "x" },
    state: { schema: "draft-state/v1", format: "all_pick", patch: "60", localSide: "radiant", phase: "active", banned: [], picks: { radiant: [], dire: [] }, lastSeq: 0 },
    side: "radiant",
    decisionContext: "response_pick",
    strata: ["hard_counter"],
    labels: { excellent: [{ hero: k, why: "x" }], acceptable: [{ hero: k + 10, why: "y" }], bad: [{ hero: k + 20, why: "z" }] },
    reasoningTags: [],
    labeledAt: "2026-08-29T00:00:00Z",
    labeledBy: "t",
  }));
  return loadGoldenDataset({ schemaVersion: GOLDEN_SCHEMA_VERSION, cases: raw }).cases;
}

function replayCase(i: number): ReplayCase {
  return {
    matchId: `M${i}`,
    leagueId: 1,
    tier: "professional",
    turnIndex: 4,
    state: { ...createIdleDraftState(`M${i}`), schema: "draft-state/v1", format: "captains_mode", patch: "60", localSide: "radiant", phase: "active", banned: [], picks: { radiant: [1 + i], dire: [20 + i, 21 + i] }, lastSeq: 4 },
    side: "radiant",
    actualHero: 5 + i,
    action: "pick",
    decisionContext: i % 2 === 0 ? "response_pick" : "closing_pick",
  };
}

describe("null-perturbation — piso de tolerancia (R1-11)", () => {
  test("toleranceFromGolden: determinista, rangos >= 0", () => {
    const meta = fixtureMeta();
    const a = toleranceFromGolden(goldenCases(), meta, { perturbations: 50, seed: 1 });
    const b = toleranceFromGolden(goldenCases(), meta, { perturbations: 50, seed: 1 });
    expect(a).toEqual(b);
    expect(a.ndcg5).toBeGreaterThanOrEqual(0);
    expect(a.badPickRate5).toBeGreaterThanOrEqual(0);
    expect(a.perturbations).toBe(50);
  });

  test("Golden vacío -> rangos 0 y nota explicativa", () => {
    const t = toleranceFromGolden([], fixtureMeta(), { perturbations: 20 });
    expect(t.ndcg5).toBe(0);
    expect(t.badPickRate5).toBe(0);
    expect(t.note).toContain("Golden vacío");
  });

  test("toleranceFromReplays: rango de Recall@3 global y por contexto, determinista", () => {
    const meta = fixtureMeta();
    const cases = Array.from({ length: 12 }, (_, i) => replayCase(i));
    const a = toleranceFromReplays(cases, meta, { perturbations: 40, seed: 2 });
    const b = toleranceFromReplays(cases, meta, { perturbations: 40, seed: 2 });
    expect(a).toEqual(b);
    expect(a.recallAt3).toBeGreaterThanOrEqual(0);
    expect(a.byContextRecallAt3).toBeGreaterThanOrEqual(a.recallAt3 - 1e-9);
  });
});
