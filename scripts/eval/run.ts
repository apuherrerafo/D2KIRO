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
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import type { DraftState } from "../../apps/engine/src/draft/reducer";
import { buildSuggestions } from "../../apps/engine/src/signals/mix";
import { hydrateState, runEngineQuality, type EngineQualityResult } from "./benchmark-engine-quality";
import { loadReplayCasesFromDb, runProAgreement, type ProAgreementResult } from "./benchmark-pro-agreement";
import type { ReplayCase } from "./types";
import { loadGoldenDataset, type GoldenCase } from "./golden";
import { dominantPatch } from "./replay";
import { renderReport, type EvidenceProfile, type ReportMeta } from "./report";
import { loadOrCreateSplit, type FrozenSplit } from "./split";

// Se leen dentro de main() (no a nivel de módulo) para que los tests puedan sobrescribir
// process.env antes de cada corrida.
function paths() {
  return {
    PRO_DB: process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite",
    ENGINE_DB: process.env.ENGINE_DB_PATH ?? "apps/engine/data/dota2coach.sqlite",
    GOLDEN_PATH: process.env.D2K_GOLDEN ?? "eval/golden/dataset.json",
    BASELINE_PATH: process.env.D2K_BASELINE_OUT ?? "eval/baselines/v6-measured.json",
    REPORTS_DIR: process.env.D2K_REPORTS_DIR ?? "eval/reports",
    SPLIT_OUT: process.env.D2K_SPLIT_OUT ?? "eval/baselines/split.json",
  };
}

function gitCommit(): string {
  try {
    return execSync("git rev-parse HEAD", { encoding: "utf-8" }).trim();
  } catch {
    return "unknown";
  }
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
function loadMeta(engineDbPath: string): { meta: MetaSnapshot; syncedAt: string | null } {
  const db = new Database(engineDbPath, { readonly: true });
  try {
    const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
    for (const r of db.query("SELECT id, localized_name AS ln, roles FROM heroes").all() as { id: number; ln: string; roles: string }[]) {
      let roles: string[] = [];
      try {
        const parsed = JSON.parse(r.roles);
        if (Array.isArray(parsed)) roles = parsed.map(String);
      } catch {
        roles = [];
      }
      heroes[r.id] = { id: r.id, localizedName: r.ln, roles };
    }

    const matchups: Record<number, { vsHero: number; games: number; wins: number }[]> = {};
    for (const r of db.query("SELECT hero_id AS h, vs_hero_id AS v, games, wins FROM hero_matchups").all() as {
      h: number;
      v: number;
      games: number;
      wins: number;
    }[]) {
      (matchups[r.h] ??= []).push({ vsHero: r.v, games: r.games, wins: r.wins });
    }

    const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
    for (const r of db.query("SELECT hero_id AS h, patch, bracket, picks, wins FROM hero_patch_stats").all() as {
      h: number;
      patch: string;
      bracket: string;
      picks: number;
      wins: number;
    }[]) {
      (patchStats[r.h] ??= []).push({ patch: r.patch, bracket: r.bracket, picks: r.picks, wins: r.wins });
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
  const { meta, syncedAt } = loadMeta(P.ENGINE_DB);
  const knownHeroIds = new Set(Object.keys(meta.heroes).map(Number));

  // SPEC §16.4 — fuerza el patch semántico del meta sobre el `state` del replay, para que
  // `patch_meta` pueda votar (el corpus tiene `patch = "60"` que nunca matchea `patchStats`).
  const patchOverride = dominantPatch(
    (meta as unknown as { patchStats?: Record<number, { patch: string }[]> }).patchStats ?? {},
  );
  const { cases: replayCases, skipped } = loadReplayCasesFromDb(P.PRO_DB, patchOverride);
  const leagueIds = [...new Set(replayCases.map((c) => c.leagueId))];
  const split = loadOrCreateSplit(leagueIds, { path: P.SPLIT_OUT });

  const golden = loadGolden(P.GOLDEN_PATH, knownHeroIds);

  const agreement: ProAgreementResult = runProAgreement(replayCases, meta, split, {});
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

  // baseline congelado — sin generatedAt para que sea reproducible byte a byte
  const frozen = {
    schemaVersion: 1,
    commit: meta_.commit,
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
