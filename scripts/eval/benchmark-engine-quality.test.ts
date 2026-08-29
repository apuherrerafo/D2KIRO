import { describe, expect, test } from "bun:test";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { runEngineQuality, hydrateState, type EngineQualityResult } from "./benchmark-engine-quality";
import { loadGoldenDataset, GOLDEN_SCHEMA_VERSION, type GoldenCase } from "./golden";

function fixtureMeta(): MetaSnapshot {
  const heroes: Record<number, { id: number; localizedName: string }> = {};
  for (let i = 1; i <= 20; i++) heroes[i] = { id: i, localizedName: `H${i}` };
  return { heroes, matchups: {}, patchStats: {} } as unknown as MetaSnapshot;
}

function rawCase(id: string, o: Partial<Record<string, unknown>>): Record<string, unknown> {
  return {
    id,
    source: { kind: "synthetic", note: "fixture" },
    state: {
      schema: "draft-state/v1",
      format: "all_pick",
      patch: "60",
      localSide: "radiant",
      phase: "active",
      banned: [],
      picks: { radiant: [], dire: [] },
      lastSeq: 0,
    },
    side: "radiant",
    decisionContext: "response_pick",
    strata: ["hard_counter"],
    labels: { excellent: [{ hero: 5, why: "x" }], acceptable: [], bad: [] },
    reasoningTags: [],
    labeledAt: "2026-08-29T00:00:00Z",
    labeledBy: "t",
    ...o,
  };
}

function cases(...raw: Record<string, unknown>[]): GoldenCase[] {
  const { cases: c, rejected } = loadGoldenDataset({ schemaVersion: GOLDEN_SCHEMA_VERSION, cases: raw });
  if (rejected.length > 0) throw new Error(`fixture inválido: ${JSON.stringify(rejected)}`);
  return c;
}

describe("runEngineQuality — Benchmark A", () => {
  test("estructura: NDCG@5, Bad Pick Rate@5 y Pairwise por ranker, segmentados por contexto y estrato", () => {
    const gc = cases(
      rawCase("c1", { decisionContext: "team_opening", strata: ["role_scarcity"] }),
      rawCase("c2", { decisionContext: "response_pick", strata: ["hard_counter", "team_needs"] }),
      rawCase("c3", { decisionContext: "closing_pick", strata: ["composition"] }),
    );
    const res: EngineQualityResult = runEngineQuality(gc, fixtureMeta(), { bootstrapIterations: 50 });

    expect(res.valid).toBe(true);
    expect(res.constraintViolationRate).toBe(0);
    for (const b of ["random", "patchMetaOnly", "v6NoCuratedCounters", "v6Full"] as const) {
      const seg = res.perRanker[b];
      expect(seg.overall.n).toBe(3);
      expect(seg.overall.ndcg5).toBeGreaterThanOrEqual(0);
      expect(seg.overall.ndcg5).toBeLessThanOrEqual(1);
      // c2 aporta a dos estratos
      expect(seg.byStratum.hard_counter.n).toBe(1);
      expect(seg.byStratum.team_needs.n).toBe(1);
      expect(seg.byDecisionContext.team_opening.n).toBe(1);
    }
    expect(res.bootstrap?.metric).toBe("NDCG@5");
  });

  test("3 excellent puestos 1-2-3 por el ranking -> NDCG@5 == 1", () => {
    const gc = cases(
      rawCase("perfect", {
        state: {
          schema: "draft-state/v1",
          format: "all_pick",
          patch: "60",
          localSide: "radiant",
          phase: "active",
          banned: [],
          // dejamos 1,2,3 libres; el resto pickeados para que el ranking los priorice
          picks: { radiant: [10, 11, 12, 13, 14], dire: [15, 16, 17, 18, 19] },
          lastSeq: 20,
        },
        labels: {
          excellent: [
            { hero: 1, why: "a" },
            { hero: 2, why: "b" },
            { hero: 3, why: "c" },
          ],
          acceptable: [],
          bad: [],
        },
      }),
    );
    // ranker sintético que devuelve exactamente [1,2,3]
    const res = runEngineQuality(gc, fixtureMeta(), {
      bootstrapIterations: 10,
      rankers: { v6Full: () => [1, 2, 3] },
    });
    expect(res.perRanker.v6Full.overall.ndcg5).toBeCloseTo(1, 5);
  });

  test("un bad en el top-1 -> Bad Pick Rate@5 alto y visible en el segmento", () => {
    const gc = cases(
      rawCase("risky", {
        strata: ["punishability"],
        labels: {
          excellent: [{ hero: 2, why: "bien" }],
          acceptable: [],
          bad: [{ hero: 1, why: "trampa" }],
        },
      }),
    );
    const res = runEngineQuality(gc, fixtureMeta(), {
      bootstrapIterations: 10,
      rankers: { v6Full: () => [1, 2] }, // bad primero
    });
    expect(res.perRanker.v6Full.overall.badPickRate5).toBeGreaterThanOrEqual(0.2);
    expect(res.perRanker.v6Full.byStratum.punishability.badPickRate5).toBeGreaterThanOrEqual(0.2);
  });

  test("gate duro: ranker que devuelve un héroe pickeado invalida la corrida", () => {
    const gc = cases(
      rawCase("g", {
        state: {
          schema: "draft-state/v1",
          format: "all_pick",
          patch: "60",
          localSide: "radiant",
          phase: "active",
          banned: [],
          picks: { radiant: [7], dire: [] },
          lastSeq: 1,
        },
      }),
    );
    const res = runEngineQuality(gc, fixtureMeta(), { rankers: { random: () => [7] } });
    expect(res.valid).toBe(false);
    expect(res.perRanker).toEqual({});
    expect(res.violations[0]!.why).toContain("baneado o pickeado");
  });

  test("hydrateState produce un DraftState completo", () => {
    const gc = cases(rawCase("h", {}));
    const s = hydrateState(gc[0]!);
    expect(s.schema).toBe("draft-state/v1");
    expect(Array.isArray(s.appliedEventIds)).toBe(true);
    expect(s.quality.captureStatus).toBe("ok");
  });

  test("determinismo: dos corridas idénticas -> resultado idéntico", () => {
    const gc = cases(rawCase("d1", {}), rawCase("d2", { decisionContext: "team_opening" }));
    const a = runEngineQuality(gc, fixtureMeta(), { bootstrapIterations: 100 });
    const b = runEngineQuality(gc, fixtureMeta(), { bootstrapIterations: 100 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
