#!/usr/bin/env bun
// Fase 9.0 — orquestador `bun run eval`. Corre los dos benchmarks y emite:
//   - eval/baselines/v6-measured.json  (el número CONGELADO — se versiona)
//   - eval/reports/<timestamp>.md      (legible — NO se versiona)
//
// Determinismo: mismo commit + mismo split + mismo snapshot ⇒ v6-measured.json byte-idéntico.
// Si cualquiera de los dos benchmarks dispara ConstraintViolationRate > 0 → exit 1, NO se
// escribe el baseline.
//
// Offline: abre pro-drafts.sqlite y dota2coach.sqlite en readonly. Cero red. No toca apps/.

import { Database } from "bun:sqlite";
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve as resolvePath } from "node:path";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import type { DraftState } from "../../apps/engine/src/draft/reducer";
import { buildSuggestions } from "../../apps/engine/src/signals/mix";
import { OMITTED_BASELINES, type BaselineId } from "./baselines";
import { hydrateState, runEngineQuality, type EngineQualityResult } from "./benchmark-engine-quality";
import { loadReplayCasesFromDb, runProAgreement, type ProAgreementResult, type Segment } from "./benchmark-pro-agreement";
import type { BuildReplayResult, ReplayCase } from "./types";
import { loadGoldenDataset, type GoldenCase } from "./golden";
import { dominantPatch } from "./replay";
import { renderReport, type EvidenceProfile, type ReportMeta } from "./report";
import { loadOrCreateSplit, type FrozenSplit } from "./split";
import { ACTIVE_SCORING_MODEL_FAMILY, LEGACY_PROTOCOL_PATCH_RULE } from "./evaluation-identity";
import { fingerprintOpenDb, metaInputSelect, rawFileSha256 } from "./snapshot";

// R0.2B — Task 34: `run.ts` no re-apunta el baseline aceptado por defecto. `HISTORICAL_REFERENCE_S0`
// (`eval/baselines/v6-measured.json`) es INMUTABLE (Req 2A.2 c8) — `run.ts` se niega a escribir ahí,
// y exige una ruta de salida EXPLÍCITA (design §4.2: "require explicit candidate output").
const HISTORICAL_REFERENCE_S0_PATH = "eval/baselines/v6-measured.json";
const SCHEMA_VERSION = 1;

// Se leen dentro de main() (no a nivel de módulo) para que los tests puedan sobrescribir
// process.env antes de cada corrida.
function paths() {
  return {
    PRO_DB: process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite",
    ENGINE_DB: process.env.ENGINE_DB_PATH ?? "apps/engine/data/dota2coach.sqlite",
    GOLDEN_PATH: process.env.D2K_GOLDEN ?? "eval/golden/dataset.json",
    // R0.2B — Task 34: SIN default. `run.ts` exige una ruta de salida explícita y NUNCA escribe
    // el `HISTORICAL_REFERENCE_S0` (`v6-measured.json`).
    BASELINE_PATH: process.env.D2K_BASELINE_OUT ?? null,
    REPORTS_DIR: process.env.D2K_REPORTS_DIR ?? "eval/reports",
    SPLIT_OUT: process.env.D2K_SPLIT_OUT ?? "eval/baselines/split.json",
    // R0.2B — Task 34: si está, `run.ts` mide sobre el snapshot de meta CONGELADO designado
    // (p.ej. `eval/snapshots/S1.sqlite`) y emite su `metaSnapshotVersion` concreto. Si NO está,
    // se mide sobre la DB de trabajo (mutable, NO reproducible ⇒ `metaSnapshotVersion: null`).
    META_SNAPSHOT: process.env.D2K_META_SNAPSHOT ?? null,
  };
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
}

/**
 * Procedencia del motor medido — Task 34 / Req 2A.2 c7: NO se infiere ciegamente de
 * `git rev-parse HEAD`. Para el candidate CURRENT normal, `measuredEngineCommit == HEAD`; para el
 * overlay de la Task 35, el llamador pasa `D2K_MEASURED_ENGINE_COMMIT=df354b9…`. El
 * `evaluationHarnessCommit` es siempre el HEAD que corre este harness.
 */
function measuredEngineCommit(): string {
  return process.env.D2K_MEASURED_ENGINE_COMMIT?.trim() || gitCommit();
}

function splitHash(split: FrozenSplit): string {
  const s = JSON.stringify(split.assignment);
  let h = 0;
  for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

// Réplica del mapeo de buildSharedMetaSnapshot (apps/engine/src/meta/provider.ts): es una copia
// directa tabla→struct, sin lógica, así que no hay riesgo de drift. Con accountId:null el overlay
// de cuenta es {heroPool:[], personalBaselineWinrate:null}. Se lee READONLY para no mutar el dato.
//
// FIX 8 (Task 34 / Req 2B.3 c4): las proyecciones SELECT de las tres tablas de meta salen de
// `metaInputSelect(...)` — el MISMO contrato (`META_INPUT_CONTRACT` en `snapshot.ts`) que usa el
// lector del fingerprint `readLogicalMetaInputs()`. Lo que el harness MIDE y lo que
// `metaSnapshotVersion` REPRESENTA no pueden divergir sin tocar ese contrato (y su prueba).
export function loadMeta(engineDbPath: string): {
  meta: MetaSnapshot;
  syncedAt: string | null;
  /** Huella de contenido lógico de ESTA DB (`meta1:<sha256>`; ver `snapshot.ts`). Siempre se calcula. */
  metaFingerprint: string;
} {
  const db = new Database(engineDbPath, { readonly: true });
  try {
    const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
    for (const r of db.query(metaInputSelect("heroes")).all() as { id: number; localized_name: string; roles: string }[]) {
      let roles: string[] = [];
      try {
        const parsed = JSON.parse(r.roles);
        if (Array.isArray(parsed)) roles = parsed.map(String);
      } catch {
        roles = [];
      }
      heroes[r.id] = { id: r.id, localizedName: r.localized_name, roles };
    }

    const matchups: Record<number, { vsHero: number; games: number; wins: number }[]> = {};
    for (const r of db.query(metaInputSelect("hero_matchups")).all() as {
      hero_id: number;
      vs_hero_id: number;
      games: number;
      wins: number;
    }[]) {
      (matchups[r.hero_id] ??= []).push({ vsHero: r.vs_hero_id, games: r.games, wins: r.wins });
    }

    const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
    for (const r of db.query(metaInputSelect("hero_patch_stats")).all() as {
      hero_id: number;
      patch: string;
      bracket: string;
      picks: number;
      wins: number;
    }[]) {
      (patchStats[r.hero_id] ??= []).push({ patch: r.patch, bracket: r.bracket, picks: r.picks, wins: r.wins });
    }

    let syncedAt: string | null = null;
    try {
      const row = db
        .query("SELECT finished_at FROM meta_sync WHERE status = 'ok' ORDER BY id DESC LIMIT 1")
        .get() as { finished_at: string | null } | null;
      syncedAt = row?.finished_at ?? null;
    } catch {
      syncedAt = null;
    }

    return {
      meta: { heroes, matchups, patchStats, heroPool: [], personalBaselineWinrate: null } as unknown as MetaSnapshot,
      syncedAt,
      metaFingerprint: fingerprintOpenDb(db),
    };
  } finally {
    db.close();
  }
}

function loadGolden(goldenPath: string, knownHeroIds: Set<number>): { cases: GoldenCase[]; note: string } {
  if (!existsSync(goldenPath)) {
    return { cases: [], note: "eval/golden/dataset.json no existe todavía — Benchmark A vacío hasta TSK-206" };
  }
  const { cases, rejected } = loadGoldenDataset(readFileSync(goldenPath, "utf-8"), { knownHeroIds });
  return {
    cases,
    note: rejected.length > 0 ? `${rejected.length} caso(s) del Golden rechazados por el loader` : `${cases.length} casos Golden`,
  };
}

// TSK-212 (Fase 9.1, §16.8): EvidenceCoverage / GuessingIndex medios del Top-6, para los rankers
// que pasan por `buildSuggestions`. Descriptivo (no entra al veredicto del gate) -- se agrega al
// reporte y al `v6-measured.json` congelado. Muestra determinista para el corpus pro (stride fijo).
const EVIDENCE_RANKERS: Record<string, { heroCounters?: Map<number, never> }> = {
  v6Full: {},
  v6NoCuratedCounters: { heroCounters: new Map() },
};
const PRO_EVIDENCE_SAMPLE = 300;

function meanEvidence(
  states: DraftState[],
  meta: MetaSnapshot,
  opts: { heroCounters?: Map<number, never> },
): { evidenceCoverage: number; guessingIndex: number; n: number } {
  let cov = 0;
  let guess = 0;
  let n = 0;
  for (const state of states) {
    for (const s of buildSuggestions(state, meta, opts).suggestions.slice(0, 6)) {
      cov += s.evidenceCoverage;
      guess += s.guessingIndex;
      n += 1;
    }
  }
  return n > 0 ? { evidenceCoverage: cov / n, guessingIndex: guess / n, n } : { evidenceCoverage: 0, guessingIndex: 0, n: 0 };
}

function computeEvidenceProfile(
  goldenCases: GoldenCase[],
  replayCases: ReplayCase[],
  meta: MetaSnapshot,
  patchOverride: string | undefined,
): EvidenceProfile {
  const goldenStates = goldenCases.map((c) => hydrateState(c, patchOverride));
  const stride = Math.max(1, Math.floor(replayCases.length / PRO_EVIDENCE_SAMPLE));
  const proStates = replayCases.filter((_, i) => i % stride === 0).map((c) => c.state);
  const engineQuality: EvidenceProfile["engineQuality"] = {};
  const proAgreement: EvidenceProfile["proAgreement"] = {};
  for (const [id, opts] of Object.entries(EVIDENCE_RANKERS)) {
    engineQuality[id] = meanEvidence(goldenStates, meta, opts);
    proAgreement[id] = meanEvidence(proStates, meta, opts);
  }
  return { engineQuality, proAgreement };
}

// Task 33 (R0.2B) — shape de "Benchmark B NO MEDIDO", cuando `pro-drafts.sqlite` está ausente
// (gitignored, ausente en cualquier checkout limpio / CI — design §9.3). UN SOLO formato de
// candidate (design §4.2): el mismo tipo `ProAgreementResult`, sin ninguna métrica pro sintetizada.
// La fuente de verdad de "no disponible" es `corpus == 0` + `perBaseline` vacío + el gate marcando
// el sub-check como SKIPPED informational (ADR-002: el pick pro no es ground truth).
// `valid: true` y `constraintViolationRate: 0` son SENTINELS de shape técnico (el tipo exige un
// boolean y un number) — NO una observación de "0 violaciones" ni de "Benchmark B pasó". `gate.ts`
// no lee `valid`; sólo exige que `constraintViolationRate` no sea > 0 para no invalidar la corrida.
function notMeasuredProAgreement(): ProAgreementResult {
  return {
    valid: true,
    constraintViolationRate: 0,
    violations: [],
    omittedBaselines: OMITTED_BASELINES,
    recallCeilingK: 6,
    perBaseline: {} as Record<BaselineId, Segment>,
    bootstrap: [],
    corpus: { cases: 0, drafts: 0, tournaments: 0 },
  };
}

// serialización estable: claves ordenadas, para que dos corridas den el mismo byte-string.
function stableStringify(value: unknown): string {
  return JSON.stringify(value, (_k, v) => {
    if (v && typeof v === "object" && !Array.isArray(v)) {
      return Object.fromEntries(Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)));
    }
    return v;
  });
}

async function main(): Promise<number> {
  const P = paths();

  // R0.2B — Task 34 / Part 10: `run.ts` NUNCA sobrescribe el `HISTORICAL_REFERENCE_S0` y exige
  // una ruta de salida explícita. Sin ella (o apuntando al baseline histórico) ⇒ error, sin escribir.
  if (P.BASELINE_PATH === null) {
    process.stderr.write(
      "\nERROR: falta la ruta de salida del candidate. Definí D2K_BASELINE_OUT con una ruta " +
        "EXPLÍCITA (nunca eval/baselines/v6-measured.json). `run.ts` no escribe un baseline por defecto.\n",
    );
    return 2;
  }
  // FIX 9 (Task 34) — en Windows el filesystem es case-insensitive: `eval/baselines/V6-MEASURED.JSON`
  // apunta al MISMO archivo histórico que `v6-measured.json`. Se compara en minúsculas SÓLO en win32
  // (POSIX es case-sensitive y no debe relajarse). No es un rediseño de symlinks/junctions — sólo
  // el mismo path con otra caja.
  const casefold = (p: string): string => {
    const s = p.replace(/\\/g, "/");
    return process.platform === "win32" ? s.toLowerCase() : s;
  };
  const resolvedOut = casefold(resolvePath(P.BASELINE_PATH));
  if (
    resolvedOut === casefold(resolvePath(HISTORICAL_REFERENCE_S0_PATH)) ||
    resolvedOut.endsWith(`/${casefold(HISTORICAL_REFERENCE_S0_PATH)}`)
  ) {
    process.stderr.write(
      `\nERROR: ${HISTORICAL_REFERENCE_S0_PATH} es HISTORICAL_REFERENCE_S0 (inmutable, Req 2A.2 c8). ` +
        "`run.ts` nunca lo sobrescribe. Elegí otra ruta de salida.\n",
    );
    return 2;
  }

  // Fuente de meta: el snapshot CONGELADO designado (D2K_META_SNAPSHOT), o la DB de trabajo.
  const metaDbPath = P.META_SNAPSHOT ?? P.ENGINE_DB;
  if (P.META_SNAPSHOT !== null && !existsSync(P.META_SNAPSHOT)) {
    process.stderr.write(`\nERROR: D2K_META_SNAPSHOT apunta a un archivo inexistente: ${P.META_SNAPSHOT}\n`);
    return 2;
  }
  const { meta, syncedAt, metaFingerprint } = loadMeta(metaDbPath);
  const knownHeroIds = new Set(Object.keys(meta.heroes).map(Number));

  // SPEC §16.4 — fuerza el patch semántico del meta sobre el `state` del replay, para que
  // `patch_meta` pueda votar (el corpus tiene `patch = "60"` que nunca matchea `patchStats`).
  const patchOverride = dominantPatch(
    (meta as unknown as { patchStats?: Record<number, { patch: string }[]> }).patchStats ?? {},
  );
  // Task 33 (R0.2B) — el corpus profesional es OPCIONAL. Antes, `run.ts` abría `pro-drafts.sqlite`
  // incondicionalmente y `bun run eval` crasheaba con `SQLITE_CANTOPEN` sin escribir candidate
  // cuando el archivo faltaba. Ahora, la ausencia se detecta con `existsSync` ANTES de abrir la DB:
  // Benchmark A / Engine Quality (`required`) se mide igual; Benchmark B / Professional Pick
  // Agreement (`informational` por ADR-002) queda NO MEDIDO. Con el archivo presente, el
  // comportamiento previo (`loadReplayCasesFromDb` + `runProAgreement`) no cambia una línea.
  const proCorpusPresent = existsSync(P.PRO_DB);
  const replay: BuildReplayResult = proCorpusPresent
    ? loadReplayCasesFromDb(P.PRO_DB, patchOverride)
    : { cases: [], skipped: [] };
  const { cases: replayCases, skipped } = replay;
  const leagueIds = [...new Set(replayCases.map((c) => c.leagueId))];
  const split = loadOrCreateSplit(leagueIds, { path: P.SPLIT_OUT });

  const golden = loadGolden(P.GOLDEN_PATH, knownHeroIds);

  const agreement: ProAgreementResult = proCorpusPresent
    ? runProAgreement(replayCases, meta, split, {})
    : notMeasuredProAgreement();
  const quality: EngineQualityResult = runEngineQuality(golden.cases, meta, { patchOverride });

  const meta_: ReportMeta = {
    generatedAt: new Date().toISOString(),
    commit: gitCommit(),
    splitHash: splitHash(split),
    snapshotSyncedAt: syncedAt,
    patchOverride: patchOverride ?? null,
    corpusSize: {
      drafts: agreement.corpus.drafts,
      tournaments: agreement.corpus.tournaments,
      goldenCases: golden.cases.length,
    },
  };

  const gateFailed = !agreement.valid || !quality.valid;

  const evidence: EvidenceProfile = computeEvidenceProfile(golden.cases, replayCases, meta, patchOverride);

  // reporte legible SIEMPRE (aunque el gate falle) — va a eval/reports/, no se versiona
  mkdirSync(P.REPORTS_DIR, { recursive: true });
  const stamp = meta_.generatedAt.replace(/[:.]/g, "-");
  writeFileSync(`${P.REPORTS_DIR}/${stamp}.md`, renderReport(meta_, quality, agreement, evidence));

  if (gateFailed) {
    process.stderr.write(
      `\nGATE FALLÓ — ConstraintViolationRate > 0 (A: ${quality.constraintViolationRate}, ` +
        `B: ${agreement.constraintViolationRate}). NO se escribe v6-measured.json.\n`,
    );
    return 1;
  }

  // R0.2B — Task 34: bloque `identity` EXPLÍCITO (Req 2A.2 c1/c5/c9) — ya no se depende sólo de
  // la derivación legacy. `metaSnapshotVersion` es concreto SÓLO si se midió sobre un snapshot
  // congelado designado (D2K_META_SNAPSHOT); sobre la DB de trabajo (mutable, no reproducible,
  // Req 2B.3 c4) es `null` — no se fabrica una identidad de meta.
  const usedFrozenSnapshot = P.META_SNAPSHOT !== null;
  const identity = {
    datasetVersion: `split:${meta_.splitHash};golden:${golden.cases.length}`,
    evaluationProtocolVersion: `schema:${SCHEMA_VERSION};${LEGACY_PROTOCOL_PATCH_RULE}`,
    scoringModelFamily: ACTIVE_SCORING_MODEL_FAMILY,
    metaSnapshotVersion: usedFrozenSnapshot ? metaFingerprint : null,
  };
  // R0.2B — Task 34: PROCEDENCIA (Req 2A.2 c6/c7) — NO decide `isComparable()`. `measuredEngineCommit`
  // no se infiere ciegamente de HEAD; para la Task 35 el llamador pasa `D2K_MEASURED_ENGINE_COMMIT`.
  const provenance = {
    measuredEngineCommit: measuredEngineCommit(),
    evaluationHarnessCommit: gitCommit(),
    snapshotFileSha: usedFrozenSnapshot ? rawFileSha256(P.META_SNAPSHOT as string) : null,
  };

  // baseline congelado — sin generatedAt para que sea reproducible byte a byte
  const frozen = {
    schemaVersion: SCHEMA_VERSION,
    commit: meta_.commit,
    identity,
    provenance,
    splitHash: meta_.splitHash,
    snapshotSyncedAt: meta_.snapshotSyncedAt,
    patchOverride: meta_.patchOverride,
    corpusSize: meta_.corpusSize,
    skippedDrafts: skipped.length,
    goldenNote: golden.note,
    engineQuality: quality,
    professionalPickAgreement: agreement,
    evidenceProfile: evidence,
  };
  writeFileSync(P.BASELINE_PATH, `${stableStringify(frozen)}\n`);

  process.stdout.write(
    `\nOK — v6-measured.json escrito.\n` +
      (proCorpusPresent
        ? ""
        : `  pro-drafts.sqlite ausente — Benchmark B (Professional Pick Agreement) NO MEDIDO (ADR-002, sub-check informational)\n`) +
      `  drafts: ${meta_.corpusSize.drafts} / torneos: ${meta_.corpusSize.tournaments} / golden: ${golden.cases.length}\n` +
      `  ${golden.note}\n` +
      `  reporte: ${P.REPORTS_DIR}/${stamp}.md\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

export { main };
