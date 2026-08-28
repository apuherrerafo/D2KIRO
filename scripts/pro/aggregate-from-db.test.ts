import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { loadDraftFormatTurnData } from "../../apps/engine/src/draft/draft-format-turns";
import { buildAggregateReport, datasetConfidence } from "./aggregate-from-db";

const table = loadDraftFormatTurnData().captainsMode!;
const BAN_ORDERS = table.turns.map((turn, order) => ({ turn, order })).filter((x) => x.turn.action === "ban").map((x) => x.order);
const FIRST_PICK_ORDERS = table.turns.map((turn, order) => ({ turn, order })).filter((x) => x.turn.action === "pick" && x.turn.team === "first").map((x) => x.order);
const SECOND_PICK_ORDERS = table.turns.map((turn, order) => ({ turn, order })).filter((x) => x.turn.action === "pick" && x.turn.team === "second").map((x) => x.order);

function seedDb(): Database {
  const db = new Database(":memory:");
  db.exec(`
    CREATE TABLE tournaments (league_id INTEGER PRIMARY KEY, name TEXT, tier TEXT, first_seen_at TEXT, last_seen_at TEXT, region TEXT, source TEXT, fetched_at TEXT, sample_size INTEGER, confidence TEXT);
    CREATE TABLE pro_drafts (match_id TEXT PRIMARY KEY, league_id INTEGER, patch TEXT, start_time INTEGER, game_mode INTEGER, radiant_team_id INTEGER, dire_team_id INTEGER, winning_side TEXT, source TEXT, fetched_at TEXT, sample_size INTEGER, ingest_status TEXT, ingest_reason TEXT, raw_json TEXT, has_gcdata INTEGER, has_parsed INTEGER);
    CREATE TABLE pro_draft_turns (match_id TEXT, draft_order INTEGER, is_pick INTEGER, hero_id INTEGER, team INTEGER, PRIMARY KEY (match_id, draft_order));
    CREATE TABLE pro_draft_slots (match_id TEXT, hero_id INTEGER, team INTEGER, position_est INTEGER, lane_role INTEGER, is_roaming INTEGER, net_worth INTEGER, PRIMARY KEY (match_id, team, hero_id));
  `);
  return db;
}

interface DraftOverrides {
  readonly matchId: string;
  readonly leagueId?: number;
  readonly tier?: string;
  readonly radiantHeroes?: readonly number[];
  readonly direHeroes?: readonly number[];
  readonly bans?: readonly number[];
  readonly winningSide?: "radiant" | "dire";
  readonly ingestStatus?: "complete" | "unclassifiable";
  readonly gameMode?: number;
  readonly hasGcdata?: 0 | 1;
  readonly fetchedAt?: string;
  readonly withSlots?: boolean;
}

function insertDraft(db: Database, overrides: DraftOverrides): void {
  const leagueId = overrides.leagueId ?? 1;
  const tier = overrides.tier ?? "premium";
  const radiantHeroes = overrides.radiantHeroes ?? [11, 12, 13, 14, 15];
  const direHeroes = overrides.direHeroes ?? [21, 22, 23, 24, 25];
  const bans = overrides.bans ?? [31, 32, 33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44];
  const gameMode = overrides.gameMode ?? 2;
  const hasGcdata = overrides.hasGcdata ?? 1;
  const fetchedAt = overrides.fetchedAt ?? "2026-08-01T00:00:00.000Z";
  const status = overrides.ingestStatus ?? "complete";
  const withSlots = overrides.withSlots ?? true;

  db.query("INSERT OR IGNORE INTO tournaments (league_id, name, tier, region, source, fetched_at, sample_size, confidence) VALUES (?, ?, ?, 'unknown', 'opendota_match', ?, 1, 'medium')").run(
    leagueId,
    `League ${leagueId}`,
    tier,
    fetchedAt,
  );
  db.query(
    "INSERT INTO pro_drafts (match_id, league_id, patch, start_time, game_mode, radiant_team_id, dire_team_id, winning_side, source, fetched_at, sample_size, ingest_status, ingest_reason, raw_json, has_gcdata, has_parsed) VALUES (?, ?, '60', 1, ?, 10, 20, ?, 'opendota_match', ?, 1, ?, NULL, '{}', ?, 1)",
  ).run(overrides.matchId, leagueId, gameMode, overrides.winningSide ?? "radiant", fetchedAt, status, hasGcdata);

  const turnStmt = db.query("INSERT INTO pro_draft_turns (match_id, draft_order, is_pick, hero_id, team) VALUES (?, ?, ?, ?, ?)");
  for (let order = 0; order < 24; order += 1) {
    const spec = table.turns[order]!;
    const team = spec.team === "first" ? 0 : 1;
    let heroId = -order;
    if (spec.action === "ban") heroId = bans[BAN_ORDERS.indexOf(order)]!;
    else if (team === 0) heroId = radiantHeroes[FIRST_PICK_ORDERS.indexOf(order)]!;
    else heroId = direHeroes[SECOND_PICK_ORDERS.indexOf(order)]!;
    turnStmt.run(overrides.matchId, order, spec.action === "pick" ? 1 : 0, heroId, team);
  }

  if (withSlots) {
    const slotStmt = db.query("INSERT INTO pro_draft_slots (match_id, hero_id, team, position_est, lane_role, is_roaming, net_worth) VALUES (?, ?, 0, ?, ?, 0, ?)");
    for (let position = 1; position <= 5; position += 1) {
      slotStmt.run(overrides.matchId, radiantHeroes[position - 1]!, position, position, 6000 - position * 500);
    }
  }
}

function seedComplete(db: Database, count: number, overrides: Omit<DraftOverrides, "matchId"> = {}, startId = 1000): void {
  for (let i = 0; i < count; i += 1) insertDraft(db, { ...overrides, matchId: String(startId + i) });
}

test("solo lee filas con ingest_status = 'complete'", () => {
  const db = seedDb();
  seedComplete(db, 3, {}, 1000);
  seedComplete(db, 2, { ingestStatus: "unclassifiable", radiantHeroes: [90, 91, 92, 93, 94] }, 2000);
  const { report } = buildAggregateReport(db);
  db.close();

  expect(report.coverage.completeDraftsInDb).toBe(3);
  expect(report.coverage.draftsAggregated).toBe(3);
  expect(report.coverage.draftsSkipped).toBe(0);
  expect(report.metadata.sampleSize).toBe(3);
});

test("las filas unclassifiable nunca aportan héroes ni muestras", () => {
  const db = seedDb();
  seedComplete(db, 30, { radiantHeroes: [11, 12, 13, 14, 15] }, 1000);
  seedComplete(db, 8, { ingestStatus: "unclassifiable", radiantHeroes: [99, 98, 97, 96, 95] }, 2000);
  const { report } = buildAggregateReport(db);
  db.close();

  expect(report.coverage.completeDraftsInDb).toBe(30);
  expect(report.coverage.samplesByHero["99"]).toBeUndefined();
  expect(report.positions.some((row) => row.heroId === 99)).toBe(false);
});

test("un draft 'complete' que no clasifica como tier_1/tier_2 se descarta con motivo", () => {
  const db = seedDb();
  seedComplete(db, 5, { leagueId: 1, tier: "premium" }, 1000);
  seedComplete(db, 3, { leagueId: 2, tier: "unknown" }, 2000);
  seedComplete(db, 2, { leagueId: 3, tier: "premium", gameMode: 22 }, 3000);
  const { report } = buildAggregateReport(db);
  db.close();

  expect(report.coverage.completeDraftsInDb).toBe(10);
  expect(report.coverage.draftsAggregated).toBe(5);
  expect(report.coverage.draftsSkippedByReason.excluded).toBe(3);
  expect(report.coverage.draftsSkippedByReason.unclassifiable).toBe(2);
});

test("respeta los umbrales de posiciones, parejas y respuestas a bans", () => {
  const positionsAt = (count: number) => {
    const db = seedDb();
    seedComplete(db, count, {});
    const { report } = buildAggregateReport(db);
    db.close();
    return report;
  };

  const below = positionsAt(29);
  expect(below.positions).toEqual([]);
  expect(below.pairs).toEqual([]);

  const at = positionsAt(30);
  expect(at.positions.find((row) => row.heroId === 11 && row.positionEst === 1)).toMatchObject({ sampleSize: 30, tier: "tier_1" });
  expect(at.pairs.find((row) => row.heroes[0] === 11 && row.heroes[1] === 12)).toMatchObject({ sampleSize: 30 });
  expect(at.coverage.patterns.positions.eligible).toBeGreaterThan(0);
  expect(at.coverage.patterns.positions.discarded).toBe(at.coverage.patterns.positions.groups - at.coverage.patterns.positions.eligible);

  const banBelow = (() => {
    const db = seedDb();
    seedComplete(db, 9, {});
    const { report } = buildAggregateReport(db);
    db.close();
    return report;
  })();
  expect(banBelow.banResponses).toEqual([]);

  const banAt = (() => {
    const db = seedDb();
    seedComplete(db, 10, {});
    const { report } = buildAggregateReport(db);
    db.close();
    return report;
  })();
  expect(banAt.banResponses.find((row) => row.bannedHero === 44 && row.nextPickHero === 25)).toMatchObject({ sampleSize: 10, confidence: "exploratory" });
});

test("el JSON es determinista: mismas filas, mismo texto, sin importar el orden de inserción", () => {
  const forward = seedDb();
  for (let i = 0; i < 30; i += 1) insertDraft(forward, { matchId: String(1000 + i), winningSide: i % 2 === 0 ? "radiant" : "dire" });
  const backward = seedDb();
  for (let i = 29; i >= 0; i -= 1) insertDraft(backward, { matchId: String(1000 + i), winningSide: i % 2 === 0 ? "radiant" : "dire" });

  const a = buildAggregateReport(forward).json;
  const b = buildAggregateReport(forward).json;
  const c = buildAggregateReport(backward).json;
  forward.close();
  backward.close();

  expect(a).toBe(b);
  expect(a).toBe(c);
});

test("preserva la metadata de origen y la propaga a cada patrón agregado", () => {
  const db = seedDb();
  for (let i = 0; i < 30; i += 1) {
    insertDraft(db, { matchId: String(1000 + i), fetchedAt: `2026-08-${String(2 + i).padStart(2, "0")}T00:00:00.000Z` });
  }
  const { report } = buildAggregateReport(db);
  db.close();

  expect(report.metadata.source).toBe("opendota_match");
  expect(report.metadata.fetchedAt).toBe("2026-08-31T00:00:00.000Z");
  expect(report.metadata.sampleSize).toBe(30);
  expect(report.metadata.confidence).toBe("exploratory");
  expect(report.thresholds.positionMinGames).toBe(30);
  expect(report.thresholds.banResponseMinGames).toBe(10);

  expect(report.positions[0]?.ref).toMatchObject({ source: "opendota_match", sampleSize: 1 });
  expect(report.pairs[0]?.ref.source).toBe("opendota_match");
});

test("datasetConfidence escala con el número de drafts", () => {
  expect(datasetConfidence(0)).toBe("none");
  expect(datasetConfidence(199)).toBe("exploratory");
  expect(datasetConfidence(200)).toBe("medium");
  expect(datasetConfidence(999)).toBe("medium");
  expect(datasetConfidence(1000)).toBe("high");
});
