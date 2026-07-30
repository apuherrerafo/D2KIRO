import { describe, expect, test } from "bun:test";
import type { DraftState } from "../draft/reducer";
import type { MetaSnapshot } from "../signals/types";
import { buildDraftPaths } from "./build-paths";
import type { HeroCapabilities } from "./types";

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
    updatedAt: "2026-07-30T00:00:00Z",
    ...overrides,
  };
}

function meta(heroIds: number[]): MetaSnapshot {
  const heroes: MetaSnapshot["heroes"] = {};
  for (const id of heroIds) heroes[id] = { id, localizedName: `Hero ${id}`, roles: [] };
  return { heroes, matchups: {} };
}

function capability(hero: number, overrides: Partial<HeroCapabilities>): HeroCapabilities {
  return {
    hero,
    damageType: "physical",
    hasInitiation: false,
    hasCatch: false,
    hasWaveclear: false,
    structuralDamage: "low",
    teamfight: "low",
    scaling: "low",
    ...overrides,
  };
}

describe("buildDraftPaths", () => {
  test("devuelve hasta 3 caminos viables sin tocar SignalContribution ni SCORING_WEIGHTS", () => {
    const result = buildDraftPaths(
      draftState({ picks: { radiant: [10], dire: [] } }),
      meta([1, 2, 3, 4, 5, 6, 10]),
      [
        capability(10, { damageType: "physical" }),
        capability(1, { structuralDamage: "high", hasWaveclear: true, hasCatch: true }),
        capability(2, { hasInitiation: true, teamfight: "high", damageType: "magical" }),
        capability(3, { hasCatch: true, hasInitiation: true }),
        capability(4, { scaling: "high", hasWaveclear: true, damageType: "magical" }),
        capability(5, { structuralDamage: "medium", hasWaveclear: true }),
        capability(6, { hasWaveclear: true, hasCatch: true }),
      ],
    );

    expect(result.schema).toBe("draft-paths/v1");
    expect(result.sessionId).toBe("s1");
    expect(result.basedOnSeq).toBe(7);
    expect(result.paths).toHaveLength(3);
    expect(result.paths.map((path) => path.archetype)).toEqual(["push", "teamfight", "pickoff"]);
    expect(result.paths[0]!.nextPick.hero).toBe(1);
    expect(result.paths[0]!.followUps).toHaveLength(2);
  });

  test("excluye baneados, picks ya tomados y héroes sin capabilities", () => {
    const result = buildDraftPaths(
      draftState({ banned: [1], picks: { radiant: [10], dire: [2] } }),
      meta([1, 2, 3, 4, 10, 99]),
      [
        capability(10, { damageType: "physical" }),
        capability(1, { structuralDamage: "high", hasWaveclear: true }),
        capability(2, { hasInitiation: true, teamfight: "high" }),
        capability(3, { hasCatch: true, hasInitiation: true }),
        capability(4, { scaling: "high", hasWaveclear: true }),
      ],
    );

    const heroes = result.paths.flatMap((path) => [path.nextPick.hero, ...path.followUps.map((step) => step.hero)]);
    expect(heroes).not.toContain(1);
    expect(heroes).not.toContain(2);
    expect(heroes).not.toContain(10);
    expect(heroes).not.toContain(99);
  });

  test("con localSide unknown no inventa caminos", () => {
    const result = buildDraftPaths(draftState({ localSide: "unknown" }), meta([1]), [capability(1, { hasCatch: true })]);

    expect(result.paths).toEqual([]);
  });
});
