import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import type { DraftEventEnvelope } from "../draft/reducer";
import { createTeamGroup, getTeamGroup } from "../db/queries";
import type { FunctionalRecommendationEvidence } from "../recommendation/evidence";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { ProtocolSessionStore } from "../server/protocol-session";
import { createLiveGsiRoutes, VISUAL_MAX_BODY_BYTES } from "../server/routes/live-gsi";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import type { HeroPositions } from "../signals/hero-positions";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import { createGsiLinkStore } from "./gsi-links";
import { createGsiLinkTestDb, gsiPayload } from "./gsi.fixtures";
import { LIVE_STALE_AFTER_MS, LiveCaptureRegistry } from "./live-capture-registry";

// Local visual capture (source "ocr"), engine side. Real kernel, real stores, real link auth, real SQLite
// team tables (memory); only V6's scorer is replaced by a deterministic pool-aware function. The capturer
// itself (screen -> portraits) lives in scripts/live/visual-capture and is tested there.

const A = 101;
const B = 202;
let clock = 1_790_000_000_000;

const POSITIONS: HeroPositions = Object.fromEntries(
  [1, 2, 3, 4, 5].flatMap((p) => [0, 1, 2, 3].map((k) => [p * 10 + k, [{ position: p as 1 | 2 | 3 | 4 | 5, matches: 1000 }]])),
);
const ALL = Object.keys(POSITIONS).map(Number);
const POOLS = [[12, 13], [22, 23], [32, 33], [42, 43], [52, 53]];

function poolAwareCompute(): ComputeSuggestionsForRecommendation {
  return async (state, _accountId, options) => {
    const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    const boost = new Set(options?.overrideHeroPool ?? []);
    const universe = options?.candidateHeroIds && options.candidateHeroIds.length > 0 ? [...options.candidateHeroIds] : ALL;
    const suggestions: Suggestion[] = universe
      .filter((hero) => !excluded.has(hero))
      .map((hero, index) => {
        const weighted = 50 - index + (boost.has(hero) ? 40 : 0);
        return {
          hero,
          rank: Math.min(index + 1, 6) as Suggestion["rank"],
          score: weighted,
          signals: [{ signal: "position_fit" as const, raw: 0.6, normalized: 60, evidenceConfidence: 1, weighted, explanation: "fixture", sampleSize: 100 }],
          reason: "fixture",
          confidence: "alta" as const,
          evidenceCoverage: 1,
          guessingIndex: 0,
        };
      })
      .sort((a, b) => b.score - a.score);
    const functionalEvidence: FunctionalRecommendationEvidence = { metaIsStale: false, signalEvidence: [], heroPositions: [], teamOpening: null, partyPreferredPositions: [] };
    const set: SuggestionSet = { schema: "suggestions/v1", sessionId: state.sessionId, basedOnSeq: state.lastSeq, decisionContext: "team_opening", suggestions, comparison: null, degraded: [], computedInMs: 1, functionalEvidence };
    return set;
  };
}

function setup() {
  const { db, sqlite } = createGsiLinkTestDb();
  sqlite.exec(`
    CREATE TABLE team_groups (id INTEGER PRIMARY KEY AUTOINCREMENT, account_id INTEGER, name TEXT NOT NULL, party_size INTEGER NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE team_members (id INTEGER PRIMARY KEY AUTOINCREMENT, team_group_id INTEGER NOT NULL, slot INTEGER NOT NULL, name TEXT NOT NULL, hero_pool TEXT NOT NULL, updated_at TEXT NOT NULL);
  `);
  const store = new ProtocolSessionStore();
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => clock });
  const routes = createLiveGsiRoutes({ links: createGsiLinkStore(db), registry, now: () => clock, loadTeamGroup: (id, accountId) => getTeamGroup(db, id, accountId) });
  const protocol = createProtocolSessionRoutes({ store, computeSuggestions: poolAwareCompute(), heroPositions: POSITIONS, heroCounters: new Map() });
  type Link = { liveId: string; token: string; sessionId: string };
  let seq = 0;

  async function issue(accountId: number): Promise<Link> {
    const response = routes.postIssue(accountId);
    expect(response.status).toBe(201);
    return (await response.json()) as Link;
  }
  async function gsi(link: Link, options: Parameters<typeof gsiPayload>[0]) {
    const response = await routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${link.liveId}`, { method: "POST", body: JSON.stringify(gsiPayload({ ...options, token: link.token })) }), link.liveId);
    expect(response.status).toBe(200);
  }
  /** What Julio's real match produced: our side + our own hero, NO draft block. */
  const gsiPartial = (link: Link, heroId?: number) => gsi(link, { teamName: "radiant", ...(heroId === undefined ? {} : { heroId }) });

  function envelope(payload: DraftEventEnvelope["payload"], overrides: Partial<DraftEventEnvelope> = {}): DraftEventEnvelope {
    seq += 1;
    return { schema: "draft-event/v1", eventId: `ocr-t-${seq}`, sessionId: "ignored-by-the-engine", seq, emittedAt: "2026-10-04T12:00:00.000Z", source: "ocr", confidence: 0.9, payload, ...overrides };
  }
  async function visual(link: Pick<Link, "liveId" | "token">, body: unknown, liveId = link.liveId): Promise<Response> {
    return routes.postVisual(new Request(`http://127.0.0.1/api/live/visual/${liveId}`, { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }), liveId);
  }
  const send = (link: Link, payload: DraftEventEnvelope["payload"], overrides: Partial<DraftEventEnvelope> = {}) => visual(link, { auth: { token: link.token }, envelope: envelope(payload, overrides) });
  const pick = (link: Link, side: "radiant" | "dire", hero: number) => send(link, { type: "hero_picked", hero, side });

  function group(accountId: number, pools: number[][]): number {
    return createTeamGroup(db, { accountId, name: "Team", partySize: 5, updatedAt: "2026-10-04", members: pools.map((heroPool, index) => ({ slot: index + 1, name: `P${index + 1}`, heroPool, updatedAt: "2026-10-04" })) }).id;
  }
  async function board(sessionId: string): Promise<TeamCoachBoard> {
    const response = await protocol.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  const top = (b: TeamCoachBoard, position: number) => b.positions.find((column) => column.position === position)!.top.map((candidate) => candidate.heroId);
  return { registry, routes, store, issue, gsi, gsiPartial, send, pick, visual, group, board, top };
}

describe("visual capture -- facts reach the live session", () => {
  test("visual ally and enemy picks land in the same live session as GSI's side and own hero", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link, 30);
    expect((await t.pick(link, "radiant", 11)).status).toBe(200);
    expect((await t.pick(link, "dire", 21)).status).toBe(200);
    expect((await t.pick(link, "dire", 31)).status).toBe(200);
    const status = t.registry.status(link.sessionId)!;
    expect(status.picks).toBe(4); // GSI own hero + 3 visual
    expect(status.localSide).toBe("radiant");
    expect(status.lastDetectedPick).toMatchObject({ heroId: 11, side: "radiant", source: "ocr" }); // own team only
  });

  test("own hero via GSI + visual = ONE pick", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link, 30);
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);
    await t.pick(link, "radiant", 30); // the screen shows the same hero GSI already reported
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);
    // and the other order, inside the draft: the screen first, then GSI repeats the whole state on every update
    const t2 = setup();
    const link2 = await t2.issue(A);
    await t2.gsiPartial(link2); // hero selection started, our hero not locked yet
    await t2.pick(link2, "radiant", 30);
    await t2.gsiPartial(link2, 30);
    await t2.gsiPartial(link2, 30);
    expect(t2.registry.status(link2.sessionId)!.picks).toBe(1);
  });

  test("a repeated visual envelope (same eventId) is idempotent", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link);
    const body = { auth: { token: link.token }, envelope: { schema: "draft-event/v1", eventId: "ocr-fixed-1", sessionId: "x", seq: 1, emittedAt: "2026-10-04T12:00:00.000Z", source: "ocr", confidence: 0.8, payload: { type: "hero_picked", hero: 11, side: "radiant" } } };
    expect((await t.visual(link, body)).status).toBe(200);
    expect((await t.visual(link, body)).status).toBe(200);
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);
  });

  test("a changed pick is reverted by the capturer and replaced", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link);
    await t.pick(link, "dire", 21);
    await t.send(link, { type: "pick_reverted", hero: 21, side: "dire" });
    await t.pick(link, "dire", 22);
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);
  });

  test("bans seen on screen are bans (side unknown)", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link);
    expect((await t.send(link, { type: "hero_banned", hero: 40, side: "unknown" })).status).toBe(200);
    expect(t.registry.status(link.sessionId)!.bans).toBe(1);
  });

  test("a visual hero on the wrong side never contradicts GSI's own hero", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link, 30);
    await t.pick(link, "dire", 30); // a misread of region/side: our own hero cannot be on the enemy team
    const status = t.registry.status(link.sessionId)!;
    expect(status.picks).toBe(1);
    expect(status.lastDetectedPick).toMatchObject({ heroId: 30, side: "radiant" });
  });
});

describe("visual capture -- Team Coach and Party 5", () => {
  test("a visual pick refreshes the Team Coach board; Party 5 pools stay active", async () => {
    const t = setup();
    const link = await t.issue(A);
    const applied = await t.routes.putTeamGroup(new Request("http://127.0.0.1/api/live/team-group", { method: "PUT", body: JSON.stringify({ teamGroupId: t.group(A, POOLS) }) }), A);
    expect(((await applied.json()) as { applied: boolean }).applied).toBe(true);
    await t.gsiPartial(link);
    const before = await t.board(link.sessionId);
    expect(t.top(before, 2).slice(0, 2).sort()).toEqual([22, 23]);

    // Round 1 of Ranked All Pick as the screen shows it: both teams' heroes, revealed together. Pos 2's and
    // Pos 1's default leaders (20, 10) are now taken by the enemy.
    for (const [side, hero] of [["radiant", 30], ["radiant", 50], ["dire", 20], ["dire", 10]] as const) await t.pick(link, side, hero);
    const after = await t.board(link.sessionId);
    expect(after).not.toEqual(before);
    for (const column of after.positions) expect(column.top.map((candidate) => candidate.heroId)).not.toContain(20);
    expect(t.top(after, 2).slice(0, 2).sort()).toEqual([22, 23]); // pool boost survived the visual pick
    expect(t.registry.status(link.sessionId)!.teamContext.positions).toEqual({ "1": true, "2": true, "3": true, "4": true, "5": true });
  });
});

describe("visual capture -- honest capture state", () => {
  test("a healthy visual capturer supplies what GSI cannot: the partial notice clears, then returns when it goes quiet", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link, 30);
    expect(t.registry.status(link.sessionId)).toMatchObject({ captureHealth: "degraded", captureDetail: "GSI_DRAFT_PARTIAL", visual: null });
    await t.send(link, { type: "capture_health", status: "ok", detail: "VISUAL_OK" });
    expect(t.registry.status(link.sessionId)).toMatchObject({ captureHealth: "ok", captureDetail: null, visual: { active: true, health: "ok", detail: "VISUAL_OK" } });
    clock += LIVE_STALE_AFTER_MS + 1;
    expect(t.registry.status(link.sessionId)).toMatchObject({ captureHealth: "degraded", captureDetail: "GSI_DRAFT_PARTIAL", visual: { active: false } });
  });

  test("visual capture lost: reported as lost, and nothing is invented", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link, 30);
    await t.pick(link, "dire", 21);
    await t.send(link, { type: "capture_health", status: "lost", detail: "VISUAL_CAPTURE_LOST" });
    const status = t.registry.status(link.sessionId)!;
    expect(status.visual).toMatchObject({ health: "lost", detail: "VISUAL_CAPTURE_LOST" });
    expect(status.captureHealth).toBe("degraded"); // the honest GSI-partial state is back, not "ok"
    expect(status.picks).toBe(2); // exactly what was confirmed before the loss
  });

  test("facts after the draft ended (in-match top bar) are dropped", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link, 30);
    await t.gsi(link, { gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", teamName: "radiant", heroId: 30 });
    expect(t.registry.status(link.sessionId)!.draftPhase).toBe("ended");
    await t.pick(link, "dire", 21);
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);
  });
});

describe("visual capture -- trust boundary", () => {
  test("no / wrong / another link's token is refused identically (401), nothing is applied", async () => {
    const t = setup();
    const a = await t.issue(A);
    const b = await t.issue(B);
    const envelopeBody = envelopeFor(11);
    for (const body of [{ envelope: envelopeBody }, { auth: { token: "x".repeat(64) }, envelope: envelopeBody }, { auth: { token: b.token }, envelope: envelopeBody }]) {
      expect((await t.visual(a, body)).status).toBe(401);
    }
    expect(t.registry.status(a.sessionId)!.picks).toBe(0);
  });

  test("the body can never name the session: another account's session id is ignored", async () => {
    const t = setup();
    const a = await t.issue(A);
    const b = await t.issue(B);
    await t.gsiPartial(a);
    const response = await t.visual(a, { auth: { token: a.token }, envelope: { ...envelopeFor(11), sessionId: b.sessionId } });
    expect(response.status).toBe(200);
    expect(t.registry.status(a.sessionId)!.picks).toBe(1);
    expect(t.registry.status(b.sessionId)!.picks).toBe(0);
  });

  test("only the visual source and only fact payloads are accepted", async () => {
    const t = setup();
    const link = await t.issue(A);
    const auth = { token: link.token };
    for (const bad of [
      { ...envelopeFor(11), source: "overwolf" },
      { ...envelopeFor(11), source: "manual" },
      { ...envelopeFor(11), payload: { type: "session_started", format: "all_pick", patch: "7.41e" } },
      { ...envelopeFor(11), payload: { type: "local_side_identified", side: "dire" } },
      { ...envelopeFor(11), payload: { type: "session_ended", reason: "aborted" } },
      { schema: "draft-event/v1" },
    ]) expect((await t.visual(link, { auth, envelope: bad })).status).toBe(400);
    expect(t.registry.status(link.sessionId)!.picks).toBe(0);
    expect(t.registry.status(link.sessionId)!.draftPhase).toBe("waiting");
  });

  test("a frame-sized body is refused before it is parsed", async () => {
    const t = setup();
    const link = await t.issue(A);
    const huge = JSON.stringify({ auth: { token: link.token }, envelope: envelopeFor(11), frame: "A".repeat(VISUAL_MAX_BODY_BYTES * 4) });
    expect((await t.visual(link, huge)).status).toBe(413);
    expect((await t.visual(link, "not json")).status).toBe(400);
  });

  test("a revoked / unknown link is refused", async () => {
    const t = setup();
    const link = await t.issue(A);
    expect((await t.visual(link, { auth: { token: link.token }, envelope: envelopeFor(11) }, "Z".repeat(43))).status).toBe(401);
    expect((await t.visual(link, { auth: { token: link.token }, envelope: envelopeFor(11) }, "bad")).status).toBe(401);
  });

  test("ocr is a distinct source: the legacy overwolf path keeps its own label", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsiPartial(link);
    t.registry.ingestEnvelope({ ...envelopeFor(11), source: "overwolf", sessionId: link.sessionId });
    expect(t.registry.status(link.sessionId)!.lastDetectedPick).toMatchObject({ heroId: 11, source: "overwolf" });
    t.registry.ingestEnvelope({ ...envelopeFor(12), sessionId: link.sessionId });
    expect(t.registry.status(link.sessionId)!.lastDetectedPick).toMatchObject({ heroId: 12, source: "ocr" });
  });
});

describe("visual capture -- GSI owns the draft lifecycle (helper left running from before the queue)", () => {
  const MENU = { gameState: null, teamName: "radiant" } as const;
  async function ack(response: Response) {
    expect(response.status).toBe(200);
    return (await response.json()) as { schema: string; draftPhase: string; draftEpoch: number };
  }
  const heartbeat = (t: ReturnType<typeof setup>, link: { liveId: string; token: string; sessionId: string }) => t.send(link, { type: "capture_health", status: "ok", detail: "VISUAL_OK" });

  test("visual facts before GSI hero selection are refused, and never resurface when the draft starts", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsi(link, MENU); // Dota in the menu / lobby / matchmaking
    expect(await ack(await t.pick(link, "radiant", 11))).toEqual({ schema: "live-visual-ack/v1", draftPhase: "waiting", draftEpoch: 0 });
    await t.send(link, { type: "hero_banned", hero: 40, side: "unknown" });
    await t.pick(link, "dire", 21);
    expect(t.registry.status(link.sessionId)).toMatchObject({ picks: 0, bans: 0, draftPhase: "waiting", lastDetectedPick: null });
    // Also with no GSI at all yet (helper started before Dota said anything).
    const fresh = setup();
    const other = await fresh.issue(B);
    const outcome = fresh.registry.ingestEnvelope({ ...envelopeFor(11), sessionId: other.sessionId });
    expect(outcome).toMatchObject({ accepted: true, changed: false, ignored: "draft_not_started" });

    await t.gsiPartial(link); // GSI: DOTA_GAMERULES_STATE_HERO_SELECTION
    expect(t.registry.status(link.sessionId)).toMatchObject({ picks: 0, bans: 0, draftPhase: "hero_selection" }); // 0/10
    await t.pick(link, "dire", 21); // the first real visible pick
    expect(t.registry.status(link.sessionId)!.picks).toBe(1); // exactly 1/10
  });

  test("the visual heartbeat in the lobby still reports the capturer's health (only facts are gated)", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsi(link, MENU);
    await heartbeat(t, link);
    expect(t.registry.status(link.sessionId)!.visual).toMatchObject({ active: true, health: "ok", detail: "VISUAL_OK" });
  });

  test("every answer carries the lifecycle: lobby -> draft 1 -> match -> menu -> draft 2, one helper", async () => {
    const t = setup();
    const link = await t.issue(A);
    expect(await ack(await heartbeat(t, link))).toMatchObject({ draftPhase: "waiting", draftEpoch: 0 });
    await t.gsi(link, MENU);
    expect(await ack(await heartbeat(t, link))).toMatchObject({ draftPhase: "waiting", draftEpoch: 0 });
    await t.gsi(link, { teamName: "radiant", matchId: "1001" });
    expect(await ack(await heartbeat(t, link))).toMatchObject({ draftPhase: "hero_selection", draftEpoch: 1 });
    await t.gsi(link, { teamName: "radiant", matchId: "1001" }); // GSI repeats hero selection: same draft
    await t.pick(link, "radiant", 11);
    expect(await ack(await heartbeat(t, link))).toMatchObject({ draftPhase: "hero_selection", draftEpoch: 1 });
    await t.gsi(link, { gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", teamName: "radiant", heroId: 30, matchId: "1001" });
    expect(await ack(await t.pick(link, "dire", 21))).toMatchObject({ draftPhase: "ended", draftEpoch: 1 }); // top bar: dropped
    await t.gsi(link, MENU);
    expect(await ack(await heartbeat(t, link))).toMatchObject({ draftPhase: "ended", draftEpoch: 1 });
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);

    await t.gsi(link, { teamName: "radiant", matchId: "1002" }); // next queue
    expect(await ack(await heartbeat(t, link))).toMatchObject({ draftPhase: "hero_selection", draftEpoch: 2 });
    expect(t.registry.status(link.sessionId)!.picks).toBe(0); // game 1 is gone: 0/10
    await t.pick(link, "radiant", 11); // same hero as game 1: game 2's own fact
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);
  });

  test("own hero still dedupes with GSI inside the gated draft (both orders)", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.gsi(link, MENU);
    await t.pick(link, "radiant", 30); // pre-draft: refused
    await t.gsiPartial(link);
    await t.pick(link, "radiant", 30); // screen first
    await t.gsiPartial(link, 30); // then GSI locks the same hero
    await t.gsiPartial(link, 30);
    await t.pick(link, "radiant", 30);
    expect(t.registry.status(link.sessionId)!.picks).toBe(1);
  });
});

function envelopeFor(hero: number): DraftEventEnvelope {
  return { schema: "draft-event/v1", eventId: `ocr-e-${hero}-${Math.random().toString(36).slice(2)}`, sessionId: "x", seq: 1, emittedAt: "2026-10-04T12:00:00.000Z", source: "ocr", confidence: 0.9, payload: { type: "hero_picked", hero, side: "radiant" } };
}
