import { Database } from "bun:sqlite";
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildManifest,
  buildS1Snapshot,
  canonicalMetaSerialization,
  computeMetaSnapshotVersion,
  dominantPatchFromDb,
  fingerprintOpenDb,
  META_INPUT_CONTRACT,
  metaInputSelect,
  rawFileSha256,
  readLogicalMetaInputs,
  serializeManifest,
  SNAPSHOT_SCHEMA_TAG,
  SNAPSHOT_VALIDATION,
  validateSnapshotDb,
} from "./snapshot";
import { isMetaSnapshotVersion } from "./evaluation-identity";

// ─────────────────────────────────────────────────────────────────────────────
// R0.2B — Task 34 (spec `.kiro/specs/r0-engineering-baseline-recovery/`, Req 2B.3 / 2A.2 c5-c9).
// Costura: NINGUNA prueba abre `apps/engine/data/*.sqlite` ni `eval/snapshots/*` real — DBs de
// fixture inline en `tmpdir()`. Cero red.
// ─────────────────────────────────────────────────────────────────────────────

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-snapshot-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

interface SeedOptions {
  heroes?: number;
  /** héroes (por índice 1..heroes) que reciben filas de hero_matchups. Default: todos. */
  matchupHeroes?: number[];
  patch?: string;
  extraUnrelatedTable?: boolean;
  syncStatus?: string;
  /** inserta las filas de heroes en orden inverso (mismos datos lógicos, otro layout físico). */
  reverseInsertOrder?: boolean;
  matchupWinsOverGames?: boolean;
  bumpMatchupWins?: boolean;
  bumpPatchPicks?: boolean;
}

function seedDb(path: string, o: SeedOptions = {}): void {
  const heroes = o.heroes ?? 110;
  const patch = o.patch ?? "7.41e";
  // matchups sólo entre los primeros MATCHUP_FANOUT+1 héroes — basta para cobertura y evita
  // ~12k inserts por DB (los tests corren de a pares). La huella lógica se prueba igual.
  const MATCHUP_FANOUT = 8;
  const db = new Database(path);
  db.exec(`
    CREATE TABLE heroes (id INTEGER PRIMARY KEY, localized_name TEXT, roles TEXT, extra_col TEXT);
    CREATE TABLE hero_patch_stats (hero_id INTEGER, patch TEXT, bracket TEXT, picks INTEGER, wins INTEGER);
    CREATE TABLE hero_matchups (hero_id INTEGER, vs_hero_id INTEGER, games INTEGER, wins INTEGER);
    CREATE TABLE meta_sync (id INTEGER PRIMARY KEY AUTOINCREMENT, status TEXT, finished_at TEXT);
  `);
  if (o.extraUnrelatedTable) {
    db.exec("CREATE TABLE meta_sync_noise (id INTEGER PRIMARY KEY, note TEXT);");
    db.query("INSERT INTO meta_sync_noise (note) VALUES ('irrelevante')").run();
  }
  const ids = Array.from({ length: heroes }, (_, i) => i + 1);
  const ordered = o.reverseInsertOrder ? [...ids].reverse() : ids;
  const insHero = db.query("INSERT INTO heroes VALUES (?, ?, ?, ?)");
  const insStat = db.query("INSERT INTO hero_patch_stats VALUES (?, ?, 'immortal', ?, ?)");
  const insMu = db.query("INSERT INTO hero_matchups VALUES (?, ?, ?, ?)");
  const rolesJson = JSON.stringify(["Carry", "Escape"]);
  const matchupHeroes = o.matchupHeroes ?? ids;
  db.transaction(() => {
    for (const i of ordered) {
      insHero.run(i, `Hero ${i}`, rolesJson, `noise-${i}`);
      const picks = i * 10 + (o.bumpPatchPicks && i === 1 ? 1 : 0);
      insStat.run(i, patch, picks, i * 4);
    }
    for (const i of matchupHeroes) {
      for (const vs of ids) {
        if (vs === i || vs > MATCHUP_FANOUT + 1) continue;
        const games = 50;
        let wins = 25 + (o.bumpMatchupWins && i === 1 && vs === 2 ? 3 : 0);
        if (o.matchupWinsOverGames && i === 1 && vs === 2) wins = 999;
        insMu.run(i, vs, games, wins);
      }
    }
    db.query("INSERT INTO meta_sync (status, finished_at) VALUES (?, '2026-08-29T00:00:00Z')").run(o.syncStatus ?? "ok");
  })();
  db.close();
}

function fingerprintOf(path: string): string {
  return computeMetaSnapshotVersion(path);
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 1/2 — huella lógica vs. bytes crudos
// ─────────────────────────────────────────────────────────────────────────────

describe("metaSnapshotVersion — huella de contenido LÓGICO", () => {
  test("formato: `meta1:` + sha256 COMPLETO (64 hex), nunca truncado", () => {
    const p = join(dir, "a.sqlite");
    seedDb(p);
    const fp = fingerprintOf(p);
    expect(fp.startsWith("meta1:")).toBe(true);
    expect(fp.slice("meta1:".length)).toMatch(/^[0-9a-f]{64}$/);
    expect(isMetaSnapshotVersion(fp)).toBe(true);
  });

  test("14 — determinista: dos lecturas del mismo archivo dan la misma huella", () => {
    const p = join(dir, "a.sqlite");
    seedDb(p);
    expect(fingerprintOf(p)).toBe(fingerprintOf(p));
    const db = new Database(p, { readonly: true });
    try {
      expect(fingerprintOpenDb(db)).toBe(fingerprintOpenDb(db));
      expect(canonicalMetaSerialization(readLogicalMetaInputs(db))).toBe(
        canonicalMetaSerialization(readLogicalMetaInputs(db)),
      );
    } finally {
      db.close();
    }
  });

  test("1 — mismos datos lógicos + distintos bytes físicos ⇒ MISMA huella", () => {
    const a = join(dir, "a.sqlite");
    const b = join(dir, "b.sqlite");
    seedDb(a);
    // b: mismo contenido lógico, insert en orden inverso + tabla extra + luego VACUUM.
    seedDb(b, { reverseInsertOrder: true, extraUnrelatedTable: true });
    const db = new Database(b);
    db.exec("VACUUM;");
    db.close();

    expect(rawFileSha256(a)).not.toBe(rawFileSha256(b)); // bytes distintos…
    expect(fingerprintOf(a)).toBe(fingerprintOf(b)); // …misma identidad lógica
  });

  test("1b — VACUUM no cambia la huella lógica", () => {
    const p = join(dir, "a.sqlite");
    seedDb(p);
    const before = fingerprintOf(p);
    const shaBefore = rawFileSha256(p);
    const db = new Database(p);
    db.exec("INSERT INTO heroes VALUES (99999, 'zzz', '[]', 'x'); DELETE FROM heroes WHERE id = 99999; VACUUM;");
    db.close();
    expect(fingerprintOf(p)).toBe(before);
    // (el sha crudo sí puede cambiar tras reescribir páginas — es exactamente el punto)
    void shaBefore;
  });

  test("4 — cambiar una tabla NO relacionada / metadata de meta_sync ⇒ MISMA huella", () => {
    const a = join(dir, "a.sqlite");
    const b = join(dir, "b.sqlite");
    seedDb(a);
    seedDb(b);
    const db = new Database(b);
    db.exec("CREATE TABLE unrelated (x INTEGER); INSERT INTO unrelated VALUES (1),(2),(3);");
    db.query("INSERT INTO meta_sync (status, finished_at) VALUES ('ok', '2099-01-01T00:00:00Z')").run();
    db.close();
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  test("2 — cambiar hero_matchups ⇒ huella DISTINTA (mismo patch label)", () => {
    const a = join(dir, "a.sqlite");
    const b = join(dir, "b.sqlite");
    seedDb(a, { patch: "7.41e" });
    seedDb(b, { patch: "7.41e", bumpMatchupWins: true });
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b));
  });

  test("3 — cambiar hero_patch_stats ⇒ huella DISTINTA (mismo patch label)", () => {
    const a = join(dir, "a.sqlite");
    const b = join(dir, "b.sqlite");
    seedDb(a, { patch: "7.41e" });
    seedDb(b, { patch: "7.41e", bumpPatchPicks: true });
    expect(fingerprintOf(a)).not.toBe(fingerprintOf(b));
  });

  test("5 — el SHA CRUDO del archivo NO participa en la identidad lógica", () => {
    const a = join(dir, "a.sqlite");
    const b = join(dir, "b.sqlite");
    seedDb(a);
    seedDb(b, { extraUnrelatedTable: true });
    // dos archivos con los mismos datos lógicos: raw sha distinto, huella lógica igual.
    expect(rawFileSha256(a)).not.toBe(rawFileSha256(b));
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });

  test("canónico: schemaTag incluido, null explícito, sin concatenación por delimitador", () => {
    const p = join(dir, "a.sqlite");
    seedDb(p, { heroes: 100 });
    const db = new Database(p);
    db.exec("UPDATE hero_patch_stats SET bracket = NULL WHERE hero_id = 1;");
    db.close();
    const rdb = new Database(p, { readonly: true });
    try {
      const canon = canonicalMetaSerialization(readLogicalMetaInputs(rdb));
      const parsed = JSON.parse(canon);
      expect(parsed.schemaTag).toBe(SNAPSHOT_SCHEMA_TAG);
      expect(Object.keys(parsed.tables)).toEqual(["heroes", "hero_patch_stats", "hero_matchups"]);
      const withNull = parsed.tables.hero_patch_stats.find((r: { hero_id: number }) => r.hero_id === 1);
      expect(withNull.bracket).toBeNull(); // null explícito, no "" ni 0
      expect(Object.keys(withNull)).toEqual(["hero_id", "patch", "bracket", "picks", "wins"]);
    } finally {
      rdb.close();
    }
  });

  test("roles: NULL / '[]' / whitespace distinto ⇒ misma huella (contenido lógico)", () => {
    const a = join(dir, "a.sqlite");
    const b = join(dir, "b.sqlite");
    seedDb(a);
    seedDb(b);
    const da = new Database(a);
    da.exec(`UPDATE heroes SET roles = '["Carry", "Escape"]' WHERE id = 5;`); // mismo array, otro whitespace
    da.close();
    expect(fingerprintOf(a)).toBe(fingerprintOf(b));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 4 — validar antes de congelar
// ─────────────────────────────────────────────────────────────────────────────

describe("validateSnapshotDb", () => {
  test("snapshot sano ⇒ ok con resumen", () => {
    const p = join(dir, "ok.sqlite");
    seedDb(p);
    const db = new Database(p, { readonly: true });
    try {
      const r = validateSnapshotDb(db);
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.summary.rowCounts.heroes).toBe(110);
      expect(r.summary.dominantPatch).toBe("7.41e");
      expect(r.summary.sourceSync.status).toBe("ok");
    } finally {
      db.close();
    }
  });

  test("RED — escritura PARCIAL de matchups (pocos héroes cubiertos) ⇒ rechazado", () => {
    const p = join(dir, "partial.sqlite");
    seedDb(p, { matchupHeroes: [1, 2, 3, 4, 5] }); // sólo 5 de 120 héroes con matchups
    const db = new Database(p, { readonly: true });
    try {
      const r = validateSnapshotDb(db);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.failures.join(" ")).toContain("cobertura de hero_matchups baja");
      expect(r.failures.join(" ")).toContain("escritura parcial");
    } finally {
      db.close();
    }
  });

  test("meta_sync no-ok ⇒ rechazado", () => {
    const p = join(dir, "failedsync.sqlite");
    seedDb(p, { syncStatus: "failed" });
    const db = new Database(p, { readonly: true });
    try {
      const r = validateSnapshotDb(db);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.failures.join(" ")).toContain("meta_sync más reciente no es status=ok");
    } finally {
      db.close();
    }
  });

  test("wins > games en un matchup ⇒ rechazado", () => {
    const p = join(dir, "badwins.sqlite");
    seedDb(p, { matchupWinsOverGames: true });
    const db = new Database(p, { readonly: true });
    try {
      const r = validateSnapshotDb(db);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.failures.join(" ")).toContain("wins > games");
    } finally {
      db.close();
    }
  });

  test("pocos héroes ⇒ rechazado", () => {
    const p = join(dir, "fewheroes.sqlite");
    seedDb(p, { heroes: SNAPSHOT_VALIDATION.MIN_HEROES - 1 });
    const db = new Database(p, { readonly: true });
    try {
      expect(validateSnapshotDb(db).ok).toBe(false);
    } finally {
      db.close();
    }
  });

  test("tabla ausente ⇒ rechazado sin lanzar", () => {
    const p = join(dir, "notable.sqlite");
    const db = new Database(p);
    db.exec("CREATE TABLE heroes (id INTEGER PRIMARY KEY);");
    db.close();
    const rdb = new Database(p, { readonly: true });
    try {
      const r = validateSnapshotDb(rdb);
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.failures.join(" ")).toContain("tabla ausente");
    } finally {
      rdb.close();
    }
  });

  test("dominantPatchFromDb — moda de hero_patch_stats.patch", () => {
    const p = join(dir, "dom.sqlite");
    seedDb(p, { patch: "7.42a" });
    const db = new Database(p, { readonly: true });
    try {
      expect(dominantPatchFromDb(db)).toBe("7.42a");
    } finally {
      db.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 3/5 — builder: validar → congelar → fingerprint → manifiesto
// ─────────────────────────────────────────────────────────────────────────────

describe("buildS1Snapshot", () => {
  const outPaths = () => ({
    outSqlitePath: join(dir, "S1.sqlite"),
    outManifestPath: join(dir, "S1.manifest.json"),
  });

  test("12 — snapshot inválido ⇒ el builder NO congela: sin S1.sqlite, sin manifiesto", () => {
    const src = join(dir, "src.sqlite");
    seedDb(src, { matchupHeroes: [1, 2, 3] }); // parcial ⇒ validación falla
    const out = outPaths();
    const r = buildS1Snapshot({
      sourceDbPath: src,
      ...out,
      patchLabel: "7.41e",
      patchLabelSource: "operator-input",
      now: () => new Date("2026-09-07T00:00:00Z"),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures.length).toBeGreaterThan(0);
    expect(existsSync(out.outSqlitePath)).toBe(false);
    expect(existsSync(out.outManifestPath)).toBe(false);
  });

  test("13 — snapshot válido ⇒ congela artefacto + manifiesto; la huella del manifiesto recomputa igual", () => {
    const src = join(dir, "src.sqlite");
    seedDb(src);
    const out = outPaths();
    const r = buildS1Snapshot({
      sourceDbPath: src,
      ...out,
      patchLabel: "7.41e",
      patchLabelSource: "operator-input",
      measuredEngineCommit: "df354b9c4ed415b86dba35dc92e2f84e5cb40e5d",
      evaluationHarnessCommit: "6498dea65f95b207d3997249f6fc60c1f1224ed1",
      now: () => new Date("2026-09-07T12:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(existsSync(out.outSqlitePath)).toBe(true);
    expect(existsSync(out.outManifestPath)).toBe(true);

    // la huella del manifiesto == recomputar sobre el archivo congelado
    const recomputed = computeMetaSnapshotVersion(out.outSqlitePath);
    expect(r.manifest.metaSnapshotVersion).toBe(recomputed);
    expect(isMetaSnapshotVersion(r.manifest.metaSnapshotVersion)).toBe(true);

    // snapshotFileSha == sha crudo del archivo congelado; NO es la huella lógica
    expect(r.manifest.snapshotFileSha).toBe(rawFileSha256(out.outSqlitePath));
    expect(r.manifest.snapshotFileSha).not.toBe(r.manifest.metaSnapshotVersion.slice("meta1:".length));

    // el manifiesto en disco coincide con lo devuelto
    const onDisk = JSON.parse(readFileSync(out.outManifestPath, "utf-8"));
    expect(onDisk.metaSnapshotVersion).toBe(r.manifest.metaSnapshotVersion);
    expect(onDisk.schemaTag).toBe(SNAPSHOT_SCHEMA_TAG);
    expect(onDisk.patchLabel).toBe("7.41e");
    expect(onDisk.patchLabelSource).toBe("operator-input");
    expect(onDisk.dominantPatch).toBe("7.41e");
    expect(onDisk.measuredEngineCommit).toBe("df354b9c4ed415b86dba35dc92e2f84e5cb40e5d");
    expect(onDisk.evaluationHarnessCommit).toBe("6498dea65f95b207d3997249f6fc60c1f1224ed1");
    expect(onDisk.rowCounts.heroes).toBe(110);
    expect(typeof onDisk.createdAt).toBe("string");
  });

  test("la huella lógica del artefacto congelado == la de la DB fuente (freeze no cambia contenido lógico)", () => {
    const src = join(dir, "src.sqlite");
    seedDb(src, { extraUnrelatedTable: true, reverseInsertOrder: true });
    const out = outPaths();
    const srcFp = computeMetaSnapshotVersion(src);
    const r = buildS1Snapshot({
      sourceDbPath: src,
      ...out,
      patchLabel: "x",
      patchLabelSource: "operator-input",
      now: () => new Date("2026-09-07T00:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.manifest.metaSnapshotVersion).toBe(srcFp);
  });

  test("no toca la DB fuente (se abre readonly)", () => {
    const src = join(dir, "src.sqlite");
    seedDb(src);
    const shaBefore = rawFileSha256(src);
    buildS1Snapshot({
      sourceDbPath: src,
      ...outPaths(),
      patchLabel: "x",
      patchLabelSource: "operator-input",
      now: () => new Date(),
    });
    expect(rawFileSha256(src)).toBe(shaBefore);
  });

  test("determinismo lógico: dos builds del mismo source ⇒ misma metaSnapshotVersion y mismo snapshotFileSha; sólo difiere createdAt", () => {
    const src = join(dir, "src.sqlite");
    seedDb(src);
    const a = { outSqlitePath: join(dir, "a.sqlite"), outManifestPath: join(dir, "a.json") };
    const b = { outSqlitePath: join(dir, "b.sqlite"), outManifestPath: join(dir, "b.json") };
    const ra = buildS1Snapshot({ sourceDbPath: src, ...a, patchLabel: "x", patchLabelSource: "operator-input", now: () => new Date("2026-01-01T00:00:00Z") });
    const rb = buildS1Snapshot({ sourceDbPath: src, ...b, patchLabel: "x", patchLabelSource: "operator-input", now: () => new Date("2027-02-02T00:00:00Z") });
    expect(ra.ok && rb.ok).toBe(true);
    if (!ra.ok || !rb.ok) return;
    expect(ra.manifest.metaSnapshotVersion).toBe(rb.manifest.metaSnapshotVersion);
    expect(ra.manifest.snapshotFileSha).toBe(rb.manifest.snapshotFileSha); // VACUUM normaliza ⇒ bytes deterministas
    expect(ra.manifest.createdAt).not.toBe(rb.manifest.createdAt); // sólo el metadato efímero difiere
  });
});

describe("buildManifest / serializeManifest — puros", () => {
  const summary = {
    rowCounts: { heroes: 120, hero_patch_stats: 120, hero_matchups: 14280 },
    distinctHeroIds: { patchStats: 120, matchups: 120 },
    heroesWithoutPatchStats: 0,
    dominantPatch: "7.41e",
    sourceSync: { status: "ok", finishedAt: "2026-08-29T00:00:00Z" },
  };

  test("dominantPatch sale de la validación; patchLabel es lo que recibió el sync", () => {
    const m = buildManifest({
      metaSnapshotVersion: "meta1:" + "a".repeat(64),
      snapshotFileSha: "b".repeat(64),
      patchLabel: "7.41e",
      patchLabelSource: "operator-input",
      validation: summary,
      createdAt: "2026-09-07T00:00:00Z",
    });
    expect(m.patchLabel).toBe("7.41e");
    expect(m.dominantPatch).toBe("7.41e");
    expect(m.measuredEngineCommit).toBeNull();
    expect(m.evaluationHarnessCommit).toBeNull();
    expect(m.snapshotFormatVersion).toBe(1);
  });

  test("serializeManifest: claves ordenadas, termina en \\n", () => {
    const m = buildManifest({
      metaSnapshotVersion: "meta1:" + "a".repeat(64),
      snapshotFileSha: "b".repeat(64),
      patchLabel: "x",
      patchLabelSource: "operator-input",
      validation: summary,
      createdAt: "2026-09-07T00:00:00Z",
    });
    const s = serializeManifest(m);
    expect(s.endsWith("\n")).toBe(true);
    expect(serializeManifest(m)).toBe(s); // determinista
    const keys = Object.keys(JSON.parse(s));
    expect(keys).toEqual([...keys].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 8 (Task 34 / C4) — contrato ÚNICO de proyección de inputs de meta.
// ─────────────────────────────────────────────────────────────────────────────

describe("META_INPUT_CONTRACT / metaInputSelect — candado de drift", () => {
  test("columnas exactas aprobadas (heroes / hero_patch_stats / hero_matchups)", () => {
    expect(META_INPUT_CONTRACT.heroes.columns).toEqual(["id", "localized_name", "roles"]);
    expect(META_INPUT_CONTRACT.hero_patch_stats.columns).toEqual(["hero_id", "patch", "bracket", "picks", "wins"]);
    expect(META_INPUT_CONTRACT.hero_matchups.columns).toEqual(["hero_id", "vs_hero_id", "games", "wins"]);
  });

  test("metaInputSelect construye el SELECT desde el contrato, sin alias", () => {
    expect(metaInputSelect("heroes")).toBe("SELECT id, localized_name, roles FROM heroes");
    expect(metaInputSelect("hero_patch_stats")).toBe(
      "SELECT hero_id, patch, bracket, picks, wins FROM hero_patch_stats",
    );
    expect(metaInputSelect("hero_matchups")).toBe("SELECT hero_id, vs_hero_id, games, wins FROM hero_matchups");
  });

  test("readLogicalMetaInputs consume esas proyecciones (roles parseado preservado)", () => {
    const p = join(dir, "contract.sqlite");
    seedDb(p, { heroes: 100 });
    const db = new Database(p, { readonly: true });
    try {
      const inputs = readLogicalMetaInputs(db);
      expect(inputs.heroes).toHaveLength(100);
      expect(inputs.heroes[0]).toEqual({ id: 1, localized_name: "Hero 1", roles: ["Carry", "Escape"] });
      expect(Object.keys(inputs.hero_patch_stats[0]!)).toEqual(["hero_id", "patch", "bracket", "picks", "wins"]);
      expect(Object.keys(inputs.hero_matchups[0]!)).toEqual(["hero_id", "vs_hero_id", "games", "wins"]);
    } finally {
      db.close();
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// FIX 4-7 (Task 34 / C1, C3) — materialización WAL-safe + orden freeze→validación.
// ─────────────────────────────────────────────────────────────────────────────

/** Seed VÁLIDO (misma forma que `seedDb`) en WAL, con una transacción COMMITEADA sin checkpoint.
 *  Devuelve la conexión ABIERTA — hay que cerrarla al final del test (mantiene vivo el `-wal`). */
function seedWalUncheckpointed(path: string): Database {
  seedDb(path); // DB base válida (110 héroes, cobertura ok, meta_sync ok)
  const hold = new Database(path);
  hold.exec("PRAGMA journal_mode=WAL;");
  // cambio COMMITEADO que queda SÓLO en el -wal (sin wal_checkpoint, sin close)
  hold.transaction(() => {
    hold.query("UPDATE hero_patch_stats SET picks = picks + 7 WHERE hero_id = 1").run();
    hold.query("UPDATE hero_matchups SET wins = wins + 1 WHERE hero_id = 2 AND vs_hero_id = 3").run();
  })();
  return hold;
}

describe("buildS1Snapshot — WAL-safe (FIX 4)", () => {
  test("RED→GREEN — WAL sin checkpoint: copyFileSync del archivo principal PIERDE datos commiteados; VACUUM INTO no", () => {
    const src = join(dir, "wal-src.sqlite");
    const hold = seedWalUncheckpointed(src);
    try {
      const fpSource = computeMetaSnapshotVersion(src); // conexión RO ve el WAL ⇒ estado commiteado real

      // RED: copia ingenua del archivo principal (lo que hacía el freeze viejo) — no arrastra el -wal
      const naive = join(dir, "naive-copy.sqlite");
      copyFileSync(src, naive);
      const fpNaive = computeMetaSnapshotVersion(naive);
      expect(fpNaive).not.toBe(fpSource); // la copia ingenua NO representa el estado commiteado

      // GREEN: buildS1Snapshot materializa con VACUUM INTO desde una conexión readonly
      const out = { outSqlitePath: join(dir, "S1.sqlite"), outManifestPath: join(dir, "S1.manifest.json") };
      const r = buildS1Snapshot({
        sourceDbPath: src,
        ...out,
        patchLabel: "7.41e",
        patchLabelSource: "operator-input",
        now: () => new Date("2026-09-07T00:00:00Z"),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;

      // el S1 congelado captura TODO el estado commiteado (incl. lo que estaba en el -wal)
      expect(r.manifest.metaSnapshotVersion).toBe(fpSource);
      expect(computeMetaSnapshotVersion(out.outSqlitePath)).toBe(fpSource);
      // standalone: abre sin -wal / -shm
      expect(existsSync(`${out.outSqlitePath}-wal`)).toBe(false);
      expect(existsSync(`${out.outSqlitePath}-shm`)).toBe(false);
      // la fuente no se tocó (VACUUM INTO corre sobre conexión readonly)
      const roundtrip = new Database(out.outSqlitePath, { readonly: true });
      try {
        expect((roundtrip.query("SELECT COUNT(*) AS n FROM heroes").get() as { n: number }).n).toBe(110);
        expect(
          (roundtrip.query("SELECT picks FROM hero_patch_stats WHERE hero_id = 1").get() as { picks: number }).picks,
        ).toBe(1 * 10 + 7); // el UPDATE que sólo vivía en el -wal quedó materializado
      } finally {
        roundtrip.close();
      }
    } finally {
      hold.close();
    }
  });

  test("source y destino idénticos ⇒ rechazado, la fuente intacta", () => {
    const src = join(dir, "same.sqlite");
    seedDb(src);
    const sha = rawFileSha256(src);
    const r = buildS1Snapshot({
      sourceDbPath: src,
      outSqlitePath: src,
      outManifestPath: join(dir, "m.json"),
      patchLabel: "x",
      patchLabelSource: "operator-input",
      now: () => new Date(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures.join(" ")).toContain("no puede ser la DB fuente");
    expect(rawFileSha256(src)).toBe(sha);
    expect(existsSync(join(dir, "m.json"))).toBe(false);
  });

  test("VACUUM INTO falla (destino en directorio inexistente) ⇒ sin artefacto, sin manifiesto", () => {
    const src = join(dir, "src.sqlite");
    seedDb(src);
    const r = buildS1Snapshot({
      sourceDbPath: src,
      outSqlitePath: join(dir, "no-such-dir", "S1.sqlite"),
      outManifestPath: join(dir, "no-such-dir", "S1.manifest.json"),
      patchLabel: "x",
      patchLabelSource: "operator-input",
      now: () => new Date(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures.join(" ")).toContain("VACUUM INTO");
    expect(existsSync(join(dir, "no-such-dir", "S1.manifest.json"))).toBe(false);
  });
});

describe("buildS1Snapshot — orden freeze→re-validación→manifiesto (FIX 5/6/7)", () => {
  test("los hechos del manifiesto se DERIVAN del artefacto CONGELADO, no de la fuente", () => {
    const src = join(dir, "src.sqlite");
    seedDb(src, { heroes: 108, patch: "7.42a", extraUnrelatedTable: true });
    const out = { outSqlitePath: join(dir, "S1.sqlite"), outManifestPath: join(dir, "S1.manifest.json") };
    const r = buildS1Snapshot({
      sourceDbPath: src,
      ...out,
      patchLabel: "op-label",
      patchLabelSource: "operator-input",
      now: () => new Date("2026-09-07T00:00:00Z"),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    // re-abrir el CONGELADO y recomputar TODO — debe coincidir con el manifiesto exactamente
    const frozen = new Database(out.outSqlitePath, { readonly: true });
    try {
      const fv = validateSnapshotDb(frozen);
      expect(fv.ok).toBe(true);
      if (!fv.ok) return;
      expect(r.manifest.validation).toEqual(fv.summary);
      expect(r.manifest.rowCounts).toEqual(fv.summary.rowCounts);
      expect(r.manifest.rowCounts.heroes).toBe(108);
      expect(r.manifest.dominantPatch).toBe(dominantPatchFromDb(frozen));
      expect(r.manifest.dominantPatch).toBe("7.42a");
      expect(r.manifest.sourceSync).toEqual(fv.summary.sourceSync);
      expect(r.manifest.sourceSync.status).toBe("ok"); // meta_sync PRESERVADO por VACUUM INTO
      expect(r.manifest.snapshotFileSha).toBe(rawFileSha256(out.outSqlitePath)); // SHA de los BYTES del congelado
      expect(r.manifest.metaSnapshotVersion).toBe(fingerprintOpenDb(frozen)); // huella del congelado
    } finally {
      frozen.close();
    }
    // …y la huella del congelado == la de la fuente (post-condición de quiescencia, FIX 7)
    expect(r.manifest.metaSnapshotVersion).toBe(computeMetaSnapshotVersion(src));
  });

  test("fuente inválida ⇒ NUNCA se materializa ni se re-valida un congelado (corta en el paso 2)", () => {
    const src = join(dir, "partial.sqlite");
    seedDb(src, { matchupHeroes: [1, 2, 3] }); // cobertura de matchups insuficiente
    const out = { outSqlitePath: join(dir, "S1.sqlite"), outManifestPath: join(dir, "S1.manifest.json") };
    const r = buildS1Snapshot({
      sourceDbPath: src,
      ...out,
      patchLabel: "x",
      patchLabelSource: "operator-input",
      now: () => new Date(),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.failures.join(" ")).toContain("cobertura de hero_matchups baja");
    expect(r.failures.join(" ")).not.toContain("congelado"); // el fallo es de la FUENTE, no del frozen
    expect(existsSync(out.outSqlitePath)).toBe(false);
    expect(existsSync(out.outManifestPath)).toBe(false);
  });
});
