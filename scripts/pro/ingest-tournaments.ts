#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { OpenDotaClient } from "../../apps/engine/src/meta/opendota-client";
import type { Confidence } from "../../apps/engine/src/pro/types";

const SCHEMA_PATH = new URL("./schema.sql", import.meta.url);
const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";

export interface LeagueSummary {
  readonly leagueid: number;
  readonly name: string;
  readonly tier: string | null;
}

export interface ProMatchSummary {
  readonly match_id: number;
  readonly start_time: number;
  readonly leagueid: number;
}

export interface TournamentRecord {
  readonly leagueId: number;
  readonly name: string;
  readonly tier: "premium" | "professional" | "excluded" | "amateur" | "unknown";
  readonly firstSeenAt: string | null;
  readonly lastSeenAt: string | null;
  readonly region: "unknown";
  readonly source: "opendota_league";
  readonly fetchedAt: string;
  readonly sampleSize: number;
  readonly confidence: Confidence;
}

function normalizeTier(tier: string | null): TournamentRecord["tier"] {
  return tier === "premium" || tier === "professional" || tier === "excluded" || tier === "amateur"
    ? tier
    : "unknown";
}

function isoFromEpoch(seconds: number): string {
  return new Date(seconds * 1000).toISOString();
}

/** Deriva un catálogo completo, conservando también ligas sin partidas en la ventana. */
export function deriveTournaments(
  leagues: readonly LeagueSummary[],
  pages: readonly (readonly ProMatchSummary[])[],
  fetchedAt: string,
): TournamentRecord[] {
  const byLeague = new Map<number, { min: number; max: number; count: number }>();
  for (const page of pages) {
    for (const match of page) {
      if (!Number.isInteger(match.leagueid) || !Number.isFinite(match.start_time)) continue;
      const previous = byLeague.get(match.leagueid);
      byLeague.set(match.leagueid, {
        min: Math.min(previous?.min ?? match.start_time, match.start_time),
        max: Math.max(previous?.max ?? match.start_time, match.start_time),
        count: (previous?.count ?? 0) + 1,
      });
    }
  }

  const names = new Map(leagues.map((league) => [league.leagueid, league] as const));
  const allIds = new Set([...names.keys(), ...byLeague.keys()]);
  return [...allIds].sort((a, b) => a - b).map((leagueId) => {
    const league = names.get(leagueId);
    const observed = byLeague.get(leagueId);
    return {
      leagueId,
      name: league?.name ?? `league-${leagueId}`,
      tier: normalizeTier(league?.tier ?? null),
      firstSeenAt: observed ? isoFromEpoch(observed.min) : null,
      lastSeenAt: observed ? isoFromEpoch(observed.max) : null,
      region: "unknown" as const,
      source: "opendota_league" as const,
      fetchedAt,
      sampleSize: observed?.count ?? 0,
      confidence: observed ? "medium" as const : "none" as const,
    };
  });
}

export function upsertTournaments(db: Database, records: readonly TournamentRecord[]): number {
  const statement = db.prepare(`INSERT INTO tournaments
    (league_id, name, tier, first_seen_at, last_seen_at, region, source, fetched_at, sample_size, confidence)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(league_id) DO UPDATE SET
      name=excluded.name, tier=excluded.tier, first_seen_at=excluded.first_seen_at,
      last_seen_at=excluded.last_seen_at, region=excluded.region, source=excluded.source,
      fetched_at=excluded.fetched_at, sample_size=excluded.sample_size, confidence=excluded.confidence`);
  const tx = db.transaction(() => {
    let inserted = 0;
    for (const record of records) {
      const exists = db.query("SELECT 1 FROM tournaments WHERE league_id = ?").get(record.leagueId);
      statement.run(record.leagueId, record.name, record.tier, record.firstSeenAt, record.lastSeenAt,
        record.region, record.source, record.fetchedAt, record.sampleSize, record.confidence);
      if (!exists) inserted += 1;
    }
    return inserted;
  });
  return tx();
}

export interface IngestOptions {
  readonly maxPages?: number;
  readonly fetchedAt?: string;
}

export async function ingestTournaments(
  client: Pick<OpenDotaClient, "getLeagues" | "getProMatches">,
  db: Database,
  options: IngestOptions = {},
): Promise<{ readonly records: number; readonly inserted: number; readonly pages: number }> {
  const leagues = (await client.getLeagues()) as LeagueSummary[];
  const pages: ProMatchSummary[][] = [];
  const maxPages = options.maxPages ?? 300;
  let cursor: number | undefined;
  for (let pageNumber = 0; pageNumber < maxPages; pageNumber += 1) {
    const page = (await client.getProMatches(cursor)) as ProMatchSummary[];
    if (!Array.isArray(page) || page.length === 0) break;
    pages.push(page);
    const next = page.at(-1)?.match_id;
    if (!Number.isInteger(next) || next <= 0 || next >= (cursor ?? Number.MAX_SAFE_INTEGER)) break;
    cursor = next;
  }
  const records = deriveTournaments(leagues, pages, options.fetchedAt ?? new Date().toISOString());
  return { records: records.length, inserted: upsertTournaments(db, records), pages: pages.length };
}

async function main(): Promise<void> {
  const args = new Map(process.argv.slice(2).map((arg) => {
    const [key, value] = arg.replace(/^--/, "").split("=");
    return [key, value ?? ""] as const;
  }));
  const dbPath = args.get("db") || DEFAULT_DB_PATH;
  const db = new Database(dbPath, { create: true });
  try {
    db.exec(await Bun.file(SCHEMA_PATH).text());
    const result = await ingestTournaments(new OpenDotaClient(), db, {
      maxPages: Number(args.get("max-pages") || 300),
      fetchedAt: args.get("fetched-at") || new Date().toISOString(),
    });
    console.log(`Torneos procesados: ${result.records}; filas nuevas: ${result.inserted}; páginas: ${result.pages}`);
  } finally {
    db.close();
  }
}

if (import.meta.main) main().catch((error) => { console.error("ingest-tournaments falló:", error); process.exit(1); });
