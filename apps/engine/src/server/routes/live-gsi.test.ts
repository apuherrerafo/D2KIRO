import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type { TeamCoachBoard } from "../../coach";
import { fakeCompute } from "../../coach/session-harness.fixtures";
import { createGsiLinkTestDb, gsiPayload, SENTINELS } from "../../live/gsi.fixtures";
import { createGsiLinkStore, GSI_LINK_TTL_MS } from "../../live/gsi-links";
import { GSI_DRAFT_PARTIAL, GSI_ITEM_CHANGES, LiveCaptureRegistry, LIVE_COMPANION_STALE_AFTER_MS, LIVE_STALE_AFTER_MS, type LiveCaptureStatus } from "../../live/live-capture-registry";
import type { HeroPositions } from "../../signals/hero-positions";
import { ProtocolSessionStore } from "../protocol-session";
import { COMPANION_MAX_BODY_BYTES, createLiveGsiRoutes, GSI_MAX_BODY_BYTES, parseCompanionHeartbeat } from "./live-gsi";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// TSK-219 -- the public GSI boundary end to end on the engine side: link store (REAL migration 0009 on
// in-memory SQLite) -> ingest route -> REAL LiveCaptureRegistry -> REAL kernel -> REAL protocol store ->
// REAL Team Coach Board route. Only V6's scorer is the deterministic fixture; positions are inline (S10).
// GSI payloads are synthetic with SENTINEL identity values (gsi.fixtures.ts).

const POSITIONS: HeroPositions = Object.fromEntries(
  [1, 2, 3, 4, 5].flatMap((position) => [0, 1, 2, 3].map((k) => [position * 10 + k, [{ position: position as 1 | 2 | 3 | 4 | 5, matches: 1000 }]])),
);
const POOL = Object.keys(POSITIONS).map(Number);
const T0 = 1_790_000_000_000;
const ACCOUNT_A = 101;
const ACCOUNT_B = 202;

function setup() {
  let clock = T0;
  const now = () => clock;
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now });
  const links = createGsiLinkStore(createGsiLinkTestDb().db);
  const routes = createLiveGsiRoutes({ links, registry, now });
  const protocol = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(POOL, POSITIONS), heroPositions: POSITIONS, heroCounters: new Map() });

  async function issue(accountId: number) {
    const response = routes.postIssue(accountId);
    expect(response.status).toBe(201);
    return (await response.json()) as { liveId: string; token: string; sessionId: string; expiresAt: string };
  }
  function post(liveId: string, body: unknown, init: { raw?: string; headers?: Record<string, string> } = {}) {
    const text = init.raw ?? JSON.stringify(body);
    return routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${liveId}`, { method: "POST", body: text, headers: { "content-type": "application/json", ...init.headers } }), liveId);
  }
  function status(sessionId: string): LiveCaptureStatus {
    const value = registry.status(sessionId);
    expect(value).not.toBeNull();
    return value!;
  }
  async function board(sessionId: string): Promise<TeamCoachBoard> {
    const response = await protocol.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  function beat(liveId: string, body: unknown, raw?: string) {
    return routes.postCompanion(new Request(`http://127.0.0.1/api/live/companion/${liveId}`, { method: "POST", body: raw ?? JSON.stringify(body), headers: { "content-type": "application/json" } }), liveId);
  }
  return { store, registry, links, routes, protocol, issue, post, beat, status, board, advance: (ms: number) => (clock += ms) };
}

const ALL_CONSOLE = ["log", "info", "warn", "error", "debug"] as const;
let consoleSpies: Mock<(...args: unknown[]) => void>[] = [];
beforeEach(() => {
  consoleSpies = ALL_CONSOLE.map((method) => spyOn(console, method).mockImplementation(() => undefined));
});
afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("live session creation and ownership", () => {
  test("issuing a link creates a live session owned by that account, and only that account", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    expect(t.protocol.isOwnedBy(issued.sessionId, ACCOUNT_A)).toBe(true);
    expect(t.protocol.isOwnedBy(issued.sessionId, ACCOUNT_B)).toBe(false);
    expect(t.status(issued.sessionId).connection).toBe("waiting");
  });

  test("the browser's link view carries the session to watch -- never the liveId nor the token", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const text = await t.routes.getLink(ACCOUNT_A).text();
    expect(JSON.parse(text).link.sessionId).toBe(issued.sessionId);
    expect(text).not.toContain(issued.token);
    expect(text).not.toContain(issued.liveId);
    expect(JSON.parse(await t.routes.getLink(ACCOUNT_B).text()).link).toBeNull();
  });

  test("a valid heartbeat from the menu connects Dota to the right session", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const response = await t.post(issued.liveId, gsiPayload({ token: issued.token, gameState: null }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    const status = t.status(issued.sessionId);
    expect(status.connection).toBe("connected");
    expect(status.gsi?.phase).toBe("idle");
    expect(status.draftPhase).toBe("waiting");
  });
});

describe("authentication fails closed", () => {
  test("wrong token, missing auth block, unknown and malformed live ids -> 401, nothing ingested", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    expect((await t.post(issued.liveId, gsiPayload({ token: "f".repeat(64) }))).status).toBe(401);
    expect((await t.post(issued.liveId, gsiPayload())).status).toBe(401);
    expect((await t.post(issued.liveId, { ...gsiPayload(), auth: { token: 7 } })).status).toBe(401);
    expect((await t.post("B".repeat(43), gsiPayload({ token: issued.token }))).status).toBe(401);
    expect((await t.post("short", gsiPayload({ token: issued.token }))).status).toBe(401);
    expect(t.status(issued.sessionId).connection).toBe("waiting");
  });

  test("expired token -> 401", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    t.advance(GSI_LINK_TTL_MS);
    expect((await t.post(issued.liveId, gsiPayload({ token: issued.token }))).status).toBe(401);
  });

  test("revoked token -> 401; rotated (re-downloaded) cfg -> the old one is dead, the new one works", async () => {
    const t = setup();
    const first = await t.issue(ACCOUNT_A);
    const second = await t.issue(ACCOUNT_A);
    expect((await t.post(first.liveId, gsiPayload({ token: first.token }))).status).toBe(401);
    expect((await t.post(second.liveId, gsiPayload({ token: second.token }))).status).toBe(200);
    t.routes.deleteLink(ACCOUNT_A);
    expect((await t.post(second.liveId, gsiPayload({ token: second.token }))).status).toBe(401);
  });

  test("rotation and revocation drop the old link's capture history from memory", async () => {
    const t = setup();
    const first = await t.issue(ACCOUNT_A);
    await t.post(first.liveId, gsiPayload({ token: first.token, teamName: "radiant", draft: "empty" }));
    expect(t.registry.status(first.sessionId)).not.toBeNull();
    const second = await t.issue(ACCOUNT_A);
    expect(t.registry.status(first.sessionId)).toBeNull();
    expect(t.registry.status(second.sessionId)).not.toBeNull();
    t.routes.deleteLink(ACCOUNT_A);
    expect(t.registry.status(second.sessionId)).toBeNull();
  });

  test("one user cannot ingest into another user's session", async () => {
    const t = setup();
    const mine = await t.issue(ACCOUNT_A);
    const theirs = await t.issue(ACCOUNT_B);
    // My (valid) token against their link id, and their link id with my token: both refused.
    expect((await t.post(theirs.liveId, gsiPayload({ token: mine.token, teamName: "dire", draft: { dire: { bans: [10] } } }))).status).toBe(401);
    expect(t.status(theirs.sessionId).connection).toBe("waiting");
    expect(t.status(theirs.sessionId).bans).toBe(0);
    // My own link only ever writes my own session.
    expect((await t.post(mine.liveId, gsiPayload({ token: mine.token, teamName: "dire", draft: { dire: { bans: [10] } } }))).status).toBe(200);
    expect(t.status(mine.sessionId).bans).toBe(1);
    expect(t.status(theirs.sessionId).bans).toBe(0);
  });

  test("identity in the body is never trusted: a payload naming another account still lands in the link owner's session", async () => {
    const t = setup();
    const mine = await t.issue(ACCOUNT_A);
    const payload = gsiPayload({ token: mine.token, teamName: "radiant" });
    (payload.player as Record<string, unknown>).accountid = String(ACCOUNT_B);
    expect((await t.post(mine.liveId, payload)).status).toBe(200);
    expect(t.protocol.isOwnedBy(mine.sessionId, ACCOUNT_A)).toBe(true);
    expect(t.protocol.isOwnedBy(mine.sessionId, ACCOUNT_B)).toBe(false);
  });
});

describe("input limits", () => {
  test("malformed JSON, non-object JSON and invalid UTF-8 -> 400", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    expect((await t.post(issued.liveId, null, { raw: "{not json" })).status).toBe(400);
    expect((await t.post(issued.liveId, [1, 2])).status).toBe(400);
    expect((await t.post(issued.liveId, null, { raw: "\"text\"" })).status).toBe(400);
    const invalidUtf8 = new Request(`http://127.0.0.1/x`, { method: "POST", body: new Uint8Array([0x7b, 0xff, 0xfe, 0x7d]) });
    expect((await t.routes.postIngest(invalidUtf8, issued.liveId)).status).toBe(400);
  });

  test("oversized body -> 413, whether Content-Length says so or the stream does", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const big = JSON.stringify({ ...gsiPayload({ token: issued.token }), pad: "x".repeat(GSI_MAX_BODY_BYTES) });
    expect((await t.post(issued.liveId, null, { raw: "{}", headers: { "content-length": String(GSI_MAX_BODY_BYTES + 1) } })).status).toBe(413);
    const streamed = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(big));
        controller.close();
      },
    });
    expect((await t.routes.postIngest(new Request("http://127.0.0.1/x", { method: "POST", body: streamed }), issued.liveId)).status).toBe(413);
    expect(t.status(issued.sessionId).connection).toBe("waiting");
  });

  test("rate limit per link: the 21st update inside one second -> 429, the next second is fine", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const body = gsiPayload({ token: issued.token, gameState: null });
    for (let i = 0; i < 20; i += 1) expect((await t.post(issued.liveId, body)).status).toBe(200);
    expect((await t.post(issued.liveId, body)).status).toBe(429);
    t.advance(1_000);
    expect((await t.post(issued.liveId, body)).status).toBe(200);
  });

  test("a flood of refused credentials turns refusals into 429 -- and never locks out a valid link, even a brand-new one", async () => {
    const t = setup();
    for (let i = 0; i < 120; i += 1) expect((await t.post("C".repeat(43), gsiPayload({ token: "e".repeat(64) }))).status).toBe(401);
    expect((await t.post("D".repeat(43), gsiPayload({ token: "e".repeat(64) }))).status).toBe(429);
    // A player who installs the cfg right in the middle of the flood still connects.
    const issued = await t.issue(ACCOUNT_A);
    expect((await t.post(issued.liveId, gsiPayload({ token: issued.token, gameState: null }))).status).toBe(200);
    t.advance(60_000);
    expect((await t.post("D".repeat(43), gsiPayload({ token: "e".repeat(64) }))).status).toBe(401);
  });

  test("a storage failure answers a bare 503 and is never thrown (its message would carry query parameters)", async () => {
    const t = setup();
    const broken = new Error(`SQLITE_ERROR params: ${ACCOUNT_A}`);
    const failing = { issue: () => { throw broken; }, active: () => { throw broken; }, revoke: () => { throw broken; }, verify: () => { throw broken; } };
    const routes = createLiveGsiRoutes({ links: failing, registry: t.registry, now: () => T0 });
    const ingest = await routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${"A".repeat(43)}`, { method: "POST", body: JSON.stringify(gsiPayload({ token: "a".repeat(64) })) }), "A".repeat(43));
    const responses = [ingest, routes.postIssue(ACCOUNT_A), routes.getLink(ACCOUNT_A), routes.deleteLink(ACCOUNT_A)];
    for (const response of responses) {
      expect(response.status).toBe(503);
      expect(await response.text()).not.toContain(String(ACCOUNT_A));
    }
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("draft capture through the kernel", () => {
  test("partial capture (no draft block): side + own hero only, reported as partial -- nothing invented", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    expect((await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "dire", heroId: 30, draft: "empty" }))).status).toBe(200);
    const status = t.status(issued.sessionId);
    expect(status.draftPhase).toBe("hero_selection");
    expect(status.localSide).toBe("dire");
    expect(status.picks).toBe(1);
    expect(status.bans).toBe(0);
    expect(status.captureHealth).toBe("degraded");
    expect(status.captureDetail).toBe(GSI_DRAFT_PARTIAL);
    expect(status.gsi?.draft).toEqual({ draftBlock: false, side: true, ownHero: true, bans: false, allyPicks: false, enemyPicks: false });
    expect(status.lastDetectedPick).toMatchObject({ side: "dire", heroId: 30, position: null, source: "gsi" });
  });

  test("Hero Selection with only our side already makes the board actionable (no lock needed first)", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", draft: "empty" }));
    const board = await t.board(issued.sessionId);
    expect(board.positions.some((column) => column.state === "RANKED")).toBe(true);
    expect(board.currentDecision.recommendedPosition).not.toBeNull();
    // A ban the Player reports afterwards still lands before ban resolution (rebuilt from the facts).
    expect(t.registry.observe(issued.sessionId, { type: "ban", heroId: 10 })).toMatchObject({ accepted: true, changed: true });
    const after = await t.board(issued.sessionId);
    expect(after.positions.flatMap((column) => column.top.map((candidate) => candidate.heroId))).not.toContain(10);
  });

  test("manual corrections: a mistaken ban or pick can be undone on a GSI session", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", draft: "empty" }));
    t.registry.observe(issued.sessionId, { type: "ban", heroId: 10 });
    t.registry.observe(issued.sessionId, { type: "pick", side: "dire", heroId: 21, position: null });
    expect(t.registry.observe(issued.sessionId, { type: "unban", heroId: 10 })).toMatchObject({ accepted: true, changed: true });
    expect(t.registry.observe(issued.sessionId, { type: "revert", side: "dire", heroId: 21 })).toMatchObject({ accepted: true, changed: true });
    expect(t.status(issued.sessionId)).toMatchObject({ bans: 0, picks: 0 });
  });

  test("a correction sticks: GSI repeating a fact the Player removed does not bring it back (Greptile TSK-219)", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const update = gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, draft: { radiant: { bans: [10], picks: [11] }, dire: { picks: [21] } } });
    await t.post(issued.liveId, update);
    expect(t.status(issued.sessionId)).toMatchObject({ bans: 1, picks: 2 });
    t.registry.observe(issued.sessionId, { type: "unban", heroId: 10 });
    t.registry.observe(issued.sessionId, { type: "revert", side: "dire", heroId: 21 });
    t.registry.observe(issued.sessionId, { type: "revert", side: "radiant", heroId: 11 });
    await t.post(issued.liveId, update);
    expect(t.status(issued.sessionId)).toMatchObject({ bans: 0, picks: 0 });
    // Stating the fact again by hand lifts the suppression; the next GSI update agrees and changes nothing.
    t.registry.observe(issued.sessionId, { type: "ban", heroId: 10 });
    await t.post(issued.liveId, update);
    expect(t.status(issued.sessionId)).toMatchObject({ bans: 1, picks: 0 });
    // A new match starts clean: nothing suppressed carries over.
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS" }));
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, matchId: "1234567899", draft: { radiant: { picks: [11] } } }));
    expect(t.status(issued.sessionId)).toMatchObject({ bans: 0, picks: 1 });
  });

  test("manual fallback still works on a GSI session, and the next GSI update never wipes it", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const update = gsiPayload({ token: issued.token, teamName: "radiant", heroId: 30, draft: "empty" });
    await t.post(issued.liveId, update);
    expect(t.registry.observe(issued.sessionId, { type: "ban", heroId: 11 }).accepted).toBe(true);
    expect(t.registry.observe(issued.sessionId, { type: "pick", side: "dire", heroId: 21, position: null }).accepted).toBe(true);
    await t.post(issued.liveId, update);
    expect(t.status(issued.sessionId)).toMatchObject({ bans: 1, picks: 2 });
  });

  test("full draft block: Team Coach recomputes from the normalized state (banned/picked heroes leave every column)", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", draft: { radiant: { bans: [10] }, dire: { bans: [20] } } }));
    const before = await t.board(issued.sessionId);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, draft: { radiant: { bans: [10], picks: [11] }, dire: { bans: [20] } } }));
    const after = await t.board(issued.sessionId);
    const ranked = (board: TeamCoachBoard) => board.positions.flatMap((column) => column.top.map((candidate) => candidate.heroId));
    for (const unavailable of [10, 20]) expect(ranked(before)).not.toContain(unavailable);
    expect(ranked(before)).toContain(11);
    expect(ranked(after)).not.toContain(11);
    expect(after.stateIdentity).not.toBe(before.stateIdentity);
    expect(t.status(issued.sessionId)).toMatchObject({ captureHealth: "ok", captureDetail: null, bans: 2, picks: 1 });
  });

  test("a completed draft is not restarted by the next identical update (manual facts survive COMPLETE)", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const full = gsiPayload({ token: issued.token, teamName: "radiant", draft: { radiant: { picks: [10, 20, 30, 40, 50] }, dire: { picks: [11, 21, 31, 41, 51] } } });
    await t.post(issued.liveId, full);
    expect(t.registry.observe(issued.sessionId, { type: "ban", heroId: 12 })).toMatchObject({ accepted: true, changed: true });
    expect(t.store.get(issued.sessionId)?.status).toBe("COMPLETE");
    await t.post(issued.liveId, full);
    expect(t.status(issued.sessionId)).toMatchObject({ draftPhase: "hero_selection", bans: 1, picks: 10 });
  });

  test("a hostile update with hundreds of draft slots is bounded by what a legal draft can hold", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const many = (from: number, count: number) => Array.from({ length: count }, (_, i) => from + i);
    const update = gsiPayload({ token: issued.token, teamName: "radiant", draft: { radiant: { bans: many(100, 99), picks: many(300, 99) }, dire: { bans: many(500, 99), picks: many(700, 99) } } });
    expect((await t.post(issued.liveId, update)).status).toBe(200);
    const status = t.status(issued.sessionId);
    expect(status.bans).toBe(40);
    expect(status.picks).toBe(10);
  });

  test("duplicate updates are idempotent: the same state twice changes nothing", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const update = gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, draft: { radiant: { bans: [10], picks: [11] }, dire: { picks: [21] } } });
    await t.post(issued.liveId, update);
    const first = await t.board(issued.sessionId);
    const firstStatus = t.status(issued.sessionId);
    for (let i = 0; i < 3; i += 1) expect((await t.post(issued.liveId, update)).status).toBe(200);
    expect(t.status(issued.sessionId)).toMatchObject({ bans: firstStatus.bans, picks: firstStatus.picks, lastDetectedPick: firstStatus.lastDetectedPick });
    expect((await t.board(issued.sessionId)).stateIdentity).toBe(first.stateIdentity);
  });

  test("reconnect: Dota goes quiet (stale), comes back, and the draft is still there", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const update = gsiPayload({ token: issued.token, teamName: "radiant", draft: { radiant: { bans: [10] } } });
    await t.post(issued.liveId, update);
    t.advance(LIVE_STALE_AFTER_MS + 1);
    expect(t.status(issued.sessionId).connection).toBe("stale");
    await t.post(issued.liveId, update);
    expect(t.status(issued.sessionId)).toMatchObject({ connection: "connected", bans: 1 });
  });

  test("the match starting ends the draft; a NEW match's hero selection starts a fresh one", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, draft: { radiant: { bans: [10], picks: [11] } } }));
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", telemetry: true }));
    expect(t.status(issued.sessionId).draftPhase).toBe("ended");
    expect(t.status(issued.sessionId).gsi?.telemetry).toContain("kda");
    t.advance(1_000);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "dire", matchId: "1234567891", draft: "empty" }));
    expect(t.status(issued.sessionId)).toMatchObject({ draftPhase: "hero_selection", localSide: "dire", bans: 0, picks: 0 });
  });
});

describe("connection diagnostics (/live-draft \"Diagnóstico de conexión\")", () => {
  test("packet age comes from the server clock; past the stale window GSI is no longer active", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    expect(t.status(issued.sessionId).gsi).toBeNull();
    await t.post(issued.liveId, gsiPayload({ token: issued.token, gameState: null }));
    expect(t.status(issued.sessionId).gsi).toMatchObject({ lastPacketAgeMs: 0, active: true });
    t.advance(532);
    expect(t.status(issued.sessionId).gsi).toMatchObject({ lastPacketAgeMs: 532, active: true });
    t.advance(LIVE_STALE_AFTER_MS);
    expect(t.status(issued.sessionId)).toMatchObject({ connection: "stale", gsi: { lastPacketAgeMs: LIVE_STALE_AFTER_MS + 532, active: false } });
    await t.post(issued.liveId, gsiPayload({ token: issued.token, gameState: null }));
    expect(t.status(issued.sessionId)).toMatchObject({ connection: "connected", gsi: { lastPacketAgeMs: 0, active: true } });
  });

  test("draft capabilities accumulate as Dota reports them; progression needs the draft to GROW between updates", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const opening = gsiPayload({ token: issued.token, teamName: "radiant", draft: { radiant: { bans: [10] } } });
    await t.post(issued.liveId, opening);
    expect(t.status(issued.sessionId).gsi).toMatchObject({ draft: { draftBlock: true, side: true, bans: true, ownHero: false, allyPicks: false, enemyPicks: false }, draftProgression: false });
    // The same state again is not progression.
    await t.post(issued.liveId, opening);
    expect(t.status(issued.sessionId).gsi?.draftProgression).toBe(false);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, draft: { radiant: { bans: [10], picks: [11] }, dire: { picks: [21] } } }));
    expect(t.status(issued.sessionId).gsi).toMatchObject({ draft: { ownHero: true, allyPicks: true, enemyPicks: true }, draftProgression: true });
    // Sticky for this draft, reset by a new match's draft.
    await t.post(issued.liveId, opening);
    expect(t.status(issued.sessionId).gsi?.draftProgression).toBe(true);
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "dire", matchId: "1234567891", draft: "empty" }));
    expect(t.status(issued.sessionId).gsi).toMatchObject({ draft: { draftBlock: false, bans: false, allyPicks: false }, draftProgression: false });
  });

  test("item changes are detected between match updates -- presence only, never the items", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const inMatch = (items: string[]) => gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", telemetry: true, items });
    await t.post(issued.liveId, inMatch(["item_tango", "item_branches"]));
    await t.post(issued.liveId, inMatch(["item_tango", "item_branches"]));
    expect(t.status(issued.sessionId).gsi?.telemetry).toContain("items");
    expect(t.status(issued.sessionId).gsi?.telemetry).not.toContain(GSI_ITEM_CHANGES);
    await t.post(issued.liveId, inMatch(["item_tango", "item_magic_wand"]));
    const status = JSON.stringify(t.status(issued.sessionId));
    expect(t.status(issued.sessionId).gsi?.telemetry).toContain(GSI_ITEM_CHANGES);
    for (const leaked of ["item_tango", "item_branches", "item_magic_wand", "itemsKey", "matchKey"]) expect(status).not.toContain(leaked);
  });

  test("a new match does not compare its inventory with the previous match's (re-queue is not an item change)", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const inMatch = (matchId: string, items: string[]) =>
      gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, matchId, gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", telemetry: true, items });
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", matchId: "1234567890", draft: "empty" }));
    await t.post(issued.liveId, inMatch("1234567890", ["item_tango", "item_branches"]));
    // Next game: a new draft, then its first inventory report -- different items, but nothing changed WITHIN this match.
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", matchId: "1234567891", draft: "empty" }));
    await t.post(issued.liveId, inMatch("1234567891", ["item_quelling_blade"]));
    expect(t.status(issued.sessionId).gsi?.telemetry).not.toContain(GSI_ITEM_CHANGES);
    await t.post(issued.liveId, inMatch("1234567891", ["item_quelling_blade", "item_magic_wand"]));
    expect(t.status(issued.sessionId).gsi?.telemetry).toContain(GSI_ITEM_CHANGES);
  });
});

describe("D2KIRO Companion heartbeat (/api/live/companion/<liveId>)", () => {
  const heartbeat = (token: string | null, companion: Record<string, unknown> = {}) => ({
    ...(token === null ? {} : { auth: { token } }),
    companion: { schema: "companion-heartbeat/v1", version: "0.1.0", dota: "not_running", phase: null, restartNeeded: false, ...companion },
  });

  test("a valid heartbeat marks the Companion present on the link owner's session, Dota closed included", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const response = await t.beat(issued.liveId, heartbeat(issued.token));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    const status = t.status(issued.sessionId);
    expect(status.companion).toEqual({ version: "0.1.0", dota: "not_running", phase: null, restartNeeded: false, active: true, lastSeenAgeMs: 0 });
    // Presence only: GSI's own connection and the draft are untouched.
    expect(status.connection).toBe("waiting");
    expect(status.gsi).toBeNull();
    expect(status.draftPhase).toBe("waiting");
  });

  test("phase and Dota state follow the latest beat; three missed beats = no longer active", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    await t.beat(issued.liveId, heartbeat(issued.token, { dota: "connected", phase: "HERO_SELECTION" }));
    expect(t.status(issued.sessionId).companion).toMatchObject({ dota: "connected", phase: "HERO_SELECTION", active: true });
    t.advance(LIVE_COMPANION_STALE_AFTER_MS + 1);
    expect(t.status(issued.sessionId).companion).toMatchObject({ active: false, lastSeenAgeMs: LIVE_COMPANION_STALE_AFTER_MS + 1 });
    await t.beat(issued.liveId, heartbeat(issued.token, { dota: "waiting", phase: null, restartNeeded: true }));
    expect(t.status(issued.sessionId).companion).toMatchObject({ dota: "waiting", phase: null, restartNeeded: true, active: true });
  });

  test("the Companion survives a new match's draft restart (it is the connection, not the draft)", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    await t.beat(issued.liveId, heartbeat(issued.token, { dota: "connected", phase: "MENU" }));
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", gameState: "DOTA_GAMERULES_STATE_HERO_SELECTION", matchId: "1" }));
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", matchId: "1" }));
    await t.post(issued.liveId, gsiPayload({ token: issued.token, teamName: "radiant", gameState: "DOTA_GAMERULES_STATE_HERO_SELECTION", matchId: "2" }));
    expect(t.status(issued.sessionId).companion?.dota).toBe("connected");
  });

  test("fails closed like GSI: wrong/missing token, unknown or malformed live id, rotated link -> 401, nothing noted", async () => {
    const t = setup();
    const first = await t.issue(ACCOUNT_A);
    expect((await t.beat(first.liveId, heartbeat("f".repeat(64)))).status).toBe(401);
    expect((await t.beat(first.liveId, heartbeat(null))).status).toBe(401);
    expect((await t.beat("B".repeat(43), heartbeat(first.token))).status).toBe(401);
    expect((await t.beat("short", heartbeat(first.token))).status).toBe(401);
    expect(t.status(first.sessionId).companion).toBeNull();
    const second = await t.issue(ACCOUNT_A);
    expect((await t.beat(first.liveId, heartbeat(first.token))).status).toBe(401);
    expect((await t.beat(second.liveId, heartbeat(second.token))).status).toBe(200);
  });

  test("anything that is not exactly a heartbeat -> 400; oversized -> 413", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    for (const bad of [{ dota: "maybe" }, { phase: "DRAFT" }, { version: "1.0" }, { version: "0.1.0; rm -rf" }, { schema: "companion-heartbeat/v2" }, { restartNeeded: "no" }]) {
      expect((await t.beat(issued.liveId, heartbeat(issued.token, bad))).status).toBe(400);
    }
    expect((await t.beat(issued.liveId, { auth: { token: issued.token } })).status).toBe(400);
    expect((await t.beat(issued.liveId, null, "not json")).status).toBe(400);
    expect((await t.beat(issued.liveId, null, JSON.stringify({ ...heartbeat(issued.token), pad: "x".repeat(COMPANION_MAX_BODY_BYTES) }))).status).toBe(413);
    expect(t.status(issued.sessionId).companion).toBeNull();
  });

  test("parseCompanionHeartbeat keeps only the five known fields", () => {
    expect(parseCompanionHeartbeat({ companion: { schema: "companion-heartbeat/v1", version: "1.2.3", dota: "connected", phase: "MATCH", restartNeeded: false, steamid: "765" } })).toEqual({ version: "1.2.3", dota: "connected", phase: "MATCH", restartNeeded: false });
    expect(parseCompanionHeartbeat({ companion: [] })).toBeNull();
    expect(parseCompanionHeartbeat(null)).toBeNull();
  });

  test("rate limited per link like every other update", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    for (let i = 0; i < 20; i++) expect((await t.beat(issued.liveId, heartbeat(issued.token))).status).toBe(200);
    expect((await t.beat(issued.liveId, heartbeat(issued.token))).status).toBe(429);
  });

  test("nothing from a heartbeat is logged or echoed; the status never carries the token or the live id", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const text = await (await t.beat(issued.liveId, heartbeat(issued.token, { dota: "connected", phase: "MENU" }))).text();
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    const exposed = [text, JSON.stringify(t.status(issued.sessionId))].join("|");
    for (const secret of [issued.token, issued.liveId, String(ACCOUNT_A)]) expect(exposed).not.toContain(secret);
  });
});

describe("privacy", () => {
  test("no raw payload, identity or token in any log line, response or status", async () => {
    const t = setup();
    const issued = await t.issue(ACCOUNT_A);
    const responses: string[] = [];
    const payloads = [
      gsiPayload({ token: issued.token, gameState: null }),
      gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, draft: { radiant: { bans: [10], picks: [11] } } }),
      gsiPayload({ token: issued.token, teamName: "radiant", heroId: 11, gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", telemetry: true }),
      gsiPayload({ token: "0".repeat(64), teamName: "radiant" }),
    ];
    for (const payload of payloads) responses.push(await (await t.post(issued.liveId, payload)).text());
    responses.push(await (await t.post(issued.liveId, null, { raw: `{"auth":{"token":"${issued.token}"},` })).text());
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
    const exposed = [...responses, JSON.stringify(t.status(issued.sessionId)), await t.routes.getLink(ACCOUNT_A).text()].join("\n");
    for (const secret of [...SENTINELS, issued.token, issued.liveId, String(ACCOUNT_A)]) expect(exposed).not.toContain(secret);
  });
});
