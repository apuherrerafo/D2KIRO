import { describe, expect, test } from "bun:test";
import { createIdleDraftState } from "../../apps/engine/src/draft/reducer";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { proposeFromCorpus, syntheticHardCounters } from "./propose-golden-cases";
import { loadGoldenDataset, GOLDEN_SCHEMA_VERSION } from "./golden";
import type { ReplayCase } from "./types";

function fixtureMeta(): MetaSnapshot {
  const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
  for (let i = 1; i <= 60; i++) heroes[i] = { id: i, localizedName: `H${i}`, roles: [] };
  const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
  for (let i = 1; i <= 60; i++) patchStats[i] = [{ patch: "60", bracket: "immortal", picks: i * 7, wins: i * 3 }];
  return { heroes, matchups: {}, patchStats, heroPool: [], personalBaselineWinrate: null } as unknown as MetaSnapshot;
}

function replayCase(matchId: string, radiant: number[], dire: number[], actual: number): ReplayCase {
  return {
    matchId,
    leagueId: 1,
    tier: "professional",
    turnIndex: radiant.length + dire.length,
    state: {
      ...createIdleDraftState(matchId),
      schema: "draft-state/v1",
      format: "captains_mode",
      patch: "60",
      localSide: "radiant",
      phase: "active",
      banned: [],
      picks: { radiant, dire },
      lastSeq: radiant.length + dire.length,
    },
    side: "radiant",
    actualHero: actual,
    action: "pick",
    decisionContext: "response_pick",
  };
}

describe("propose-golden-cases", () => {
  test("proposeFromCorpus: determinista, respeta target, ordena por informatividad", () => {
    const meta = fixtureMeta();
    const cases = Array.from({ length: 20 }, (_, i) => replayCase(`M${i}`, [1 + i, 2 + i], [30 + i, 31 + i], 40 + i));
    const a = proposeFromCorpus(cases, meta, 8);
    const b = proposeFromCorpus(cases, meta, 8);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    expect(a.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < a.length; i++) expect(a[i - 1]!.score).toBeGreaterThanOrEqual(a[i]!.score);
    for (const p of a) {
      expect(p.v6Top6.length).toBeLessThanOrEqual(6);
      expect(p.reason.length).toBeGreaterThan(5);
      expect(["hard_counter", "flexibility", "role_scarcity", "team_needs", "composition", "punishability", "historical_failure"]).toContain(p.suggestedStratum);
    }
  });

  test("syntheticHardCounters: genera estados con un hard-counter curado revelado en el rival", () => {
    const syn = syntheticHardCounters(fixtureMeta(), 4);
    expect(syn.length).toBeGreaterThan(0);
    expect(syn.length).toBeLessThanOrEqual(4);
    for (const s of syn) {
      expect(s.suggestedStratum).toBe("hard_counter");
      expect(s.actualPick).toBeNull();
      expect(s.state.picks.dire.length).toBeGreaterThan(0);
      expect(s.reason).toContain("hard counter curado");
    }
  });

  test("los estados propuestos pasan el type-guard de DraftState del loader del Golden", () => {
    const meta = fixtureMeta();
    const cases = Array.from({ length: 6 }, (_, i) => replayCase(`M${i}`, [1 + i], [30 + i, 31 + i], 40 + i));
    const props = [...syntheticHardCounters(meta, 2), ...proposeFromCorpus(cases, meta, 4)];

    // envolvemos cada estado propuesto en un caso Golden mínimo y lo validamos
    const raw = props.map((p, i) => ({
      id: `prop-${i}`,
      source: p.actualPick === null ? { kind: "synthetic", note: p.reason } : { kind: "replay", matchId: "x", turnIndex: 0 },
      state: p.state,
      side: p.side,
      decisionContext: p.decisionContext,
      strata: [p.suggestedStratum],
      labels: { excellent: [{ hero: 1, why: "placeholder" }], acceptable: [], bad: [] },
      reasoningTags: [],
      labeledAt: "2026-08-29T00:00:00Z",
      labeledBy: "test",
    }));
    const { cases: ok, rejected } = loadGoldenDataset({ schemaVersion: GOLDEN_SCHEMA_VERSION, cases: raw });
    expect(rejected).toHaveLength(0);
    expect(ok.length).toBe(raw.length);
  });
});
