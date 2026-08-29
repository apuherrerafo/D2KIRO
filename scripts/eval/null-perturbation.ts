#!/usr/bin/env bun
// Fase 9.0 — baseline de null-perturbation (SPEC.md §15.4.6, R1-11).
//
// La tolerancia del gate NO se inventa: sale de medir cuánto se mueve una métrica "sin motivo"
// al perturbar las entradas dentro de lo que no debería cambiar una recomendación. Ese movimiento
// es el PISO de tolerancia — una tolerancia por debajo produciría FAIL falsos.
//
// Perturbación aplicada: intercambiar posiciones ADYACENTES del ranking de v6Full con probabilidad
// `p` (simula "el motor podría haber ordenado estos dos en cualquier orden"). Determinista por
// semilla. Mide el rango de NDCG@5 / Recall@3 / BadPickRate@5 sobre N perturbaciones.

import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import type { HeroId } from "../../apps/engine/src/draft/reducer";
import { RANKERS } from "./baselines";
import { badPickRateAt5, ndcg5, recallAtK } from "./metrics";
import { toGradedMap, toMetricLabels, type GoldenCase } from "./golden";
import { hydrateState } from "./benchmark-engine-quality";
import type { ReplayCase } from "./types";

export interface Tolerance {
  schemaVersion: 1;
  perturbations: number;
  swapProbability: number;
  ndcg5: number;
  recallAt3: number;
  badPickRate5: number;
  byContextRecallAt3: number;
  note: string;
}

function mulberry(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function perturbRanking(ranking: HeroId[], rand: () => number, p: number): HeroId[] {
  const out = [...ranking];
  for (let i = 0; i < out.length - 1; i++) {
    if (rand() < p) [out[i], out[i + 1]] = [out[i + 1]!, out[i]!];
  }
  return out;
}

function rangeOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const sorted = [...xs].sort((a, b) => a - b);
  const lo = sorted[Math.floor(sorted.length * 0.025)] ?? sorted[0]!;
  const hi = sorted[Math.floor(sorted.length * 0.975)] ?? sorted[sorted.length - 1]!;
  return hi - lo;
}

export interface NullPerturbationOptions {
  perturbations?: number;
  swapProbability?: number;
  seed?: number;
}

/** Sobre casos Golden (Benchmark A) — la fuente primaria de tolerancia para NDCG@5/BadPickRate. */
export function toleranceFromGolden(cases: GoldenCase[], meta: MetaSnapshot, opts: NullPerturbationOptions = {}): Tolerance {
  const N = opts.perturbations ?? 200;
  const p = opts.swapProbability ?? 0.15;
  const rand = mulberry(opts.seed ?? 0x9e3779b9);

  const base = cases.map((c) => ({ c, ranking: RANKERS.v6Full(hydrateState(c), meta) }));
  const ndcgs: number[] = [];
  const bprs: number[] = [];
  for (let it = 0; it < N; it++) {
    let ndcgSum = 0;
    let bprSum = 0;
    for (const { c, ranking } of base) {
      const pr = perturbRanking(ranking, rand, p);
      ndcgSum += ndcg5(pr, toGradedMap(c));
      bprSum += badPickRateAt5(pr, toMetricLabels(c));
    }
    const n = base.length || 1;
    ndcgs.push(ndcgSum / n);
    bprs.push(bprSum / n);
  }
  return {
    schemaVersion: 1,
    perturbations: N,
    swapProbability: p,
    ndcg5: rangeOf(ndcgs),
    recallAt3: 0,
    badPickRate5: rangeOf(bprs),
    byContextRecallAt3: 0,
    note: cases.length === 0 ? "Golden vacío — tolerancia NDCG@5/BadPickRate no medible hasta TSK-206" : `${cases.length} casos Golden`,
  };
}

/** Sobre replays (Benchmark B) — tolerancia para Recall@3, global y por contexto. */
export function toleranceFromReplays(cases: ReplayCase[], meta: MetaSnapshot, opts: NullPerturbationOptions = {}): Pick<Tolerance, "recallAt3" | "byContextRecallAt3"> {
  const N = opts.perturbations ?? 200;
  const p = opts.swapProbability ?? 0.15;
  const rand = mulberry(opts.seed ?? 0x51ed270b);

  const base = cases.map((c) => ({ c, ranking: RANKERS.v6Full(c.state, meta) }));
  const globalR3: number[] = [];
  const ctxRanges: number[] = [];

  const contexts = [...new Set(cases.map((c) => c.decisionContext))];
  const perCtx: Record<string, number[]> = Object.fromEntries(contexts.map((c) => [c, []]));

  for (let it = 0; it < N; it++) {
    let hits = 0;
    const ctxHits: Record<string, { h: number; n: number }> = Object.fromEntries(contexts.map((c) => [c, { h: 0, n: 0 }]));
    for (const { c, ranking } of base) {
      const pr = perturbRanking(ranking, rand, p);
      const r = recallAtK(pr, c.actualHero, 3);
      hits += r;
      ctxHits[c.decisionContext]!.h += r;
      ctxHits[c.decisionContext]!.n += 1;
    }
    globalR3.push(hits / (base.length || 1));
    for (const ctx of contexts) {
      const { h, n } = ctxHits[ctx]!;
      perCtx[ctx]!.push(n === 0 ? 0 : h / n);
    }
  }
  for (const ctx of contexts) ctxRanges.push(rangeOf(perCtx[ctx]!));
  return { recallAt3: rangeOf(globalR3), byContextRecallAt3: Math.max(0, ...ctxRanges) };
}

async function main(): Promise<number> {
  const { Database } = await import("bun:sqlite");
  const { writeFileSync, mkdirSync, existsSync, readFileSync } = await import("node:fs");
  const { loadReplayCasesFromDb } = await import("./benchmark-pro-agreement");
  const { loadGoldenDataset } = await import("./golden");

  const ENGINE_DB = process.env.ENGINE_DB_PATH ?? "apps/engine/data/dota2coach.sqlite";
  const PRO_DB = process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite";
  const GOLDEN = process.env.D2K_GOLDEN ?? "eval/golden/dataset.json";
  const OUT = process.env.D2K_TOLERANCE_OUT ?? "data/generated/tolerance.json";

  const db = new Database(ENGINE_DB, { readonly: true });
  const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
  for (const r of db.query("SELECT id, localized_name AS ln FROM heroes").all() as { id: number; ln: string }[]) heroes[r.id] = { id: r.id, localizedName: r.ln, roles: [] };
  const matchups: Record<number, { vsHero: number; games: number; wins: number }[]> = {};
  for (const r of db.query("SELECT hero_id AS h, vs_hero_id AS v, games, wins FROM hero_matchups").all() as { h: number; v: number; games: number; wins: number }[]) (matchups[r.h] ??= []).push({ vsHero: r.v, games: r.games, wins: r.wins });
  const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
  for (const r of db.query("SELECT hero_id AS h, patch, bracket, picks, wins FROM hero_patch_stats").all() as { h: number; patch: string; bracket: string; picks: number; wins: number }[]) (patchStats[r.h] ??= []).push({ patch: r.patch, bracket: r.bracket, picks: r.picks, wins: r.wins });
  db.close();
  const meta = { heroes, matchups, patchStats, heroPool: [], personalBaselineWinrate: null } as unknown as MetaSnapshot;

  const { cases: replays } = loadReplayCasesFromDb(PRO_DB);
  const replaySample = replays.filter((_, i) => i % 20 === 0);
  const golden = existsSync(GOLDEN) ? loadGoldenDataset(readFileSync(GOLDEN, "utf-8"), { knownHeroIds: new Set(Object.keys(heroes).map(Number)) }).cases : [];

  const g = toleranceFromGolden(golden, meta);
  const r = toleranceFromReplays(replaySample, meta);
  const tol: Tolerance = { ...g, ...r };

  mkdirSync("data/generated", { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(tol, null, 2)}\n`);
  process.stdout.write(
    `\ntolerancia (null-perturbation): ndcg5 ${tol.ndcg5.toFixed(4)}, recall@3 ${tol.recallAt3.toFixed(4)}, ` +
      `badPickRate ${tol.badPickRate5.toFixed(4)}, por-contexto R@3 ${tol.byContextRecallAt3.toFixed(4)}\n  → ${OUT}\n  ${tol.note}\n`,
  );
  return 0;
}

if (import.meta.main) process.exit(await main());
export { main };
