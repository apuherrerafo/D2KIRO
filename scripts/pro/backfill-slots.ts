#!/usr/bin/env bun
// Reconstruye pro_draft_slots desde pro_drafts.raw_json con el mapeo de equipo correcto
// (Radiant/Dire vía isRadiant/player_slot), recuperando los slots de Dire que la ingesta vieja
// descartaba. Offline: solo lee raw_json ya guardado, nunca la red. Idempotente: cada corrida deja
// la tabla en el mismo estado, con la PK nueva (match_id, team, hero_id).
import { Database } from "bun:sqlite";
import { type MatchDetail, playersToSlotRows } from "./ingest-drafts";

const DEFAULT_DB_PATH = "apps/engine/data/pro-drafts.sqlite";

const REBUILD_DDL = `CREATE TABLE pro_draft_slots_rebuild (
  match_id TEXT NOT NULL,
  hero_id INTEGER NOT NULL,
  team INTEGER NOT NULL CHECK (team IN (0, 1)),
  position_est INTEGER NOT NULL CHECK (position_est BETWEEN 1 AND 5),
  lane_role INTEGER NOT NULL,
  is_roaming INTEGER NOT NULL CHECK (is_roaming IN (0, 1)),
  net_worth INTEGER NOT NULL,
  PRIMARY KEY (match_id, team, hero_id),
  FOREIGN KEY (match_id) REFERENCES pro_drafts(match_id) ON DELETE CASCADE
)`;

export interface BackfillReport {
  readonly dryRun: boolean;
  readonly totalDrafts: number;
  readonly completeDrafts: number;
  readonly unparseableRawJson: number;
  readonly slotsBefore: number;
  readonly slotsAfter: number;
  readonly completeWithFullSlots: number;
  readonly completeWithPartialSlots: number;
  readonly completeWithoutSlots: number;
}

interface DraftRawRow { readonly match_id: string; readonly raw_json: string; readonly ingest_status: string }

function countSlots(db: Database): number {
  return Number((db.query("SELECT COUNT(*) AS count FROM pro_draft_slots").get() as { count: number }).count);
}

export function backfillSlots(db: Database, options: { dryRun?: boolean } = {}): BackfillReport {
  const dryRun = options.dryRun ?? false;
  const rows = db.query("SELECT match_id, raw_json, ingest_status FROM pro_drafts ORDER BY match_id").all() as DraftRawRow[];

  const slotRowsToWrite: ReturnType<typeof playersToSlotRows> = [];
  const completeSlotCounts: number[] = [];
  let unparseableRawJson = 0;
  let completeDrafts = 0;

  for (const row of rows) {
    let detail: MatchDetail;
    try {
      detail = JSON.parse(row.raw_json) as MatchDetail;
    } catch {
      unparseableRawJson += 1;
      if (row.ingest_status === "complete") { completeDrafts += 1; completeSlotCounts.push(0); }
      continue;
    }
    const slots = playersToSlotRows(row.match_id, detail.players);
    slotRowsToWrite.push(...slots);
    if (row.ingest_status === "complete") { completeDrafts += 1; completeSlotCounts.push(slots.length); }
  }

  const completeWithFullSlots = completeSlotCounts.filter((n) => n === 10).length;
  const completeWithoutSlots = completeSlotCounts.filter((n) => n === 0).length;
  const completeWithPartialSlots = completeSlotCounts.length - completeWithFullSlots - completeWithoutSlots;

  const slotsBefore = countSlots(db);
  let slotsAfter = slotsBefore;

  if (!dryRun) {
    db.transaction(() => {
      db.run("DROP TABLE IF EXISTS pro_draft_slots_rebuild");
      db.run(REBUILD_DDL);
      const insert = db.prepare(
        "INSERT OR IGNORE INTO pro_draft_slots_rebuild (match_id, hero_id, team, position_est, lane_role, is_roaming, net_worth) VALUES (?, ?, ?, ?, ?, ?, ?)",
      );
      for (const slot of slotRowsToWrite) {
        insert.run(slot.matchId, slot.heroId, slot.team, slot.positionEst, slot.laneRole, slot.isRoaming ? 1 : 0, slot.netWorth);
      }
      db.run("DROP TABLE pro_draft_slots");
      db.run("ALTER TABLE pro_draft_slots_rebuild RENAME TO pro_draft_slots");
    })();
    slotsAfter = countSlots(db);
  }

  return {
    dryRun,
    totalDrafts: rows.length,
    completeDrafts,
    unparseableRawJson,
    slotsBefore,
    slotsAfter,
    completeWithFullSlots,
    completeWithPartialSlots,
    completeWithoutSlots,
  };
}

async function main(): Promise<void> {
  const args = new Map(process.argv.slice(2).map((arg) => arg.replace(/^--/, "").split("=") as [string, string]));
  const dbPath = args.get("db") || DEFAULT_DB_PATH;
  const dryRun = args.has("dry-run");
  const db = new Database(dbPath);
  try {
    const report = backfillSlots(db, { dryRun });
    const prefix = report.dryRun ? "[dry-run] " : "";
    console.log(`${prefix}drafts totales: ${report.totalDrafts}; complete: ${report.completeDrafts}; raw_json ilegible: ${report.unparseableRawJson}`);
    console.log(`${prefix}slots: ${report.slotsBefore} -> ${report.slotsAfter}`);
    console.log(`${prefix}complete con 10 slots: ${report.completeWithFullSlots}; parciales (1-9): ${report.completeWithPartialSlots}; sin slots: ${report.completeWithoutSlots}`);
  } finally {
    db.close();
  }
}

if (import.meta.main) main().catch((error) => { console.error("backfill-slots falló:", error); process.exit(1); });
