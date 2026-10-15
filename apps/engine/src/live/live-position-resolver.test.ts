import { describe, expect, test } from "bun:test";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { HeroPositions } from "../signals/hero-positions";
import { resolveLiveOwnPositions, type LiveOwnPickEvidence } from "./live-position-resolver";

// P0-2 -- live own hero -> position. Pure; inline positions and pools (S10: never the curated file).

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

function resolve(ownPicks: LiveOwnPickEvidence[], pools: Partial<Record<Position, readonly number[]>> | null = POOLS, heroPositions: HeroPositions = POSITIONS) {
  return resolveLiveOwnPositions({ ownPicks, playerPoolsByPosition: pools, heroPositions });
}

describe("resolveLiveOwnPositions -- evidence hierarchy", () => {
  test("a hero only the Pos 5 pool lists -> Pos 5 bound (UNIQUE_POOL)", () => {
    const result = resolve(picks(51));
    expect(result.heroes).toEqual([{ heroId: 51, position: 5, provenance: "UNIQUE_POOL", possiblePositions: [5] }]);
    expect(result.necessarilyOccupied).toEqual([5]);
    expect(result.possiblyOccupied).toEqual([]);
  });

  test("a second hero uniquely in the Pos 1 pool -> Pos 1 bound too", () => {
    const result = resolve(picks(51, 11));
    expect(result.heroes.map((hero) => [hero.heroId, hero.position, hero.provenance])).toEqual([[51, 5, "UNIQUE_POOL"], [11, 1, "UNIQUE_POOL"]]);
    expect(result.necessarilyOccupied).toEqual([1, 5]);
  });

  test("a flex hero in the Pos 3 AND Pos 4 pools is NOT guessed", () => {
    const result = resolve(picks(32));
    expect(result.heroes).toEqual([{ heroId: 32, position: null, provenance: "UNRESOLVED", possiblePositions: [3, 4] }]);
    expect(result.necessarilyOccupied).toEqual([]);
    expect(result.possiblyOccupied).toEqual([3, 4]);
  });

  test("a second pick disambiguates the joint assignment: both bind", () => {
    // 31 is only in the Pos 3 pool, so the flex 32 (Pos 3 / Pos 4) can only be the Pos 4.
    const result = resolve(picks(32, 31));
    expect(result.heroes.map((hero) => [hero.heroId, hero.position, hero.provenance])).toEqual([[32, 4, "JOINT_INFERENCE"], [31, 3, "UNIQUE_POOL"]]);
    expect(result.necessarilyOccupied).toEqual([3, 4]);
    expect(result.possiblyOccupied).toEqual([]);
  });

  test("a hero outside every pool but credible at exactly one free position -> JOINT_INFERENCE", () => {
    const result = resolve(picks(31), { 1: [11], 2: [21], 4: [41], 5: [51] });
    expect(result.heroes).toEqual([{ heroId: 31, position: 3, provenance: "JOINT_INFERENCE", possiblePositions: [3] }]);
  });

  test("a hero outside every pool and credible at two free positions stays UNRESOLVED", () => {
    const result = resolve(picks(12), { 3: [31], 4: [41], 5: [51] });
    expect(result.heroes[0]).toEqual({ heroId: 12, position: null, provenance: "UNRESOLVED", possiblePositions: [1, 2] });
    expect(result.possiblyOccupied).toEqual([1, 2]);
  });

  test("two unresolved flex heroes covering Pos 3 / Pos 4 between them occupy BOTH, whichever is which", () => {
    const result = resolve(picks(32, 32 + 100), { 3: [31, 32, 132], 4: [32, 132, 41] }, { ...POSITIONS, 132: POSITIONS[32]! });
    expect(result.heroes.every((hero) => hero.provenance === "UNRESOLVED")).toBe(true);
    expect(result.necessarilyOccupied).toEqual([3, 4]);
    expect(result.possiblyOccupied).toEqual([]);
  });

  test("five own heroes -> five distinct positions when the evidence admits one solution", () => {
    const result = resolve(picks(12, 42, 21, 32, 41));
    // 21 -> 2 (only pool 2), so 12 -> 1; 41 is in the Pos 4 pool only, so 32 -> 3, and 42 -> 5.
    expect(result.heroes.map((hero) => [hero.heroId, hero.position])).toEqual([[12, 1], [42, 5], [21, 2], [32, 3], [41, 4]]);
    expect(new Set(result.heroes.map((hero) => hero.position)).size).toBe(5);
    expect(result.heroes.every((hero) => hero.provenance !== "UNRESOLVED")).toBe(true);
    expect(result.necessarilyOccupied).toEqual([1, 2, 3, 4, 5]);
  });
});

describe("resolveLiveOwnPositions -- invariants", () => {
  test("an explicit position is never overwritten by inference", () => {
    const result = resolve(picks([51, 3]));
    expect(result.heroes[0]).toEqual({ heroId: 51, position: 3, provenance: "EXPLICIT", possiblePositions: [3] });
  });

  test("an explicit position removes that position from every inferred hero", () => {
    // 32 is Pos 3 / Pos 4 by pool; Pos 3 is stated for 31, so 32 must be the Pos 4.
    const result = resolve(picks([31, 3], 32));
    expect(result.heroes.map((hero) => [hero.heroId, hero.position, hero.provenance])).toEqual([[31, 3, "EXPLICIT"], [32, 4, "JOINT_INFERENCE"]]);
  });

  test("never one position for two heroes, even when only one pool lists both", () => {
    const result = resolve(picks(51, 151), { 5: [51, 151] }, { ...POSITIONS, 151: [share(5, 1000)] });
    const bound = result.heroes.flatMap((hero) => (hero.position === null ? [] : [hero.position]));
    expect(new Set(bound).size).toBe(bound.length);
    // The pool tier admits no assignment (both only Pos 5): the domains relax, nothing is invented.
    expect(result.heroes.every((hero) => hero.provenance !== "UNIQUE_POOL")).toBe(true);
  });

  test("no pools and no role data: only what the facts force (nothing for one hero)", () => {
    const result = resolve(picks(77), null, {});
    expect(result.heroes[0]!.provenance).toBe("UNRESOLVED");
    expect(result.heroes[0]!.possiblePositions).toEqual([1, 2, 3, 4, 5]);
    expect(result.necessarilyOccupied).toEqual([]);
  });

  test("four stated positions force the fifth hero onto the last one", () => {
    const result = resolve(picks([11, 1], [21, 2], [31, 3], [41, 4], 77), null, {});
    expect(result.heroes[4]).toEqual({ heroId: 77, position: 5, provenance: "JOINT_INFERENCE", possiblePositions: [5] });
  });

  test("two picks stating the SAME position: the first statement wins, the second is inferred, never a double bind", () => {
    const result = resolve(picks([31, 3], [32, 3]));
    expect(result.heroes.map((hero) => [hero.heroId, hero.position, hero.provenance])).toEqual([[31, 3, "EXPLICIT"], [32, 4, "JOINT_INFERENCE"]]);
  });

  test("deterministic: same evidence, same resolution", () => {
    expect(resolve(picks(32, 12, 51))).toEqual(resolve(picks(32, 12, 51)));
  });
});
