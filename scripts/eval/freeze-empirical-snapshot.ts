#!/usr/bin/env bun
// Certification remediation (Phase A, A1) -- FREEZE the empirical snapshot a certification packet is generated against.
//
//   bun scripts/eval/freeze-empirical-snapshot.ts --source=apps/engine/data/dota2coach.sqlite --id=W5-EMP-001
//   bun scripts/eval/freeze-empirical-snapshot.ts --verify=W5-EMP-001      (re-hash the frozen files; exit 1 on any drift)
//
// Writes `eval/snapshots/<id>.sqlite` + `eval/snapshots/<id>.provenance.json`. IMMUTABLE: an existing id is never overwritten.
// Only the META tables are copied (heroes, hero_patch_stats, hero_matchups, meta_sync): the live DB also holds accounts / hero
// pools / teams, which contain personal data (a Steam32) and never belong in an evidence artifact. The source is opened
// `readonly`, zero network. The logical fingerprint is the repo's existing `meta1:` contract (`snapshot.ts`), i.e. exactly what
// `loadMeta` reads, independent of file layout.
//
// Unlike `buildS1Snapshot` this does NOT refuse a snapshot whose last sync did not finish: it freezes what is there and DECLARES
// the interruption in the provenance (the certified Wave 5 data is exactly that state). Never imported from apps/.
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RANKED_ALL_PICK_IDENTITY } from "../../apps/engine/src/draft-protocol/rulesets/ranked-all-pick";
import { buildEmpiricalProvenance, validateEmpiricalProvenance, type BracketFact, type EmpiricalSnapshotProvenance, type MatchupRetrievalGroup, type SyncRunFact } from "./empirical-provenance";
import { fingerprintOpenDb, metaInputSelect, rawFileSha256 } from "./snapshot";

const SNAPSHOT_DIR = resolve(import.meta.dir, "../../eval/snapshots");
const TABLES = ["heroes", "hero_patch_stats", "hero_matchups", "meta_sync"] as const;

export const snapshotPaths = (id: string) => ({ db: join(SNAPSHOT_DIR, `${id}.sqlite`), provenance: join(SNAPSHOT_DIR, `${id}.provenance.json`) });

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
}

interface Facts {
  syncRuns: SyncRunFact[];
  tables: EmpiricalSnapshotProvenance["synchronization"]["tables"];
  patchLabelDistinct: string[];
  matchupRetrievalGroups: MatchupRetrievalGroup[];
  matchupHeroesDistinct: number;
  brackets: BracketFact[];
}

/** Everything the provenance states, read from the (already frozen) snapshot itself -- never from the live DB. */
export function readFacts(db: Database): Facts {
  const syncRuns = (db.query("SELECT id, source, started_at AS startedAt, finished_at AS finishedAt, status, rows_written AS rowsWritten FROM meta_sync ORDER BY id").all() as SyncRunFact[]);
  const table = (name: string) => {
    const row = db.query(`SELECT COUNT(*) AS rows, MIN(updated_at) AS retrievedFrom, MAX(updated_at) AS retrievedTo FROM ${name}`).get() as { rows: number; retrievedFrom: string | null; retrievedTo: string | null };
    return row;
  };
  const perHero = db.query("SELECT hero_id AS heroId, MIN(updated_at) AS f, MAX(updated_at) AS t FROM hero_matchups GROUP BY hero_id").all() as { heroId: number; f: string; t: string }[];
  const groups = new Map<number | null, MatchupRetrievalGroup>();
  for (const hero of perHero) {
    const owner = [...syncRuns].reverse().find((run) => run.startedAt <= hero.f)?.id ?? null;
    const group = groups.get(owner) ?? { syncId: owner, heroes: 0, retrievedFrom: hero.f, retrievedTo: hero.t };
    group.heroes += 1;
    if (hero.f < group.retrievedFrom) group.retrievedFrom = hero.f;
    if (hero.t > group.retrievedTo) group.retrievedTo = hero.t;
    groups.set(owner, group);
  }
  const brackets = db.query("SELECT bracket, SUM(picks) AS totalPicks, SUM(wins) AS totalWins FROM hero_patch_stats GROUP BY bracket ORDER BY bracket").all() as BracketFact[];
  const labels = (db.query("SELECT DISTINCT patch FROM hero_patch_stats ORDER BY patch").all() as { patch: string }[]).map((row) => row.patch);
  return {
    syncRuns,
    tables: { heroes: table("heroes"), hero_patch_stats: table("hero_patch_stats"), hero_matchups: table("hero_matchups") },
    patchLabelDistinct: labels,
    matchupRetrievalGroups: [...groups.values()].sort((a, b) => a.retrievedFrom.localeCompare(b.retrievedFrom)),
    matchupHeroesDistinct: perHero.length,
    brackets,
  };
}

function freeze(sourcePath: string, id: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(id)) throw new Error("--id may only contain letters, digits, '.', '_' and '-'");
  const target = snapshotPaths(id);
  if (existsSync(target.db) || existsSync(target.provenance)) throw new Error(`snapshot ${id} already exists -- frozen snapshots are immutable; choose a new id`);
  mkdirSync(SNAPSHOT_DIR, { recursive: true });

  const source = new Database(resolve(sourcePath), { readonly: true });
  const out = new Database(target.db, { create: true });
  try {
    out.run("PRAGMA journal_mode = DELETE");
    const sourceFingerprint = fingerprintOpenDb(source);
    for (const table of TABLES) {
      const ddl = (source.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = ?").get(table) as { sql: string } | null)?.sql;
      if (!ddl) throw new Error(`source has no table ${table}`);
      out.run(ddl);
      // ORDER BY rowid: the source's PHYSICAL row order is kept. `loadMeta` reads without ORDER BY, so that order decides the
      // iteration order of `patchStats`/`matchups` arrays (and with it the floating-point summation order) -- the logical
      // fingerprint below sorts canonically and would NOT notice a different order, the explicit check after the copy does.
      const rows = source.query(`SELECT * FROM ${table} ORDER BY rowid`).all() as Record<string, unknown>[];
      if (rows.length === 0) continue;
      const columns = Object.keys(rows[0]!);
      const insert = out.prepare(`INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`);
      out.transaction(() => { for (const row of rows) insert.run(...columns.map((column) => row[column] as never)); })();
    }
    if (fingerprintOpenDb(out) !== sourceFingerprint) throw new Error("frozen copy's logical fingerprint differs from the source -- aborting");
    for (const input of ["heroes", "hero_patch_stats", "hero_matchups"] as const) {
      if (JSON.stringify(out.query(metaInputSelect(input)).all()) !== JSON.stringify(source.query(metaInputSelect(input)).all())) throw new Error(`frozen ${input} rows are not in the source's iteration order -- aborting`);
    }
  } catch (error) {
    out.close();
    source.close();
    rmSync(target.db, { force: true });
    throw error;
  }
  out.close();
  source.close();

  const frozen = new Database(target.db, { readonly: true });
  const facts = readFacts(frozen);
  const logicalFingerprint = fingerprintOpenDb(frozen);
  frozen.close();
  const provenance = buildEmpiricalProvenance({
    snapshotId: id,
    frozenAt: new Date().toISOString(),
    rulesetTarget: RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch,
    patchLabelOnRows: facts.patchLabelDistinct.length === 1 ? facts.patchLabelDistinct[0]! : null,
    patchLabelDistinct: facts.patchLabelDistinct,
    syncRuns: facts.syncRuns,
    tables: facts.tables,
    matchupRetrievalGroups: facts.matchupRetrievalGroups,
    matchupHeroesDistinct: facts.matchupHeroesDistinct,
    brackets: facts.brackets,
    hashes: { logicalFingerprint, fileSha256: rawFileSha256(target.db), sourceFileSha256: rawFileSha256(resolve(sourcePath)) },
  });
  const problems = validateEmpiricalProvenance(provenance);
  if (problems.length > 0) {
    rmSync(target.db, { force: true });
    throw new Error(`provenance invalid, nothing kept: ${problems.join("; ")}`);
  }
  writeFileSync(target.provenance, `${JSON.stringify(provenance, null, 2)}\n`);
  console.log(JSON.stringify({ frozen: id, db: `eval/snapshots/${id}.sqlite`, provenance: `eval/snapshots/${id}.provenance.json`, rowCounts: provenance.rowCounts, hashes: provenance.hashes, limitations: provenance.limitations.length }, null, 2));
}

/** Re-derives every hash and fact from the frozen files and compares with the recorded provenance. Returns the discrepancies. */
export function verifySnapshot(id: string): string[] {
  const paths = snapshotPaths(id);
  if (!existsSync(paths.db) || !existsSync(paths.provenance)) return [`snapshot ${id} is missing a file`];
  const recorded = JSON.parse(readFileSync(paths.provenance, "utf8")) as EmpiricalSnapshotProvenance;
  const problems = validateEmpiricalProvenance(recorded);
  if (rawFileSha256(paths.db) !== recorded.hashes.fileSha256) problems.push("file sha256 differs from the recorded one");
  const db = new Database(paths.db, { readonly: true });
  try {
    if (fingerprintOpenDb(db) !== recorded.hashes.logicalFingerprint) problems.push("logical fingerprint differs from the recorded one");
    const facts = readFacts(db);
    if (JSON.stringify(facts.tables) !== JSON.stringify(recorded.synchronization.tables)) problems.push("table facts (row counts / retrieval times) differ from the recorded ones");
  } finally {
    db.close();
  }
  return problems;
}

if (import.meta.main) {
  const verify = arg("verify");
  if (verify) {
    const problems = verifySnapshot(verify);
    console.log(problems.length === 0 ? `snapshot ${verify}: OK` : `snapshot ${verify}: DRIFT\n- ${problems.join("\n- ")}`);
    process.exit(problems.length === 0 ? 0 : 1);
  }
  const source = arg("source");
  const id = arg("id");
  if (!source || !id) throw new Error("usage: --source=<sqlite> --id=<snapshot id>   |   --verify=<snapshot id>");
  freeze(source, id);
}
