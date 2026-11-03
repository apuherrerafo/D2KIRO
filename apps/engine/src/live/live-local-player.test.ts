import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import { fakeCompute } from "../coach/session-harness.fixtures";
import type { Position } from "../draft-protocol/roles/role-belief";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createLiveGsiRoutes } from "../server/routes/live-gsi";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { HeroPositions } from "../signals/hero-positions";
import { createGsiLinkTestDb, gsiPayload } from "./gsi.fixtures";
import { createGsiLinkStore } from "./gsi-links";
import { applyLiveObservation, emptyLiveFacts, replayLiveFacts, type LiveFacts } from "./live-capture";
import { LiveCaptureRegistry } from "./live-capture-registry";

// STEP 1B-A -- truthful LOCAL player binding, end to end:
//   Player's declared seat (PUT /api/live/human-position) + GSI's local hero (the real, link-authenticated ingest)
//   -> REAL registry -> REAL kernel replay -> REAL store -> REAL Team Coach Board route.
// The ONLY exact hero -> position binding that is not a stated position is LOCAL_PLAYER. Pools and role data are in
// every scenario on purpose, and must never bind a teammate. Heroes and positions are inline (S10), cero red.

const A = 101;
const B = 202;
const T0 = 1_790_000_000_000;

const QUEEN_OF_PAIN = 39;
const EARTHSHAKER = 7;
const OTHER_ALLY = 22;
const THIRD_ALLY = 5;
const ENEMY = 91;

const share = (position: Position, matches: number) => ({ position, matches });
const POSITIONS: HeroPositions = {
  ...Object.fromEntries(([1, 2, 3, 4, 5] as Position[]).flatMap((position) => [0, 1, 2, 3].map((k) => [position * 10 + k, [share(position, 1000)]]))),
  [QUEEN_OF_PAIN]: [share(2, 900)],
  [EARTHSHAKER]: [share(2, 400), share(4, 600)], // credible at Pos 2 too: the trap
  [OTHER_ALLY]: [share(4, 800)],
  [THIRD_ALLY]: [share(5, 800)],
};
const ALL = Object.keys(POSITIONS).map(Number);
/** The Pos 2 pool holds BOTH Queen of Pain and Earthshaker -- being listed there is not who picked what. */
const POOLS: Partial<Record<Position, readonly number[]>> = { 2: [QUEEN_OF_PAIN, EARTHSHAKER], 4: [EARTHSHAKER, OTHER_ALLY], 5: [THIRD_ALLY] };

function setup() {
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => T0, heroPositions: POSITIONS });
  const links = createGsiLinkStore(createGsiLinkTestDb().db);
  const routes = createLiveGsiRoutes({ links, registry, now: () => T0 });
  const protocol = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(ALL, POSITIONS), heroPositions: POSITIONS, heroCounters: new Map() });

  async function issue(accountId: number) {
    const response = routes.postIssue(accountId);
    expect(response.status).toBe(201);
    return (await response.json()) as { liveId: string; token: string; sessionId: string };
  }
  /** One Dota GSI update through the link-authenticated route. Allies = our team's draft picks; `heroId` = the local hero. */
  async function gsi(link: { liveId: string; token: string }, options: { heroId?: number; allies?: number[]; enemies?: number[]; teamName?: "radiant" | "dire" | null } = {}) {
    const draft = { radiant: { picks: options.allies ?? [] }, dire: { picks: options.enemies ?? [] } };
    const body = gsiPayload({ teamName: options.teamName === undefined ? "radiant" : options.teamName, ...(options.heroId === undefined ? {} : { heroId: options.heroId }), draft, token: link.token });
    const response = await routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${link.liveId}`, { method: "POST", body: JSON.stringify(body) }), link.liveId);
    expect(response.status).toBe(200);
  }
  async function declare(accountId: number, body: unknown) {
    const response = await routes.putHumanPosition(new Request("http://127.0.0.1/api/live/human-position", { method: "PUT", body: JSON.stringify(body) }), accountId);
    return { status: response.status, text: await response.text() };
  }
  async function board(sessionId: string): Promise<TeamCoachBoard> {
    const response = await protocol.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  const localPlayer = (sessionId: string) => registry.status(sessionId)!.localPlayer;
  return { store, registry, routes, issue, gsi, declare, board, localPlayer };
}

const column = (board: TeamCoachBoard, position: Position) => board.positions.find((candidate) => candidate.position === position)!;
const filledHeroes = (board: TeamCoachBoard) => board.positions.flatMap((entry) => (entry.filledHeroId === null ? [] : [[entry.position, entry.filledHeroId] as const]));

describe("A. declared seat + GSI local hero => LOCAL_PLAYER", () => {
  test("Pos 2 declared, Queen of Pain is the local hero => Queen of Pain -> Pos 2, and nobody else", async () => {
    const t = setup();
    const link = await t.issue(A);
    expect((await t.declare(A, { humanPosition: 2 })).status).toBe(200);
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    const body = await t.board(link.sessionId);
    expect(column(body, 2)).toMatchObject({ state: "FILLED", alreadyFilled: true, filledHeroId: QUEEN_OF_PAIN, eligibleNow: false });
    expect(filledHeroes(body)).toEqual([[2, QUEEN_OF_PAIN]]);
    expect(body.unboundOwnHeroIds).toEqual([]);
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 2, heroId: QUEEN_OF_PAIN, bound: true });
  });

  test("the order does not matter: GSI names the hero first, the seat is declared afterwards", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    expect((await t.board(link.sessionId)).unboundOwnHeroIds).toEqual([QUEEN_OF_PAIN]); // GSI alone is not a position
    expect(t.localPlayer(link.sessionId)).toEqual({ position: null, heroId: QUEEN_OF_PAIN, bound: false });
    await t.declare(A, { humanPosition: 2 });
    expect(column(await t.board(link.sessionId), 2)).toMatchObject({ state: "FILLED", filledHeroId: QUEEN_OF_PAIN });
  });

  test("LOCAL_PLAYER provenance survives GSI: the local hero is also an allied pick, and stays identifiable (pure replay)", () => {
    const facts: LiveFacts = [
      { type: "draft_started" as const, patch: "7.41e" },
      { type: "side" as const, side: "radiant" as const },
      { type: "pick" as const, side: "radiant" as const, heroId: QUEEN_OF_PAIN, position: null },
      { type: "pick" as const, side: "radiant" as const, heroId: EARTHSHAKER, position: null },
      { type: "local_hero" as const, heroId: QUEEN_OF_PAIN },
    ].reduce((current, observation) => applyLiveObservation(current, observation).facts, emptyLiveFacts("7.41e"));
    const replay = replayLiveFacts({ ...facts, bansClosed: true }, { sessionId: "pure-A", rulesetId: "dota2/ranked-all-pick", partyContext: { partySize: 5, side: "radiant", controlledSlots: [] }, defaultSide: "radiant", humanPosition: 2 })!;
    expect(replay.ownPositions.heroes).toEqual([
      { heroId: QUEEN_OF_PAIN, position: 2, provenance: "LOCAL_PLAYER", possiblePositions: [2] },
      { heroId: EARTHSHAKER, position: null, provenance: "UNRESOLVED", possiblePositions: [1, 3, 4, 5] },
    ]);
    expect(replay.ownBindings.map((binding) => [binding.assignedPosition, binding.provenance])).toEqual([[2, "LOCAL_PLAYER"]]);
  });
});

describe("B. a teammate in the declared position's pool is NOT bound", () => {
  test("Earthshaker is visible and sits in the Pos 2 pool => Earthshaker does NOT bind to Pos 2", async () => {
    const t = setup();
    const link = await t.issue(A);
    t.registry.setTeamContext(link.sessionId, A, { teamGroupId: 7, playerPoolsByPosition: POOLS });
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [EARTHSHAKER, QUEEN_OF_PAIN] });
    const body = await t.board(link.sessionId);
    expect(column(body, 2).filledHeroId).toBe(QUEEN_OF_PAIN);
    expect(filledHeroes(body).some(([, heroId]) => heroId === EARTHSHAKER)).toBe(false);
    expect(body.unboundOwnHeroIds).toEqual([EARTHSHAKER]);
  });

  test("before the Player's own hero is known, Earthshaker alone is not Pos 2 either: the seat stays open", async () => {
    const t = setup();
    const link = await t.issue(A);
    t.registry.setTeamContext(link.sessionId, A, { teamGroupId: 7, playerPoolsByPosition: POOLS });
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { allies: [EARTHSHAKER] }); // no hero.id: the Player has not locked yet
    const body = await t.board(link.sessionId);
    expect(filledHeroes(body)).toEqual([]);
    expect(column(body, 2).alreadyFilled).toBe(false);
    expect(body.unboundOwnHeroIds).toEqual([EARTHSHAKER]);
  });
});

describe("C. the local hero is CURRENT state: X -> Y replaces the binding", () => {
  test("GSI changes the local hero Queen of Pain -> Earthshaker: Queen of Pain loses it, Earthshaker gains it", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN, EARTHSHAKER] });
    expect(column(await t.board(link.sessionId), 2).filledHeroId).toBe(QUEEN_OF_PAIN);

    await t.gsi(link, { heroId: EARTHSHAKER, allies: [QUEEN_OF_PAIN, EARTHSHAKER] });
    const body = await t.board(link.sessionId);
    expect(column(body, 2).filledHeroId).toBe(EARTHSHAKER);
    expect(filledHeroes(body)).toEqual([[2, EARTHSHAKER]]); // never both heroes on the local seat
    expect(body.unboundOwnHeroIds).toEqual([QUEEN_OF_PAIN]);
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 2, heroId: EARTHSHAKER, bound: true });
  });

  test("GSI stops naming a local hero: the binding is dropped, not kept from history", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    expect(t.localPlayer(link.sessionId).bound).toBe(true);

    await t.gsi(link, { allies: [QUEEN_OF_PAIN] });
    const body = await t.board(link.sessionId);
    expect(filledHeroes(body)).toEqual([]);
    expect(body.unboundOwnHeroIds).toEqual([QUEEN_OF_PAIN]);
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 2, heroId: null, bound: false });
  });

  test("an update that does not say which team we are on cannot place the hero: nothing binds", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN], teamName: null });
    expect(t.localPlayer(link.sessionId).bound).toBe(false);
  });

  test("the same update repeated is a no-op (no churn, one binding)", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    const revision = t.registry.status(link.sessionId)!.factsRevision;
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    expect(t.registry.status(link.sessionId)!.factsRevision).toBe(revision);
    expect(filledHeroes(await t.board(link.sessionId))).toEqual([[2, QUEEN_OF_PAIN]]);
  });
});

describe("D. changing or clearing the declared position invalidates the old binding", () => {
  test("Pos 2 -> Pos 4: the hero moves, Pos 2 is open again", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    expect(column(await t.board(link.sessionId), 2).filledHeroId).toBe(QUEEN_OF_PAIN);

    await t.declare(A, { humanPosition: 4 });
    const body = await t.board(link.sessionId);
    expect(column(body, 4).filledHeroId).toBe(QUEEN_OF_PAIN);
    expect(column(body, 2)).toMatchObject({ filledHeroId: null, alreadyFilled: false });
    expect(filledHeroes(body)).toEqual([[4, QUEEN_OF_PAIN]]);
  });

  test("Pos 2 -> cleared (null): the exact binding disappears and the hero is unbound again", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    const cleared = await t.declare(A, { humanPosition: null });
    expect(cleared.status).toBe(200);
    expect(JSON.parse(cleared.text).localPlayer).toEqual({ position: null, heroId: QUEEN_OF_PAIN, bound: false });
    const body = await t.board(link.sessionId);
    expect(filledHeroes(body)).toEqual([]);
    expect(column(body, 2)).toMatchObject({ alreadyFilled: false, filledHeroId: null });
    expect(body.unboundOwnHeroIds).toEqual([QUEEN_OF_PAIN]);
  });

  test("re-declaring the same position is idempotent", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    await t.declare(A, { humanPosition: 2 });
    expect(filledHeroes(await t.board(link.sessionId))).toEqual([[2, QUEEN_OF_PAIN]]);
  });
});

describe("E. teammates with no identity evidence stay UNRESOLVED", () => {
  test("three visible allies, no local hero, no declared seat => nobody is placed, nothing is filled by a guess", async () => {
    const t = setup();
    const link = await t.issue(A);
    t.registry.setTeamContext(link.sessionId, A, { teamGroupId: 7, playerPoolsByPosition: POOLS });
    await t.gsi(link, { allies: [EARTHSHAKER, OTHER_ALLY, THIRD_ALLY], enemies: [ENEMY] });
    const body = await t.board(link.sessionId);
    expect(filledHeroes(body)).toEqual([]);
    expect([...body.unboundOwnHeroIds].sort((a, b) => a - b)).toEqual([THIRD_ALLY, EARTHSHAKER, OTHER_ALLY].sort((a, b) => a - b));
    for (const entry of body.positions) expect(entry.alreadyFilled).toBe(false);
  });

  test("with the Player's seat bound, the OTHER allies are still unresolved", async () => {
    const t = setup();
    const link = await t.issue(A);
    t.registry.setTeamContext(link.sessionId, A, { teamGroupId: 7, playerPoolsByPosition: POOLS });
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN, EARTHSHAKER, OTHER_ALLY, THIRD_ALLY] });
    const body = await t.board(link.sessionId);
    expect(filledHeroes(body)).toEqual([[2, QUEEN_OF_PAIN]]);
    expect([...body.unboundOwnHeroIds].sort((a, b) => a - b)).toEqual([THIRD_ALLY, EARTHSHAKER, OTHER_ALLY].sort((a, b) => a - b));
  });
});

describe("PUT /api/live/human-position -- the setter", () => {
  test("only 1..5 or null are accepted; anything else is a 400 and changes nothing", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 3 });
    for (const bad of [{ humanPosition: 0 }, { humanPosition: 6 }, { humanPosition: "2" }, { humanPosition: 2.5 }, { humanPosition: true }, { humanPosition: [2] }, {}, { position: 2 }, null, "2"]) {
      expect({ bad, status: (await t.declare(A, bad)).status }).toEqual({ bad, status: 400 });
    }
    expect(t.localPlayer(link.sessionId).position).toBe(3);
  });

  test("a malformed or oversized body is refused before anything is read", async () => {
    const t = setup();
    await t.issue(A);
    const malformed = await t.routes.putHumanPosition(new Request("http://127.0.0.1/api/live/human-position", { method: "PUT", body: "{not json" }), A);
    expect(malformed.status).toBe(400);
    const oversized = await t.routes.putHumanPosition(new Request("http://127.0.0.1/api/live/human-position", { method: "PUT", body: JSON.stringify({ humanPosition: 2, pad: "x".repeat(4096) }) }), A);
    expect(oversized.status).toBe(413);
  });

  test("without a Dota link there is no live session to declare on: 409, nothing created", async () => {
    const t = setup();
    expect((await t.declare(A, { humanPosition: 2 })).status).toBe(409);
  });

  test("the seat is per ACCOUNT: B declaring a seat never touches A's session, and the body can never name a session", async () => {
    const t = setup();
    const linkA = await t.issue(A);
    const linkB = await t.issue(B);
    await t.declare(A, { humanPosition: 2 });
    await t.declare(B, { humanPosition: 5, sessionId: linkA.sessionId });
    expect(t.localPlayer(linkA.sessionId).position).toBe(2);
    expect(t.localPlayer(linkB.sessionId).position).toBe(5);
  });

  test("a session another account owns refuses the declaration at the registry (never silently applied)", async () => {
    const t = setup();
    const linkA = await t.issue(A);
    expect(t.registry.setHumanPosition(linkA.sessionId, B, 2)).toBe(false);
    expect(t.registry.setHumanPosition("no-such-session", A, 2)).toBe(false);
    expect(t.localPlayer(linkA.sessionId).position).toBeNull();
  });

  test("the response carries the engine's own view of the seat -- never the account, the token or the live id", async () => {
    const t = setup();
    const link = await t.issue(A);
    const answer = await t.declare(A, { humanPosition: 2 });
    expect(JSON.parse(answer.text)).toEqual({ schema: "live-human-position/v1", localPlayer: { position: 2, heroId: null, bound: false } });
    for (const secret of [link.token, link.liveId, String(A)]) expect(answer.text).not.toContain(secret);
  });

});

describe("F. the declared seat belongs to ONE match: a new match starts undeclared", () => {
  /** A GSI update of another match (new match id) on the same live link. */
  async function otherMatch(t: ReturnType<typeof setup>, link: { liveId: string; token: string }, options: { heroId?: number } = {}) {
    const picks = options.heroId === undefined ? [] : [options.heroId];
    const body = gsiPayload({ teamName: "radiant", token: link.token, matchId: "9876543210", ...(options.heroId === undefined ? {} : { heroId: options.heroId }), draft: { radiant: { picks }, dire: { picks: [] } } });
    const response = await t.routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${link.liveId}`, { method: "POST", body: JSON.stringify(body) }), link.liveId);
    expect(response.status).toBe(200);
  }

  test("match A: Pos 2 declared and bound. New match starts => humanPosition is null, nothing is bound", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 2, heroId: QUEEN_OF_PAIN, bound: true });

    // Match B: GSI names the SAME hero for the same side -- the old declaration must not silently apply to it.
    await otherMatch(t, link, { heroId: QUEEN_OF_PAIN });
    expect(t.store.metadata(link.sessionId)!.humanPosition).toBeNull();
    expect(t.localPlayer(link.sessionId)).toEqual({ position: null, heroId: QUEEN_OF_PAIN, bound: false });
    const body = await t.board(link.sessionId);
    expect(filledHeroes(body)).toEqual([]);
    expect(body.unboundOwnHeroIds).toEqual([QUEEN_OF_PAIN]);

    // ...and it binds again only once the Player declares again.
    await t.declare(A, { humanPosition: 4 });
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 4, heroId: QUEEN_OF_PAIN, bound: true });
    expect(filledHeroes(await t.board(link.sessionId))).toEqual([[4, QUEEN_OF_PAIN]]);
  });

  test("the same match key after the draft ended (match phase, then a fresh draft) also starts undeclared", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    const inMatch = gsiPayload({ gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", teamName: "radiant", heroId: QUEEN_OF_PAIN, token: link.token });
    await t.routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${link.liveId}`, { method: "POST", body: JSON.stringify(inMatch) }), link.liveId);
    expect(t.localPlayer(link.sessionId).position).toBe(2); // same match, still in progress: nothing forgotten yet

    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    expect(t.localPlayer(link.sessionId)).toEqual({ position: null, heroId: QUEEN_OF_PAIN, bound: false });
    expect(filledHeroes(await t.board(link.sessionId))).toEqual([]);
  });

  test("a repeated update of the SAME match never forgets the seat", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 2, heroId: QUEEN_OF_PAIN, bound: true });
  });

  test("a seat declared AFTER the new match started is that match's own and survives its updates", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    await otherMatch(t, link);
    expect(t.localPlayer(link.sessionId).position).toBeNull();
    await t.declare(A, { humanPosition: 5 });
    await otherMatch(t, link, { heroId: THIRD_ALLY });
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 5, heroId: THIRD_ALLY, bound: true });
  });
});

describe("G. X -> Y must not leave a GHOST local pick (full draft state, not only the binding)", () => {
  const ownPickCount = (t: ReturnType<typeof setup>, sessionId: string) => t.registry.status(sessionId)!.picks;

  test("GSI is the ONLY source of X: the local hero changes X -> Y => X is gone from the draft, Y holds the seat", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN }); // no draft block lists anyone: X exists only because GSI named it
    expect(ownPickCount(t, link.sessionId)).toBe(1);

    await t.gsi(link, { heroId: EARTHSHAKER });
    const body = await t.board(link.sessionId);
    expect(ownPickCount(t, link.sessionId)).toBe(1); // one own pick, not two
    expect(filledHeroes(body)).toEqual([[2, EARTHSHAKER]]);
    expect(body.unboundOwnHeroIds).toEqual([]); // no ghost Queen of Pain waiting for a position
    expect(t.localPlayer(link.sessionId)).toEqual({ position: 2, heroId: EARTHSHAKER, bound: true });
  });

  test("X -> Y -> X: no residue either way, and it never needs a declared seat to be safe", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsi(link, { heroId: QUEEN_OF_PAIN });
    await t.gsi(link, { heroId: EARTHSHAKER });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN });
    expect(ownPickCount(t, link.sessionId)).toBe(1);
    expect((await t.board(link.sessionId)).unboundOwnHeroIds).toEqual([QUEEN_OF_PAIN]);
  });

  test("X -> (none) -> Y: a pause in the local hero does not let X outlive its only source", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsi(link, { heroId: QUEEN_OF_PAIN });
    await t.gsi(link, {});
    await t.gsi(link, { heroId: EARTHSHAKER });
    expect(ownPickCount(t, link.sessionId)).toBe(1);
    expect((await t.board(link.sessionId)).unboundOwnHeroIds).toEqual([EARTHSHAKER]);
  });

  test("a full side (4 allies + X) still takes Y: the ghost never makes the draft look full", async () => {
    const t = setup();
    const link = await t.issue(A);
    const four = [OTHER_ALLY, THIRD_ALLY, 50, 60];
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: four });
    expect(ownPickCount(t, link.sessionId)).toBe(5);
    await t.gsi(link, { heroId: EARTHSHAKER, allies: four });
    const body = await t.board(link.sessionId);
    expect(ownPickCount(t, link.sessionId)).toBe(5);
    expect([...body.unboundOwnHeroIds].sort((a, b) => a - b)).toEqual([...four, EARTHSHAKER].sort((a, b) => a - b));
  });

  test("X is ALSO stated by the draft block (another source): it is a real pick and stays when the local hero changes to Y", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.declare(A, { humanPosition: 2 });
    await t.gsi(link, { heroId: QUEEN_OF_PAIN, allies: [QUEEN_OF_PAIN] });
    await t.gsi(link, { heroId: EARTHSHAKER, allies: [QUEEN_OF_PAIN, EARTHSHAKER] });
    expect(ownPickCount(t, link.sessionId)).toBe(2);
    expect(filledHeroes(await t.board(link.sessionId))).toEqual([[2, EARTHSHAKER]]);
  });

  test("X first seen alone, then corroborated by another source, then the local hero changes: X stays (it is a real pick)", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsi(link, { heroId: QUEEN_OF_PAIN });
    t.registry.observe(link.sessionId, { type: "pick", side: "radiant", heroId: QUEEN_OF_PAIN, position: null }); // the Player confirms it by hand
    await t.gsi(link, { heroId: EARTHSHAKER });
    expect(ownPickCount(t, link.sessionId)).toBe(2);
  });

  test("pure facts: the replacement is atomic -- one local-only pick at a time, never two", () => {
    const local = (heroId: number) => ({ type: "pick" as const, side: "radiant" as const, heroId, position: null, viaLocalHero: true as const });
    const first = applyLiveObservation(emptyLiveFacts("7.41e"), local(QUEEN_OF_PAIN)).facts;
    expect(first.localOnlyPick).toBe(QUEEN_OF_PAIN);
    const outcome = applyLiveObservation(first, local(EARTHSHAKER));
    expect(outcome.changed).toBe(true);
    expect(outcome.facts.picks.map((pick) => pick.heroId)).toEqual([EARTHSHAKER]);
    expect(outcome.facts.localOnlyPick).toBe(EARTHSHAKER);
    // A revert of the local-only pick clears the marker too.
    expect(applyLiveObservation(outcome.facts, { type: "revert", side: "radiant", heroId: EARTHSHAKER }).facts.localOnlyPick).toBeNull();
  });
});

describe("H. an allied hero with NO exact identity never makes Team Coach sure about a position that may already be taken", () => {
  // Bait: Pos 5's saved pool has exactly ONE hero left, and that hero is on Pos 5's shortlist. With every position
  // certainly open this is a STRATEGIC call (POOL_SCARCITY on Pos 5). A visible ally of unknown role must switch it off.
  const BAIT_POOLS: Partial<Record<Position, readonly number[]>> = { 5: [50] };
  async function boardWith(options: { allies: number[]; enemies?: number[]; heroId?: number; declared?: Position }) {
    const t = setup();
    const link = await t.issue(A);
    t.registry.setTeamContext(link.sessionId, A, { teamGroupId: 7, playerPoolsByPosition: BAIT_POOLS });
    if (options.declared !== undefined) await t.declare(A, { humanPosition: options.declared });
    await t.gsi(link, { allies: options.allies, enemies: options.enemies ?? [], ...(options.heroId === undefined ? {} : { heroId: options.heroId }) });
    return { t, link, body: await t.board(link.sessionId) };
  }

  test("control (the lock has teeth): with nobody visible, the same pool bait IS a strategic call", async () => {
    const { body } = await boardWith({ allies: [] });
    expect(body.currentDecision.targetBasis).toBe("STRATEGIC");
    expect(body.currentDecision.recommendedPosition).toBe(5);
  });

  test("one visible ally with no identity: no strategic claim, nothing filled, the doubt is said out loud", async () => {
    const { body } = await boardWith({ allies: [OTHER_ALLY] });
    expect(body.unboundOwnHeroIds).toEqual([OTHER_ALLY]);
    expect(filledHeroes(body)).toEqual([]);
    for (const entry of body.positions) expect(entry.alreadyFilled).toBe(false);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(body.currentDecision.reason).toContain("en duda");
    expect(body.currentDecision.reason).not.toContain("Asegurar el pool");
  });

  test("two visible allies with no identity, round 2 open (pools + curated roles would 'explain' both): still no strategic claim", async () => {
    const { body } = await boardWith({ allies: [EARTHSHAKER, OTHER_ALLY], enemies: [ENEMY, 92] });
    expect(body.currentDecision.actionablePositions.length).toBeGreaterThan(0); // an action IS open: the claim is withheld, not skipped
    expect(filledHeroes(body)).toEqual([]);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(body.currentDecision.reason).toContain("en duda");
  });

  test("the Player's own seat is bound but a teammate is unknown: the remaining positions are STILL in doubt", async () => {
    const { t, link, body } = await boardWith({ allies: [QUEEN_OF_PAIN, OTHER_ALLY], enemies: [ENEMY, 92], heroId: QUEEN_OF_PAIN, declared: 2 });
    expect(t.localPlayer(link.sessionId).bound).toBe(true);
    expect(body.currentDecision.actionablePositions.length).toBeGreaterThan(0);
    expect(filledHeroes(body)).toEqual([[2, QUEEN_OF_PAIN]]);
    expect(body.unboundOwnHeroIds).toEqual([OTHER_ALLY]);
    expect(body.currentDecision.targetBasis).toBe("PHASE_FALLBACK");
    expect(body.currentDecision.reason).toContain("en duda");
  });

  test("a fully-identified team (stated position) is not affected: the lock does not over-fire", async () => {
    const t = setup();
    const link = await t.issue(A);
    t.registry.setTeamContext(link.sessionId, A, { teamGroupId: 7, playerPoolsByPosition: BAIT_POOLS });
    await t.gsi(link, { allies: [] });
    t.registry.observe(link.sessionId, { type: "pick", side: "radiant", heroId: QUEEN_OF_PAIN, position: 2 });
    const body = await t.board(link.sessionId);
    expect(filledHeroes(body)).toEqual([[2, QUEEN_OF_PAIN]]);
    expect(body.currentDecision.targetBasis).toBe("STRATEGIC");
    expect(body.currentDecision.recommendedPosition).toBe(5);
  });
});
