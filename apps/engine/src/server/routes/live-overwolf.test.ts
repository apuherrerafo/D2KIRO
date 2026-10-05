import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import type { TeamCoachBoard } from "../../coach";
import { fakeCompute } from "../../coach/session-harness.fixtures";
import { CAPTURE_CREDENTIAL_TTL_MS, CAPTURE_PAIRING_TTL_MS, createCapturePairingStore } from "../../live/capture-pairing";
import { createGsiLinkTestDb, gsiPayload } from "../../live/gsi.fixtures";
import { createGsiLinkStore } from "../../live/gsi-links";
import { LiveCaptureRegistry, LIVE_STALE_AFTER_MS, OVERWOLF_LOST, type LiveCaptureStatus } from "../../live/live-capture-registry";
import type { HeroPositions } from "../../signals/hero-positions";
import { ProtocolSessionStore } from "../protocol-session";
import { createLiveGsiRoutes } from "./live-gsi";
import { createLiveOverwolfRoutes, OVERWOLF_MAX_EVENTS_PER_BATCH } from "./live-overwolf";
import { createProtocolSessionRoutes } from "./protocol-sessions";

// Overwolf automatic capture, engine side, end to end: pairing code (REAL migration 0010 on in-memory
// SQLite) -> scoped credential -> batch route -> REAL LiveCaptureRegistry -> REAL kernel -> REAL protocol
// store -> REAL Team Coach Board route. Only V6's scorer is the deterministic fixture; positions are inline
// (S10). Overwolf payloads are synthetic. Identity SENTINELS prove nothing identity-shaped is ever stored.

const POSITIONS: HeroPositions = Object.fromEntries(
  [1, 2, 3, 4, 5].flatMap((position) => [0, 1, 2, 3].map((k) => [position * 10 + k, [{ position: position as 1 | 2 | 3 | 4 | 5, matches: 1000 }]])),
);
const POOL = Object.keys(POSITIONS).map(Number);
const T0 = 1_790_000_000_000;
const A = 101;
const B = 202;
const ALL_PRESENCE = { roster: true, bans: true, draft: true, players: true };
const NO_PRESENCE = { roster: false, bans: false, draft: false, players: false };

type Payload = Record<string, unknown>;

function setup() {
  let clock = T0;
  const now = () => clock;
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now });
  const { db } = createGsiLinkTestDb();
  const links = createGsiLinkStore(db);
  const pairing = createCapturePairingStore(db);
  const gsi = createLiveGsiRoutes({ links, registry, now });
  const routes = createLiveOverwolfRoutes({ pairing, links, registry, now, listHeroes: async () => [{ id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage", imgUrl: "x", steamId: "SENTINEL" }, { bad: true }] });
  const protocol = createProtocolSessionRoutes({ store, computeSuggestions: fakeCompute(POOL, POSITIONS), heroPositions: POSITIONS, heroCounters: new Map() });
  let seq = 0;

  async function link(accountId: number) {
    const response = gsi.postIssue(accountId);
    expect(response.status).toBe(201);
    return (await response.json()) as { liveId: string; token: string; sessionId: string };
  }
  async function pair(accountId: number) {
    const issued = routes.postPairingCode(accountId);
    expect(issued.status).toBe(201);
    const { code } = (await issued.json()) as { code: string };
    const redeemed = await routes.postPair(new Request("http://127.0.0.1/api/live/overwolf/pair", { method: "POST", body: JSON.stringify({ code }) }));
    expect(redeemed.status).toBe(200);
    return { code, ...((await redeemed.json()) as { captureId: string; token: string; expiresAt: string }) };
  }
  function event(payload: Payload) {
    seq += 1;
    return { eventId: `ow-test-${seq}`, seq, emittedAt: new Date(clock).toISOString(), payload };
  }
  function batch(captureId: string, token: string, events: Payload[], presence = ALL_PRESENCE, extra: Record<string, unknown> = {}) {
    const body = { schema: "overwolf-capture/v1", events: events.map(event), presence, ...extra };
    return routes.postBatch(new Request(`http://127.0.0.1/api/live/overwolf/${captureId}`, { method: "POST", body: JSON.stringify(body), headers: { "x-capture-credential": token } }), captureId);
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
  return { store, registry, links, pairing, gsi, routes, protocol, link, pair, batch, status, board, advance: (ms: number) => (clock += ms), now };
}

const started = { type: "session_started", format: "all_pick", patch: "7.41e" };
const side = (value: "radiant" | "dire") => ({ type: "local_side_identified", side: value });
const ban = (hero: number) => ({ type: "hero_banned", hero, side: "unknown" });
const pick = (hero: number, owner: "radiant" | "dire", position?: number) => ({ type: "hero_picked", hero, side: owner, ...(position === undefined ? {} : { position }) });

const ALL_CONSOLE = ["log", "info", "warn", "error", "debug"] as const;
let consoleSpies: Mock<(...args: unknown[]) => void>[] = [];
beforeEach(() => {
  consoleSpies = ALL_CONSOLE.map((method) => spyOn(console, method).mockImplementation(() => undefined));
});
afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("pairing", () => {
  test("a code needs an active Dota link, is one-time, and becomes a scoped credential", async () => {
    const t = setup();
    expect(t.routes.postPairingCode(A).status).toBe(409);
    await t.link(A);
    const issued = t.routes.postPairingCode(A);
    expect(issued.status).toBe(201);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    const { code } = (await issued.json()) as { code: string };
    expect(code).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const redeem = () => t.routes.postPair(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ code: code.toLowerCase() }) }));
    const first = await redeem();
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ schema: "live-capture-credential/v1" });
    // One-time: the same code never works twice.
    expect((await redeem()).status).toBe(401);
  });

  test("an expired code fails closed", async () => {
    const t = setup();
    await t.link(A);
    const { code } = (await t.routes.postPairingCode(A).json()) as { code: string };
    t.advance(CAPTURE_PAIRING_TTL_MS);
    expect((await t.routes.postPair(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ code }) }))).status).toBe(401);
  });

  test("a malformed or unknown code is refused identically (no oracle) and never reaches the store", async () => {
    const t = setup();
    await t.link(A);
    for (const body of [{ code: "NOPE" }, { code: 12345678 }, { code: "AAAA-AAAA" }, {}, { code: "I0O1I0O1" }]) {
      const response = await t.routes.postPair(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(body) }));
      expect(response.status).toBe(401);
      expect(await response.text()).toBe("");
    }
  });

  test("the browser's pairing state never carries the credential or the code", async () => {
    const t = setup();
    await t.link(A);
    const paired = await t.pair(A);
    const text = await t.routes.getPairing(A).text();
    expect(JSON.parse(text)).toMatchObject({ paired: true });
    expect(text).not.toContain(paired.token);
    expect(text).not.toContain(paired.captureId);
    expect(JSON.parse(await t.routes.getPairing(B).text())).toMatchObject({ paired: false });
  });

  test("a new pairing replaces the previous credential at once", async () => {
    const t = setup();
    const link = await t.link(A);
    const first = await t.pair(A);
    const second = await t.pair(A);
    expect((await t.batch(first.captureId, first.token, [started])).status).toBe(401);
    expect((await t.batch(second.captureId, second.token, [started, side("radiant")])).status).toBe(200);
    expect(t.status(link.sessionId).overwolf?.connected).toBe(true);
  });
});

describe("the capture credential fails closed", () => {
  test("expired credential -> 401", async () => {
    const t = setup();
    await t.link(A);
    const cred = await t.pair(A);
    t.advance(CAPTURE_CREDENTIAL_TTL_MS);
    // A fresh link keeps the session valid; only the credential's own expiry matters here.
    expect((await t.batch(cred.captureId, cred.token, [started])).status).toBe(401);
  });

  test("revoked credential -> 401, and revoking drops a pending code too", async () => {
    const t = setup();
    await t.link(A);
    const cred = await t.pair(A);
    expect((await t.batch(cred.captureId, cred.token, [started])).status).toBe(200);
    const pending = (await t.routes.postPairingCode(A).json()) as { code: string };
    expect(t.routes.deletePairing(A).status).toBe(200);
    expect((await t.batch(cred.captureId, cred.token, [started])).status).toBe(401);
    expect((await t.routes.postPair(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ code: pending.code }) }))).status).toBe(401);
  });

  test("a rotated or revoked Dota link strands the credential (it never feeds a session nobody watches)", async () => {
    const t = setup();
    await t.link(A);
    const cred = await t.pair(A);
    await t.link(A);
    expect((await t.batch(cred.captureId, cred.token, [started])).status).toBe(401);
    const second = await t.link(A);
    const again = await t.pair(A);
    expect((await t.batch(again.captureId, again.token, [started])).status).toBe(200);
    t.gsi.deleteLink(A);
    expect((await t.batch(again.captureId, again.token, [started])).status).toBe(401);
    expect(t.registry.status(second.sessionId)).toBeNull();
  });

  test("wrong token, missing header, malformed ids -> 401 and nothing ingested", async () => {
    const t = setup();
    const link = await t.link(A);
    const cred = await t.pair(A);
    expect((await t.batch(cred.captureId, "f".repeat(64), [started])).status).toBe(401);
    expect((await t.batch(cred.captureId, "short", [started])).status).toBe(401);
    expect((await t.batch("B".repeat(43), cred.token, [started])).status).toBe(401);
    const noHeader = await t.routes.postBatch(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({}) }), cred.captureId);
    expect(noHeader.status).toBe(401);
    expect(t.status(link.sessionId).overwolf).toBeNull();
  });

  test("another account cannot submit to this live session -- not with their credential, not by naming it", async () => {
    const t = setup();
    const mine = await t.link(A);
    const theirs = await t.link(B);
    const credA = await t.pair(A);
    const credB = await t.pair(B);
    // A's credential against B's id and B's credential against A's id: refused.
    expect((await t.batch(credB.captureId, credA.token, [started, ban(10)])).status).toBe(401);
    expect((await t.batch(credA.captureId, credB.token, [started, ban(10)])).status).toBe(401);
    // A body naming B's session (or an account) is not a way in: the credential's own session is the only target.
    const hostile = await t.batch(credA.captureId, credA.token, [started, ban(10)], ALL_PRESENCE, { sessionId: theirs.sessionId, accountId: B });
    expect(hostile.status).toBe(200);
    expect(t.status(mine.sessionId).bans).toBe(1);
    expect(t.status(theirs.sessionId).bans).toBe(0);
    expect(t.status(theirs.sessionId).overwolf).toBeNull();
  });

  test("a hostile failure flood answers 429 but a valid credential is always served", async () => {
    const t = setup();
    await t.link(A);
    const cred = await t.pair(A);
    let limited = 0;
    for (let i = 0; i < 80; i += 1) {
      const response = await t.batch(cred.captureId, "e".repeat(64), [started]);
      if (response.status === 429) limited += 1;
    }
    expect(limited).toBeGreaterThan(0);
    expect((await t.batch(cred.captureId, cred.token, [started])).status).toBe(200);
  });
});

describe("batch boundary", () => {
  test("a malformed batch is refused whole; unknown types and fields never reach the registry", async () => {
    const t = setup();
    const link = await t.link(A);
    const cred = await t.pair(A);
    expect((await t.batch(cred.captureId, cred.token, [started, { type: "hero_picked", hero: "axe", side: "radiant" }])).status).toBe(400);
    expect((await t.batch(cred.captureId, cred.token, [started, { type: "steam_identity", name: "x" }])).status).toBe(400);
    expect((await t.batch(cred.captureId, cred.token, [pick(10, "radiant", 9)])).status).toBe(400);
    expect((await t.batch(cred.captureId, cred.token, [{ type: "capture_health", status: "ok", detail: "ANY FREE TEXT with spaces" }])).status).toBe(400);
    expect((await t.batch(cred.captureId, cred.token, Array.from({ length: OVERWOLF_MAX_EVENTS_PER_BATCH + 1 }, () => ban(10)))).status).toBe(400);
    const badPresence = await t.routes.postBatch(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify({ schema: "overwolf-capture/v1", events: [], presence: { roster: "yes" } }), headers: { "x-capture-credential": cred.token } }), cred.captureId);
    expect(badPresence.status).toBe(400);
    expect(t.status(link.sessionId).overwolf).toBeNull();
    expect(t.status(link.sessionId).picks).toBe(0);
  });

  test("invalid hero ids inside well-formed events are ignored by the fact layer, never applied", async () => {
    const t = setup();
    const link = await t.link(A);
    const cred = await t.pair(A);
    expect((await t.batch(cred.captureId, cred.token, [started, side("radiant"), ban(0), ban(-4), ban(1000), pick(2.5, "radiant")])).status).toBe(400);
    expect((await t.batch(cred.captureId, cred.token, [started, side("radiant"), ban(0), ban(1000), pick(1001, "dire")])).status).toBe(200);
    expect(t.status(link.sessionId)).toMatchObject({ bans: 0, picks: 0 });
  });

  test("the hero catalog is scoped to the credential and carries id / name / localizedName only", async () => {
    const t = setup();
    await t.link(A);
    const cred = await t.pair(A);
    const get = (token: string) => t.routes.getHeroes(new Request("http://127.0.0.1/x", { headers: { "x-capture-credential": token } }), cred.captureId);
    expect((await get("0".repeat(64))).status).toBe(401);
    const ok = await get(cred.token);
    expect(await ok.json()).toEqual([{ id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage" }]);
  });
});

describe("full automatic draft", () => {
  const RADIANT = [10, 20, 30, 40, 50];
  const DIRE = [11, 21, 31, 41, 51];

  test("bans, picks, repeated snapshots and the final 10 heroes follow automatically, one fact each", async () => {
    const t = setup();
    const link = await t.link(A);
    const cred = await t.pair(A);
    const first = await t.batch(cred.captureId, cred.token, [started, side("radiant"), ban(12), ban(13), ban(22)]);
    expect(first.status).toBe(200);
    expect(t.status(link.sessionId)).toMatchObject({ draftPhase: "hero_selection", localSide: "radiant", bans: 3, picks: 0 });
    // Full snapshots keep arriving with the same facts: never a duplicate.
    for (let i = 0; i < 3; i += 1) await t.batch(cred.captureId, cred.token, [started, side("radiant"), ban(12), ban(13), ban(22)]);
    expect(t.status(link.sessionId).bans).toBe(3);

    await t.batch(cred.captureId, cred.token, [pick(RADIANT[0]!, "radiant", 1), pick(DIRE[0]!, "dire")]);
    for (let i = 1; i < 5; i += 1) await t.batch(cred.captureId, cred.token, [pick(RADIANT[i]!, "radiant", [1, 2, 3, 4, 5][i]), pick(DIRE[i]!, "dire")]);
    // Same full snapshot again, out of order.
    await t.batch(cred.captureId, cred.token, [...DIRE.map((h) => pick(h, "dire")), ...RADIANT.map((h, i) => pick(h, "radiant", [1, 2, 3, 4, 5][i]))].reverse());
    const done = t.status(link.sessionId);
    expect(done.picks).toBe(10);
    expect(done.bans).toBe(3);
    expect(done.overwolf).toMatchObject({ connected: true, draft: true, players: true, authoritative: true });
    expect(done.captureHealth === "ok" || done.captureHealth === "unknown").toBe(true);
  });

  test("every Overwolf pick moves the Team Coach, and the Party 5 preset stays active across all of them", async () => {
    const t = setup();
    const link = await t.link(A);
    expect(t.store.setLiveTeamContext(link.sessionId, A, { teamGroupId: 7, playerPoolsByPosition: { 1: [10, 11], 2: [20], 3: [30], 4: [40], 5: [50] } })).toBe(true);
    const cred = await t.pair(A);
    await t.batch(cred.captureId, cred.token, [started, side("radiant"), ban(12)]);
    // What the Player sees of the board: which positions are filled by which hero, and what is still open.
    const view = async () => {
      const current = await t.board(link.sessionId);
      return JSON.stringify([current.stateIdentity, current.positions.map((column) => [column.position, column.filledHeroId, column.state]), current.currentDecision.recommendedPosition]);
    };
    const views = new Set<string>([await view()]);
    // Both sides pick, as in a real draft (a round only resolves once the rival has revealed its own picks).
    const sequence: [number, "radiant" | "dire"][] = [[10, "radiant"], [11, "dire"], [20, "radiant"], [21, "dire"], [30, "radiant"], [31, "dire"]];
    let previous = [...views][0]!;
    const refreshed: boolean[] = [];
    for (const [hero, owner] of sequence) {
      await t.batch(cred.captureId, cred.token, [pick(hero, owner, owner === "radiant" ? POSITIONS[hero]![0]!.position : undefined)]);
      const next = await view();
      refreshed.push(next !== previous);
      previous = next;
      expect(t.status(link.sessionId).teamContext).toMatchObject({ teamGroupId: 7, positions: { "1": true, "2": true, "3": true, "4": true, "5": true } });
    }
    expect(refreshed).toEqual([true, true, true, true, true, true]);
  });
});

describe("authority: Overwolf over GSI", () => {
  async function linkedWithGsi() {
    const t = setup();
    const issued = await t.link(A);
    const cred = await t.pair(A);
    const gsiPost = (heroId: number) =>
      t.gsi.postIngest(new Request("http://127.0.0.1/x", { method: "POST", body: JSON.stringify(gsiPayload({ token: issued.token, teamName: "radiant", heroId })) }), issued.liveId);
    return { t, issued, cred, gsiPost };
  }

  test("GSI own hero equal to Overwolf's pick dedupes to one pick", async () => {
    const { t, issued, cred, gsiPost } = await linkedWithGsi();
    await t.batch(cred.captureId, cred.token, [started, side("radiant"), pick(30, "radiant", 3)]);
    expect((await gsiPost(30)).status).toBe(200);
    expect((await gsiPost(30)).status).toBe(200);
    expect(t.status(issued.sessionId).picks).toBe(1);
  });

  test("while Overwolf is authoritative GSI cannot add or move a hero; it still reports lifecycle", async () => {
    const { t, issued, cred, gsiPost } = await linkedWithGsi();
    await t.batch(cred.captureId, cred.token, [started, side("radiant"), pick(30, "radiant", 3)]);
    // A different own hero from GSI (e.g. a late change) does NOT become a second own pick.
    await gsiPost(40);
    expect(t.status(issued.sessionId).picks).toBe(1);
    expect(t.status(issued.sessionId).gsi?.active).toBe(true);
    expect(t.status(issued.sessionId).captureDetail).not.toBe("GSI_DRAFT_PARTIAL");
  });

  test("without Overwolf, GSI behaves exactly as before (the own hero is a pick)", async () => {
    const { t, issued, gsiPost } = await linkedWithGsi();
    await gsiPost(40);
    expect(t.status(issued.sessionId).picks).toBe(1);
    expect(t.status(issued.sessionId).overwolf).toBeNull();
  });

  test("Overwolf disappearing mid-draft reports the capture degraded and invents nothing", async () => {
    const { t, issued, cred } = await linkedWithGsi();
    await t.batch(cred.captureId, cred.token, [started, side("radiant"), pick(30, "radiant", 3), ban(12)]);
    const before = t.status(issued.sessionId);
    t.advance(LIVE_STALE_AFTER_MS + 1_000);
    const lost = t.status(issued.sessionId);
    expect(lost.overwolf).toMatchObject({ connected: false, authoritative: false });
    expect(lost.captureHealth).toBe("degraded");
    expect(lost.captureDetail).toBe(OVERWOLF_LOST);
    expect({ picks: lost.picks, bans: lost.bans }).toEqual({ picks: before.picks, bans: before.bans });
    // Back again: health recovers by itself.
    await t.batch(cred.captureId, cred.token, [{ type: "capture_health", status: "ok", detail: "HERO_SELECTION" }]);
    expect(t.status(issued.sessionId).captureDetail).not.toBe(OVERWOLF_LOST);
  });

  test("a draft that ended stays ended, and the next draft starts clean", async () => {
    const { t, issued, cred } = await linkedWithGsi();
    await t.batch(cred.captureId, cred.token, [started, side("radiant"), ban(12), pick(30, "radiant", 3)]);
    await t.batch(cred.captureId, cred.token, [{ type: "session_ended", reason: "completed" }]);
    expect(t.status(issued.sessionId).draftPhase).toBe("ended");
    expect(t.status(issued.sessionId).captureDetail).not.toBe(OVERWOLF_LOST);
    t.advance(LIVE_STALE_AFTER_MS + 1_000);
    expect(t.status(issued.sessionId).captureDetail).not.toBe(OVERWOLF_LOST);
    await t.batch(cred.captureId, cred.token, [started]);
    expect(t.status(issued.sessionId)).toMatchObject({ draftPhase: "hero_selection", bans: 0, picks: 0 });
  });
});

describe("privacy", () => {
  test("nothing from a batch body beyond the allowlist is stored, echoed or logged", async () => {
    const t = setup();
    const link = await t.link(A);
    const cred = await t.pair(A);
    const response = await t.batch(cred.captureId, cred.token, [started, side("radiant"), pick(30, "radiant", 3)], ALL_PRESENCE, { steamId: "SENTINEL-STEAM", players: [{ name: "SENTINEL-NAME", steamId: "SENTINEL-STEAM" }] });
    const text = await response.text();
    const surfaces = [text, JSON.stringify(t.status(link.sessionId)), await t.routes.getPairing(A).text()];
    for (const surface of surfaces) {
      expect(surface).not.toContain("SENTINEL");
      expect(surface).not.toContain(cred.token);
    }
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  test("presence reports which Overwolf keys arrived, never their content", async () => {
    const t = setup();
    const link = await t.link(A);
    const cred = await t.pair(A);
    await t.batch(cred.captureId, cred.token, [started], { roster: true, bans: false, draft: false, players: false });
    expect(t.status(link.sessionId).overwolf).toMatchObject({ connected: true, roster: true, bans: false, draft: false, players: false, authoritative: false });
    await t.batch(cred.captureId, cred.token, [], NO_PRESENCE);
    expect(Object.keys(t.status(link.sessionId).overwolf!).sort()).toEqual(["authoritative", "bans", "connected", "draft", "lastUpdateAgeMs", "players", "roster"]);
  });
});
