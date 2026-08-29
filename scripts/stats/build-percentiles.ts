#!/usr/bin/env bun
// Fase 9.1 — genera los percentiles empíricos que reemplazan la normalización lineal de
// RAW_RANGE (SPEC.md §16.5, ADR-004). Se calculan SÓLO sobre los folds de train del split.json
// de 9.0 (nunca el held-out) y sobre el perfil YA arreglado por TSK-207 (patch_meta votando).
//
// Offline: consume los building blocks YA exportados del motor. No modifica apps/engine/src/**.
// SQLite readonly, cero red. Salida congelada + versionada, determinista.

import { Database } from "bun:sqlite";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createArchetypeFitScorer } from "../../apps/engine/src/signals/archetype-fit";
import { createCounterScorer } from "../../apps/engine/src/signals/counter";
import { heroPoolFitScorer } from "../../apps/engine/src/signals/hero-pool-fit";
import { loadHeroCounters } from "../../apps/engine/src/signals/hero-counters";
import { loadHeroPositions } from "../../apps/engine/src/signals/hero-positions";
import { patchMetaScorer } from "../../apps/engine/src/signals/patch-meta";
import { createPositionFitScorer } from "../../apps/engine/src/signals/position-fit";
import { createTeamSynergyScorer } from "../../apps/engine/src/signals/team-synergy";
import type { MetaSnapshot, SignalId, SignalScorer } from "../../apps/engine/src/signals/types";
import { loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import { buildReplayCases, dominantPatch } from "../eval/replay";
import type { ProDraftTurn } from "../eval/types";

const SIGNALS: SignalId[] = ["position_fit", "counter", "patch_meta", "team_synergy", "hero_pool_fit", "archetype_fit"];
// Señales que NO se calibran (applicable:false estructural en el backtest — sin cuenta, sin
// intención). El motor usa su RAW_RANGE [0,1] (el raw ya viene normalizado de adentro del scorer).
const NON_CALIBRATED: ReadonlySet<SignalId> = new Set<SignalId>(["hero_pool_fit", "archetype_fit"]);

export interface PercentileEntry {
  p05: number;
  p95: number;
  n: number;
}
export interface PercentilesFile {
  schemaVersion: 1;
  trainSplitHash: string;
  corpusPatchOverride: string | null;
  signals: Record<string, { global: PercentileEntry } | null>;
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[idx]!;
}

/**
 * Función pura: dados los `raw` no nulos agrupados por señal, devuelve los percentiles p05/p95
 * por señal. Una señal sin datos, o en `NON_CALIBRATED`, → `null` (el motor cae a `RAW_RANGE`).
 */
export function computePercentiles(
  rawsBySignal: Record<string, number[]>,
  meta: { trainSplitHash: string; corpusPatchOverride: string | null },
): PercentilesFile {
  const signals: PercentilesFile["signals"] = {};
  for (const s of SIGNALS) {
    const raws = rawsBySignal[s] ?? [];
    if (NON_CALIBRATED.has(s) || raws.length === 0) {
      signals[s] = null;
      continue;
    }
    const sorted = [...raws].sort((a, b) => a - b);
    const p05 = percentile(sorted, 0.05);
    const p95 = percentile(sorted, 0.95);
    // p05 === p95 haría que calibratedNormalize divida por cero; el motor lo trata como
    // "sin calibración útil" y cae a RAW_RANGE, pero lo dejamos explícito acá.
    signals[s] = p05 === p95 ? null : { global: { p05, p95, n: sorted.length } };
  }
  return { schemaVersion: 1, trainSplitHash: meta.trainSplitHash, corpusPatchOverride: meta.corpusPatchOverride, signals };
}

// ---------- orquestación (main) ----------

function stableHash(value: unknown): string {
  const s = JSON.stringify(value);
  let h = 0;
  for (const ch of s) h = (Math.imul(h, 31) + ch.charCodeAt(0)) >>> 0;
  return h.toString(16).padStart(8, "0");
}

function loadMeta(dbPath: string): MetaSnapshot {
  const db = new Database(dbPath, { readonly: true });
  try {
    const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
    for (const r of db.query("SELECT id, localized_name AS ln, roles FROM heroes").all() as { id: number; ln: string; roles: string }[]) {
      let roles: string[] = [];
      try {
        const p = JSON.parse(r.roles);
        if (Array.isArray(p)) roles = p.map(String);
      } catch {
        roles = [];
      }
      heroes[r.id] = { id: r.id, localizedName: r.ln, roles };
    }
    const matchups: Record<number, { vsHero: number; games: number; wins: number }[]> = {};
    for (const r of db.query("SELECT hero_id AS h, vs_hero_id AS v, games, wins FROM hero_matchups").all() as { h: number; v: number; games: number; wins: number }[]) {
      (matchups[r.h] ??= []).push({ vsHero: r.v, games: r.games, wins: r.wins });
    }
    const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
    for (const r of db.query("SELECT hero_id AS h, patch, bracket, picks, wins FROM hero_patch_stats").all() as { h: number; patch: string; bracket: string; picks: number; wins: number }[]) {
      (patchStats[r.h] ??= []).push({ patch: r.patch, bracket: r.bracket, picks: r.picks, wins: r.wins });
    }
    return { heroes, matchups, patchStats, heroPool: [], personalBaselineWinrate: null } as unknown as MetaSnapshot;
  } finally {
    db.close();
  }
}

function assembleScorers(): SignalScorer[] {
  const caps = loadHeroCapabilities();
  return [
    patchMetaScorer,
    heroPoolFitScorer,
    createCounterScorer(loadHeroCounters()),
    createPositionFitScorer(loadHeroPositions()),
    createTeamSynergyScorer(caps),
    createArchetypeFitScorer(caps, undefined),
  ];
}

async function main(): Promise<number> {
  const ENGINE_DB = process.env.ENGINE_DB_PATH ?? "apps/engine/data/dota2coach.sqlite";
  const PRO_DB = process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite";
  const SPLIT = process.env.D2K_SPLIT_OUT ?? "eval/baselines/split.json";
  const SAMPLE = Number(process.env.D2K_PERCENTILES_SAMPLE ?? "600");
  const OUT = process.env.D2K_PERCENTILES_OUT ?? "data/generated/percentiles.json";
  const META_OUT = process.env.D2K_PERCENTILES_META_OUT ?? "data/metadata/percentiles.json";

  const split = JSON.parse(readFileSync(SPLIT, "utf-8")) as { folds: number; assignment: Record<string, number> };
  const heldOutFold = split.folds - 1; // el fold de mayor índice se reserva para el QA final (§16.13-F)
  const trainLeagues = new Set(
    Object.entries(split.assignment)
      .filter(([, f]) => f !== heldOutFold)
      .map(([id]) => Number(id)),
  );
  const trainSplitHash = stableHash({ assignment: split.assignment, heldOutFold });

  const meta = loadMeta(ENGINE_DB);
  const patchOverride = dominantPatch(
    (meta as unknown as { patchStats?: Record<number, { patch: string }[]> }).patchStats ?? {},
  );

  const scorers = assembleScorers();
  const heroIds = Object.keys(meta.heroes).map(Number);
  const rawsBySignal: Record<string, number[]> = Object.fromEntries(SIGNALS.map((s) => [s, []]));

  const db = new Database(PRO_DB, { readonly: true });
  try {
    const drafts = (
      db
        .query("SELECT match_id AS m, league_id AS l, patch AS p FROM pro_drafts WHERE ingest_reason IS NULL OR ingest_reason <> 'invalid_draft_shape' ORDER BY match_id")
        .all() as { m: string; l: number; p: string }[]
    ).filter((d) => trainLeagues.has(d.l));
    const stmt = db.query("SELECT draft_order AS o, is_pick AS ip, hero_id AS h, team AS t FROM pro_draft_turns WHERE match_id = ? ORDER BY draft_order");
    const step = Math.max(1, Math.floor(drafts.length / SAMPLE));

    let states = 0;
    for (let i = 0; i < drafts.length && states < SAMPLE; i += step) {
      const d = drafts[i]!;
      const rows = stmt.all(d.m) as { o: number; ip: number; h: number; t: number }[];
      const turns: ProDraftTurn[] = rows.map((r) => ({ order: r.o, isPick: r.ip === 1, hero: r.h, team: (r.t === 1 ? 1 : 0) as 0 | 1 }));
      const { cases } = buildReplayCases(turns, { matchId: d.m, leagueId: d.l, tier: "professional", patch: d.p, patchOverride });
      for (const idx of [0, Math.floor(cases.length / 2), cases.length - 1]) {
        const c = cases[idx];
        if (!c) continue;
        states += 1;
        const taken = new Set<number>([...c.state.banned, ...c.state.picks.radiant, ...c.state.picks.dire]);
        for (const hero of heroIds) {
          if (taken.has(hero)) continue;
          for (const sc of scorers) {
            let raw: number | null = null;
            try {
              raw = sc.score(c.state, hero, meta).raw;
            } catch {
              raw = null;
            }
            if (raw !== null) rawsBySignal[sc.id]!.push(raw);
          }
        }
      }
    }

    const result = computePercentiles(rawsBySignal, { trainSplitHash, corpusPatchOverride: patchOverride ?? null });

    mkdirSync("data/generated", { recursive: true });
    mkdirSync("data/metadata", { recursive: true });
    writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
    writeFileSync(
      META_OUT,
      `${JSON.stringify(
        {
          source: `${ENGINE_DB} + ${PRO_DB} (folds de train de ${SPLIT}, held-out fold ${heldOutFold})`,
          generatedAt: new Date().toISOString(),
          generatorVersion: "build-percentiles@1",
          sampleWindow: null,
          patch: patchOverride ?? null,
          rowCount: SIGNALS.filter((s) => result.signals[s] !== null).length,
          schemaVersion: 1,
          note: "SPEC §16.5. Reemplaza la normalización lineal de RAW_RANGE (ADR-004). byBracket omitido: un DraftState de replay no lleva bracket; sólo `global`. hero_pool_fit/archetype_fit no se calibran.",
        },
        null,
        2,
      )}\n`,
    );

    process.stdout.write(
      `\npercentiles (train, ${states} estados) → ${OUT}\n` +
        SIGNALS.map((s) => {
          const e = result.signals[s];
          return `  ${s.padEnd(14)} ${e ? `[${e.global.p05.toFixed(4)}, ${e.global.p95.toFixed(4)}]  n=${e.global.n}` : "(no calibrada)"}`;
        }).join("\n") +
        "\n",
    );
    return 0;
  } finally {
    db.close();
  }
}

if (import.meta.main) process.exit(await main());
export { main };
