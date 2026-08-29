import { describe, expect, test } from "bun:test";
import { createIdleDraftState } from "../../apps/engine/src/draft/reducer";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { BASELINE_IDS, OMITTED_BASELINES, RANKERS } from "./baselines";

function fixtureMeta(): MetaSnapshot {
  return {
    heroes: {
      1: { id: 1, localizedName: "Uno" },
      2: { id: 2, localizedName: "Dos" },
      3: { id: 3, localizedName: "Tres" },
      4: { id: 4, localizedName: "Cuatro" },
      5: { id: 5, localizedName: "Cinco" },
    },
    matchups: {},
    patchStats: {
      1: [{ patch: "60", bracket: "immortal", picks: 10, wins: 5 }],
      2: [{ patch: "60", bracket: "immortal", picks: 500, wins: 260 }],
      3: [{ patch: "60", bracket: "immortal", picks: 100, wins: 55 }],
    },
  } as unknown as MetaSnapshot;
}

function stateWith(bannedOrPicked: { banned?: number[]; radiant?: number[]; dire?: number[] }) {
  return {
    ...createIdleDraftState("bl"),
    phase: "active" as const,
    format: "all_pick" as const,
    localSide: "radiant" as const,
    banned: bannedOrPicked.banned ?? [],
    picks: { radiant: bannedOrPicked.radiant ?? [], dire: bannedOrPicked.dire ?? [] },
  };
}

describe("baselines", () => {
  test("ningún ranker propone un héroe baneado o pickeado", () => {
    const meta = fixtureMeta();
    const state = stateWith({ banned: [1], radiant: [2], dire: [3] });
    const taken = new Set([1, 2, 3]);
    for (const id of BASELINE_IDS) {
      const ranking = RANKERS[id](state, meta);
      for (const hero of ranking) expect(taken.has(hero)).toBe(false);
    }
  });

  test("patchMetaOnly ordena por picks del parche descendente", () => {
    const ranking = RANKERS.patchMetaOnly(stateWith({}), fixtureMeta());
    // 2 (500 picks) > 3 (100) > 1 (10) > 4,5 (0)
    expect(ranking.slice(0, 3)).toEqual([2, 3, 1]);
  });

  test("random es determinista para el mismo estado", () => {
    const meta = fixtureMeta();
    const s = stateWith({});
    expect(RANKERS.random(s, meta)).toEqual(RANKERS.random(s, meta));
  });

  test("v6Full devuelve un ranking (<= TOP_N) de héroes disponibles", () => {
    const meta = fixtureMeta();
    const state = stateWith({ radiant: [1], dire: [2] });
    const ranking = RANKERS.v6Full(state, meta);
    expect(ranking.length).toBeGreaterThan(0);
    expect(ranking.length).toBeLessThanOrEqual(6);
    for (const h of ranking) expect([1, 2].includes(h)).toBe(false);
  });

  test("positionFitOnly está documentado como omitido, con motivo", () => {
    expect(OMITTED_BASELINES.map((o) => o.id)).toContain("positionFitOnly");
    expect(OMITTED_BASELINES[0]!.reason.length).toBeGreaterThan(10);
  });
});
