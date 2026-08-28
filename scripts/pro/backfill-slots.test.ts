import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { backfillSlots } from "./backfill-slots";

interface RawPlayer {
  hero_id: number;
  player_slot?: number | null;
  isRadiant?: boolean | null;
  team?: 0 | 1 | null;
  position_est?: number | null;
  lane_role?: number | null;
  is_roaming?: boolean | null;
  net_worth?: number | null;
}

function seedDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE pro_drafts (match_id TEXT PRIMARY KEY, ingest_status TEXT NOT NULL, raw_json TEXT NOT NULL);
    CREATE TABLE pro_draft_slots (match_id TEXT, hero_id INTEGER, team INTEGER, position_est INTEGER, lane_role INTEGER, is_roaming INTEGER, net_worth INTEGER, PRIMARY KEY (match_id, team, position_est));
  `);
  return db;
}

function insertDraft(db: Database, matchId: string, players: readonly RawPlayer[], ingestStatus: "complete" | "unclassifiable" = "complete"): void {
  db.query("INSERT INTO pro_drafts (match_id, ingest_status, raw_json) VALUES (?, ?, ?)").run(matchId, ingestStatus, JSON.stringify({ players }));
}

// Reproduce el bug viejo: los 5 jugadores de Radiant escritos con team=0, Dire descartado.
function seedBuggyRadiantSlots(db: Database, matchId: string, radiant: readonly RawPlayer[]): void {
  const stmt = db.query("INSERT OR IGNORE INTO pro_draft_slots (match_id, hero_id, team, position_est, lane_role, is_roaming, net_worth) VALUES (?, ?, 0, ?, ?, 0, ?)");
  for (const player of radiant) stmt.run(matchId, player.hero_id, player.position_est ?? 1, player.lane_role ?? 0, player.net_worth ?? 0);
}

function tenPlayers(base = 0, opts: { withPlayerSlot?: boolean; withIsRadiant?: boolean } = {}): RawPlayer[] {
  const { withPlayerSlot = true, withIsRadiant = true } = opts;
  return Array.from({ length: 10 }, (_, i) => {
    const radiant = i < 5;
    return {
      hero_id: base + i + 1,
      team: null,
      player_slot: withPlayerSlot ? (radiant ? i : 128 + (i - 5)) : null,
      isRadiant: withIsRadiant ? radiant : null,
      position_est: (i % 5) + 1,
      lane_role: (i % 5) + 1,
      is_roaming: false,
      net_worth: 10000 - i * 100,
    };
  });
}

function slotRows(db: Database): { match_id: string; hero_id: number; team: number; position_est: number }[] {
  return db.query("SELECT match_id, hero_id, team, position_est FROM pro_draft_slots ORDER BY match_id, team, hero_id").all() as never;
}

test("recupera los 5 slots de Dire que la ingesta vieja descartaba", () => {
  const db = seedDb();
  const players = tenPlayers();
  insertDraft(db, "1", players);
  seedBuggyRadiantSlots(db, "1", players.slice(0, 5));

  const report = backfillSlots(db);

  expect(report.slotsBefore).toBe(5);
  expect(report.slotsAfter).toBe(10);
  expect(report.completeWithFullSlots).toBe(1);
  expect(report.completeWithPartialSlots).toBe(0);
  expect(slotRows(db).filter((row) => row.team === 1)).toHaveLength(5);
  db.close();
});

test("deriva el equipo de player_slot cuando isRadiant no viene", () => {
  const db = seedDb();
  insertDraft(db, "1", tenPlayers(0, { withIsRadiant: false, withPlayerSlot: true }));
  backfillSlots(db);
  const direHeroes = slotRows(db).filter((row) => row.team === 1).map((row) => row.hero_id).sort((a, b) => a - b);
  expect(direHeroes).toEqual([6, 7, 8, 9, 10]);
  db.close();
});

test("--dry-run no escribe nada", () => {
  const db = seedDb();
  const players = tenPlayers();
  insertDraft(db, "1", players);
  seedBuggyRadiantSlots(db, "1", players.slice(0, 5));

  const report = backfillSlots(db, { dryRun: true });

  expect(report.dryRun).toBe(true);
  expect(report.slotsAfter).toBe(report.slotsBefore);
  expect(report.slotsBefore).toBe(5);
  expect(db.query("SELECT COUNT(*) AS c FROM pro_draft_slots").get()).toEqual({ c: 5 });
  db.close();
});

test("es idempotente: dos corridas dejan exactamente las mismas filas", () => {
  const db = seedDb();
  insertDraft(db, "1", tenPlayers(0));
  insertDraft(db, "2", tenPlayers(20));

  const first = backfillSlots(db);
  const firstRows = JSON.stringify(slotRows(db));
  const second = backfillSlots(db);
  const secondRows = JSON.stringify(slotRows(db));

  expect(second.slotsAfter).toBe(first.slotsAfter);
  expect(secondRows).toBe(firstRows);
  db.close();
});

test("omite jugadores con position_est nulo o fuera de 1..5 sin inventar posición", () => {
  const db = seedDb();
  const players = tenPlayers();
  players[2] = { ...players[2]!, position_est: null };
  players[7] = { ...players[7]!, position_est: 0 };
  insertDraft(db, "1", players);

  const report = backfillSlots(db);

  expect(report.slotsAfter).toBe(8);
  expect(report.completeWithFullSlots).toBe(0);
  expect(report.completeWithPartialSlots).toBe(1);
  expect(slotRows(db).some((row) => row.hero_id === 3 || row.hero_id === 8)).toBe(false);
  db.close();
});

test("la PK nueva es (match_id, team, hero_id) y conserva position_est duplicado dentro de un equipo", () => {
  const db = seedDb();
  const players = tenPlayers();
  players[1] = { ...players[1]!, position_est: 3 }; // dos héroes de Radiant en pos 3
  insertDraft(db, "1", players);

  backfillSlots(db);

  const pk = (db.query("PRAGMA table_info(pro_draft_slots)").all() as { name: string; pk: number }[])
    .filter((column) => column.pk > 0)
    .sort((a, b) => a.pk - b.pk)
    .map((column) => column.name);
  expect(pk).toEqual(["match_id", "team", "hero_id"]);
  expect(slotRows(db).filter((row) => row.team === 0 && row.position_est === 3)).toHaveLength(2);
  db.close();
});

test("reconstruye slots de todos los drafts pero solo desglosa los 'complete'", () => {
  const db = seedDb();
  insertDraft(db, "1", tenPlayers(0), "complete");
  insertDraft(db, "2", tenPlayers(20), "unclassifiable");

  const report = backfillSlots(db);

  expect(report.totalDrafts).toBe(2);
  expect(report.completeDrafts).toBe(1);
  expect(report.completeWithFullSlots).toBe(1);
  expect(report.slotsAfter).toBe(20);
  db.close();
});
