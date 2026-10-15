import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { HeroPositions } from "../signals/hero-positions";
import { resolveLiveOwnPositions, type LiveLocalPlayerEvidence, type LiveOwnPickEvidence } from "./live-position-resolver";

// Live own hero -> position. Pure; inline positions and pools (S10: never the curated file).
//
// The rule these tests hold (docs/agents/live-contract.md, truths 1-3): a hero is bound to a position ONLY by
// EXPLICIT evidence (a source stated it) or LOCAL_PLAYER (the Player's declared seat + GSI's local hero). Pools and
// curated role data are handed over on purpose in most cases below -- and must never bind anything.

const share = (position: Position, matches: number) => ({ position, matches });
const POSITIONS: HeroPositions = {
  11: [share(1, 1000)], // carry only
  12: [share(1, 700), share(2, 900)], // carry / mid
  21: [share(2, 1000)], // mid only
  31: [share(3, 1000)], // offlane only
  32: [share(3, 600), share(4, 500)], // offlane / soft support
  41: [share(4, 1000)], // soft support only
  42: [share(4, 600), share(5, 500)], // soft / hard support
  51: [share(5, 1000)], // hard support only
};
const POOLS: Partial<Record<Position, readonly number[]>> = { 1: [11, 12], 2: [21, 12], 3: [31, 32], 4: [32, 41, 42], 5: [51, 42] };

function picks(...heroes: (number | [number, Position])[]): LiveOwnPickEvidence[] {
  return heroes.map((hero) => (Array.isArray(hero) ? { heroId: hero[0], explicitPosition: hero[1] } : { heroId: hero, explicitPosition: null }));
}

function resolve(ownPicks: LiveOwnPickEvidence[], localPlayer: LiveLocalPlayerEvidence | null = null, pools: Partial<Record<Position, readonly number[]>> | null = POOLS, heroPositions: HeroPositions = POSITIONS) {
  return resolveLiveOwnPositions({ ownPicks, localPlayer, playerPoolsByPosition: pools, heroPositions });
}

describe("resolveLiveOwnPositions -- pools and role data are never identity", () => {
  test("a hero only the Pos 5 pool lists stays UNRESOLVED (was UNIQUE_POOL)", () => {
    const result = resolve(picks(51));
    expect(result.heroes).toEqual([{ heroId: 51, position: null, provenance: "UNRESOLVED", possiblePositions: [1, 2, 3, 4, 5] }]);
    expect(result.necessarilyOccupied).toEqual([]);
    expect(result.possiblyOccupied).toEqual([1, 2, 3, 4, 5]);
  });

  test("a second pick does not disambiguate the first through the pools: both stay UNRESOLVED (was JOINT_INFERENCE)", () => {
    // 31 is only in the Pos 3 pool and 32 is Pos 3 / Pos 4: the old resolver called 32 "the Pos 4". Nobody said so.
    const result = resolve(picks(32, 31));
    expect(result.heroes.map((hero) => [hero.heroId, hero.position, hero.provenance])).toEqual([[32, null, "UNRESOLVED"], [31, null, "UNRESOLVED"]]);
    expect(result.necessarilyOccupied).toEqual([]);
  });

  test("a hero credible at exactly one free position is not bound to it", () => {
    const result = resolve(picks(31), null, { 1: [11], 2: [21], 4: [41], 5: [51] });
    expect(result.heroes[0]).toMatchObject({ heroId: 31, position: null, provenance: "UNRESOLVED" });
  });

  test("the same picks resolve identically with, without and with different pools / role data", () => {
    const picked = picks(12, 42, 21, 32, 41);
    const withEvidence = resolve(picked);
    expect(resolve(picked, null, null, {})).toEqual(withEvidence);
    expect(resolve(picked, null, { 1: [41], 2: [42] }, POSITIONS)).toEqual(withEvidence);
    expect(withEvidence.heroes.every((hero) => hero.provenance === "UNRESOLVED" && hero.position === null)).toBe(true);
  });

  test("five unresolved heroes still occupy all five positions (a set fact), without a single identity", () => {
    const result = resolve(picks(12, 42, 21, 32, 41));
    expect(result.necessarilyOccupied).toEqual([1, 2, 3, 4, 5]);
    expect(result.heroes.every((hero) => hero.possiblePositions.length === 5)).toBe(true);
  });
});

describe("resolveLiveOwnPositions -- explicit positions", () => {
  test("an explicit position is a fact and nothing overwrites it", () => {
    const result = resolve(picks([51, 3]));
    expect(result.heroes[0]).toEqual({ heroId: 51, position: 3, provenance: "EXPLICIT", possiblePositions: [3] });
  });

  test("an explicit position removes that position from every unresolved hero's possibilities", () => {
    const result = resolve(picks([31, 3], 32));
    expect(result.heroes).toEqual([
      { heroId: 31, position: 3, provenance: "EXPLICIT", possiblePositions: [3] },
      { heroId: 32, position: null, provenance: "UNRESOLVED", possiblePositions: [1, 2, 4, 5] },
    ]);
  });

  test("four stated positions: the fifth hero is UNRESOLVED -- the position is occupied, the identity is not deduced", () => {
    const result = resolve(picks([11, 1], [21, 2], [31, 3], [41, 4], 77), null, null, {});
    expect(result.heroes[4]).toEqual({ heroId: 77, position: null, provenance: "UNRESOLVED", possiblePositions: [5] });
    expect(result.necessarilyOccupied).toEqual([1, 2, 3, 4, 5]);
  });

  test("with 1/2/5 stated, two unknown heroes occupy {3, 4} between them and neither is told apart", () => {
    const result = resolve(picks([11, 1], [21, 2], [51, 5], 31, 41));
    expect(result.necessarilyOccupied).toEqual([1, 2, 3, 4, 5]);
    expect(result.heroes.slice(3)).toEqual([
      { heroId: 31, position: null, provenance: "UNRESOLVED", possiblePositions: [3, 4] },
      { heroId: 41, position: null, provenance: "UNRESOLVED", possiblePositions: [3, 4] },
    ]);
  });

  test("two picks stating the SAME position: the first statement wins, the second is unresolved, never a double bind", () => {
    const result = resolve(picks([31, 3], [32, 3]));
    expect(result.heroes.map((hero) => [hero.heroId, hero.position, hero.provenance])).toEqual([[31, 3, "EXPLICIT"], [32, null, "UNRESOLVED"]]);
  });
});

describe("resolveLiveOwnPositions -- LOCAL_PLAYER (declared seat + GSI's local hero)", () => {
  test("the declared position and the local hero bind exactly that hero", () => {
    const result = resolve(picks(39), { position: 2, heroId: 39 });
    expect(result.heroes).toEqual([{ heroId: 39, position: 2, provenance: "LOCAL_PLAYER", possiblePositions: [2] }]);
    expect(result.necessarilyOccupied).toEqual([2]);
  });

  test("only the local hero is bound: a teammate in the same pool as the declared seat is NOT (Earthshaker is not Pos 2)", () => {
    const result = resolve(picks(7, 39), { position: 2, heroId: 39 }, { 2: [39, 7] });
    expect(result.heroes).toEqual([
      { heroId: 7, position: null, provenance: "UNRESOLVED", possiblePositions: [1, 3, 4, 5] },
      { heroId: 39, position: 2, provenance: "LOCAL_PLAYER", possiblePositions: [2] },
    ]);
  });

  test("no declared position -> nothing binds, even with the local hero known", () => {
    expect(resolve(picks(39), { position: null, heroId: 39 }).heroes[0]).toMatchObject({ position: null, provenance: "UNRESOLVED" });
  });

  test("no local hero -> nothing binds, even with the position declared", () => {
    expect(resolve(picks(39), { position: 2, heroId: null }).heroes[0]).toMatchObject({ position: null, provenance: "UNRESOLVED" });
  });

  test("a local hero that is not one of our picks (not locked yet, or the other team's) binds nothing", () => {
    const result = resolve(picks(7), { position: 2, heroId: 39 });
    expect(result.heroes[0]).toMatchObject({ heroId: 7, position: null, provenance: "UNRESOLVED" });
    expect(result.necessarilyOccupied).toEqual([]);
  });

  test("X -> Y: the binding follows the CURRENT local hero, the previous one is unbound", () => {
    const first = resolve(picks(39, 7), { position: 2, heroId: 39 });
    const second = resolve(picks(39, 7), { position: 2, heroId: 7 });
    expect(first.heroes.map((hero) => [hero.heroId, hero.provenance])).toEqual([[39, "LOCAL_PLAYER"], [7, "UNRESOLVED"]]);
    expect(second.heroes.map((hero) => [hero.heroId, hero.provenance])).toEqual([[39, "UNRESOLVED"], [7, "LOCAL_PLAYER"]]);
    expect(second.heroes.filter((hero) => hero.provenance === "LOCAL_PLAYER")).toHaveLength(1);
  });

  test("changing the declared position moves the binding; clearing it removes it", () => {
    expect(resolve(picks(39), { position: 2, heroId: 39 }).heroes[0]).toMatchObject({ position: 2, provenance: "LOCAL_PLAYER" });
    expect(resolve(picks(39), { position: 4, heroId: 39 }).heroes[0]).toMatchObject({ position: 4, provenance: "LOCAL_PLAYER" });
    expect(resolve(picks(39), { position: null, heroId: 39 }).heroes[0]).toMatchObject({ position: null, provenance: "UNRESOLVED" });
  });

  test("a stated position for the local hero wins over the declared seat", () => {
    const result = resolve(picks([39, 3]), { position: 2, heroId: 39 });
    expect(result.heroes[0]).toEqual({ heroId: 39, position: 3, provenance: "EXPLICIT", possiblePositions: [3] });
    expect(result.necessarilyOccupied).toEqual([3]);
  });

  test("a declared seat another hero already holds by a stated position binds nobody (never one position for two heroes)", () => {
    const result = resolve(picks([31, 2], 39), { position: 2, heroId: 39 });
    expect(result.heroes.map((hero) => [hero.heroId, hero.position, hero.provenance])).toEqual([[31, 2, "EXPLICIT"], [39, null, "UNRESOLVED"]]);
  });

  test("the local hero narrows what is left for the others: a set constraint, not an identity", () => {
    const result = resolve(picks([11, 1], [21, 2], [51, 5], 39, 7), { position: 3, heroId: 39 });
    expect(result.heroes.slice(3)).toEqual([
      { heroId: 39, position: 3, provenance: "LOCAL_PLAYER", possiblePositions: [3] },
      { heroId: 7, position: null, provenance: "UNRESOLVED", possiblePositions: [4] },
    ]);
    expect(result.necessarilyOccupied).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("resolveLiveOwnPositions -- invariants", () => {
  test("no pools and no role data: one hero is unresolved and every position is possible", () => {
    const result = resolve(picks(77), null, null, {});
    expect(result.heroes[0]).toEqual({ heroId: 77, position: null, provenance: "UNRESOLVED", possiblePositions: [1, 2, 3, 4, 5] });
    expect(result.necessarilyOccupied).toEqual([]);
  });

  test("never one position for two heroes", () => {
    const result = resolve(picks([31, 3], [32, 3], 39, 7), { position: 3, heroId: 39 });
    const bound = result.heroes.flatMap((hero) => (hero.position === null ? [] : [hero.position]));
    expect(new Set(bound).size).toBe(bound.length);
  });

  test("no provenance other than EXPLICIT, LOCAL_PLAYER or UNRESOLVED exists", () => {
    const all = [resolve(picks(12, 42, 21, 32, 41)), resolve(picks([11, 1], 21), { position: 2, heroId: 21 }), resolve(picks(77), null, null, {})];
    const seen = new Set(all.flatMap((result) => result.heroes.map((hero) => hero.provenance)));
    expect([...seen].every((provenance) => ["EXPLICIT", "LOCAL_PLAYER", "UNRESOLVED"].includes(provenance))).toBe(true);
  });

  test("deterministic: same evidence, same resolution", () => {
    expect(resolve(picks(32, 12, 51), { position: 1, heroId: 12 })).toEqual(resolve(picks(32, 12, 51), { position: 1, heroId: 12 }));
  });
});
