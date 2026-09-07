import { Database } from "bun:sqlite";
import { afterEach, beforeEach, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { main } from "./run";
import { main as gateMain } from "./gate";
import { extractEvaluationIdentity, isComparable } from "./evaluation-identity";
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

// ─────────────────────────────────────────────────────────────────────────────
// Task 33 (R0.2B) — productor de eval corpus-opcional. Regression matrix de
// `.kiro/specs/r0-engineering-baseline-recovery/tasks.md` (tarea 33, 11 puntos).
// Contrato: con `pro-drafts.sqlite` AUSENTE, `bun run eval` produce un candidate válido,
// Benchmark A se mide de verdad, Benchmark B queda NO MEDIDO (corpus=0, perBaseline={},
// bootstrap=[]) y el gate lo lee como SKIPPED informational. Con el corpus PRESENTE, el
// comportamiento previo (Benchmark B real) no cambia.
// ─────────────────────────────────────────────────────────────────────────────

function removeProDb(): void {
  rmSync(process.env.D2K_PRO_DB!, { force: true });
}

/** Golden fixture mínimo y válido (S17) — para probar que Benchmark A se calcula de verdad. */
function writeGoldenFixture(): string {
  const path = join(dir, "golden.json");
  writeFileSync(
    path,
    JSON.stringify({
      schemaVersion: 1,
      cases: [
        {
          id: "t33-g1",
          source: { kind: "synthetic", note: "fixture Task 33" },
          state: {
            schema: "draft-state/v1",
            format: "captains_mode",
            patch: "60",
            localSide: "radiant",
            phase: "active",
            banned: [3, 4],
            picks: { radiant: [1], dire: [2] },
            lastSeq: 4,
          },
          side: "radiant",
          decisionContext: "response_pick",
          strata: ["team_needs"],
          labels: {
            excellent: [{ hero: 5, why: "fixture" }],
            acceptable: [{ hero: 6, why: "fixture" }],
            bad: [{ hero: 7, why: "fixture" }],
          },
          reasoningTags: ["fixture"],
          labeledAt: "2026-09-07",
          labeledBy: "task-33-test",
        },
      ],
    }),
  );
  return path;
}

test("Task33 [11] RED→GREEN: sin pro-drafts.sqlite el productor NO crashea (SQLITE_CANTOPEN) y termina exit 0", async () => {
  removeProDb();
  expect(existsSync(process.env.D2K_PRO_DB!)).toBe(false);

  let thrown: unknown;
  const code = await main().catch((e: unknown) => {
    thrown = e;
    return -1;
  });

  // Antes del fix `new Database(path, { readonly: true })` lanza `unable to open database file`.
  expect(thrown).toBeUndefined();
  expect(code).toBe(0);
});

test("Task33 [1]: pro ausente ⇒ el candidate artifact existe", async () => {
  removeProDb();
  const code = await main();
  expect(code).toBe(0);
  expect(existsSync(process.env.D2K_BASELINE_OUT!)).toBe(true);
});

test("Task33 [2] + BENCHMARK A REAL: pro ausente ⇒ Benchmark A se calcula sobre el Golden (cases > 0)", async () => {
  process.env.D2K_GOLDEN = writeGoldenFixture();
  removeProDb();

  const code = await main();
  expect(code).toBe(0);

  const frozen = JSON.parse(readFileSync(process.env.D2K_BASELINE_OUT!, "utf-8"));
  // engineQuality viene de runEngineQuality() sobre el fixture — NO copiado de un ReferenceBaseline.
  expect(frozen.engineQuality.valid).toBe(true);
  expect(frozen.engineQuality.corpus.cases).toBe(1);
  expect(frozen.engineQuality.perRanker.v6Full).toBeDefined();
  expect(frozen.engineQuality.perRanker.v6Full.overall.n).toBe(1);
  expect(frozen.corpusSize.goldenCases).toBe(1);
});

test("Task33 [3] + SENTINEL: pro ausente ⇒ Benchmark B NO MEDIDO (corpus=0, perBaseline={}, bootstrap=[])", async () => {
  removeProDb();
  const code = await main();
  expect(code).toBe(0);

  const b = JSON.parse(readFileSync(process.env.D2K_BASELINE_OUT!, "utf-8")).professionalPickAgreement;
  expect(b.perBaseline).toEqual({});
  expect(b.bootstrap).toEqual([]);
  expect(b.corpus).toEqual({ cases: 0, drafts: 0, tournaments: 0 });
  // `constraintViolationRate: 0` es SENTINEL de shape (el tipo exige un number), no una medición.
  // La verdad de "no disponible" es corpus=0 + perBaseline={} + gate SKIPPED (ver test [4]).
  expect(b.constraintViolationRate).toBe(0);
  expect(b.perBaseline.v6Full).toBeUndefined();
});

test("Task33 [4]+[5]: gate canónico read-only ⇒ B SKIPPED informational, --enforce PASS si A PASS, B nunca PASS", async () => {
  const goldenPath = writeGoldenFixture();
  process.env.D2K_GOLDEN = goldenPath;

  // Reference: corrida CON pro corpus (mismo split scratch, misma identidad de evaluación).
  const refPath = join(dir, "reference.json");
  process.env.D2K_BASELINE_OUT = refPath;
  expect(await main()).toBe(0);

  // Candidate: corrida SIN pro corpus.
  const candPath = join(dir, "candidate.json");
  process.env.D2K_BASELINE_OUT = candPath;
  removeProDb();
  expect(await main()).toBe(0);

  // Gate canónico, read-only. Se compara el candidate contra el reference.
  process.env.D2K_BASELINE_OUT = refPath;
  process.env.D2K_GATE_CURRENT = candPath;
  process.env.D2K_TOLERANCE_OUT = join(dir, "no-tolerance.json"); // fuerza DEFAULT_TOL
  const exit = await gateMain(["--enforce"]);
  expect(exit).toBe(0); // Benchmark A PASS ⇒ --enforce puede PASS aunque B no se haya medido

  delete process.env.D2K_GATE_CURRENT;
  delete process.env.D2K_TOLERANCE_OUT;
});

test("Task33 [9] + EVALUATION IDENTITY: candidate missing-pro sigue siendo comparable con el reference", async () => {
  process.env.D2K_GOLDEN = writeGoldenFixture();

  const refPath = join(dir, "reference.json");
  process.env.D2K_BASELINE_OUT = refPath;
  await main();

  const candPath = join(dir, "candidate.json");
  process.env.D2K_BASELINE_OUT = candPath;
  removeProDb();
  await main();

  const ref = JSON.parse(readFileSync(refPath, "utf-8"));
  const cand = JSON.parse(readFileSync(candPath, "utf-8"));

  const refId = extractEvaluationIdentity(ref);
  const candId = extractEvaluationIdentity(cand);
  expect(refId.ok).toBe(true);
  expect(candId.ok).toBe(true);
  if (!refId.ok || !candId.ok) return;

  expect(isComparable(candId.identity, refId.identity).comparable).toBe(true);
});

test("Task33 [8] + [7]: candidate y reference son artifacts distintos y no se fabrican métricas pro", async () => {
  process.env.D2K_GOLDEN = writeGoldenFixture();

  const refPath = join(dir, "reference.json");
  process.env.D2K_BASELINE_OUT = refPath;
  await main();
  const ref = JSON.parse(readFileSync(refPath, "utf-8"));

  const candPath = join(dir, "candidate.json");
  process.env.D2K_BASELINE_OUT = candPath;
  removeProDb();
  await main();
  const cand = JSON.parse(readFileSync(candPath, "utf-8"));

  // reference SÍ midió Benchmark B (4 drafts / 2 torneos del fixture); candidate NO.
  expect(ref.professionalPickAgreement.corpus.drafts).toBe(4);
  expect(cand.professionalPickAgreement.corpus.drafts).toBe(0);
  // Ninguna métrica pro sintetizada en el candidate: perBaseline vacío ⇒ sin R@k, sin MRR.
  expect(Object.keys(cand.professionalPickAgreement.perBaseline)).toEqual([]);
  expect(cand.professionalPickAgreement.bootstrap).toEqual([]);
});

test("Task33 [12] REPORT: pro ausente ⇒ el reporte no crashea y marca Benchmark B como NO MEDIDO (no PASS)", async () => {
  removeProDb();
  const code = await main();
  expect(code).toBe(0);

  const reportsDir = process.env.D2K_REPORTS_DIR!;
  const file = require("node:fs").readdirSync(reportsDir)[0];
  const report = readFileSync(join(reportsDir, file), "utf-8");

  expect(report).toContain("NO MEDIDO");
  // No se presenta el sentinel como observación ni se fabrica una conclusión cuantitativa.
  expect(report).not.toContain("| baseline | R@1 |");
  expect(report).not.toMatch(/Benchmark B[^\n]*\bPASS\b/);
});

test("Task33 [6] PRESENT-PRO PRESERVADO: con pro-drafts.sqlite presente, Benchmark B real sigue corriendo", async () => {
  // el fixture de beforeEach ya crea pro.sqlite con 4 drafts / 2 torneos.
  const code = await main();
  expect(code).toBe(0);

  const b = JSON.parse(readFileSync(process.env.D2K_BASELINE_OUT!, "utf-8")).professionalPickAgreement;
  expect(b.valid).toBe(true);
  expect(b.corpus.drafts).toBe(4);
  expect(b.corpus.tournaments).toBe(2);
  expect(b.perBaseline.v6Full).toBeDefined();
  expect(b.bootstrap.length).toBeGreaterThan(0);
});

test("Task33 [10]: pro ausente ⇒ el productor no crea ni toca `pro-drafts.sqlite`", async () => {
  removeProDb();
  const code = await main();
  expect(code).toBe(0);
  // el guard `existsSync` nunca abre la DB ⇒ el archivo sigue sin existir (cero creación/descarga).
  expect(existsSync(process.env.D2K_PRO_DB!)).toBe(false);
});
