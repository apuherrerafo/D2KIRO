import { describe, expect, test } from "bun:test";
import { createIdleDraftState } from "../../apps/engine/src/draft/reducer";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { profileFromStates } from "./profile-signals";

function fixtureMeta(): MetaSnapshot {
  const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
  for (let i = 1; i <= 25; i++) heroes[i] = { id: i, localizedName: `H${i}`, roles: ["Carry"] };
  const matchups: Record<number, { vsHero: number; games: number; wins: number }[]> = {
    3: [
      { vsHero: 20, games: 400, wins: 260 },
      { vsHero: 21, games: 400, wins: 180 },
    ],
  };
  const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
  for (let i = 1; i <= 25; i++) patchStats[i] = [{ patch: "60", bracket: "immortal", picks: i * 10, wins: i * 5 }];
  return { heroes, matchups, patchStats, heroPool: [], personalBaselineWinrate: null } as unknown as MetaSnapshot;
}

function state(picks: { radiant?: number[]; dire?: number[] }) {
  return {
    ...createIdleDraftState("p"),
    schema: "draft-state/v1" as const,
    format: "captains_mode" as const,
    patch: "60",
    localSide: "radiant" as const,
    phase: "active" as const,
    banned: [] as number[],
    picks: { radiant: picks.radiant ?? [], dire: picks.dire ?? [] },
    lastSeq: 4,
  };
}

describe("profileFromStates — perfil de señales (C5)", () => {
  const meta = fixtureMeta();
  const states = [
    { state: state({ radiant: [1], dire: [20, 21] }), ctx: "response_pick" as const },
    { state: state({ radiant: [1, 2], dire: [20, 21] }), ctx: "response_pick" as const },
    { state: state({ radiant: [1, 2, 3, 4], dire: [20, 21, 22, 23] }), ctx: "closing_pick" as const },
  ];

  test("emite las 6 señales con pendiente efectiva, SD intra-estado, influencia realizada y tasa null", () => {
    const r = profileFromStates(states, meta);
    expect(r.signals).toHaveLength(6);
    for (const s of r.signals) {
      expect(s.effectiveSlope).toBeGreaterThan(0);
      expect(s.meanIntraStateSD).toBeGreaterThanOrEqual(0);
      expect(s.realizedInfluence).toBeCloseTo(s.effectiveSlope * s.meanIntraStateSD, 6);
      expect(s.rawNullRate).toBeGreaterThanOrEqual(0);
      expect(s.rawNullRate).toBeLessThanOrEqual(1);
    }
  });

  test("pendiente efectiva coincide con 100·w/(b−a): counter=90, patch_meta=29.25", () => {
    const r = profileFromStates(states, meta);
    const counter = r.signals.find((s) => s.signal === "counter")!;
    const patch = r.signals.find((s) => s.signal === "patch_meta")!;
    expect(counter.effectiveSlope).toBeCloseTo((100 * 0.216) / 0.24, 3); // [-0.12,0.12] -> rango 0.24
    expect(patch.effectiveSlope).toBeCloseTo((100 * 0.117) / 0.4, 3); // [0.3,0.7] -> rango 0.4
  });

  test("hero_pool_fit sin pool configurado -> applicableFalseRate alto", () => {
    const r = profileFromStates(states, meta);
    const hp = r.signals.find((s) => s.signal === "hero_pool_fit")!;
    expect(hp.applicableFalseRate).toBeGreaterThan(0.5);
  });

  test("ablación: entrada por señal, desglosada por los 4 contextos", () => {
    const r = profileFromStates(states, meta);
    expect(r.ablation).toHaveLength(6);
    for (const a of r.ablation) {
      expect(Object.keys(a.byContext).sort()).toEqual(["blind_second_pick", "closing_pick", "response_pick", "team_opening"]);
      expect(a.meanAbsDelta).toBeGreaterThanOrEqual(0);
    }
  });

  test("histograma de nº de señales con voto suma 1 y tiene 7 celdas (0..6)", () => {
    const r = profileFromStates(states, meta);
    expect(r.voteCountHistogram).toHaveLength(7);
    expect(r.voteCountHistogram.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 6);
  });

  test("determinismo: misma entrada -> mismo resultado", () => {
    const a = profileFromStates(states, meta);
    const b = profileFromStates(states, meta);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });
});
