import { describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { readFileSync } from "fs";
import { join } from "path";
import { getTeamGroup } from "../../db/queries";
import { createGsiLinkTestDb } from "../../live/gsi.fixtures";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";
import { createTeamGroupRoutes } from "./team-groups";

// Hero Pools V2 / F2 -- up to 5 pools per saved teammate (member.id + position), through the REAL routes and a REAL
// in-memory SQLite. Pool heroes identify owner AND seat: 1x = Pos 1 pool, 5x = Pos 5 pool, 2x = Pos 2 pool...

const A = 101;
const B = 202;
const KNOWN = [11, 12, 13, 14, 15, 16, 21, 22, 31, 32, 41, 42, 51, 52, 53];
const LEGACY: Record<number, number[]> = { 1: [11, 12], 2: [21, 22], 3: [31, 32], 4: [41, 42], 5: [51, 52] };

type Saved = {
  id: number;
  members: { id: number; slot: number; position: number | null; name: string; heroPool: number[]; positionPools: { position: number; heroPool: number[]; version: number }[] }[];
};

function setup() {
  const { db, sqlite } = createGsiLinkTestDb();
  sqlite.exec(`
    CREATE TABLE heroes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL, img_url TEXT NOT NULL, primary_attr TEXT NOT NULL, attack_type TEXT NOT NULL, roles TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL, party_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, position INTEGER, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_member_position_pools (member_id INTEGER NOT NULL, position INTEGER NOT NULL, hero_pool TEXT NOT NULL, version INTEGER NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (member_id, position));
  `);
  const insertHero = sqlite.prepare("INSERT INTO heroes VALUES (?, 'h', 'H', 'x', 'str', 'Melee', '[]', '2026-10-04')");
  for (const id of KNOWN) insertHero.run(id);

  const teams = createTeamGroupRoutes({ db });
  const store = new ProtocolSessionStore();
  const sessions = createProtocolSessionRoutes({
    store,
    computeSuggestions: async () => {
      throw new Error("not used");
    },
    heroPositions: {},
    loadTeamGroup: async (id, accountId) => (accountId === null ? null : getTeamGroup(db, id, accountId)),
  });

  async function saveTeam(account: number, members: { position: number | null; heroPool: number[] }[]) {
    const body = { name: "Team", partySize: 5, members: members.map((m, i) => ({ slot: i + 1, name: `P${i + 1}`, ...m })) };
    const response = await teams.post(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body) }), account);
    expect(response.status).toBe(201);
    return (await response.json()) as Saved;
  }
  async function putTeam(account: number, id: number, body: unknown) {
    return teams.put(new Request("http://127.0.0.1/x", { method: "PUT", body: JSON.stringify(body) }), id, account);
  }
  async function putPool(account: number, teamId: number, memberId: number, position: number, body: unknown) {
    const path = teams.parsePoolPath(`/api/team-groups/${teamId}/members/${memberId}/pools/${position}`);
    expect(path).not.toBeNull();
    return teams.putPool(new Request("http://127.0.0.1/x", { method: "PUT", body: JSON.stringify(body) }), path!.teamGroupId, path!.memberId, path!.position, account);
  }
  const reload = (account: number, id: number) => getTeamGroup(db, id, account)!;
  async function startSession(account: number, body: Record<string, unknown>) {
    const response = await sessions.post(
      new Request("http://127.0.0.1/x", {
        method: "POST",
        body: JSON.stringify({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", simulatorSeed: "SEED", ...body }),
      }),
      account,
    );
    const json = (await response.json()) as { sessionId?: string };
    return { status: response.status, pools: json.sessionId ? (store.perspectiveRecommendationContext(json.sessionId)?.playerPoolsByPosition ?? null) : null };
  }
  const party5 = (assignment?: Record<string, number>) => ({
    partyContext: { partySize: 5, side: "radiant", controlledSlots: [] },
    controlledPositions: [1, 2, 3, 4, 5],
    humanPosition: 3,
    ...(assignment ? { teamAssignment: assignment } : {}),
  });
  return { sqlite, teams, saveTeam, putTeam, putPool, reload, startSession, party5 };
}

// Seats confirmed, no pool yet: writes start from "no row" (version 0).
const fiveBare = () => [1, 2, 3, 4, 5].map((position) => ({ position, heroPool: [] as number[] }));
const fiveLegacy = () => [1, 2, 3, 4, 5].map((position) => ({ position, heroPool: LEGACY[position]! }));
const usualSeats = (team: Saved) => Object.fromEntries(team.members.map((m) => [String(m.id), m.position!]));

describe("F2 write path: one pool per (member, seat), up to five per person", () => {
  test("a person can hold a pool for each of the five seats, independently", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const carry = team.members[0]!;
    const pools: Record<number, number[]> = { 1: [11], 2: [12], 3: [13], 4: [14], 5: [15] };
    for (const [position, heroPool] of Object.entries(pools)) {
      expect((await t.putPool(A, team.id, carry.id, Number(position), { heroPool, expectedVersion: 0 })).status).toBe(200);
    }
    const stored = t.reload(A, team.id).members.find((m) => m.id === carry.id)!;
    expect(stored.positionPools.map((p) => [p.position, p.heroPool])).toEqual([[1, [11]], [2, [12]], [3, [13]], [4, [14]], [5, [15]]]);
  });

  test("a pool holds at most 5 distinct, known heroes and states the version it was read at", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const id = team.members[0]!.id;
    const bad = [
      { heroPool: [11, 12, 13, 14, 15, 16], expectedVersion: 0 }, // 6 heroes
      { heroPool: [11, 11], expectedVersion: 0 }, // duplicate
      { heroPool: [999], expectedVersion: 0 }, // unknown hero
      { heroPool: [11], expectedVersion: -1 },
      { heroPool: [11] }, // no precondition
      { heroPool: "11", expectedVersion: 0 },
    ];
    for (const body of bad) expect((await t.putPool(A, team.id, id, 1, body)).status).toBe(400);
    expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM team_member_position_pools").get()).toEqual({ n: 0 });
  });

  test("only seats 1..5 are addressable", () => {
    const t = setup();
    for (const seat of [0, 6, 10]) expect(t.teams.parsePoolPath(`/api/team-groups/1/members/1/pools/${seat}`)).toBeNull();
    expect(t.teams.parsePoolPath("/api/team-groups/1/members/1/pools/5")).toEqual({ teamGroupId: 1, memberId: 1, position: 5 });
  });
});

describe("F2 integrity: stale writes and old PUTs never destroy pools", () => {
  test("compare-and-set: a second writer holding the old version is refused and changes nothing", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const id = team.members[0]!.id;
    expect((await t.putPool(A, team.id, id, 5, { heroPool: [51], expectedVersion: 0 })).status).toBe(200);
    expect((await t.putPool(A, team.id, id, 5, { heroPool: [52], expectedVersion: 0 })).status).toBe(409); // stale tab
    expect(t.reload(A, team.id).members[0]!.positionPools[0]).toMatchObject({ position: 5, heroPool: [51], version: 1 });
    expect((await t.putPool(A, team.id, id, 5, { heroPool: [52], expectedVersion: 1 })).status).toBe(200);
    expect(t.reload(A, team.id).members[0]!.positionPools[0]).toMatchObject({ heroPool: [52], version: 2 });
  });

  test("an OLD team PUT (legacy heroPool, no pool knowledge) leaves every position pool intact", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const carry = team.members[0]!;
    await t.putPool(A, team.id, carry.id, 1, { heroPool: [13], expectedVersion: 0 });
    await t.putPool(A, team.id, carry.id, 5, { heroPool: [53], expectedVersion: 0 });
    const oldTabBody = {
      name: "Team", partySize: 5,
      members: team.members.map((m) => ({ id: m.id, slot: m.slot, position: m.position, name: "renamed", heroPool: [] })),
    };
    expect((await t.putTeam(A, team.id, oldTabBody)).status).toBe(200);
    const stored = t.reload(A, team.id).members.find((m) => m.id === carry.id)!;
    expect(stored.positionPools.map((p) => [p.position, p.heroPool])).toEqual([[1, [13]], [5, [53]]]);
    expect(stored.name).toBe("renamed"); // identity edits still work
  });

  test("changing a member's USUAL position or order never moves or drops their pools (identity = member.id)", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const carry = team.members[0]!;
    await t.putPool(A, team.id, carry.id, 1, { heroPool: [13], expectedVersion: 0 });
    // carry <-> support swap their usual seats and list order
    const swapped = team.members.map((m) => ({
      id: m.id, slot: 6 - m.slot, position: m.position === 1 ? 5 : m.position === 5 ? 1 : m.position, name: m.name, heroPool: m.heroPool,
    }));
    expect((await t.putTeam(A, team.id, { name: "Team", partySize: 5, members: swapped })).status).toBe(200);
    const stored = t.reload(A, team.id).members.find((m) => m.id === carry.id)!;
    expect(stored.position).toBe(5);
    expect(stored.positionPools.map((p) => [p.position, p.heroPool])).toEqual([[1, [13]]]);
  });

  test("a new member saved with a seat and a pool is seeded at THAT seat; a later usual-seat change does not re-aim it", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveLegacy());
    const carry = team.members[0]!;
    expect(t.reload(A, team.id).members[0]!.positionPools.map((p) => [p.position, p.heroPool])).toEqual([[1, [11, 12]]]);
    const moved = team.members.map((m) => ({ id: m.id, slot: m.slot, position: m.id === carry.id ? null : m.position, name: m.name, heroPool: m.heroPool }));
    expect((await t.putTeam(A, team.id, { name: "Team", partySize: 5, members: moved })).status).toBe(200);
    const stored = t.reload(A, team.id).members[0]!;
    expect(stored.position).toBeNull();
    expect(stored.positionPools.map((p) => p.position)).toEqual([1]);
  });

  test("removing a person removes only THEIR pools", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const [first, second] = team.members;
    await t.putPool(A, team.id, first!.id, 1, { heroPool: [13], expectedVersion: 0 });
    await t.putPool(A, team.id, second!.id, 2, { heroPool: [21], expectedVersion: 0 });
    const kept = team.members.filter((m) => m.id !== first!.id).map((m) => ({ id: m.id, slot: m.slot - 1, position: m.position, name: m.name, heroPool: m.heroPool }));
    expect((await t.putTeam(A, team.id, { name: "Team", partySize: 5, members: kept })).status).toBe(200);
    const rows = t.sqlite.prepare("SELECT member_id FROM team_member_position_pools").all() as { member_id: number }[];
    expect(rows.map((r) => r.member_id)).toEqual([second!.id]);
  });

  test("deleting the team removes all of its pools and none of another team's", async () => {
    const t = setup();
    const one = await t.saveTeam(A, fiveBare());
    const two = await t.saveTeam(A, fiveBare());
    await t.putPool(A, one.id, one.members[0]!.id, 1, { heroPool: [13], expectedVersion: 0 });
    await t.putPool(A, two.id, two.members[0]!.id, 1, { heroPool: [14], expectedVersion: 0 });
    expect(t.teams.delete(one.id, A).status).toBe(204);
    const rows = t.sqlite.prepare("SELECT member_id FROM team_member_position_pools").all() as { member_id: number }[];
    expect(rows.map((r) => r.member_id)).toEqual([two.members[0]!.id]);
  });
});

describe("F2 isolation: accounts and people never see or write each other's pools", () => {
  test("another account cannot write a pool of my team's member (404, nothing written)", async () => {
    const t = setup();
    const mine = await t.saveTeam(A, fiveBare());
    const response = await t.putPool(B, mine.id, mine.members[0]!.id, 1, { heroPool: [13], expectedVersion: 0 });
    expect(response.status).toBe(404);
    expect(t.sqlite.prepare("SELECT COUNT(*) AS n FROM team_member_position_pools").get()).toEqual({ n: 0 });
  });

  test("a member id from ANOTHER team of the same account is not addressable through this team", async () => {
    const t = setup();
    const one = await t.saveTeam(A, fiveBare());
    const two = await t.saveTeam(A, fiveBare());
    expect((await t.putPool(A, one.id, two.members[0]!.id, 1, { heroPool: [13], expectedVersion: 0 })).status).toBe(404);
    expect((await t.putPool(A, one.id, 9999, 1, { heroPool: [13], expectedVersion: 0 })).status).toBe(404);
  });

  test("a pool written for one person is not visible on a teammate, and a team PUT cannot smuggle pools in", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    await t.putPool(A, team.id, team.members[0]!.id, 5, { heroPool: [51], expectedVersion: 0 });
    const body = {
      name: "Team", partySize: 5,
      members: team.members.map((m) => ({ id: m.id, slot: m.slot, position: m.position, name: m.name, heroPool: m.heroPool, positionPools: [{ position: 5, heroPool: [99] }] })),
    };
    expect((await t.putTeam(A, team.id, body)).status).toBe(200);
    const stored = t.reload(A, team.id).members;
    expect(stored[1]!.positionPools).toEqual([]);
    expect(stored[0]!.positionPools.map((p) => p.heroPool)).toEqual([[51]]);
  });
});

describe("F2 activation: the match seat decides which pool a session uses", () => {
  async function teamWithSeatPools() {
    const t = setup();
    const team = await t.saveTeam(A, fiveLegacy());
    await t.putPool(A, team.id, team.members[0]!.id, 5, { heroPool: [53], expectedVersion: 0 }); // the carry's own Pos 5 pool
    return { t, team };
  }

  test("no assignment: usual seats use their pools (the legacy list still serves untouched rows)", async () => {
    const { t, team } = await teamWithSeatPools();
    const started = await t.startSession(A, { ...t.party5(), teamGroupId: team.id });
    expect(started.status).toBe(201);
    // Pos 3 is the owner's declared seat (humanPosition): the owner plays from their personal pool, never a team pool.
    expect(started.pools).toEqual({ 1: LEGACY[1], 2: LEGACY[2], 4: LEGACY[4], 5: LEGACY[5] });
  });

  test("carry moved to Pos 5: Pos 5 gets the carry's Pos 5 pool; Pos 1's pool does not travel; the support's pool does not land on Pos 1", async () => {
    const { t, team } = await teamWithSeatPools();
    const assignment = usualSeats(team);
    assignment[String(team.members[0]!.id)] = 5;
    assignment[String(team.members[4]!.id)] = 1;
    const started = await t.startSession(A, { ...t.party5(assignment), teamGroupId: team.id });
    expect(started.pools).toEqual({ 2: LEGACY[2], 4: LEGACY[4], 5: [53] });
  });

  test("moved to a seat with no pool: that seat has none (credible role candidates take over), nothing borrowed", async () => {
    const { t, team } = await teamWithSeatPools();
    const assignment = usualSeats(team);
    assignment[String(team.members[1]!.id)] = 5; // mid -> Pos 5, has no Pos 5 pool
    assignment[String(team.members[4]!.id)] = 2;
    const started = await t.startSession(A, { ...t.party5(assignment), teamGroupId: team.id });
    expect(started.pools![5]).toBeUndefined();
    expect(started.pools![2]).toBeUndefined();
  });
});

describe("F2 safety D1: the old team PUT never edits hero lists (no false save, no expectedVersion bypass)", () => {
  const sameBody = (team: Saved, edit: (m: Saved["members"][number]) => Record<string, unknown>) => ({
    name: "Team", partySize: 5,
    members: team.members.map((m) => ({ id: m.id, slot: m.slot, position: m.position, name: m.name, heroPool: m.heroPool, ...edit(m) })),
  });
  const rows = (t: ReturnType<typeof setup>) => t.sqlite.prepare("SELECT member_id, position, hero_pool, version FROM team_member_position_pools ORDER BY member_id, position").all();
  const legacyColumn = (t: ReturnType<typeof setup>) => t.sqlite.prepare("SELECT id, hero_pool FROM team_members ORDER BY id").all();

  test("changing the legacy heroPool of an existing member -> 409 use_position_pool_editor, nothing changes", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveLegacy());
    const poolsBefore = rows(t);
    const legacyBefore = legacyColumn(t);
    const response = await t.putTeam(A, team.id, sameBody(team, (m) => (m.id === team.members[0]!.id ? { heroPool: [13, 14], name: "renamed too" } : {})));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "use_position_pool_editor" });
    expect(rows(t)).toEqual(poolsBefore);
    expect(legacyColumn(t)).toEqual(legacyBefore);
    expect(t.reload(A, team.id).members[0]!.name).toBe("P1"); // the whole save is refused, not half applied
  });

  test("filling an EMPTY legacy list or clearing a non-empty one is also a hero edit -> 409", async () => {
    const t = setup();
    const team = await t.saveTeam(A, [{ position: 1, heroPool: [11] }, { position: 2, heroPool: [] }, ...[3, 4, 5].map((position) => ({ position, heroPool: [] as number[] }))]);
    expect((await t.putTeam(A, team.id, sameBody(team, (m) => (m.position === 2 ? { heroPool: [21] } : {})))).status).toBe(409);
    expect((await t.putTeam(A, team.id, sameBody(team, (m) => (m.position === 1 ? { heroPool: [] } : {})))).status).toBe(409);
    expect(rows(t)).toEqual([{ member_id: team.members[0]!.id, position: 1, hero_pool: "[11]", version: 1 }]);
  });

  test("the pool version is not bypassed: a hero edit through the team PUT leaves heroes and version as they were", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const id = team.members[0]!.id;
    await t.putPool(A, team.id, id, 1, { heroPool: [11], expectedVersion: 0 });
    expect((await t.putTeam(A, team.id, sameBody(team, (m) => (m.id === id ? { heroPool: [12] } : {})))).status).toBe(409);
    expect(t.reload(A, team.id).members[0]!.positionPools[0]).toMatchObject({ heroPool: [11], version: 1 });
  });

  test("editing only nickname / order (heroPool unchanged) still works", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveLegacy());
    const response = await t.putTeam(A, team.id, sameBody(team, (m) => ({ name: `${m.name}!`, slot: 6 - m.slot })));
    expect(response.status).toBe(200);
    expect(t.reload(A, team.id).members.map((m) => m.name)).toEqual(["P5!", "P4!", "P3!", "P2!", "P1!"]);
  });

  test("an unchanged legacy list on a member with no seat (never migrated) is accepted", async () => {
    const t = setup();
    const team = await t.saveTeam(A, [{ position: null, heroPool: [11] }, ...[2, 3, 4, 5].map((position) => ({ position, heroPool: [] as number[] }))]);
    expect((await t.putTeam(A, team.id, sameBody(team, () => ({ name: "again" })))).status).toBe(200);
  });

  test("a NEW member (no id) with an explicit seat + heroes is created and seeded at that seat only; without a seat no pool row is invented", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    const kept = team.members.slice(1).map((m) => ({ id: m.id, slot: m.slot, position: m.position, name: m.name, heroPool: m.heroPool }));
    const withSeat = { name: "Team", partySize: 5, members: [...kept, { slot: 1, position: 1, name: "newbie", heroPool: [11, 12] }] };
    expect((await t.putTeam(A, team.id, withSeat)).status).toBe(200);
    const created = t.reload(A, team.id).members.find((m) => m.name === "newbie")!;
    expect(created.positionPools.map((p) => [p.position, p.heroPool])).toEqual([[1, [11, 12]]]);
    const kept2 = t.reload(A, team.id).members.filter((m) => m.name !== "newbie").map((m) => ({ id: m.id, slot: m.slot, position: m.position, name: m.name, heroPool: m.heroPool }));
    const noSeat = { name: "Team", partySize: 5, members: [...kept2, { slot: 1, position: null, name: "nopos", heroPool: [11] }] };
    expect((await t.putTeam(A, team.id, noSeat)).status).toBe(200);
    expect(t.reload(A, team.id).members.find((m) => m.name === "nopos")!.positionPools).toEqual([]);
  });
});

describe("F2 safety D3: an old client that sends members WITHOUT ids can't silently recreate the team's people", () => {
  const snapshot = (t: ReturnType<typeof setup>) => ({
    members: t.sqlite.prepare("SELECT id, team_group_id, slot, position, name, hero_pool FROM team_members ORDER BY id").all(),
    pools: t.sqlite.prepare("SELECT member_id, position, hero_pool, version FROM team_member_position_pools ORDER BY member_id, position").all(),
  });
  // What a pre-identity tab sends: the whole roster, same names / seats / lists, and no `id` anywhere.
  const idLess = (team: Saved) => ({
    name: "Team", partySize: 5,
    members: team.members.map((m) => ({ slot: m.slot, position: m.position, name: m.name, heroPool: m.heroPool })),
  });

  test("id-less PUT over a saved team with pools -> 409 member_ids_required; same ids, same pools, same versions", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveLegacy());
    await t.putPool(A, team.id, team.members[0]!.id, 5, { heroPool: [53], expectedVersion: 0 });
    const before = snapshot(t);
    const response = await t.putTeam(A, team.id, idLess(team));
    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({ error: "member_ids_required" });
    expect(snapshot(t)).toEqual(before);
    expect(t.reload(A, team.id).members.map((m) => m.id)).toEqual(team.members.map((m) => m.id));
  });

  test("one pool anywhere in the team is enough to refuse (it would be deleted with its owner)", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    await t.putPool(A, team.id, team.members[3]!.id, 4, { heroPool: [41], expectedVersion: 0 });
    const before = snapshot(t);
    expect((await t.putTeam(A, team.id, idLess(team))).status).toBe(409);
    expect(snapshot(t)).toEqual(before);
  });

  test("a team with no pools at all has nothing to lose: the pre-identity id-less save keeps working", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    expect((await t.putTeam(A, team.id, idLess(team))).status).toBe(200);
  });

  test("a modern client still adds / replaces people: ids for the kept ones, none for the newcomer", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveBare());
    await t.putPool(A, team.id, team.members[1]!.id, 2, { heroPool: [21], expectedVersion: 0 });
    const kept = team.members.slice(1).map((m) => ({ id: m.id, slot: m.slot, position: m.position, name: m.name, heroPool: m.heroPool }));
    const body = { name: "Team", partySize: 5, members: [...kept, { slot: 1, position: 1, name: "newcomer", heroPool: [] as number[] }] };
    expect((await t.putTeam(A, team.id, body)).status).toBe(200);
    const stored = t.reload(A, team.id).members;
    expect(stored.map((m) => m.name).sort()).toEqual(["P2", "P3", "P4", "P5", "newcomer"]);
    expect(stored.find((m) => m.id === team.members[1]!.id)!.positionPools.map((p) => p.heroPool)).toEqual([[21]]);
  });
});

describe("F2 safety D2: a legacy list never jumps seat when the usual position changes", () => {
  // Member 0 has a legacy list and NO seat; the others hold seats 1, 2, 4, 5.
  async function legacyOnlyTeam(t: ReturnType<typeof setup>) {
    return t.saveTeam(A, [{ position: null, heroPool: [31, 32] }, ...[1, 2, 4, 5].map((position) => ({ position, heroPool: [] as number[] }))]);
  }
  const moveFirst = (team: Saved, to: number | null) => ({
    name: "Team", partySize: 5,
    members: team.members.map((m, i) => ({ id: m.id, slot: m.slot, position: i === 0 ? to : m.position, name: m.name, heroPool: m.heroPool })),
  });

  test("a legacy-only member that receives a usual seat does NOT activate its legacy list there", async () => {
    const t = setup();
    const team = await legacyOnlyTeam(t);
    expect((await t.putTeam(A, team.id, moveFirst(team, 3))).status).toBe(200);
    const stored = t.reload(A, team.id).members[0]!;
    expect(stored.position).toBe(3);
    expect(stored.heroPool).toEqual([31, 32]); // preserved for an explicit confirmation later (F4)
    expect(stored.positionPools).toEqual([]);
    const started = await t.startSession(A, { ...t.party5(), humanPosition: 4, teamGroupId: team.id });
    expect(started.status).toBe(201);
    expect(started.pools?.[3]).toBeUndefined(); // null (no team pool at all) or a map without Pos 3 -- never [31, 32]
    expect(JSON.stringify(started.pools)).not.toContain("31");
  });

  test("an already-migrated pool stays at its original seat when the usual seat changes", async () => {
    const t = setup();
    const team = await t.saveTeam(A, fiveLegacy()); // carry: pool at Pos 1; support: pool at Pos 5
    const swapped = {
      name: "Team", partySize: 5,
      members: team.members.map((m) => ({ id: m.id, slot: m.slot, position: m.position === 1 ? 5 : m.position === 5 ? 1 : m.position, name: m.name, heroPool: m.heroPool })),
    };
    expect((await t.putTeam(A, team.id, swapped)).status).toBe(200);
    const stored = t.reload(A, team.id).members;
    expect(stored[0]!.positionPools.map((p) => [p.position, p.heroPool])).toEqual([[1, [11, 12]]]);
    expect(stored[4]!.positionPools.map((p) => [p.position, p.heroPool])).toEqual([[5, [51, 52]]]);
    const started = await t.startSession(A, { ...t.party5(), teamGroupId: team.id });
    // carry now sits at usual Pos 5 but only owns a Pos 1 pool: Pos 5 has none; support at usual Pos 1 has only a Pos 5 pool.
    expect(started.pools![1]).toBeUndefined();
    expect(started.pools![5]).toBeUndefined();
  });
});

describe("F2 migration 0011: additive, backfills only confirmed seats, keeps legacy", () => {
  const SQL = readFileSync(join(import.meta.dir, "../../db/migrations/0011_team_member_position_pools.sql"), "utf-8");
  function run(sqlite: Database) {
    for (const statement of SQL.split("--> statement-breakpoint")) if (statement.trim()) sqlite.exec(statement.trim());
  }

  test("confirmed + non-empty rows get a v1 pool at their seat; unconfirmed/empty rows get none; legacy column untouched", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, position INTEGER, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);");
    const insert = sqlite.prepare("INSERT INTO team_members (team_group_id, slot, position, name, hero_pool, updated_at) VALUES (1, ?, ?, ?, ?, '2026-10-01')");
    insert.run(1, 4, "confirmed", "[41,42]"); // id 1
    insert.run(2, null, "never confirmed", "[21]"); // id 2 -- slot order is NOT a position
    insert.run(3, 3, "confirmed but empty", "[]"); // id 3
    run(sqlite);
    expect(sqlite.prepare("SELECT member_id, position, hero_pool, version FROM team_member_position_pools").all()).toEqual([
      { member_id: 1, position: 4, hero_pool: "[41,42]", version: 1 },
    ]);
    expect(sqlite.prepare("SELECT id, hero_pool FROM team_members ORDER BY id").all()).toEqual([
      { id: 1, hero_pool: "[41,42]" },
      { id: 2, hero_pool: "[21]" },
      { id: 3, hero_pool: "[]" },
    ]);
  });

  test("malformed hero_pool values ('null', '[ ]', not-JSON) are never backfilled", () => {
    const sqlite = new Database(":memory:");
    sqlite.exec("CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, position INTEGER, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);");
    const insert = sqlite.prepare("INSERT INTO team_members (team_group_id, slot, position, name, hero_pool, updated_at) VALUES (1, 1, 2, 'x', ?, '2026-10-01')");
    for (const raw of ["null", "[ ]", "not json", "{}", "[7]"]) insert.run(raw);
    run(sqlite);
    expect(sqlite.prepare("SELECT hero_pool FROM team_member_position_pools").all()).toEqual([{ hero_pool: "[7]" }]);
  });

  test("the migration only creates/inserts: no DROP/DELETE/ALTER of existing data", () => {
    // Statement-initial verbs only: the FK clause legitimately says "ON DELETE no action".
    expect(SQL).not.toMatch(/^\s*(DROP|DELETE|TRUNCATE|ALTER|UPDATE)\b/im);
  });
});
