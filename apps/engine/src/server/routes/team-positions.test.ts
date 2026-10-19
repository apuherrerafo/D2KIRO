import { describe, expect, test } from "bun:test";
import { getTeamGroup } from "../../db/queries";
import { createGsiLinkTestDb } from "../../live/gsi.fixtures";
import { ProtocolSessionStore } from "../protocol-session";
import { createProtocolSessionRoutes } from "./protocol-sessions";
import { createTeamGroupRoutes } from "./team-groups";

// SIAMES / saved-team positions -- "usual position" (saved) vs "this match" (assignment) vs display order (slot),
// through the REAL routes and a REAL in-memory SQLite. Heroes in a pool identify their owner: 1x = carry's, 2x = mid's...

const A = 101;
const KNOWN_HEROES = [11, 12, 21, 22, 31, 32, 41, 42, 51, 52];
const POOL: Record<number, number[]> = { 1: [11, 12], 2: [21, 22], 3: [31, 32], 4: [41, 42], 5: [51, 52] };

function setup() {
  const { db, sqlite } = createGsiLinkTestDb();
  sqlite.exec(`
    CREATE TABLE heroes (id INTEGER PRIMARY KEY, name TEXT NOT NULL, localized_name TEXT NOT NULL, img_url TEXT NOT NULL, primary_attr TEXT NOT NULL, attack_type TEXT NOT NULL, roles TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL, party_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, position INTEGER, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const insertHero = sqlite.prepare("INSERT INTO heroes VALUES (?, 'h', 'H', 'x', 'str', 'Melee', '[]', '2026-10-04')");
  for (const id of KNOWN_HEROES) insertHero.run(id);

  const teamRoutes = createTeamGroupRoutes({ db });
  const store = new ProtocolSessionStore();
  const sessionRoutes = createProtocolSessionRoutes({
    store,
    computeSuggestions: async () => {
      throw new Error("not used");
    },
    heroPositions: {},
    loadTeamGroup: async (id, accountId) => (accountId === null ? null : getTeamGroup(db, id, accountId)),
  });

  async function saveTeam(partySize: 2 | 3 | 5, members: { slot: number; position?: number | null; name?: string; heroPool: number[] }[]) {
    const response = await teamRoutes.post(
      new Request("http://127.0.0.1/api/team-groups", { method: "POST", body: JSON.stringify({ name: "Team", partySize, members: members.map((m) => ({ name: `P${m.slot}`, ...m })) }) }),
      A,
    );
    expect(response.status).toBe(201);
    return (await response.json()) as { id: number; members: { id: number; slot: number; position: number | null; heroPool: number[] }[] };
  }
  async function putTeam(id: number, body: unknown) {
    return teamRoutes.put(new Request("http://127.0.0.1/api/team-groups/1", { method: "PUT", body: JSON.stringify(body) }), id, A);
  }
  async function startSession(body: Record<string, unknown>) {
    const response = await sessionRoutes.post(
      new Request("http://127.0.0.1/x", {
        method: "POST",
        body: JSON.stringify({ rulesetId: "dota2/ranked-all-pick", patch: "7.41e", localSide: "radiant", adapterKind: "simulator", simulatorSeed: "SEED", ...body }),
      }),
      A,
    );
    const json = (await response.json()) as { sessionId?: string; error?: string };
    return { status: response.status, json, pools: json.sessionId ? (store.perspectiveRecommendationContext(json.sessionId)?.playerPoolsByPosition ?? null) : null };
  }
  const party = (partySize: 1 | 2 | 3 | 5, controlledPositions: number[], humanPosition: number) => ({
    partyContext: { partySize, side: "radiant", controlledSlots: [] },
    controlledPositions,
    humanPosition,
  });
  return { saveTeam, putTeam, startSession, party, db };
}

/** Five people, usual positions 1..5, listed in the order given (so slot != position when reordered). */
const fiveByPosition = (order: number[]) => order.map((position, index) => ({ slot: index + 1, position, heroPool: POOL[position]! }));

describe("saved team -- positions are stored and validated as explicit facts", () => {
  test("the usual position round-trips; a client that sends none stores null (never slot)", async () => {
    const t = setup();
    const team = await t.saveTeam(5, [
      { slot: 1, position: 3, heroPool: POOL[3]! },
      { slot: 2, heroPool: POOL[2]! },
      { slot: 3, position: null, heroPool: POOL[1]! },
      { slot: 4, position: 4, heroPool: POOL[4]! },
      { slot: 5, position: 5, heroPool: POOL[5]! },
    ]);
    expect(team.members.map((m) => [m.slot, m.position])).toEqual([[1, 3], [2, null], [3, null], [4, 4], [5, 5]]);
  });

  test.each([
    ["a position of 0", 0],
    ["a position of 6", 6],
    ["a string position", "2"],
  ])("PUT with %s is refused", async (_label, position) => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const body = { name: "Team", partySize: 5, members: fiveByPosition([1, 2, 3, 4, 5]).map((m, i) => ({ ...m, name: `P${i}`, position: i === 0 ? position : m.position })) };
    expect((await t.putTeam(team.id, body)).status).toBe(400);
  });

  test("two people on the same usual position are refused", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const clash = fiveByPosition([1, 2, 3, 4, 5]).map((m, i) => ({ ...m, name: `P${i}`, position: i === 4 ? 1 : m.position }));
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members: clash })).status).toBe(400);
  });

  test("re-ordering the editor rows (slots) while keeping each person's position is a pure display change", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const reordered = fiveByPosition([3, 5, 1, 2, 4]).map((m, i) => ({ ...m, name: `P${m.position}`, slot: i + 1 }));
    const response = await t.putTeam(team.id, { name: "Team", partySize: 5, members: reordered });
    expect(response.status).toBe(200);
    const stored = (await response.json()) as { members: { name: string; position: number; heroPool: number[] }[] };
    for (const member of stored.members) expect(member.heroPool).toEqual(POOL[member.position]!);
  });
});

describe("saved team -- an older tab can't erase positions confirmed since it was opened", () => {
  const legacyBody = (members: ReturnType<typeof fiveByPosition>) => ({ name: "Team", partySize: 5, members: members.map((m, i) => ({ slot: m.slot, name: `P${i}`, heroPool: m.heroPool })) });

  test("a PUT that doesn't say anything about positions is refused (409) once the team has confirmed ones, and nothing is written", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const response = await t.putTeam(team.id, { ...legacyBody(fiveByPosition([1, 2, 3, 4, 5])), name: "Renamed by an old tab" });
    expect(response.status).toBe(409);
    expect(((await response.json()) as { error: string }).error).toBe("positions_required");
    const stored = getTeamGroup(t.db, team.id, A)!;
    expect(stored.name).toBe("Team");
    expect(stored.members.map((m) => m.position)).toEqual([1, 2, 3, 4, 5]);
  });

  test("a PUT that sends position: null explicitly is a deliberate clear and is honoured", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const cleared = fiveByPosition([1, 2, 3, 4, 5]).map((m, i) => ({ ...m, name: `P${i}`, position: null }));
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members: cleared })).status).toBe(200);
    expect(getTeamGroup(t.db, team.id, A)!.members.map((m) => m.position)).toEqual([null, null, null, null, null]);
  });

  test("an old team that never had positions can still be saved by a client that doesn't send them", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]).map((m) => ({ ...m, position: null })));
    expect((await t.putTeam(team.id, legacyBody(fiveByPosition([1, 2, 3, 4, 5])))).status).toBe(200);
    expect(getTeamGroup(t.db, team.id, A)!.members.map((m) => m.position)).toEqual([null, null, null, null, null]);
  });

  test("the editor's own save, positions included, still goes through", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const reordered = fiveByPosition([2, 1, 3, 4, 5]).map((m, i) => ({ ...m, name: `P${i}` }));
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members: reordered })).status).toBe(200);
  });
});

describe("simulator session -- usual positions, then this match's swap", () => {
  test("Party 5 with the usual positions: every non-owner seat gets ITS player's pool; the owner's seat gets none", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([3, 5, 1, 2, 4])); // listed out of order on purpose
    const started = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: team.id });
    expect(started.status).toBe(201);
    expect(started.pools).toEqual({ 2: POOL[2], 3: POOL[3], 4: POOL[4], 5: POOL[5] });
  });

  test("swapping two players for this match: neither pool lands on the seat they moved to (F0 guard)", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const byPosition = new Map(team.members.map((m) => [m.position, m.id]));
    // Mid (usual Pos 2) and hard support (usual Pos 5) trade seats this game.
    const assignment = { [byPosition.get(1)!]: 1, [byPosition.get(2)!]: 5, [byPosition.get(3)!]: 3, [byPosition.get(4)!]: 4, [byPosition.get(5)!]: 2 };
    const started = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: team.id, teamAssignment: assignment });
    expect(started.status).toBe(201);
    expect(started.pools).toEqual({ 3: POOL[3], 4: POOL[4] }); // Pos 1 is the owner's seat
    expect(started.pools?.[2]).toBeUndefined();
    expect(started.pools?.[5]).toBeUndefined();
  });

  test("a swap is NOT saved: the team keeps its usual positions", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const before = getTeamGroup(t.db, team.id, A)!.members.map((m) => [m.id, m.slot, m.position]);
    const byPosition = new Map(team.members.map((m) => [m.position, m.id]));
    await t.startSession({
      ...t.party(5, [1, 2, 3, 4, 5], 1),
      teamGroupId: team.id,
      teamAssignment: { [byPosition.get(2)!]: 3, [byPosition.get(3)!]: 2 },
    });
    expect(getTeamGroup(t.db, team.id, A)!.members.map((m) => [m.id, m.slot, m.position])).toEqual(before);
  });

  test("the owner swapped onto another seat: that seat is the owner's, and the player dragged to Pos 2 brings no pool", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const byPosition = new Map(team.members.map((m) => [m.position, m.id]));
    // The owner plays Pos 3 this game; the players of Pos 2 and Pos 3 traded seats.
    const started = await t.startSession({
      ...t.party(5, [1, 2, 3, 4, 5], 3),
      teamGroupId: team.id,
      teamAssignment: { [byPosition.get(1)!]: 1, [byPosition.get(2)!]: 3, [byPosition.get(3)!]: 2, [byPosition.get(4)!]: 4, [byPosition.get(5)!]: 5 },
    });
    expect(started.pools).toEqual({ 1: POOL[1], 4: POOL[4], 5: POOL[5] });
    expect(started.pools?.[3]).toBeUndefined();
    expect(started.pools?.[2]).toBeUndefined();
  });

  test("a player left out of the assignment is unplaced -- their usual seat doesn't quietly keep their pool", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const byPosition = new Map(team.members.map((m) => [m.position, m.id]));
    const started = await t.startSession({
      ...t.party(5, [1, 2, 3, 4, 5], 1),
      teamGroupId: team.id,
      teamAssignment: { [byPosition.get(1)!]: 1, [byPosition.get(3)!]: 3 },
    });
    expect(started.pools).toEqual({ 3: POOL[3] });
  });

  test("an old team with no confirmed positions applies nothing -- placing people for one match does not change that", async () => {
    const t = setup();
    const legacy = await t.saveTeam(5, [1, 2, 3, 4, 5].map((slot) => ({ slot, position: null, heroPool: POOL[slot]! })));
    const untouched = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: legacy.id });
    expect(untouched.status).toBe(201);
    expect(untouched.pools).toBeNull();

    // Placing an unconfirmed player for THIS match gives them no pool (their position was never confirmed), and nothing is written back.
    const placed = await t.startSession({
      ...t.party(5, [1, 2, 3, 4, 5], 1),
      teamGroupId: legacy.id,
      teamAssignment: { [legacy.members[1]!.id]: 2, [legacy.members[2]!.id]: 3 },
    });
    expect(placed.pools).toBeNull();
    expect(getTeamGroup(t.db, legacy.id, A)!.members.every((m) => m.position === null)).toBe(true);
  });

  test("an older web client's slot-derived pools can't fill in for positions the saved team left unconfirmed", async () => {
    const t = setup();
    const legacy = await t.saveTeam(5, [1, 2, 3, 4, 5].map((slot) => ({ slot, position: null, heroPool: POOL[slot]! })));
    const started = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: legacy.id, playerPoolsByPosition: { 2: [999] } });
    expect(started.pools).toBeNull();
  });
});

describe("simulator session -- an assignment that can't be trusted is refused, not half-applied", () => {
  test.each([
    ["an id that is not in the team", (ids: number[]) => ({ [ids[0]!]: 1, 987654: 2 })],
    ["two players on one seat", (ids: number[]) => ({ [ids[0]!]: 2, [ids[1]!]: 2 })],
    ["a seat out of range", (ids: number[]) => ({ [ids[0]!]: 7 })],
    ["not an object", () => [1, 2, 3]],
  ])("%s -> 400 invalid_team_assignment and no session", async (_label, build) => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const started = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: team.id, teamAssignment: build(team.members.map((m) => m.id)) });
    expect(started.status).toBe(400);
    expect(started.json).toMatchObject({ error: "invalid_team_assignment" });
    expect(started.json.sessionId).toBeUndefined();
  });

  test("another account's member ids are not usable (the team is loaded per account)", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]));
    const response = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: team.id + 50, teamAssignment: { [team.members[0]!.id]: 1 } });
    // The team doesn't load for this account, so nothing is applied; the foreign ids never reach a pool.
    expect(response.pools).toBeNull();
  });
});

describe("simulator session -- Solo, Party 2, Party 3 (only what the simulator already supports)", () => {
  test("Solo: no team is involved; nothing changes", async () => {
    const t = setup();
    const started = await t.startSession({ ...t.party(1, [4], 4) });
    expect(started.status).toBe(201);
    expect(started.pools).toBeNull();
  });

  test("Party 2: a companion's pool goes to the companion's CONFIRMED position, never to Pos <slot>", async () => {
    const t = setup();
    const team = await t.saveTeam(2, [{ slot: 1, position: 4, heroPool: POOL[4]! }]);
    // The party plays Pos 2 (owner) and Pos 4 (the companion).
    const started = await t.startSession({ ...t.party(2, [2, 4], 2), teamGroupId: team.id });
    expect(started.pools).toEqual({ 4: POOL[4] });
    expect(started.pools?.[1]).toBeUndefined();
  });

  test("Party 2: a companion saved without a position gets no pool at all", async () => {
    const t = setup();
    const team = await t.saveTeam(2, [{ slot: 1, heroPool: POOL[4]! }]);
    const started = await t.startSession({ ...t.party(2, [2, 4], 2), teamGroupId: team.id });
    expect(started.pools).toBeNull();
  });

  test("Party 3: two companions swapped for this match bring no pool to the seat they moved to", async () => {
    const t = setup();
    const team = await t.saveTeam(3, [{ slot: 1, position: 4, heroPool: POOL[4]! }, { slot: 2, position: 5, heroPool: POOL[5]! }]);
    const [first, second] = team.members;
    const usual = await t.startSession({ ...t.party(3, [3, 4, 5], 3), teamGroupId: team.id });
    expect(usual.pools).toEqual({ 4: POOL[4], 5: POOL[5] });
    const swapped = await t.startSession({ ...t.party(3, [3, 4, 5], 3), teamGroupId: team.id, teamAssignment: { [first!.id]: 5, [second!.id]: 4 } });
    expect(swapped.pools).toBeNull();
  });

  test("Party 3: companions placed on seats other than their usual ones apply no pool (their pools are for Pos 1 / Pos 2)", async () => {
    const t = setup();
    const team = await t.saveTeam(3, [{ slot: 1, position: 1, heroPool: POOL[1]! }, { slot: 2, position: 2, heroPool: POOL[2]! }]);
    const [carryMember, midMember] = team.members;
    // The party plays 3 (owner), 4 and 5 tonight: both companions move.
    const started = await t.startSession({ ...t.party(3, [3, 4, 5], 3), teamGroupId: team.id, teamAssignment: { [carryMember!.id]: 4, [midMember!.id]: 5 } });
    expect(started.pools).toBeNull();
  });
});

// A player is the member `id`. Nickname and slot are labels: they can change, repeat, or reorder without moving a pool.
// Every name below is arbitrary on purpose -- nothing here depends on who the players are called.
describe("saved team -- a player's identity is the member id, never the nickname or the slot", () => {
  type StoredTeam = Awaited<ReturnType<ReturnType<typeof setup>["saveTeam"]>>;
  type StoredMember = StoredTeam["members"][number] & { name: string };

  /** What the editor sends back for a saved member, with overrides. `id` present = the same person. */
  const editorEntry = (member: StoredMember, overrides: Record<string, unknown> = {}) => ({
    id: member.id,
    slot: member.slot,
    position: member.position,
    name: member.name,
    heroPool: member.heroPool,
    ...overrides,
  });
  const saveFive = (t: ReturnType<typeof setup>) => t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]).map((m) => ({ ...m, name: `Nick-${m.position}` })));
  const stored = (t: ReturnType<typeof setup>, team: StoredTeam) => getTeamGroup(t.db, team.id, A)!.members;
  const membersOf = (team: StoredTeam) => team.members as StoredMember[];

  test("editing and saving keeps every member id and every pool bound to its id (reordered slots, renamed, positions swapped)", async () => {
    const t = setup();
    const team = await saveFive(t);
    const before = new Map(team.members.map((m) => [m.id, m.heroPool]));
    const [a, b, c, d, e] = membersOf(team) as [StoredMember, StoredMember, StoredMember, StoredMember, StoredMember];
    const members = [
      editorEntry(e, { slot: 1, name: "Renamed-1" }),
      editorEntry(d, { slot: 2, name: "Renamed-2" }),
      editorEntry(a, { slot: 3, name: "Renamed-3", position: b.position }), // a and b trade usual positions
      editorEntry(b, { slot: 4, name: "Renamed-4", position: a.position }),
      editorEntry(c, { slot: 5 }),
    ];
    const response = await t.putTeam(team.id, { name: "Team", partySize: 5, members });
    expect(response.status).toBe(200);
    const after = stored(t, team);
    expect(after.map((m) => m.id).sort()).toEqual(team.members.map((m) => m.id).sort());
    for (const member of after) expect(member.heroPool).toEqual(before.get(member.id)!);
    expect<number | null>(after.find((m) => m.id === a.id)!.position).toBe(b.position);
    expect<number | null>(after.find((m) => m.id === b.id)!.position).toBe(a.position);
  });

  test("renaming a member (same id) never costs them their pool", async () => {
    const t = setup();
    const team = await saveFive(t);
    const [first, ...rest] = membersOf(team);
    const members = [editorEntry(first!, { name: "Completely different nickname" }), ...rest.map((m) => editorEntry(m))];
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members })).status).toBe(200);
    const renamed = stored(t, team).find((m) => m.id === first!.id)!;
    expect(renamed.name).toBe("Completely different nickname");
    expect(renamed.heroPool).toEqual(first!.heroPool);
  });

  test("two people with the SAME nickname never cross pools when their positions are swapped", async () => {
    const t = setup();
    const team = await t.saveTeam(3, [
      { slot: 1, position: 4, name: "Twin", heroPool: POOL[4]! },
      { slot: 2, position: 5, name: "Twin", heroPool: POOL[5]! },
    ]);
    const [first, second] = membersOf(team) as [StoredMember, StoredMember];
    const members = [editorEntry(first, { position: 5 }), editorEntry(second, { position: 4 })];
    expect((await t.putTeam(team.id, { name: "Team", partySize: 3, members })).status).toBe(200);
    const after = stored(t, team);
    expect(after.find((m) => m.id === first.id)!.heroPool).toEqual(POOL[4]!);
    expect(after.find((m) => m.id === second.id)!.heroPool).toEqual(POOL[5]!);
    // And the engine follows the person: `first` (pool 4x) now sits on Pos 5.
    const started = await t.startSession({ ...t.party(3, [3, 4, 5], 3), teamGroupId: team.id });
    expect(started.pools).toEqual({ 4: POOL[5], 5: POOL[4] });
  });

  test("an entry WITHOUT an id is a new person: fresh id, and it never inherits the pool of whoever sat there before", async () => {
    const t = setup();
    const team = await saveFive(t);
    const [replaced, ...rest] = membersOf(team);
    // Same nickname, same slot, same usual position -- but no id: that is somebody else.
    const members = [
      { slot: replaced!.slot, position: replaced!.position, name: replaced!.name, heroPool: [] as number[] },
      ...rest.map((m) => editorEntry(m)),
    ];
    const response = await t.putTeam(team.id, { name: "Team", partySize: 5, members });
    expect(response.status).toBe(200);
    const after = stored(t, team);
    expect(after.some((m) => m.id === replaced!.id)).toBe(false);
    const newcomer = after.find((m) => m.slot === replaced!.slot)!;
    expect(newcomer.id).toBeGreaterThan(Math.max(...team.members.map((m) => m.id)));
    expect(newcomer.heroPool).toEqual([]);
  });

  test("a match assignment naming a replaced / removed member is refused -- it is never re-pointed at somebody else", async () => {
    const t = setup();
    const team = await saveFive(t);
    const [replaced, ...rest] = membersOf(team);
    const assignment = Object.fromEntries(team.members.map((m) => [m.id, m.position]));
    const members = [{ slot: replaced!.slot, position: replaced!.position, name: replaced!.name, heroPool: POOL[1]! }, ...rest.map((m) => editorEntry(m))];
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members })).status).toBe(200);
    const started = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: team.id, teamAssignment: assignment });
    expect(started.status).toBe(400);
    expect(started.json.error).toBe("invalid_team_assignment");
  });

  test("the id of a removed member is never handed to a later member", async () => {
    const t = setup();
    const team = await t.saveTeam(3, [{ slot: 1, position: 4, name: "One", heroPool: POOL[4]! }, { slot: 2, position: 5, name: "Two", heroPool: POOL[5]! }]);
    const [one, two] = membersOf(team) as [StoredMember, StoredMember];
    // Remove the last-created member, then add a newcomer: SQLite must not recycle the freed id.
    const members = [editorEntry(one), { slot: 2, position: 5, name: "Newcomer", heroPool: POOL[5]! }];
    expect((await t.putTeam(team.id, { name: "Team", partySize: 3, members })).status).toBe(200);
    const newcomer = stored(t, team).find((m) => m.name === "Newcomer")!;
    expect(newcomer.id).not.toBe(two.id);
    expect(newcomer.id).toBeGreaterThan(two.id);
  });

  test("an id that is not a member of THIS team (other team, or nonexistent) is refused and nothing is written", async () => {
    const t = setup();
    const mine = await saveFive(t);
    const other = await saveFive(t);
    const foreign = other.members[0]!;
    const before = JSON.stringify(stored(t, mine));
    for (const strange of [foreign.id, 99999]) {
      const [first, ...rest] = membersOf(mine);
      const members = [editorEntry(first!, { id: strange, name: "Hijack" }), ...rest.map((m) => editorEntry(m))];
      const response = await t.putTeam(mine.id, { name: "Team", partySize: 5, members });
      expect(response.status).toBe(400);
    }
    expect(JSON.stringify(stored(t, mine))).toBe(before);
    expect(stored(t, other).map((m) => m.id)).toContain(foreign.id);
  });

  test("the same id twice in one save is refused (two entries cannot be the same person)", async () => {
    const t = setup();
    const team = await saveFive(t);
    const [first, second, ...rest] = membersOf(team);
    const members = [editorEntry(first!), editorEntry(first!, { slot: second!.slot, position: second!.position }), ...rest.map((m) => editorEntry(m))];
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members })).status).toBe(400);
  });

  test("an old team with unconfirmed positions stays unconfirmed after an id-bearing save: no pool is invented", async () => {
    const t = setup();
    const team = await t.saveTeam(5, fiveByPosition([1, 2, 3, 4, 5]).map((m) => ({ ...m, position: null })));
    const members = membersOf(team).map((m) => editorEntry(m, { position: null }));
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members })).status).toBe(200);
    expect(stored(t, team).map((m) => m.position)).toEqual([null, null, null, null, null]);
    const started = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 1), teamGroupId: team.id });
    expect(started.pools).toBeNull();
  });

  test("the owner's seat never takes a team pool, even after the team was edited and re-saved by id", async () => {
    const t = setup();
    const team = await saveFive(t);
    const members = membersOf(team).map((m) => editorEntry(m, { name: `${m.name}-edited` }));
    expect((await t.putTeam(team.id, { name: "Team", partySize: 5, members })).status).toBe(200);
    const started = await t.startSession({ ...t.party(5, [1, 2, 3, 4, 5], 2), teamGroupId: team.id });
    expect(started.pools).toEqual({ 1: POOL[1], 3: POOL[3], 4: POOL[4], 5: POOL[5] });
  });
});
