import { describe, expect, test } from "bun:test";
import { assignmentBelongsToTeam, parseTeamAssignment, poolsByConfirmedPosition, withoutOwnerSeat, type SavedTeamMember } from "./team-positions";

// Pure unit tests (S3-style). Inline fixtures only: nothing here reads a real team or a real pool.

const carry: SavedTeamMember = { id: 10, position: 1, heroPool: [11, 12] };
const mid: SavedTeamMember = { id: 20, position: 2, heroPool: [21, 22] };
const offlane: SavedTeamMember = { id: 30, position: 3, heroPool: [31, 32] };

describe("poolsByConfirmedPosition -- usual position", () => {
  test("a pool lands on the member's confirmed position, whatever order the members are listed in", () => {
    expect(poolsByConfirmedPosition([offlane, carry, mid])).toEqual({ 1: [11, 12], 2: [21, 22], 3: [31, 32] });
  });

  test("an unconfirmed member (null / missing position) gets no pool -- the position is never guessed from the list", () => {
    const legacy: SavedTeamMember[] = [{ id: 1, position: null, heroPool: [11] }, { id: 2, heroPool: [21] }];
    expect(poolsByConfirmedPosition(legacy)).toEqual({});
  });

  test("a member without any hero gets no pool entry (no empty pool that would read as 'configured')", () => {
    expect(poolsByConfirmedPosition([{ id: 1, position: 4, heroPool: [] }])).toEqual({});
  });

  test("two members claiming the same position: neither is applied (nobody can say whose it is)", () => {
    const clash: SavedTeamMember[] = [{ id: 1, position: 2, heroPool: [21] }, { id: 2, position: 2, heroPool: [22] }, offlane];
    expect(poolsByConfirmedPosition(clash)).toEqual({ 3: [31, 32] });
  });
});

describe("poolsByConfirmedPosition -- this match's assignment", () => {
  // F0 guard: a pool is the player's pool FOR THEIR CONFIRMED POSITION. Moving them elsewhere never carries it along.
  test("swapping two players leaves BOTH without a pool: neither pool is stored for the seat they moved to", () => {
    const swapped = new Map([[10, 1 as const], [20, 3 as const], [30, 2 as const]]);
    expect(poolsByConfirmedPosition([carry, mid, offlane], swapped)).toEqual({ 1: [11, 12] });
  });

  test("a carry moved to Pos 5 does not apply the carry pool there; back on the usual position the pool returns", () => {
    const hardSupport: SavedTeamMember = { id: 50, position: 5, heroPool: [51, 52] };
    const moved = new Map([[10, 5 as const], [50, 1 as const]]);
    expect(poolsByConfirmedPosition([carry, hardSupport], moved)).toEqual({});
    const home = new Map([[10, 1 as const], [50, 5 as const]]);
    expect(poolsByConfirmedPosition([carry, hardSupport], home)).toEqual({ 1: [11, 12], 5: [51, 52] });
    expect(poolsByConfirmedPosition([carry, hardSupport])).toEqual({ 1: [11, 12], 5: [51, 52] });
  });

  test("the assignment is the whole picture: a member it doesn't name is unplaced, not silently back at their usual position", () => {
    const onlyCarryAndOfflane = new Map([[10, 1 as const], [30, 3 as const]]);
    expect(poolsByConfirmedPosition([carry, mid, offlane], onlyCarryAndOfflane)).toEqual({ 1: [11, 12], 3: [31, 32] });
  });

  test("an unconfirmed (legacy) member placed for a match applies no pool, and the saved row is untouched", () => {
    const legacy: SavedTeamMember = { id: 40, position: null, heroPool: [41, 42] };
    expect(poolsByConfirmedPosition([legacy], new Map([[40, 4 as const]]))).toEqual({});
    expect(legacy.position).toBeNull();
    expect(legacy.heroPool).toEqual([41, 42]);
  });

  test("an empty assignment places nobody", () => {
    expect(poolsByConfirmedPosition([carry, mid], new Map())).toEqual({});
  });
});

describe("poolsByConfirmedPosition -- live and simulator share the rule", () => {
  // Live calls it with no assignment, the simulator with this match's: the same people on their usual seats must agree.
  test("no assignment and an assignment that keeps everybody on their usual seat give the same pools", () => {
    const team = [carry, mid, offlane, { id: 40, position: null, heroPool: [41] }];
    const usual = new Map([[10, 1 as const], [20, 2 as const], [30, 3 as const]]);
    expect(poolsByConfirmedPosition(team, usual)).toEqual(poolsByConfirmedPosition(team));
  });
});

describe("poolsByConfirmedPosition -- the owner", () => {
  test("the owner's seat never carries a team pool; every other seat keeps theirs", () => {
    expect(poolsByConfirmedPosition([carry, mid, offlane], null, 2)).toEqual({ 1: [11, 12], 3: [31, 32] });
  });
});

describe("withoutOwnerSeat", () => {
  const pools = { 1: [11], 2: [21] } as const;
  test("drops only the declared seat", () => {
    expect(withoutOwnerSeat(pools, 1)).toEqual({ 2: [21] });
  });
  test("no declared seat -> pools untouched", () => {
    expect(withoutOwnerSeat(pools, null)).toEqual(pools);
    expect(withoutOwnerSeat(pools, undefined)).toEqual(pools);
  });
  test("nothing left -> null (reads as 'no team pools'), and null stays null", () => {
    expect(withoutOwnerSeat({ 3: [31] }, 3)).toBeNull();
    expect(withoutOwnerSeat(null, 3)).toBeNull();
    expect(withoutOwnerSeat(undefined, 3)).toBeNull();
  });
});

describe("parseTeamAssignment", () => {
  test("absent / null -> undefined (use the saved positions)", () => {
    expect(parseTeamAssignment(undefined)).toBeUndefined();
    expect(parseTeamAssignment(null)).toBeUndefined();
  });

  test("a well-formed map -> memberId -> position", () => {
    expect(parseTeamAssignment({ "10": 3, "20": 1 })).toEqual(new Map([[10, 3], [20, 1]]));
  });

  test.each([
    ["an array", [1, 2]],
    ["a string", "10"],
    ["a position out of range", { "10": 6 }],
    ["position zero", { "10": 0 }],
    ["a numeric string as position", { "10": "2" }],
    ["a non-numeric member id", { abc: 2 }],
    ["a non-positive member id", { "0": 2 }],
    ["a fractional member id", { "1.5": 2 }],
    ["two members on one position", { "10": 2, "20": 2 }],
    ["more than five members", { "1": 1, "2": 2, "3": 3, "4": 4, "5": 5, "6": 1 }],
  ])("malformed (%s) -> null, so the route can refuse it", (_label, raw) => {
    expect(parseTeamAssignment(raw)).toBeNull();
  });
});

describe("assignmentBelongsToTeam", () => {
  test("every id must be a member of the loaded team", () => {
    expect(assignmentBelongsToTeam(new Map([[10, 1], [20, 2]]), [carry, mid, offlane])).toBe(true);
    expect(assignmentBelongsToTeam(new Map([[10, 1], [999, 2]]), [carry, mid, offlane])).toBe(false);
  });
});
