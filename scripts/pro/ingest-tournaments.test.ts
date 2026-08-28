import { Database } from "bun:sqlite";
import { expect, test } from "bun:test";
import { deriveTournaments, ingestTournaments, upsertTournaments, type LeagueSummary, type ProMatchSummary } from "./ingest-tournaments";

const leagues: LeagueSummary[] = [
  { leagueid: 10, name: "Premium Cup", tier: "premium" },
  { leagueid: 20, name: "Professional Cup", tier: "professional" },
  { leagueid: 30, name: "No games", tier: null },
];
const pages: ProMatchSummary[][] = [[
  { match_id: 200, start_time: 2000, leagueid: 10 },
  { match_id: 199, start_time: 1000, leagueid: 10 },
  { match_id: 198, start_time: 1500, leagueid: 99 },
]];

test("deriveTournaments conserva ligas sin partidas y deriva fechas por start_time", () => {
  const records = deriveTournaments(leagues, pages, "2026-08-27T00:00:00.000Z");
  expect(records).toHaveLength(4);
  expect(records.find((r) => r.leagueId === 10)).toMatchObject({
    tier: "premium", firstSeenAt: new Date(1000 * 1000).toISOString(),
    lastSeenAt: new Date(2000 * 1000).toISOString(), sampleSize: 2, confidence: "medium",
  });
  expect(records.find((r) => r.leagueId === 30)).toMatchObject({
    tier: "unknown", firstSeenAt: null, lastSeenAt: null, sampleSize: 0, confidence: "none",
  });
  expect(records.find((r) => r.leagueId === 99)?.tier).toBe("unknown");
});

test("upsertTournaments es idempotente y cuenta solo filas nuevas", () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE tournaments (league_id INTEGER PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL,
    first_seen_at TEXT, last_seen_at TEXT, region TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL,
    sample_size INTEGER NOT NULL, confidence TEXT NOT NULL)`);
  const records = deriveTournaments(leagues, pages, "2026-08-27T00:00:00.000Z");
  expect(upsertTournaments(db, records)).toBe(4);
  expect(upsertTournaments(db, records)).toBe(0);
  expect(db.query("SELECT count(*) AS count FROM tournaments").get()).toEqual({ count: 4 });
  db.close();
});

test("ingestTournaments pagina y usa fixtures sin red", async () => {
  const db = new Database(":memory:");
  db.exec(`CREATE TABLE tournaments (league_id INTEGER PRIMARY KEY, name TEXT NOT NULL, tier TEXT NOT NULL,
    first_seen_at TEXT, last_seen_at TEXT, region TEXT NOT NULL, source TEXT NOT NULL, fetched_at TEXT NOT NULL,
    sample_size INTEGER NOT NULL, confidence TEXT NOT NULL)`);
  let calls = 0;
  const result = await ingestTournaments({
    getLeagues: async () => leagues,
    getProMatches: async (cursor?: number) => { calls += 1; return cursor ? [] : pages[0]!; },
  }, db, { fetchedAt: "2026-08-27T00:00:00.000Z" });
  expect(result).toEqual({ records: 4, inserted: 4, pages: 1 });
  expect(calls).toBe(2);
  db.close();
});
