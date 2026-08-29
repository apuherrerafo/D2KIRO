import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./run";
import type { ProDraftTurn } from "./types";

let dir: string;
const ENV_KEYS = ["D2K_PRO_DB", "ENGINE_DB_PATH", "D2K_GOLDEN", "D2K_BASELINE_OUT", "D2K_REPORTS_DIR", "D2K_SPLIT_OUT"] as const;
const saved: Record<string, string | undefined> = {};

function draft24(base: number): ProDraftTurn[] {
  const h = (n: number): number => base + n + 1;
  const t: ProDraftTurn[] = [];
  for (let o = 0; o < 6; o++) t.push({ order: o, isPick: false, hero: h(o), team: (o % 2) as 0 | 1 });
  for (let k = 0; k < 10; k++) t.push({ order: 6 + k, isPick: true, hero: h(6 + k), team: (k % 2) as 0 | 1 });
  for (let o = 16; o < 24; o++) t.push({ order: o, isPick: false, hero: h(o), team: (o % 2) as 0 | 1 });
  return t;
}

function makeEngineDb(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE heroes (id INTEGER PRIMARY KEY, localized_name TEXT NOT NULL, roles TEXT NOT NULL);
    CREATE TABLE hero_matchups (hero_id INTEGER, vs_hero_id INTEGER, games INTEGER, wins INTEGER);
    CREATE TABLE hero_patch_stats (hero_id INTEGER, patch TEXT, bracket TEXT, picks INTEGER, wins INTEGER);
    CREATE TABLE meta_sync (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, finished_at TEXT);
  `);
  for (let i = 1; i <= 40; i++) {
    db.query("INSERT INTO heroes VALUES (?, ?, ?)").run(i, `H${i}`, '["Carry"]');
    db.query("INSERT INTO hero_patch_stats VALUES (?, '60', 'immortal', ?, ?)").run(i, i * 10, i * 5);
  }
  db.query("INSERT INTO meta_sync (status, finished_at) VALUES ('ok', '2026-08-29T00:00:00Z')").run();
  db.close();
}

function makeProDb(path: string): void {
  const db = new Database(path);
  db.exec(`
    CREATE TABLE tournaments (league_id INTEGER PRIMARY KEY, tier TEXT NOT NULL);
    CREATE TABLE pro_drafts (match_id TEXT PRIMARY KEY, league_id INTEGER, patch TEXT, ingest_reason TEXT);
    CREATE TABLE pro_draft_turns (match_id TEXT, draft_order INTEGER, is_pick INTEGER, hero_id INTEGER, team INTEGER, PRIMARY KEY (match_id, draft_order));
  `);
  db.query("INSERT INTO tournaments VALUES (10, 'professional'), (20, 'premium')").run();
  const drafts: [string, number][] = [["A1", 10], ["A2", 10], ["B1", 20], ["B2", 20]];
  for (const [mid, league] of drafts) {
    db.query("INSERT INTO pro_drafts VALUES (?, ?, '60', NULL)").run(mid, league);
    draft24(0).forEach((t) => db.query("INSERT INTO pro_draft_turns VALUES (?,?,?,?,?)").run(mid, t.order, t.isPick ? 1 : 0, t.hero, t.team));
  }
  db.close();
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-eval-run-"));
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.ENGINE_DB_PATH = join(dir, "engine.sqlite");
  process.env.D2K_PRO_DB = join(dir, "pro.sqlite");
  process.env.D2K_GOLDEN = join(dir, "no-golden.json");
  process.env.D2K_BASELINE_OUT = join(dir, "v6-measured.json");
  process.env.D2K_REPORTS_DIR = join(dir, "reports");
  process.env.D2K_SPLIT_OUT = join(dir, "split.json");
  makeEngineDb(process.env.ENGINE_DB_PATH);
  makeProDb(process.env.D2K_PRO_DB);
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  rmSync(dir, { recursive: true, force: true });
});

test("bun run eval: corrida válida escribe v6-measured.json + reporte, exit 0", async () => {
  const code = await main();
  expect(code).toBe(0);
  expect(existsSync(process.env.D2K_BASELINE_OUT!)).toBe(true);

  const frozen = JSON.parse(readFileSync(process.env.D2K_BASELINE_OUT!, "utf-8"));
  expect(frozen.schemaVersion).toBe(1);
  expect(frozen.commit).toMatch(/^[0-9a-f]{7,40}$|^unknown$/);
  expect(frozen.splitHash).toMatch(/^[0-9a-f]{8}$/);
  expect(frozen.professionalPickAgreement.valid).toBe(true);
  expect(frozen.professionalPickAgreement.constraintViolationRate).toBe(0);
  expect(frozen.corpusSize.drafts).toBe(4);
  expect(frozen.corpusSize.tournaments).toBe(2);
  expect(frozen.corpusSize.goldenCases).toBe(0); // no hay Golden todavía

  // el reporte existe y trae la advertencia de ADR-002
  const reports = readFileSync(join(process.env.D2K_REPORTS_DIR!, require("node:fs").readdirSync(process.env.D2K_REPORTS_DIR!)[0]), "utf-8");
  expect(reports).toContain("INSTRUMENTO COMPARATIVO, NO PREDICTIVO");
  expect(reports).toContain("NO es \"accuracy\"");
});

test("determinismo: dos corridas -> v6-measured.json byte-idéntico", async () => {
  await main();
  const first = readFileSync(process.env.D2K_BASELINE_OUT!, "utf-8");
  await main();
  const second = readFileSync(process.env.D2K_BASELINE_OUT!, "utf-8");
  expect(second).toBe(first);
});

test("split.json se crea una vez y no se regenera en la segunda corrida", async () => {
  await main();
  const s1 = readFileSync(process.env.D2K_SPLIT_OUT!, "utf-8");
  await main();
  const s2 = readFileSync(process.env.D2K_SPLIT_OUT!, "utf-8");
  expect(s2).toBe(s1);
});
