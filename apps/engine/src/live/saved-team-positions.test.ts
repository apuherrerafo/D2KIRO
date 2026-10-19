import { describe, expect, test } from "bun:test";
import { getTeamGroup } from "../db/queries";
import { createLiveGsiRoutes } from "../server/routes/live-gsi";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createGsiLinkTestDb } from "./gsi.fixtures";
import { createGsiLinkStore } from "./gsi-links";
import { LiveCaptureRegistry } from "./live-capture-registry";

// SIAMES / saved-team position fix -- RED first. A saved teammate's position must be an EXPLICIT, confirmed fact
// of the row (`team_members.position`, nullable), never inferred from `slot`, which is only the visual order the
// editor happened to list them in. These tests are written against the post-migration shape (the `position`
// column exists in the test DDL); on RC2 the engine ignores it and keeps mapping `slot N -> Pos N`.

const A = 101;
const T0 = 1_790_000_000_000;

// Each person's pool is identifiable by its heroes: 1xx = the carry's, 2xx = mid's, 3xx = offlane's, ...
const POOL_BY_POSITION: Record<number, number[]> = { 1: [11, 12], 2: [21, 22], 3: [31, 32], 4: [41, 42], 5: [51, 52] };

interface SavedMember {
  slot: number;
  /** null = never confirmed (legacy row). */
  position: number | null;
  name: string;
  heroPool: number[];
}

function setup() {
  const { db, sqlite } = createGsiLinkTestDb();
  sqlite.exec(`
    CREATE TABLE team_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL, party_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, position INTEGER, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => T0 });
  const links = createGsiLinkStore(db);
  const routes = createLiveGsiRoutes({ links, registry, now: () => T0, loadTeamGroup: (id, accountId) => getTeamGroup(db, id, accountId) });

  // Raw insert: the legacy / reordered shapes are data states, not something the (fixed) write path would produce.
  function saveGroup(partySize: 2 | 3 | 5, members: SavedMember[]): number {
    const group = sqlite.prepare("INSERT INTO team_groups (account_id, name, party_size, updated_at) VALUES (?, 'Team', ?, '2026-10-04') RETURNING id").get(A, partySize) as { id: number };
    const insert = sqlite.prepare("INSERT INTO team_members (team_group_id, slot, position, name, hero_pool, updated_at) VALUES (?, ?, ?, ?, ?, '2026-10-04')");
    for (const member of members) insert.run(group.id, member.slot, member.position, member.name, JSON.stringify(member.heroPool));
    return group.id;
  }
  async function issue() {
    const response = routes.postIssue(A);
    expect(response.status).toBe(201);
    return (await response.json()) as { sessionId: string };
  }
  async function select(body: unknown) {
    const response = await routes.putTeamGroup(new Request("http://127.0.0.1/api/live/team-group", { method: "PUT", body: JSON.stringify(body) }), A);
    return { status: response.status, json: (await response.json()) as Record<string, unknown> };
  }
  const poolsOf = (sessionId: string) => store.perspectiveRecommendationContext(sessionId)?.playerPoolsByPosition ?? null;
  return { saveGroup, issue, select, poolsOf };
}

function member(position: number, slot: number): SavedMember {
  return { slot, position, name: `P${position}`, heroPool: POOL_BY_POSITION[position]! };
}

describe("saved team -- position is an explicit fact, slot is only display order", () => {
  test("RED 1: the same five people listed in a different order land on the SAME positions", async () => {
    const t = setup();
    const link = await t.issue();
    // Carry listed 3rd, offlane listed 1st, ... -- the editor order is arbitrary, the saved positions are not.
    const reordered = [member(3, 1), member(5, 2), member(1, 3), member(2, 4), member(4, 5)];
    const applied = await t.select({ teamGroupId: t.saveGroup(5, reordered) });
    expect(applied.json).toMatchObject({ applied: true, reason: null });
    expect(t.poolsOf(link.sessionId)).toEqual(POOL_BY_POSITION);
  });

  test("RED 2: a legacy row with no confirmed position is never given one -- nothing is applied, reason says why", async () => {
    const t = setup();
    const link = await t.issue();
    // Pre-3db6a42 shape: a "Party 5" group of 4 companions, slots 1..4, no position ever recorded.
    const legacy = [1, 2, 3, 4].map((slot): SavedMember => ({ slot, position: null, name: `Compañero ${slot}`, heroPool: POOL_BY_POSITION[slot]! }));
    const applied = await t.select({ teamGroupId: t.saveGroup(5, legacy) });
    expect(applied.json).toMatchObject({ applied: false, reason: "positions_unconfirmed" });
    expect(t.poolsOf(link.sessionId)).toBeNull();
  });

  test("RED 3: a half-confirmed team applies only the confirmed members, never guesses the rest", async () => {
    const t = setup();
    const link = await t.issue();
    const mixed: SavedMember[] = [member(1, 1), { ...member(2, 2), position: null }, member(3, 3)];
    await t.select({ teamGroupId: t.saveGroup(5, mixed) });
    expect(t.poolsOf(link.sessionId)).toEqual({ 1: POOL_BY_POSITION[1], 3: POOL_BY_POSITION[3] });
  });
});

describe("saved team -- the simulator path has the same slot -> position leak", () => {
  test("RED 4: a Party 2/3 companion's pool is never read as the pool of Pos <slot>", async () => {
    const store = new ProtocolSessionStore();
    const routes = createProtocolSessionRoutes({
      store,
      computeSuggestions: async () => {
        throw new Error("not used");
      },
      heroPositions: {},
      loadTeamGroup: async () => ({ id: 7, partySize: 2, members: [{ slot: 1, heroPool: [31, 32] }] }),
    });
    const response = await routes.post(
      new Request("http://127.0.0.1/x", {
        method: "POST",
        body: JSON.stringify({
          rulesetId: "dota2/ranked-all-pick",
          patch: "7.41e",
          localSide: "radiant",
          adapterKind: "simulator",
          humanPosition: 2,
          simulatorSeed: "SEED",
          partyContext: { partySize: 2, side: "radiant", controlledSlots: [] },
          controlledPositions: [2, 3],
          teamGroupId: 7,
        }),
      }),
      A,
    );
    expect(response.status).toBe(201);
    const { sessionId } = (await response.json()) as { sessionId: string };
    // "Compañero 1" has no position: Pos 1 must stay without a configured pool.
    expect(store.perspectiveRecommendationContext(sessionId)?.playerPoolsByPosition ?? null).toBeNull();
  });
});
