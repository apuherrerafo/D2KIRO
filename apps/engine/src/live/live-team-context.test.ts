import { describe, expect, test } from "bun:test";
import type { TeamCoachBoard } from "../coach";
import type { FunctionalRecommendationEvidence } from "../recommendation/evidence";
import type { ComputeSuggestionsForRecommendation } from "../recommendation/perspective-context";
import { createTeamGroup, getTeamGroup } from "../db/queries";
import { createLiveGsiRoutes } from "../server/routes/live-gsi";
import { createProtocolSessionRoutes } from "../server/routes/protocol-sessions";
import { ProtocolSessionStore } from "../server/protocol-session";
import type { HeroPositions } from "../signals/hero-positions";
import type { Suggestion, SuggestionSet } from "../signals/mix";
import { createGsiLinkTestDb, gsiPayload, SENTINELS } from "./gsi.fixtures";
import { createGsiLinkStore } from "./gsi-links";
import { LiveCaptureRegistry } from "./live-capture-registry";

// Live Dota + Party 5 preset: the selected team group of the ACCOUNT reaches the live session's
// PerspectiveRecommendationContext (slot N -> Pos N), is loaded server-side by id (a body can never carry
// pools), stays a soft signal, and never crosses accounts. Real kernel, real stores, real SQLite team tables
// (in memory); only V6's scorer is replaced by a deterministic pool-aware function.

const A = 101;
const B = 202;
const T0 = 1_790_000_000_000;

// Position p owns heroes p0..p3 (e.g. pos 2 -> 20,21,22,23). The scorer ranks by index, so WITHOUT a pool hero p0 leads.
const POSITIONS: HeroPositions = Object.fromEntries(
  [1, 2, 3, 4, 5].flatMap((p) => [0, 1, 2, 3].map((k) => [p * 10 + k, [{ position: p as 1 | 2 | 3 | 4 | 5, matches: 1000 }]])),
);
const ALL = Object.keys(POSITIONS).map(Number);

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
          signals: [
            { signal: "position_fit" as const, raw: 0.6, normalized: 60, evidenceConfidence: 1, weighted, explanation: "fixture", sampleSize: 100 },
            { signal: "hero_pool_fit" as const, raw: boost.has(hero) ? 0.9 : 0.1, normalized: boost.has(hero) ? 90 : 10, evidenceConfidence: 1, weighted: 0, explanation: "fixture", sampleSize: 1, applicable: boost.size > 0 },
          ],
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
  const registry = new LiveCaptureRegistry({ store, defaultPatch: "7.41e", now: () => T0 });
  const links = createGsiLinkStore(db);
  const routes = createLiveGsiRoutes({
    links,
    registry,
    now: () => T0,
    // Same wiring as app.ts: the account-scoped query.
    loadTeamGroup: (id, accountId) => getTeamGroup(db, id, accountId),
  });
  const protocol = createProtocolSessionRoutes({ store, computeSuggestions: poolAwareCompute(), heroPositions: POSITIONS, heroCounters: new Map() });

  function group(accountId: number, pools: number[][], partySize: 1 | 2 | 3 | 5 = 5): number {
    const created = createTeamGroup(db, {
      accountId,
      name: "Team",
      partySize,
      updatedAt: "2026-10-04",
      members: pools.map((heroPool, index) => ({ slot: index + 1, name: `P${index + 1}`, heroPool, updatedAt: "2026-10-04" })),
    });
    return created.id;
  }
  async function issue(accountId: number) {
    const response = routes.postIssue(accountId);
    expect(response.status).toBe(201);
    return (await response.json()) as { liveId: string; token: string; sessionId: string };
  }
  async function select(accountId: number, body: unknown) {
    const response = await routes.putTeamGroup(new Request("http://127.0.0.1/api/live/team-group", { method: "PUT", body: JSON.stringify(body) }), accountId);
    return { status: response.status, json: (await response.json().catch(() => null)) as Record<string, unknown> | null };
  }
  async function board(sessionId: string): Promise<TeamCoachBoard> {
    const response = await protocol.getTeamRecommendations(sessionId, new URL(`http://127.0.0.1/api/session/protocol/${sessionId}/team-recommendations`));
    expect(response.status).toBe(200);
    return (await response.json()) as TeamCoachBoard;
  }
  async function ingest(link: { liveId: string; token: string }, options: Parameters<typeof gsiPayload>[0]) {
    const response = await routes.postIngest(
      new Request(`http://127.0.0.1/api/live/gsi/${link.liveId}`, { method: "POST", body: JSON.stringify(gsiPayload({ ...options, token: link.token })) }),
      link.liveId,
    );
    expect(response.status).toBe(200);
  }
  async function startDraft(link: { liveId: string; token: string }) {
    await ingest(link, { teamName: "radiant", draft: "empty" });
  }
  const top = (b: TeamCoachBoard, position: number) => b.positions.find((column) => column.position === position)!.top.map((candidate) => candidate.heroId);
  return { db, store, registry, routes, protocol, group, issue, select, board, ingest, startDraft, top };
}

// Each position's player pool: two heroes of that position, NEITHER being the scorer's default leader (p0).
const POOLS = [[12, 13], [22, 23], [32, 33], [42, 43], [52, 53]];

describe("Live Party 5 preset -- data flow", () => {
  test("slot N feeds Pos N: every column of the live board follows ITS OWN player's pool", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.startDraft(link);
    const before = await t.board(link.sessionId);
    for (const p of [1, 2, 3, 4, 5]) expect(t.top(before, p)[0]).toBe(p * 10); // no preset: the default leader

    const applied = await t.select(A, { teamGroupId: t.group(A, POOLS) });
    expect(applied.status).toBe(200);
    expect(applied.json).toMatchObject({ schema: "live-team-group/v1", applied: true, reason: null });
    expect(t.store.perspectiveRecommendationContext(link.sessionId)?.playerPoolsByPosition).toEqual({ 1: [12, 13], 2: [22, 23], 3: [32, 33], 4: [42, 43], 5: [52, 53] });

    const after = await t.board(link.sessionId);
    for (const p of [1, 2, 3, 4, 5]) {
      expect(POOLS[p - 1]).toContain(t.top(after, p)[0]!);
      // never the personal pool applied to every position: pos p only ever boosts ITS pool
      for (const other of [1, 2, 3, 4, 5].filter((o) => o !== p)) expect(POOLS[other - 1]).not.toContain(t.top(after, p)[0]!);
    }
  });

  test("changing only Pos 2's pool changes only Pos 2's ranking", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.startDraft(link);
    await t.select(A, { teamGroupId: t.group(A, POOLS) });
    const first = await t.board(link.sessionId);
    const changed = POOLS.map((pool, index) => (index === 1 ? [21] : pool));
    await t.select(A, { teamGroupId: t.group(A, changed) });
    const second = await t.board(link.sessionId);
    expect(t.top(second, 2)).not.toEqual(t.top(first, 2));
    expect(t.top(second, 2)[0]).toBe(21);
    for (const p of [1, 3, 4, 5]) expect(t.top(second, p)).toEqual(t.top(first, p));
  });

  test("the pool is a soft signal: out-of-pool heroes stay eligible and listed", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.startDraft(link);
    await t.select(A, { teamGroupId: t.group(A, POOLS) });
    const board = await t.board(link.sessionId);
    const column2 = t.top(board, 2);
    expect(column2.slice(0, 2).sort()).toEqual([22, 23]);
    expect(column2.some((hero) => !POOLS[1]!.includes(hero))).toBe(true);
  });

  test("a preset survives later GSI updates and a fresh draft on the same link", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.select(A, { teamGroupId: t.group(A, POOLS) }); // selected BEFORE Dota says anything
    await t.startDraft(link);
    expect(t.registry.status(link.sessionId)?.teamContext.positions).toEqual({ "1": true, "2": true, "3": true, "4": true, "5": true });
    await t.ingest(link, { gameState: "DOTA_GAMERULES_STATE_GAME_IN_PROGRESS", teamName: "radiant", heroId: 30 });
    await t.startDraft(link); // a new draft restarts the facts, not the team
    expect(t.registry.status(link.sessionId)?.teamContext.teamGroupId).not.toBeNull();
  });
});

describe("Live Party 5 preset -- account isolation and graceful failure", () => {
  test("a team group of another account cannot be loaded: nothing applied, owner unaffected", async () => {
    const t = setup();
    const linkA = await t.issue(A);
    const linkB = await t.issue(B);
    const groupOfA = t.group(A, POOLS);
    await t.select(A, { teamGroupId: groupOfA });

    const refused = await t.select(B, { teamGroupId: groupOfA });
    expect(refused.status).toBe(200);
    expect(refused.json).toMatchObject({ applied: false, reason: "not_found" });
    expect(t.store.perspectiveRecommendationContext(linkB.sessionId)?.playerPoolsByPosition).toBeNull();
    expect(t.store.perspectiveRecommendationContext(linkA.sessionId)?.playerPoolsByPosition?.[1]).toEqual([12, 13]);
  });

  test("a missing / deleted teamGroupId fails gracefully and leaves NO stale preset", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.startDraft(link);
    await t.select(A, { teamGroupId: t.group(A, POOLS) });
    const missing = await t.select(A, { teamGroupId: 987_654 });
    expect(missing.status).toBe(200);
    expect(missing.json).toMatchObject({ applied: false, reason: "not_found" });
    expect(t.store.perspectiveRecommendationContext(link.sessionId)?.playerPoolsByPosition).toBeNull();
    const board = await t.board(link.sessionId); // the coach still answers, as if no preset
    for (const p of [1, 2, 3, 4, 5]) expect(t.top(board, p)[0]).toBe(p * 10);
  });

  test("only a Party 5 preset applies; null clears; a body can never carry pools", async () => {
    const t = setup();
    const link = await t.issue(A);
    expect((await t.select(A, { teamGroupId: t.group(A, [[1, 2], [3]], 3) })).json).toMatchObject({ applied: false, reason: "not_party5" });
    expect((await t.select(A, { teamGroupId: t.group(A, [[], [], [], [], []]) })).json).toMatchObject({ applied: false, reason: "no_pools" });

    const id = t.group(A, POOLS);
    // pools smuggled in the body are ignored: the DB's group wins
    await t.select(A, { teamGroupId: id, playerPoolsByPosition: { 1: [99] } });
    expect(t.store.perspectiveRecommendationContext(link.sessionId)?.playerPoolsByPosition?.[1]).toEqual([12, 13]);
    // pools WITHOUT a teamGroupId are refused outright
    expect((await t.select(A, { playerPoolsByPosition: { 1: [99] } })).status).toBe(400);
    expect((await t.select(A, { teamGroupId: "7" })).status).toBe(400);
    expect((await t.select(A, { teamGroupId: -1 })).status).toBe(400);

    expect((await t.select(A, { teamGroupId: null })).json).toMatchObject({ applied: false, reason: null });
    expect(t.store.perspectiveRecommendationContext(link.sessionId)?.playerPoolsByPosition).toBeNull();
  });

  test("an account without a Dota link gets 409 and nothing is created", async () => {
    const t = setup();
    expect((await t.select(A, { teamGroupId: t.group(A, POOLS) })).status).toBe(409);
  });
});

describe("Live GSI partial capture never invents heroes", () => {
  test("only side + own hero: one pick, no ally/enemy picks, no bans -- with or without a preset", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.select(A, { teamGroupId: t.group(A, POOLS) });
    await t.ingest(link, { teamName: "radiant", heroId: 30, draft: "empty" });
    const status = t.registry.status(link.sessionId)!;
    expect(status).toMatchObject({ bans: 0, picks: 1, localSide: "radiant" });
    expect(status.gsi?.draft).toMatchObject({ draftBlock: false, ownHero: true, allyPicks: false, enemyPicks: false, bans: false });
    const view = t.store.view(link.sessionId)!;
    expect(view.ownPicks.filter((slot) => slot.visibility !== "HIDDEN").map((slot) => slot.heroId)).toEqual([30]);
    expect(view.enemyPicks.filter((slot) => slot.visibility !== "HIDDEN")).toHaveLength(0);
    for (const sentinel of SENTINELS) expect(JSON.stringify(status)).not.toContain(sentinel);
  });
});

describe("Live GSI structural discovery through the real route", () => {
  test("a roster-like section is reported by presence, accumulates, and leaks no identity, token or raw value", async () => {
    const t = setup();
    const link = await t.issue(A);
    const entry = { steamid: SENTINELS[0], accountid: SENTINELS[1], name: SENTINELS[2], id: 14, team_name: "dire" };
    const roster = Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`player${i}`, entry]));
    const body = { ...gsiPayload({ token: link.token, teamName: "radiant", heroId: 30, draft: "empty" }), allplayers: { team2: roster, team3: roster } };
    const response = await t.routes.postIngest(new Request(`http://127.0.0.1/api/live/gsi/${link.liveId}`, { method: "POST", body: JSON.stringify(body) }), link.liveId);
    expect(response.status).toBe(200);
    // The next update has no allplayers at all: what was ever seen is still reported (capability discovery accumulates).
    await t.ingest(link, { teamName: "radiant", heroId: 30, draft: "empty" });
    const status = t.registry.status(link.sessionId)!;
    expect(status.gsi?.structure).toEqual(expect.arrayContaining(["section.draft", "section.allplayers", "roster.full_entries", "roster.hero_fields"]));
    // ...and it never turned into facts: still just our own hero.
    expect(status).toMatchObject({ picks: 1, bans: 0 });
    const text = JSON.stringify(status);
    for (const sentinel of SENTINELS) expect(text).not.toContain(sentinel);
    expect(text).not.toContain(link.token);
  });

  test("a client that sends no draft and no roster: those sections are reported absent", async () => {
    const t = setup();
    const link = await t.issue(A);
    await t.ingest(link, { teamName: "radiant", heroId: 30 });
    const structure = t.registry.status(link.sessionId)!.gsi!.structure;
    expect(structure).not.toContain("section.draft");
    expect(structure).not.toContain("section.allplayers");
    expect(structure.some((label) => label.startsWith("roster."))).toBe(false);
  });
});
