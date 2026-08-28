#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { OpenDotaClient } from "../../apps/engine/src/meta/opendota-client";
import { validateDraftShape } from "./validate-drafts";

const SCHEMA_PATH = new URL("./schema.sql", import.meta.url);
const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";
export const DAILY_REQUEST_CAP = 2_000;
export const SESSION_REQUEST_CAP = 500;
export const DEFAULT_REQUEST_DELAY_MS = 2_500;
const ACCEPTED_TIERS = new Set(["premium", "professional"]);

export interface ProMatchSummary { readonly match_id: number; readonly start_time: number; readonly leagueid: number; }
export interface MatchDetail {
  readonly patch?: number; readonly start_time?: number; readonly game_mode?: number; readonly radiant_win?: boolean;
  readonly leagueid?: number; readonly league?: { readonly tier?: string | null; readonly name?: string };
  readonly radiant_team_id?: number | null; readonly dire_team_id?: number | null;
  readonly picks_bans?: readonly { readonly order?: number; readonly is_pick: boolean; readonly hero_id: number; readonly team: 0 | 1 }[];
  readonly players?: readonly MatchDetailPlayer[];
  readonly od_data?: { readonly has_gcdata?: boolean; readonly has_parsed?: boolean };
}

// OpenDota (`GET /matches/{id}`) NO trae un `team` fiable en cada jugador: manda `player_slot`
// (0-4 Radiant, 128-132 Dire) y `isRadiant`. El ingestor viejo usaba `team ?? 0`, así que los 5
// jugadores de Dire colapsaban a `team=0` y la PK de `pro_draft_slots` descartaba ese lado.
export interface MatchDetailPlayer {
  readonly hero_id?: number;
  readonly team?: 0 | 1 | null;
  readonly player_slot?: number | null;
  readonly isRadiant?: boolean | null;
  readonly position_est?: number | null;
  readonly lane_role?: number | null;
  readonly is_roaming?: boolean | null;
  readonly net_worth?: number | null;
}

export interface ProSlotRow {
  readonly matchId: string;
  readonly heroId: number;
  readonly team: 0 | 1;
  readonly positionEst: number;
  readonly laneRole: number;
  readonly isRoaming: boolean;
  readonly netWorth: number;
}

/** Radiant (0) o Dire (1). Prefiere `isRadiant`, cae a `player_slot >= 128`, luego al `team` crudo. */
export function playerTeam(player: Pick<MatchDetailPlayer, "team" | "player_slot" | "isRadiant">): 0 | 1 {
  if (player.isRadiant === true) return 0;
  if (player.isRadiant === false) return 1;
  if (typeof player.player_slot === "number") return player.player_slot >= 128 ? 1 : 0;
  return player.team === 1 ? 1 : 0;
}

/** Normaliza `players[]` a filas de slot. Omite jugadores sin héroe o con `position_est` fuera de
 *  1..5 (no se inventa posición). Reutilizada por `upsertDrafts` y por `backfill-slots.ts`. */
export function playersToSlotRows(matchId: string, players: MatchDetail["players"]): ProSlotRow[] {
  const rows: ProSlotRow[] = [];
  for (const player of players ?? []) {
    const position = player?.position_est;
    if (player?.hero_id === undefined || typeof position !== "number" || !Number.isInteger(position) || position < 1 || position > 5) continue;
    rows.push({
      matchId,
      heroId: player.hero_id,
      team: playerTeam(player),
      positionEst: position,
      laneRole: player.lane_role ?? 0,
      isRoaming: player.is_roaming === true,
      netWorth: player.net_worth ?? 0,
    });
  }
  return rows;
}

export interface IngestedDraft {
  readonly matchId: string; readonly leagueId: number; readonly patch: string; readonly startTime: number;
  readonly leagueName: string; readonly leagueTier: "premium" | "professional" | "excluded" | "amateur" | "unknown";
  readonly gameMode: number; readonly radiantTeamId: number | null; readonly direTeamId: number | null;
  readonly winningSide: "radiant" | "dire"; readonly turns: readonly unknown[]; readonly slots: readonly unknown[];
  readonly status: "complete" | "unclassifiable"; readonly reason: string | null; readonly rawJson: string;
  readonly hasGcdata: boolean; readonly hasParsed: boolean;
}

export function normalizeDraft(match: ProMatchSummary, detail: MatchDetail, leagueTier: string | null): IngestedDraft {
  const turns = detail.picks_bans ?? [];
  const slots = detail.players ?? [];
  const shape = validateDraftShape({ match_id: match.match_id, patch: detail.patch, picks_bans: turns });
  const reason = !ACCEPTED_TIERS.has(leagueTier ?? "") ? "tier_not_accepted"
    : !detail.od_data?.has_gcdata ? "has_gcdata_false"
    : !shape.valid ? "invalid_draft_shape"
    : !detail.players ? "players_missing" : null;
  return {
    matchId: String(match.match_id), leagueId: match.leagueid, leagueName: detail.league?.name ?? `League ${match.leagueid}`,
    leagueTier: ACCEPTED_TIERS.has(leagueTier ?? "") ? leagueTier as "premium" | "professional" : "unknown",
    patch: String(detail.patch ?? "unknown"),
    startTime: detail.start_time ?? match.start_time, gameMode: detail.game_mode ?? 0,
    radiantTeamId: detail.radiant_team_id ?? null, direTeamId: detail.dire_team_id ?? null,
    winningSide: detail.radiant_win ? "radiant" : "dire", turns, slots,
    status: reason ? "unclassifiable" : "complete", reason, rawJson: JSON.stringify(detail),
    hasGcdata: detail.od_data?.has_gcdata === true, hasParsed: detail.od_data?.has_parsed === true,
  };
}

export function upsertDrafts(db: Database, drafts: readonly IngestedDraft[]): number {
  const statement = db.prepare(`INSERT OR IGNORE INTO pro_drafts
    (match_id, league_id, patch, start_time, game_mode, radiant_team_id, dire_team_id, winning_side,
     source, fetched_at, sample_size, ingest_status, ingest_reason, raw_json, has_gcdata, has_parsed)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'opendota_match', ?, 1, ?, ?, ?, ?, ?)`);
  const turnStatement = db.prepare(`INSERT OR IGNORE INTO pro_draft_turns (match_id, draft_order, is_pick, hero_id, team) VALUES (?, ?, ?, ?, ?)`);
  const slotStatement = db.prepare(`INSERT OR IGNORE INTO pro_draft_slots (match_id, hero_id, team, position_est, lane_role, is_roaming, net_worth) VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const tournamentStatement = db.prepare(`INSERT OR IGNORE INTO tournaments (league_id, name, tier, first_seen_at, last_seen_at, region, source, fetched_at, sample_size, confidence) VALUES (?, ?, ?, ?, ?, 'unknown', 'opendota_match', ?, 1, 'medium')`);
  const tx = db.transaction(() => {
    let inserted = 0;
    for (const draft of drafts) {
      tournamentStatement.run(draft.leagueId, draft.leagueName, draft.leagueTier, new Date(draft.startTime * 1000).toISOString(), new Date(draft.startTime * 1000).toISOString(), new Date().toISOString());
      const result = statement.run(draft.matchId, draft.leagueId, draft.patch, draft.startTime, draft.gameMode,
        draft.radiantTeamId, draft.direTeamId, draft.winningSide, new Date().toISOString(), draft.status,
        draft.reason, draft.rawJson, draft.hasGcdata ? 1 : 0, draft.hasParsed ? 1 : 0);
      inserted += Number(result.changes);
      for (const turn of draft.turns as MatchDetail["picks_bans"]) {
        if (turn?.order !== undefined) turnStatement.run(draft.matchId, turn.order, turn.is_pick ? 1 : 0, turn.hero_id, turn.team);
      }
      for (const row of playersToSlotRows(draft.matchId, draft.slots as MatchDetail["players"])) {
        slotStatement.run(row.matchId, row.heroId, row.team, row.positionEst, row.laneRole, row.isRoaming ? 1 : 0, row.netWorth);
      }
    }
    return inserted;
  });
  return tx();
}

function saveCheckpoint(db: Database, cursor: number | undefined): void {
  if (cursor === undefined) return;
  const table = db.query("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'ingest_checkpoint'").get();
  if (!table) return;
  db.run("INSERT INTO ingest_checkpoint (id, cursor, updated_at) VALUES (1, ?, ?) ON CONFLICT(id) DO UPDATE SET cursor=excluded.cursor, updated_at=excluded.updated_at", String(cursor), new Date().toISOString());
}
function readCheckpoint(db: Database): number | undefined {
  const row = db.query("SELECT cursor FROM ingest_checkpoint WHERE id = 1").get() as { cursor?: string } | null;
  const value = Number(row?.cursor);
  return Number.isSafeInteger(value) && value > 0 ? value : undefined;
}

export interface IngestOptions { readonly maxPages?: number; readonly maxRequests?: number; readonly cursor?: number; readonly targetDrafts?: number; readonly requestDelayMs?: number; }
export async function ingestDrafts(client: Pick<OpenDotaClient, "getProMatches" | "getMatchDetail">, db: Database, options: IngestOptions = {}) {
  const maxPages = options.maxPages ?? 300;
  const maxRequests = Math.min(options.maxRequests ?? SESSION_REQUEST_CAP, SESSION_REQUEST_CAP);
  const requestDelayMs = Math.max(0, options.requestDelayMs ?? DEFAULT_REQUEST_DELAY_MS);
  let lastRequestAt = 0;
  const throttle = async (): Promise<void> => { const wait = requestDelayMs - (Date.now() - lastRequestAt); if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait)); lastRequestAt = Date.now(); };
  let requests = 0; let cursor = options.cursor; let pages = 0; let rateLimited = false; let failedDetails = 0; const drafts: IngestedDraft[] = [];
  while (pages < maxPages && requests < maxRequests) {
    if (options.targetDrafts !== undefined) {
      const count = Number((db.query("SELECT COUNT(*) AS count FROM pro_drafts WHERE ingest_status = 'complete'").get() as { count: number }).count);
      if (count >= options.targetDrafts) break;
    }
    let page: ProMatchSummary[];
    try {
      await throttle(); page = (await client.getProMatches(cursor)) as ProMatchSummary[]; requests += 1; pages += 1;
    } catch (error) {
      if (typeof error === "object" && error !== null && "status" in error && error.status === 429) { rateLimited = true; break; }
      throw error;
    }
    if (!Array.isArray(page) || page.length === 0) break;
    for (const summary of page) {
      if (requests >= maxRequests) break;
      const exists = db.query("SELECT 1 FROM pro_drafts WHERE match_id = ?").get(String(summary.match_id));
      if (exists) continue;
      let detail: MatchDetail;
      try { await throttle(); detail = (await client.getMatchDetail(summary.match_id)) as MatchDetail; }
      catch (error) {
        if (typeof error === "object" && error !== null && "status" in error && error.status === 429) { rateLimited = true; break; }
        failedDetails += 1; continue;
      }
      requests += 1;
      drafts.push(normalizeDraft(summary, detail, detail.league?.tier ?? null));
    }
    if (rateLimited) break;
    const next = page.at(-1)?.match_id;
    if (!Number.isInteger(next) || next <= 0 || next >= (cursor ?? Number.MAX_SAFE_INTEGER)) break;
    cursor = next;
    saveCheckpoint(db, cursor);
  }
  return { inserted: upsertDrafts(db, drafts), fetched: drafts.length, failedDetails, requests, pages, cursor: cursor ?? null };
}

async function main(): Promise<void> {
  const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=") as [string, string]));
  const db = new Database(args.get("db") || DEFAULT_DB_PATH, { create: true });
  try {
    db.exec(await Bun.file(SCHEMA_PATH).text());
    const result = await ingestDrafts(new OpenDotaClient(), db, { cursor: readCheckpoint(db), maxPages: Number(args.get("max-pages") || 300), maxRequests: Number(args.get("max-requests") || SESSION_REQUEST_CAP), requestDelayMs: Number(args.get("delay-ms") || DEFAULT_REQUEST_DELAY_MS), targetDrafts: Number(args.get("target-drafts") || 3000) });
    console.log(`Drafts nuevos: ${result.inserted}; requests: ${result.requests}; cursor: ${result.cursor ?? "none"}`);
  } finally { db.close(); }
}

if (import.meta.main) main().catch((error) => { console.error("ingest-drafts falló:", error); process.exit(1); });
