#!/usr/bin/env bun
// R0.2B — Task 34 (spec `.kiro/specs/r0-engineering-baseline-recovery/`, Req 2B.3 / 2A.2 c5-c9):
//   Builder + validador de S1 — el snapshot de meta CONGELADO y confiable para evaluación — y la
//   huella de CONTENIDO LÓGICO (`metaSnapshotVersion`) que lo identifica.
//
//   Este archivo es SÓLO el builder (código + tests). La generación real de
//   `eval/snapshots/S1.sqlite` + `eval/snapshots/S1.manifest.json` es un HUMAN OPERATIONAL
//   CHECKPOINT posterior — NO se ejecuta en esta sesión, NO se hace red aquí.
//
//   Secuencia operativa real (el operador la corre en el HUMAN CHECKPOINT, contra una DB temporal
//   DESECHABLE, nunca producción ni la DB local de trabajo):
//
//     DB temporal fresca
//       → migrar / inicializar esquema        (apps/engine/src/db/migrate.ts)
//       → correr el sync canónico de meta     (apps/engine/src/meta/sync.ts → runMetaSync)
//       → EXIGIR status=ok                     (éxito completo)
//       → buildS1Snapshot({ sourceDbPath, ... }):
//            → validar FUENTE (validateSnapshotDb)      ── falla ⇒ SIN artefacto
//            → fingerprint lógico de la FUENTE
//            → materializar S1 standalone WAL-safe (VACUUM INTO — nunca copyFileSync)
//            → RE-validar el S1 CONGELADO + fingerprint del CONGELADO
//            → exigir fingerprint(FUENTE) == fingerprint(CONGELADO)
//            → derivar hechos del manifiesto DESDE el CONGELADO + snapshotFileSha de sus bytes
//            → manifiesto AL FINAL
//       → commitear la evidencia congelada después
//
//   Si el sync lanza, hace rate-limit, termina non-ok o la validación falla ⇒ descartar la DB
//   temporal por completo; NO se produce ningún artefacto; nunca se congela una DB a medias.
//   PRECONDICIÓN de quiescencia (FIX 7): el sync canónico terminó ANTES de llamar a
//   `buildS1Snapshot`. La corrección no depende sólo de esa prosa — la post-condición
//   fingerprint(FUENTE) == fingerprint(CONGELADO) + la re-validación del congelado la fuerzan.
//
//   Offline por diseño: la FUENTE se abre siempre `readonly: true`; `VACUUM INTO` la lee sin
//   mutarla y escribe un archivo NUEVO en journal mode `delete` (sin sidecars -wal/-shm). Cero
//   red. No importa `apps/engine`. `scripts/eval/**` no se importa desde `apps/**` (regla Fase 9).

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";

import {
  isMetaSnapshotVersion,
  META_SNAPSHOT_VERSION_PREFIX,
} from "./evaluation-identity";

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 1 — huella de CONTENIDO LÓGICO
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tag de formato de la serialización canónica del fingerprint. Va DENTRO del input canónico
 * (no sólo en el manifiesto): si el formato cambia, se bumpea esto y el prefijo `meta1:` juntos,
 * de modo que una huella vieja y una nueva nunca colisionen ni se comparen por accidente.
 */
export const SNAPSHOT_SCHEMA_TAG = "meta-eval-inputs/v1";

/** Una fila lógica de `heroes` — EXACTAMENTE lo que consume `loadMeta` (`run.ts`). */
export interface HeroLogicalRow {
  id: number;
  localized_name: string | null;
  /** Array parseado del TEXT `roles` (JSON). Column ausente/NULL/no-parseable ⇒ `[]` (lo que usa el motor). */
  roles: string[];
}

/** Una fila lógica de `hero_patch_stats`. */
export interface HeroPatchStatLogicalRow {
  hero_id: number;
  patch: string | null;
  bracket: string | null;
  picks: number | null;
  wins: number | null;
}

/** Una fila lógica de `hero_matchups`. */
export interface HeroMatchupLogicalRow {
  hero_id: number;
  vs_hero_id: number;
  games: number | null;
  wins: number | null;
}

/** Los tres inputs de meta que consume `loadMeta`, en orden estable. */
export interface MetaLogicalInputs {
  schemaTag: string;
  heroes: HeroLogicalRow[];
  hero_patch_stats: HeroPatchStatLogicalRow[];
  hero_matchups: HeroMatchupLogicalRow[];
}

// ─────────────────────────────────────────────────────────────────────────────
// FIX 8 (Task 34 / Req 2B.3 c4) — CONTRATO ÚNICO de proyección de los inputs de meta.
//
// `run.ts::loadMeta()` (lo que el harness REALMENTE mide) y `readLogicalMetaInputs()` (lo que el
// fingerprint `metaSnapshotVersion` REPRESENTA) tienen que leer EXACTAMENTE las mismas columnas de
// las mismas tablas — si divergen, el `metaSnapshotVersion` afirma representar un dato que el motor
// no usó (o al revés) y el baseline queda mintiendo sobre qué se midió.
//
// Este objeto es esa única fuente de verdad. Ambos caminos construyen su `SELECT` con
// `metaInputSelect(...)` — no dos arrays iguales que alguien compara, sino la MISMA definición
// generando las dos proyecciones. Tocar el esquema de eval = tocar SÓLO acá, y ambos lo ven.
// `meta_sync` NO entra: el fingerprint es estable ante su metadata a propósito (ver más abajo).
// ─────────────────────────────────────────────────────────────────────────────

export const META_INPUT_CONTRACT = {
  heroes: { table: "heroes", columns: ["id", "localized_name", "roles"] },
  hero_patch_stats: {
    table: "hero_patch_stats",
    columns: ["hero_id", "patch", "bracket", "picks", "wins"],
  },
  hero_matchups: {
    table: "hero_matchups",
    columns: ["hero_id", "vs_hero_id", "games", "wins"],
  },
} as const;

export type MetaInputTable = keyof typeof META_INPUT_CONTRACT;

/**
 * `SELECT <cols del contrato> FROM <tabla del contrato>` — la ÚNICA forma de proyectar un input de
 * meta. Sin alias: las columnas se leen por su nombre real en ambos caminos (`loadMeta` y el
 * fingerprint), así una columna agregada/quitada del contrato rompe los dos a la vez.
 */
export function metaInputSelect(table: MetaInputTable): string {
  const spec = META_INPUT_CONTRACT[table];
  return `SELECT ${spec.columns.join(", ")} FROM ${spec.table}`;
}

function toIntOrNull(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  const n = typeof value === "bigint" ? Number(value) : Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value: unknown, field: string): number {
  const n = toIntOrNull(value);
  if (n === null) throw new Error(`snapshot: valor entero inválido en ${field}: ${String(value)}`);
  return n;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  return String(value);
}

/** Parsea el TEXT `roles` (JSON array). Cualquier problema ⇒ `[]` — idéntico a `loadMeta`. */
function parseRoles(raw: unknown): string[] {
  if (typeof raw !== "string" || raw.trim() === "") return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

/** Orden total, con `null` SIEMPRE primero (manejo explícito de null en el orden). */
function cmpNullable(a: string | number | null, b: string | number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return -1;
  if (b === null) return 1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/**
 * Lee EXACTAMENTE los inputs de `loadMeta` de una DB abierta, con orden estable determinista
 * (re-ordenado en JS, sin depender de la colación de SQLite):
 *   - heroes            → `id`
 *   - hero_patch_stats  → (`hero_id`, `patch`, `bracket`)
 *   - hero_matchups     → (`hero_id`, `vs_hero_id`)
 */
export function readLogicalMetaInputs(db: Database): MetaLogicalInputs {
  const heroes: HeroLogicalRow[] = (
    db.query(metaInputSelect("heroes")).all() as {
      id: unknown;
      localized_name: unknown;
      roles: unknown;
    }[]
  )
    .map((r) => ({
      id: toInt(r.id, "heroes.id"),
      localized_name: toStringOrNull(r.localized_name),
      roles: parseRoles(r.roles),
    }))
    .sort((a, b) => a.id - b.id);

  const hero_patch_stats: HeroPatchStatLogicalRow[] = (
    db.query(metaInputSelect("hero_patch_stats")).all() as {
      hero_id: unknown;
      patch: unknown;
      bracket: unknown;
      picks: unknown;
      wins: unknown;
    }[]
  )
    .map((r) => ({
      hero_id: toInt(r.hero_id, "hero_patch_stats.hero_id"),
      patch: toStringOrNull(r.patch),
      bracket: toStringOrNull(r.bracket),
      picks: toIntOrNull(r.picks),
      wins: toIntOrNull(r.wins),
    }))
    .sort(
      (a, b) =>
        a.hero_id - b.hero_id ||
        cmpNullable(a.patch, b.patch) ||
        cmpNullable(a.bracket, b.bracket) ||
        // el esquema real tiene PK (hero_id,patch,bracket) — estos desempates sólo importan para
        // una DB malformada, y garantizan un orden TOTAL igual (huella determinista siempre).
        cmpNullable(a.picks, b.picks) ||
        cmpNullable(a.wins, b.wins),
    );

  const hero_matchups: HeroMatchupLogicalRow[] = (
    db.query(metaInputSelect("hero_matchups")).all() as {
      hero_id: unknown;
      vs_hero_id: unknown;
      games: unknown;
      wins: unknown;
    }[]
  )
    .map((r) => ({
      hero_id: toInt(r.hero_id, "hero_matchups.hero_id"),
      vs_hero_id: toInt(r.vs_hero_id, "hero_matchups.vs_hero_id"),
      games: toIntOrNull(r.games),
      wins: toIntOrNull(r.wins),
    }))
    .sort(
      (a, b) =>
        a.hero_id - b.hero_id ||
        a.vs_hero_id - b.vs_hero_id ||
        cmpNullable(a.games, b.games) ||
        cmpNullable(a.wins, b.wins),
    );

  return { schemaTag: SNAPSHOT_SCHEMA_TAG, heroes, hero_patch_stats, hero_matchups };
}

/**
 * Serialización canónica INEQUÍVOCA de los inputs lógicos: un ÚNICO documento JSON con
 *   - identidad de tabla explícita (`tables.heroes` / `.hero_patch_stats` / `.hero_matchups`);
 *   - nombres de campo explícitos por fila (objetos, no tuplas posicionales);
 *   - orden de claves FIJO (se construye el objeto en orden y `JSON.stringify` lo preserva);
 *   - filas pre-ordenadas por su clave estable;
 *   - `null` explícito (nunca se omite una clave, nunca se coacciona a `0`/`""`);
 *   - `schemaTag` incluido.
 * NO es una concatenación por delimitador — no hay ambigüedad de separador.
 */
export function canonicalMetaSerialization(inputs: MetaLogicalInputs): string {
  return JSON.stringify({
    schemaTag: inputs.schemaTag,
    tables: {
      heroes: inputs.heroes.map((r) => ({
        id: r.id,
        localized_name: r.localized_name,
        roles: r.roles,
      })),
      hero_patch_stats: inputs.hero_patch_stats.map((r) => ({
        hero_id: r.hero_id,
        patch: r.patch,
        bracket: r.bracket,
        picks: r.picks,
        wins: r.wins,
      })),
      hero_matchups: inputs.hero_matchups.map((r) => ({
        hero_id: r.hero_id,
        vs_hero_id: r.vs_hero_id,
        games: r.games,
        wins: r.wins,
      })),
    },
  });
}

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * `metaSnapshotVersion` = `meta1:<sha256 COMPLETO>` (64 hex, NUNCA truncado, NUNCA el SHA crudo
 * del archivo SQLite) sobre la serialización canónica de los inputs de `loadMeta`. Representa
 * CONTENIDO LÓGICO: estable ante VACUUM, layout de páginas, tablas no relacionadas y metadata de
 * `meta_sync`; cambia si cualquier valor relevante para la evaluación cambia.
 */
export function fingerprintOpenDb(db: Database): string {
  return META_SNAPSHOT_VERSION_PREFIX + sha256Hex(canonicalMetaSerialization(readLogicalMetaInputs(db)));
}

/** Igual que `fingerprintOpenDb` pero abriendo `dbPath` readonly y cerrándolo. */
export function computeMetaSnapshotVersion(dbPath: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    return fingerprintOpenDb(db);
  } finally {
    db.close();
  }
}

/** SHA-256 CRUDO del archivo (`snapshotFileSha`) — PROCEDENCIA/TAMPER, NUNCA identidad. */
export function rawFileSha256(path: string): string {
  return sha256Hex(readFileSync(path));
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 4 — validar ANTES de congelar
// ─────────────────────────────────────────────────────────────────────────────

/** Umbrales de la validación acotada. Arranque; ajustables sin reabrir el Spec. */
export const SNAPSHOT_VALIDATION = {
  /** Piso de héroes: Dota 7.3x tiene ~124-126; por debajo de esto el set está incompleto. */
  MIN_HEROES: 100,
  /** Cobertura mínima de `hero_id` distintos en patch_stats / matchups vs. el total de héroes. */
  MIN_TABLE_HERO_COVERAGE: 0.8,
  /** Héroes sin NINGUNA fila de patch_stats que se toleran (un puñado sin datos es normal). */
  MAX_HEROES_WITHOUT_PATCH_STATS: 10,
} as const;

export interface SnapshotValidationSummary {
  rowCounts: { heroes: number; hero_patch_stats: number; hero_matchups: number };
  distinctHeroIds: { patchStats: number; matchups: number };
  heroesWithoutPatchStats: number;
  dominantPatch: string | null;
  /**
   * PROCEDENCIA del sync que produjo la DB. `buildS1Snapshot` publica el resumen calculado sobre
   * el ARTEFACTO CONGELADO (la materialización WAL-safe copia `meta_sync`), así que cuando aparece
   * en el manifiesto de S1 está verificado contra el contenido del artefacto, no sólo contra la
   * fuente. Describe el evento de sync de la DB de origen.
   */
  sourceSync: { status: string; finishedAt: string | null };
}

export type SnapshotValidationResult =
  | { ok: true; summary: SnapshotValidationSummary }
  | { ok: false; failures: string[] };

function count(db: Database, sql: string): number {
  const row = db.query(sql).get() as { n: number } | null;
  return toIntOrNull(row?.n) ?? 0;
}

function tableExists(db: Database, name: string): boolean {
  const row = db
    .query("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name) as { name: string } | null;
  return row !== null;
}

/** Moda de `hero_patch_stats.patch` (no vacía). Informativo — NO prueba el patch real de Dota. */
export function dominantPatchFromDb(db: Database): string | null {
  const rows = db
    .query(
      "SELECT patch AS p, COUNT(*) AS n FROM hero_patch_stats WHERE patch IS NOT NULL AND TRIM(patch) <> '' GROUP BY patch ORDER BY n DESC, patch ASC LIMIT 1",
    )
    .all() as { p: string; n: number }[];
  return rows.length > 0 ? (rows[0]!.p ?? null) : null;
}

/**
 * Validación acotada suficiente para RECHAZAR la clase conocida de escritura parcial
 * (`syncMatchups` no-transaccional deja algunos héroes con matchups y otros sin ninguno).
 * Junta TODOS los fallos (no corta en el primero). NO afirma ground truth de OpenDota —
 * detecta fallo estructural/de integridad.
 */
export function validateSnapshotDb(db: Database): SnapshotValidationResult {
  const failures: string[] = [];

  for (const t of ["heroes", "hero_patch_stats", "hero_matchups", "meta_sync"]) {
    if (!tableExists(db, t)) failures.push(`tabla ausente: ${t}`);
  }
  if (failures.length > 0) return { ok: false, failures };

  // meta_sync: la última sync relevante debe ser status=ok (éxito completo).
  const sync = db
    .query("SELECT status, finished_at AS fa FROM meta_sync ORDER BY id DESC LIMIT 1")
    .get() as { status: string | null; fa: string | null } | null;
  const sourceSync = { status: sync?.status ?? "<sin registro>", finishedAt: sync?.fa ?? null };
  if (sourceSync.status !== "ok") {
    failures.push(`meta_sync más reciente no es status=ok (es "${sourceSync.status}")`);
  }

  const heroCount = count(db, "SELECT COUNT(*) AS n FROM heroes");
  const patchStatCount = count(db, "SELECT COUNT(*) AS n FROM hero_patch_stats");
  const matchupCount = count(db, "SELECT COUNT(*) AS n FROM hero_matchups");

  if (heroCount < SNAPSHOT_VALIDATION.MIN_HEROES) {
    failures.push(`heroes insuficientes: ${heroCount} < ${SNAPSHOT_VALIDATION.MIN_HEROES}`);
  }
  if (patchStatCount === 0) failures.push("hero_patch_stats vacío");
  if (matchupCount === 0) failures.push("hero_matchups vacío");

  const distinctPatchHeroes = count(db, "SELECT COUNT(DISTINCT hero_id) AS n FROM hero_patch_stats");
  const distinctMatchupHeroes = count(db, "SELECT COUNT(DISTINCT hero_id) AS n FROM hero_matchups");
  const minCoverage = Math.floor(heroCount * SNAPSHOT_VALIDATION.MIN_TABLE_HERO_COVERAGE);
  if (heroCount > 0 && distinctPatchHeroes < minCoverage) {
    failures.push(
      `cobertura de hero_patch_stats baja: ${distinctPatchHeroes} de ${heroCount} héroes (< ${minCoverage})`,
    );
  }
  if (heroCount > 0 && distinctMatchupHeroes < minCoverage) {
    failures.push(
      `cobertura de hero_matchups baja: ${distinctMatchupHeroes} de ${heroCount} héroes (< ${minCoverage}) — posible escritura parcial`,
    );
  }

  // games >= wins, no negativos (matchups y patch_stats).
  if (count(db, "SELECT COUNT(*) AS n FROM hero_matchups WHERE wins > games") > 0) {
    failures.push("hero_matchups con wins > games");
  }
  if (count(db, "SELECT COUNT(*) AS n FROM hero_matchups WHERE games < 0 OR wins < 0") > 0) {
    failures.push("hero_matchups con games/wins negativos");
  }
  if (count(db, "SELECT COUNT(*) AS n FROM hero_patch_stats WHERE wins > picks") > 0) {
    failures.push("hero_patch_stats con wins > picks");
  }
  if (count(db, "SELECT COUNT(*) AS n FROM hero_patch_stats WHERE picks < 0 OR wins < 0") > 0) {
    failures.push("hero_patch_stats con picks/wins negativos");
  }

  // Ninguna FK huérfana: todo hero_id referenciado existe en heroes.
  if (
    count(
      db,
      "SELECT COUNT(*) AS n FROM (SELECT hero_id FROM hero_patch_stats UNION SELECT hero_id FROM hero_matchups UNION SELECT vs_hero_id FROM hero_matchups) x WHERE x.hero_id NOT IN (SELECT id FROM heroes)",
    ) > 0
  ) {
    failures.push("hero_id/vs_hero_id referenciado que no existe en heroes");
  }

  // Set de héroes obviamente a medias: demasiados héroes sin ninguna fila de patch_stats.
  const heroesWithoutPatchStats = count(
    db,
    "SELECT COUNT(*) AS n FROM heroes WHERE id NOT IN (SELECT DISTINCT hero_id FROM hero_patch_stats)",
  );
  if (heroesWithoutPatchStats > SNAPSHOT_VALIDATION.MAX_HEROES_WITHOUT_PATCH_STATS) {
    failures.push(
      `${heroesWithoutPatchStats} héroes sin ninguna fila de hero_patch_stats (> ${SNAPSHOT_VALIDATION.MAX_HEROES_WITHOUT_PATCH_STATS})`,
    );
  }

  // Se puede derivar un patch dominante.
  const dominantPatch = dominantPatchFromDb(db);
  if (dominantPatch === null) failures.push("no se puede derivar un patch dominante de hero_patch_stats");

  // Dos lecturas deterministas del input lógico congelado coinciden.
  if (canonicalMetaSerialization(readLogicalMetaInputs(db)) !== canonicalMetaSerialization(readLogicalMetaInputs(db))) {
    failures.push("dos lecturas del input lógico NO coinciden (no determinista)");
  }

  if (failures.length > 0) return { ok: false, failures };
  return {
    ok: true,
    summary: {
      rowCounts: { heroes: heroCount, hero_patch_stats: patchStatCount, hero_matchups: matchupCount },
      distinctHeroIds: { patchStats: distinctPatchHeroes, matchups: distinctMatchupHeroes },
      heroesWithoutPatchStats,
      dominantPatch,
      sourceSync,
    },
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 5 — contrato del manifiesto de S1
// ─────────────────────────────────────────────────────────────────────────────

export const S1_MANIFEST_FORMAT_VERSION = 1;

/** De dónde vino `patchLabel`. El sync RECIBE la etiqueta, no la descubre. */
export type PatchLabelSource = "operator-input" | "observed-dominant" | "sync-option" | (string & {});

export interface S1Manifest {
  /** Versión de formato del manifiesto. */
  snapshotFormatVersion: number;
  /** Tag/versión del esquema incluido en el input del fingerprint (`SNAPSHOT_SCHEMA_TAG`). */
  schemaTag: string;
  /** IDENTIDAD: huella de contenido lógico `meta1:<sha256 completo>`. */
  metaSnapshotVersion: string;
  /** PROCEDENCIA/TAMPER: SHA-256 crudo del `S1.sqlite` congelado. NO participa en `isComparable()`. */
  snapshotFileSha: string;
  /** PROCEDENCIA: la etiqueta de patch que el sync recibió como input. */
  patchLabel: string;
  /** PROCEDENCIA: de dónde vino `patchLabel`. */
  patchLabelSource: PatchLabelSource;
  /** INFORMATIVO: moda de `hero_patch_stats.patch`. NO prueba el patch real vigente de Dota. */
  dominantPatch: string | null;
  rowCounts: { heroes: number; hero_patch_stats: number; hero_matchups: number };
  /** PROCEDENCIA: estado del sync de la DB fuente. */
  sourceSync: { status: string; finishedAt: string | null };
  /** Resumen de la validación que pasó antes de congelar. */
  validation: SnapshotValidationSummary;
  /** PROCEDENCIA: commit del motor medido / harness. `null` si no se proveyó. NO deciden `isComparable()`. */
  measuredEngineCommit: string | null;
  evaluationHarnessCommit: string | null;
  /** METADATA EFÍMERA — excluida del determinismo lógico. */
  createdAt: string;
}

export interface BuildManifestInput {
  metaSnapshotVersion: string;
  snapshotFileSha: string;
  patchLabel: string;
  patchLabelSource: PatchLabelSource;
  validation: SnapshotValidationSummary;
  measuredEngineCommit?: string | null;
  evaluationHarnessCommit?: string | null;
  createdAt: string;
}

/** Construye el objeto manifiesto — función pura. `createdAt` viene del llamador (reloj inyectado). */
export function buildManifest(input: BuildManifestInput): S1Manifest {
  return {
    snapshotFormatVersion: S1_MANIFEST_FORMAT_VERSION,
    schemaTag: SNAPSHOT_SCHEMA_TAG,
    metaSnapshotVersion: input.metaSnapshotVersion,
    snapshotFileSha: input.snapshotFileSha,
    patchLabel: input.patchLabel,
    patchLabelSource: input.patchLabelSource,
    dominantPatch: input.validation.dominantPatch,
    rowCounts: input.validation.rowCounts,
    sourceSync: input.validation.sourceSync,
    validation: input.validation,
    measuredEngineCommit: input.measuredEngineCommit ?? null,
    evaluationHarnessCommit: input.evaluationHarnessCommit ?? null,
    createdAt: input.createdAt,
  };
}

/** Serializa el manifiesto de forma estable (claves ordenadas) para diffs limpios. */
export function serializeManifest(manifest: S1Manifest): string {
  const stable = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(stable);
    if (value && typeof value === "object") {
      return Object.fromEntries(
        Object.entries(value as Record<string, unknown>)
          .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
          .map(([k, v]) => [k, stable(v)]),
      );
    }
    return value;
  };
  return `${JSON.stringify(stable(manifest), null, 2)}\n`;
}

// ─────────────────────────────────────────────────────────────────────────────
// PARTE 3 — builder: validar → congelar → fingerprint → manifiesto
// ─────────────────────────────────────────────────────────────────────────────

export interface BuildS1Options {
  /**
   * DB TEMPORAL fresca ya migrada + sincronizada por el operador (status=ok). NUNCA la DB de
   * producción ni la DB local de trabajo — el builder la abre `readonly`.
   */
  sourceDbPath: string;
  /** Destino del SQLite congelado (p.ej. `eval/snapshots/S1.sqlite`). NO se escribe si la validación falla. */
  outSqlitePath: string;
  /** Destino del manifiesto (p.ej. `eval/snapshots/S1.manifest.json`). NO se escribe si la validación falla. */
  outManifestPath: string;
  /** La etiqueta de patch que el sync recibió como input (procedencia). */
  patchLabel: string;
  /** De dónde vino `patchLabel` (procedencia). */
  patchLabelSource: PatchLabelSource;
  /** Reloj inyectable — `createdAt` es metadata efímera. */
  now?: () => Date;
  /** Procedencia de motor/harness (no deciden `isComparable()`). */
  measuredEngineCommit?: string | null;
  evaluationHarnessCommit?: string | null;
}

export type BuildS1Result =
  | { ok: true; manifest: S1Manifest; sqlitePath: string; manifestPath: string }
  | { ok: false; failures: string[] };

function errMsg(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * FIX 4 (Task 34 / C1) — MATERIALIZA una copia STANDALONE y WAL-safe de `sourceDbPath` en `outPath`.
 *
 * `copyFileSync` del archivo principal es INSUFICIENTE: si la fuente tiene un WAL sin checkpoint
 * (el sync canónico lo deja así), la copia pierde las filas COMMITEADAS que todavía viven en el
 * `-wal`, o queda dependiendo de un `-wal`/`-shm` que no viajan con ella.
 *
 * `VACUUM INTO` lee el estado COMMITEADO COMPLETO a través del WAL (lo ve una conexión readonly
 * con el `-wal` presente) y lo escribe página por página en un archivo NUEVO en journal mode
 * `delete` — el resultado abre SIN `-wal`/`-shm`, es un SQLite válido por sí solo, y el source se
 * abre `readonly` ⇒ nunca se muta. El nombre de salida va como PARÁMETRO ligado (`?`), no
 * interpolado, así que se codifica de forma segura.
 */
function materializeStandalone(sourceDbPath: string, outPath: string): void {
  const src = new Database(sourceDbPath, { readonly: true });
  try {
    src.run("VACUUM INTO ?", [outPath]);
  } finally {
    src.close();
  }
}

/**
 * FIX 5 (Task 34) — Congela un S1 confiable a partir de una DB fuente ya sincronizada, en el orden
 * TRUSTWORTHY exacto:
 *   1. abre la FUENTE `readonly`;
 *   2. VALIDA la fuente (`validateSnapshotDb`) — falla ⇒ SIN artefacto, `{ ok:false }`;
 *   3. huella lógica de la FUENTE (`logicalBefore`);
 *   4. MATERIALIZA el S1 standalone WAL-safe (`VACUUM INTO`), sin tocar la fuente;
 *   5. abre el S1 CONGELADO `readonly`;
 *   6. RE-VALIDA (`validateSnapshotDb`) el S1 CONGELADO — falla ⇒ borra el SQLite, SIN manifiesto;
 *   7. huella lógica del S1 CONGELADO (`logicalAfter`);
 *   8. EXIGE `logicalBefore === logicalAfter` (post-condición de quiescencia — FIX 7) y que el
 *      congelado no dejó sidecars `-wal`/`-shm`; cualquier discrepancia ⇒ borra el SQLite, SIN manifiesto;
 *   9. deriva/re-verifica los hechos del manifiesto DESDE la validación del CONGELADO (rowCounts,
 *      dominantPatch, sourceSync, validation summary);
 *  10. `snapshotFileSha` = SHA-256 crudo de los BYTES del CONGELADO;
 *  11. escribe el manifiesto AL FINAL.
 *
 * Idempotencia de fallo: cualquier fallo después de materializar borra `outSqlitePath` (+ sidecars);
 * el manifiesto sólo se escribe si TODO lo anterior pasó. El manifiesto nunca afirma hechos de
 * validación de una DB distinta de la que se envía como S1.
 */
export function buildS1Snapshot(opts: BuildS1Options): BuildS1Result {
  const now = opts.now ?? (() => new Date());
  const frozenSiblings = [
    `${opts.outSqlitePath}-wal`,
    `${opts.outSqlitePath}-shm`,
    `${opts.outSqlitePath}-journal`,
  ];
  const rmFrozen = (): void => {
    for (const p of [opts.outSqlitePath, ...frozenSiblings]) if (existsSync(p)) rmSync(p, { force: true });
  };
  const rmAll = (): void => {
    rmFrozen();
    if (existsSync(opts.outManifestPath)) rmSync(opts.outManifestPath, { force: true });
  };

  if (resolvePath(opts.sourceDbPath) === resolvePath(opts.outSqlitePath)) {
    return { ok: false, failures: ["la ruta de salida del S1 no puede ser la DB fuente"] };
  }

  // 1-4. abrir FUENTE readonly, validar, fingerprint de fuente, y materializar standalone WAL-safe.
  // El resumen de validación de la FUENTE NO se guarda: los hechos que publica el manifiesto salen
  // de re-validar el CONGELADO (pasos 6-9). Acá sólo importa que la fuente pase y su huella lógica.
  let logicalBefore: string;
  try {
    const src = new Database(opts.sourceDbPath, { readonly: true });
    try {
      const v = validateSnapshotDb(src);
      if (!v.ok) return { ok: false, failures: v.failures };
      logicalBefore = fingerprintOpenDb(src);
    } finally {
      src.close();
    }
    // `VACUUM INTO` exige que el destino no exista todavía
    rmFrozen();
    materializeStandalone(opts.sourceDbPath, opts.outSqlitePath);
  } catch (error) {
    rmFrozen();
    return { ok: false, failures: [`fallo al materializar S1 (VACUUM INTO): ${errMsg(error)}`] };
  }

  // 5-11. abrir el S1 CONGELADO readonly, RE-VALIDAR, fingerprint, candados, manifiesto
  try {
    let frozenSummary: SnapshotValidationSummary;
    let logicalAfter: string;
    const frozen = new Database(opts.outSqlitePath, { readonly: true });
    try {
      const fv = validateSnapshotDb(frozen);
      if (!fv.ok) {
        rmAll();
        return { ok: false, failures: fv.failures.map((f) => `S1 congelado inválido: ${f}`) };
      }
      frozenSummary = fv.summary;
      logicalAfter = fingerprintOpenDb(frozen);
    } finally {
      frozen.close();
    }

    // 8. candados de integridad del freeze
    if (existsSync(`${opts.outSqlitePath}-wal`) || existsSync(`${opts.outSqlitePath}-shm`)) {
      rmAll();
      return { ok: false, failures: ["el S1 congelado dejó sidecars -wal/-shm — no es standalone"] };
    }
    if (logicalAfter !== logicalBefore) {
      rmAll();
      return {
        ok: false,
        failures: [`la huella lógica cambió al congelar (fuente ${logicalBefore}, congelado ${logicalAfter})`],
      };
    }
    if (!isMetaSnapshotVersion(logicalAfter)) {
      rmAll();
      return { ok: false, failures: [`huella lógica del S1 congelado mal formada: ${logicalAfter}`] };
    }

    // 9-11. hechos del manifiesto DERIVADOS DEL ARTEFACTO CONGELADO; SHA crudo de sus bytes; manifiesto al final
    const snapshotFileSha = rawFileSha256(opts.outSqlitePath);
    const manifest = buildManifest({
      metaSnapshotVersion: logicalAfter,
      snapshotFileSha,
      patchLabel: opts.patchLabel,
      patchLabelSource: opts.patchLabelSource,
      validation: frozenSummary,
      measuredEngineCommit: opts.measuredEngineCommit ?? null,
      evaluationHarnessCommit: opts.evaluationHarnessCommit ?? null,
      createdAt: now().toISOString(),
    });
    writeFileSync(opts.outManifestPath, serializeManifest(manifest));

    return { ok: true, manifest, sqlitePath: opts.outSqlitePath, manifestPath: opts.outManifestPath };
  } catch (error) {
    rmAll();
    return { ok: false, failures: [`fallo al validar/manifestar el S1 congelado: ${errMsg(error)}`] };
  }
}
