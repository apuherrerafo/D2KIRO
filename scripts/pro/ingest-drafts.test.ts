import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { normalizeDraft, upsertDrafts, ingestDrafts, type ProMatchSummary, type MatchDetail } from "./ingest-drafts";
import { CURATED_HERO_IDS } from "./validate-drafts";

const summary: ProMatchSummary = { match_id: 42, start_time: 100, leagueid: 7 };
const detail: MatchDetail = {
  patch: 60, start_time: 101, radiant_win: true, leagueid: 7, league: { tier: "premium" },
  radiant_team_id: 1, dire_team_id: 2, od_data: { has_gcdata: true, has_parsed: true },
  picks_bans: Array.from({ length: 24 }, (_, order) => ({ order, is_pick: order % 2 === 0, hero_id: [...CURATED_HERO_IDS][order % CURATED_HERO_IDS.size], team: 0 as const })),
  players: Array.from({ length: 10 }, (_, i) => ({ hero_id: i + 1, team: (i < 5 ? 0 : 1) as 0 | 1, position_est: ((i % 5) + 1) as 1 | 2 | 3 | 4 | 5, lane_role: i % 5, is_roaming: false, net_worth: 1000 + i })),
};
function db(): Database { const value = new Database(":memory:"); value.exec(`CREATE TABLE tournaments (league_id INTEGER PRIMARY KEY, name TEXT, tier TEXT, first_seen_at TEXT, last_seen_at TEXT, region TEXT, source TEXT, fetched_at TEXT, sample_size INTEGER, confidence TEXT); CREATE TABLE pro_drafts (match_id TEXT PRIMARY KEY, league_id INTEGER, patch TEXT, start_time INTEGER, game_mode INTEGER, radiant_team_id INTEGER, dire_team_id INTEGER, winning_side TEXT, source TEXT, fetched_at TEXT, sample_size INTEGER, ingest_status TEXT, ingest_reason TEXT, raw_json TEXT, has_gcdata INTEGER, has_parsed INTEGER); CREATE TABLE pro_draft_turns (match_id TEXT, draft_order INTEGER, is_pick INTEGER, hero_id INTEGER, team INTEGER, PRIMARY KEY(match_id,draft_order)); CREATE TABLE pro_draft_slots (match_id TEXT, hero_id INTEGER, team INTEGER, position_est INTEGER, lane_role INTEGER, is_roaming INTEGER, net_worth INTEGER, PRIMARY KEY(match_id,team,hero_id));`); return value; }

test("normalizeDraft retiene los 24 turnos y slots completos", () => {
  const draft = normalizeDraft(summary, detail, "premium");
  expect(draft.status).toBe("complete"); expect(draft.turns).toHaveLength(24); expect(draft.slots).toHaveLength(10);
});
test("draft incompleto o sin gcdata queda registrado como unclassifiable", () => {
  const draft = normalizeDraft(summary, { ...detail, picks_bans: detail.picks_bans?.slice(0, 2), od_data: { has_gcdata: false } }, "premium");
  expect(draft.status).toBe("unclassifiable"); expect(draft.reason).toBe("has_gcdata_false");
});
test("draft con héroe fuera de catálogo queda registrado como unclassifiable", () => {
  const draft = normalizeDraft(summary, { ...detail, picks_bans: detail.picks_bans?.map((turn, i) => i === 0 ? { ...turn, hero_id: 999 } : turn) }, "premium");
  expect(draft.status).toBe("unclassifiable"); expect(draft.reason).toBe("invalid_draft_shape");
});
test("upsert e ingesta son idempotentes y omiten el detalle ya guardado", async () => {
  const database = db(); const first = normalizeDraft(summary, detail, "premium");
  expect(upsertDrafts(database, [first])).toBe(1); expect(upsertDrafts(database, [first])).toBe(0);
  let details = 0;
  const result = await ingestDrafts({ getProMatches: async () => [summary], getMatchDetail: async () => { details += 1; return detail; } }, database, { maxPages: 1 });
  expect(result.inserted).toBe(0); expect(details).toBe(0); database.close();
});
test("un rate-limit conserva el lote descargado y termina de forma reanudable", async () => {
  const database = db(); const rateLimit = Object.assign(new Error("too many requests"), { status: 429 });
  const result = await ingestDrafts({ getProMatches: async () => [summary], getMatchDetail: async () => { throw rateLimit; } }, database, { maxPages: 1, requestDelayMs: 0 });
  expect(result.inserted).toBe(0); expect(result.fetched).toBe(0); database.close();
});
test("un error 5xx de detalle no aborta la ingesta completa", async () => {
  const database = db(); const serverError = Object.assign(new Error("server error"), { status: 500 });
  const result = await ingestDrafts({ getProMatches: async () => [summary], getMatchDetail: async () => { throw serverError; } }, database, { maxPages: 1, requestDelayMs: 0 });
  expect(result.inserted).toBe(0); expect(result.failedDetails).toBe(1); database.close();
});

test("ingesta respeta el cursor recibido para reanudar hacia atrás", async () => {
  const database = db(); let received: number | undefined;
  await ingestDrafts({ getProMatches: async (cursor) => { received = cursor; return []; }, getMatchDetail: async () => detail }, database, { cursor: 12345, maxPages: 1, maxRequests: 1, requestDelayMs: 0 });
  expect(received).toBe(12345); database.close();
});
