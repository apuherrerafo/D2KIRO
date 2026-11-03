import { describe, expect, test } from "bun:test";
import { poolsByConfirmedPosition, type SavedTeamMember } from "./team-positions";

// Hero Pools V2 / F2 -- the resolver: pool = member.id + SEAT. Pure, inline fixtures (S10-family: no curated file read).

const carry: SavedTeamMember = {
  id: 1,
  position: 1,
  heroPool: [11, 12], // legacy single list
  positionPools: [
    { position: 1, heroPool: [11, 12] },
    { position: 5, heroPool: [51, 52] },
  ],
};
const mid: SavedTeamMember = { id: 2, position: 2, heroPool: [21], positionPools: [{ position: 2, heroPool: [21] }] };

describe("resolver: the pool of the seat played THIS match activates", () => {
  test("usual seat: the carry's Pos 1 pool", () => {
    expect(poolsByConfirmedPosition([carry])).toEqual({ 1: [11, 12] });
  });

  test("moved to Pos 5 with an assignment: Pos 5's own pool activates, Pos 1's pool does not travel", () => {
    expect(poolsByConfirmedPosition([carry], new Map([[1, 5]]))).toEqual({ 5: [51, 52] });
  });

  test("moved to a seat with NO pool: that seat has none -- another seat's pool is never borrowed", () => {
    expect(poolsByConfirmedPosition([carry], new Map([[1, 3]]))).toEqual({});
  });

  test("a two-person swap hands each one the pool of the seat they now occupy", () => {
    const both: SavedTeamMember[] = [
      { ...carry, positionPools: [...carry.positionPools!, { position: 2, heroPool: [91] }] },
      { ...mid, positionPools: [...mid.positionPools!, { position: 1, heroPool: [92] }] },
    ];
    expect(poolsByConfirmedPosition(both, new Map([[1, 2], [2, 1]]))).toEqual({ 2: [91], 1: [92] });
  });
});

describe("resolver: legacy rows and the legacy list", () => {
  test("a pre-V2 row (no positionPools) keeps its legacy pool at its confirmed usual seat", () => {
    const legacy: SavedTeamMember = { id: 3, position: 4, heroPool: [41, 42] };
    expect(poolsByConfirmedPosition([legacy])).toEqual({ 4: [41, 42] });
  });

  test("a pre-V2 row moved to another seat gets nothing there (legacy never travels)", () => {
    const legacy: SavedTeamMember = { id: 3, position: 4, heroPool: [41, 42] };
    expect(poolsByConfirmedPosition([legacy], new Map([[3, 5]]))).toEqual({});
  });

  test("a pool row shadows the legacy list at the usual seat", () => {
    const edited: SavedTeamMember = { id: 3, position: 4, heroPool: [41, 42], positionPools: [{ position: 4, heroPool: [43] }] };
    expect(poolsByConfirmedPosition([edited])).toEqual({ 4: [43] });
  });

  test("an EMPTY pool row means 'no pool for this seat': the legacy list does not come back", () => {
    const cleared: SavedTeamMember = { id: 3, position: 4, heroPool: [41, 42], positionPools: [{ position: 4, heroPool: [] }] };
    expect(poolsByConfirmedPosition([cleared])).toEqual({});
  });

  test("changing the USUAL position never re-aims the legacy list: once a member has pool rows, a seat without a row has none", () => {
    const moved: SavedTeamMember = { id: 3, position: 5, heroPool: [1, 2], positionPools: [{ position: 4, heroPool: [1, 2] }] };
    expect(poolsByConfirmedPosition([moved])).toEqual({});
    expect(poolsByConfirmedPosition([moved], new Map([[3, 4]]))).toEqual({ 4: [1, 2] }); // its own seat still works
  });

  test("an unconfirmed member gets no usual-seat pool; only an assignment plus a pool row for that seat places them", () => {
    const unconfirmed: SavedTeamMember = { id: 6, position: null, heroPool: [61], positionPools: [{ position: 3, heroPool: [31] }] };
    expect(poolsByConfirmedPosition([unconfirmed])).toEqual({});
    expect(poolsByConfirmedPosition([unconfirmed], new Map([[6, 3]]))).toEqual({ 3: [31] });
    expect(poolsByConfirmedPosition([unconfirmed], new Map([[6, 2]]))).toEqual({});
  });
});

describe("resolver: owner seat and contested seats are unchanged by V2", () => {
  test("the owner's declared seat never receives a teammate pool", () => {
    expect(poolsByConfirmedPosition([carry, mid], null, 1)).toEqual({ 2: [21] });
  });

  test("a seat claimed by two members with pools stays without a pool", () => {
    const twin: SavedTeamMember = { id: 9, position: 3, heroPool: [], positionPools: [{ position: 1, heroPool: [99] }] };
    expect(poolsByConfirmedPosition([carry, twin], new Map([[1, 1], [9, 1]]))).toEqual({});
  });
});

describe("D2: DB-sourced members (positionPools present) never fall back to the legacy list", () => {
  test("a member read from the DB with NO pool rows and a usual seat has no pool: legacy waits for explicit confirmation", () => {
    const waiting: SavedTeamMember = { id: 7, position: 3, heroPool: [31, 32], positionPools: [] };
    expect(poolsByConfirmedPosition([waiting])).toEqual({});
    expect(poolsByConfirmedPosition([waiting], new Map([[7, 1]]))).toEqual({});
  });
});
