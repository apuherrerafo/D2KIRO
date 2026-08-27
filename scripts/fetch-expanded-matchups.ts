#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { OpenDotaClient } from "../apps/engine/src/meta/opendota-client";

export interface ExpandedMatchupRow {
  hero_id: number;
  vs_hero_id: number;
  games: number;
  wins: number;
}

export const MIN_MATCHUP_GAMES = 200;
export const DEFAULT_BATCH_SIZE = 1000;
export const DEFAULT_BATCHES = 10;

// Una sola consulta evita 127 llamadas a /heroes/{id}/matchups y conserva el umbral de calidad
// del motor. public_matches aporta el filtro de MMR alto y los dos rosters completos; así evitamos
// joins contra matches/player_matches que hacen que Explorer agote su timeout de lectura.
export function buildExplorerSql(cursor?: number, batchSize = DEFAULT_BATCH_SIZE): string {
  if (!Number.isInteger(batchSize) || batchSize < 100 || batchSize > 5000) {
    throw new Error("batchSize debe estar entre 100 y 5000");
  }
  const cursorClause = cursor === undefined ? "" : `AND match_id < ${cursor}`;
  return `
WITH ranked_matches AS (
  SELECT match_id, radiant_win, radiant_team, dire_team
  FROM public_matches
  WHERE avg_rank_tier >= 60
    AND start_time >= extract(epoch FROM now() - interval '90 days')
    ${cursorClause}
  ORDER BY start_time DESC
  LIMIT ${batchSize}
), pairs AS (
  SELECT m.match_id, own.hero_id, rival.hero_id AS vs_hero_id, m.radiant_win, true AS own_radiant
  FROM ranked_matches m, unnest(m.radiant_team) own(hero_id), unnest(m.dire_team) rival(hero_id)
  UNION ALL
  SELECT m.match_id, own.hero_id, rival.hero_id AS vs_hero_id, m.radiant_win, false AS own_radiant
  FROM ranked_matches m, unnest(m.dire_team) own(hero_id), unnest(m.radiant_team) rival(hero_id)
)
SELECT hero_id, vs_hero_id, count(*)::int AS games,
  sum(CASE WHEN (own_radiant AND radiant_win) OR (NOT own_radiant AND NOT radiant_win) THEN 1 ELSE 0 END)::int AS wins,
  max(match_id)::bigint AS batch_cursor
FROM pairs
WHERE pairs.hero_id > 0 AND pairs.vs_hero_id > 0
GROUP BY hero_id, vs_hero_id
ORDER BY hero_id, vs_hero_id;
`.trim();
}

export const EXPLORER_SQL = buildExplorerSql();

function isValidRow(value: unknown): value is ExpandedMatchupRow {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return Number.isInteger(row.hero_id) && Number.isInteger(row.vs_hero_id)
    && Number.isInteger(row.games) && Number.isInteger(row.wins)
    && Number(row.hero_id) > 0 && Number(row.vs_hero_id) > 0
    && Number(row.games) >= 1 && Number(row.wins) >= 0 && Number(row.wins) <= Number(row.games);
}

/** Agrega lotes por par; la consulta SQL ya entrega cada par agrupado, pero esto permite paginar. */
export function aggregateExpandedMatchups(raw: unknown): ExpandedMatchupRow[] {
  const rows = Array.isArray(raw) ? raw : (raw as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) throw new Error("Explorer no devolvió un array de filas");
  const unique = new Map<string, ExpandedMatchupRow>();
  for (const row of rows) {
    if (!isValidRow(row)) continue;
    const key = `${row.hero_id}:${row.vs_hero_id}`;
    const previous = unique.get(key);
    unique.set(key, previous
      ? { ...previous, games: previous.games + row.games, wins: previous.wins + row.wins }
      : { hero_id: row.hero_id, vs_hero_id: row.vs_hero_id, games: row.games, wins: row.wins });
  }
  return [...unique.values()]
    .filter((row) => row.games >= MIN_MATCHUP_GAMES)
    .sort((a, b) => a.hero_id - b.hero_id || a.vs_hero_id - b.vs_hero_id);
}

export function replaceHeroMatchups(dbPath: string, rows: readonly ExpandedMatchupRow[], updatedAt: string): number {
  if (rows.length === 0) throw new Error("No se actualiza hero_matchups con un snapshot vacío");
  const db = new Database(dbPath);
  try {
    const insert = db.prepare(`INSERT INTO hero_matchups (hero_id, vs_hero_id, games, wins, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(hero_id, vs_hero_id) DO UPDATE SET games=excluded.games, wins=excluded.wins, updated_at=excluded.updated_at`);
    const tx = db.transaction(() => {
      for (const row of rows) insert.run(row.hero_id, row.vs_hero_id, row.games, row.wins, updatedAt);
    });
    tx();
    return rows.length;
  } finally {
    db.close();
  }
}

async function main(): Promise<void> {
  const client = new OpenDotaClient();
  const batchCount = Number(process.env.EXPANDED_MATCHUPS_BATCHES ?? DEFAULT_BATCHES);
  if (!Number.isInteger(batchCount) || batchCount < 1 || batchCount > 100) {
    throw new Error("EXPANDED_MATCHUPS_BATCHES debe estar entre 1 y 100");
  }
  const rawRows: unknown[] = [];
  let cursor: number | undefined;
  for (let batch = 0; batch < batchCount; batch += 1) {
    const response = await client.getExplorer(buildExplorerSql(cursor));
    const page = Array.isArray(response) ? response : (response as { rows?: unknown })?.rows;
    if (!Array.isArray(page) || page.length === 0) break;
    rawRows.push(...page);
    const cursors = page
      .map((row) => Number((row as { batch_cursor?: unknown })?.batch_cursor))
      .filter((value) => Number.isInteger(value) && value > 0);
    const nextCursor = cursors.length > 0 ? Math.min(...cursors) : undefined;
    if (nextCursor === undefined || nextCursor >= (cursor ?? Number.MAX_SAFE_INTEGER)) break;
    cursor = nextCursor;
  }
  const rows = aggregateExpandedMatchups(rawRows);
  const output = process.env.EXPANDED_MATCHUPS_OUTPUT ?? "apps/engine/data/expanded-matchups.json";
  await Bun.write(output, JSON.stringify({ source: "opendota-explorer", generatedAt: new Date().toISOString(), rows }, null, 2) + "\n");
  if (Bun.argv.includes("--write-db")) {
    const dbPath = process.env.ENGINE_DB_PATH ?? "apps/engine/data/dota2coach.sqlite";
    console.log(`Matchups agregados: ${replaceHeroMatchups(dbPath, rows, new Date().toISOString())}`);
  }
  console.log(`Snapshot escrito en ${output}: ${rows.length} pares válidos.`);
}

if (import.meta.main) await main();
