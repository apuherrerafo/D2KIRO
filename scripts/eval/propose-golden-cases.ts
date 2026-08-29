#!/usr/bin/env bun
// Fase 9.0 — selección asistida de casos para el Golden Dataset (SPEC.md §15.4.4, D8).
//
// NO etiqueta. Propone, ordenados, los ~30 estados más informativos para que el humano cure
// sobre ellos (TSK-206). Todo determinista. Criterios (§15.4.4):
//   1. Cobertura de estratos: cuota por (decisionContext × estrato temático).
//   2. Desacuerdo entre baselines: estados con bajo Jaccard entre los Top-5 de v6 / patch-meta /
//      random. Ahí el etiquetado humano discrimina.
//   3. Fallos históricos: estados donde v6Full rankea el pick profesional real fuera del Top-6.
//   4. Escenarios sintéticos para estratos que el corpus no cubre bien (hard_counter, sobre todo),
//      construidos desde hero-counters.json + hero-positions.json.

import { readFileSync } from "node:fs";
import type { DraftDecisionContext } from "../../apps/engine/src/drafter/decision-context";
import { createIdleDraftState, type DraftState, type HeroId } from "../../apps/engine/src/draft/reducer";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { RANKERS } from "./baselines";
import { jaccardAtK } from "./metrics";
import type { GoldenStratum } from "./golden";
import type { ReplayCase } from "./types";

export interface ProposedCase {
  state: DraftState;
  side: "radiant" | "dire";
  decisionContext: DraftDecisionContext;
  suggestedStratum: GoldenStratum;
  reason: string;
  v6Top6: HeroId[];
  actualPick: HeroId | null; // null para sintéticos
  score: number; // prioridad; mayor = más informativo
}

const CURATED_COUNTERS: Record<string, { vs: number; level: "hard" | "medium" }[]> = JSON.parse(
  readFileSync("apps/engine/src/signals/hero-counters.json", "utf-8"),
);
const HERO_POSITIONS: { hero: number; positions: { position: number; matches: number }[] }[] = JSON.parse(
  readFileSync("apps/engine/src/signals/hero-positions.json", "utf-8"),
);

function heroesAtPosition(pos: number): number[] {
  return HERO_POSITIONS.filter((h) => h.positions.some((p) => p.position === pos)).map((h) => h.hero);
}

// Heurística de estrato: no pretende acertar, sólo orientar al curador (que decide).
function guessStratum(state: DraftState, meta: MetaSnapshot): GoldenStratum {
  const enemy = state.localSide === "radiant" ? state.picks.dire : state.picks.radiant;
  const own = state.localSide === "radiant" ? state.picks.radiant : state.picks.dire;
  // ¿algún rival revelado es el `vs` de un counter curado sobre un candidato plausible?
  const enemySet = new Set(enemy);
  for (const [, list] of Object.entries(CURATED_COUNTERS)) {
    if (list.some((c) => enemySet.has(c.vs) && c.level === "hard")) return "hard_counter";
  }
  if (own.length >= 4) return "composition";
  if (enemy.length >= 3 && own.length <= 2) return "punishability";
  if (own.length <= 1) return "role_scarcity";
  return "team_needs";
}

export function proposeFromCorpus(cases: ReplayCase[], meta: MetaSnapshot, target = 30): ProposedCase[] {
  const proposals: ProposedCase[] = [];

  // muestreo determinista: un estado por draft (el del medio), recorriendo en orden
  const seen = new Set<string>();
  for (const c of cases) {
    if (seen.has(c.matchId)) continue;
    seen.add(c.matchId);

    const v6 = RANKERS.v6Full(c.state, meta);
    const pm = RANKERS.patchMetaOnly(c.state, meta);
    const rnd = RANKERS.random(c.state, meta);

    const disagreement =
      1 - (jaccardAtK(v6, pm, 5) + jaccardAtK(v6, rnd, 5) + jaccardAtK(pm, rnd, 5)) / 3;
    const missRank = v6.indexOf(c.actualHero);
    const historicalFailure = missRank === -1 || missRank >= 6;

    // prioridad: desacuerdo alto + fallo histórico pesan
    const score = disagreement * 2 + (historicalFailure ? 1 : 0);

    proposals.push({
      state: c.state,
      side: c.side,
      decisionContext: c.decisionContext,
      suggestedStratum: guessStratum(c.state, meta),
      reason:
        `desacuerdo baselines=${disagreement.toFixed(2)}` +
        (historicalFailure ? `, v6 no ubica el pick pro en el Top-6` : `, v6 ubica el pick pro en #${missRank + 1}`),
      v6Top6: v6.slice(0, 6),
      actualPick: c.actualHero,
      score,
    });
  }

  proposals.sort((a, b) => b.score - a.score);

  // cuota por (decisionContext × estrato): tomamos primero llenando celdas vacías
  const picked: ProposedCase[] = [];
  const cellCount = new Map<string, number>();
  const cellCap = Math.max(1, Math.ceil(target / 12)); // 4 contextos × ~3 estratos frecuentes
  for (const p of proposals) {
    if (picked.length >= target) break;
    const key = `${p.decisionContext}:${p.suggestedStratum}`;
    const n = cellCount.get(key) ?? 0;
    if (n >= cellCap) continue;
    cellCount.set(key, n + 1);
    picked.push(p);
  }
  // completar hasta target con lo mejor que quede
  for (const p of proposals) {
    if (picked.length >= target) break;
    if (!picked.includes(p)) picked.push(p);
  }
  return picked.slice(0, target);
}

/** Escenarios sintéticos de hard_counter: un `vs` curado ya revelado en el rival + la víctima
 *  como candidato del rol adecuado. Cubre un estrato que el corpus rara vez presenta limpio. */
export function syntheticHardCounters(meta: MetaSnapshot, n = 5): ProposedCase[] {
  const out: ProposedCase[] = [];
  const heroIds = new Set(Object.keys(meta.heroes).map(Number));
  const victims = Object.entries(CURATED_COUNTERS)
    .map(([v, list]) => ({ victim: Number(v), hard: list.filter((c) => c.level === "hard") }))
    .filter((x) => x.hard.length > 0 && heroIds.has(x.victim))
    .sort((a, b) => a.victim - b.victim);

  for (const { victim, hard } of victims) {
    if (out.length >= n) break;
    const counter = hard[0]!.vs;
    if (!heroIds.has(counter)) continue;
    // rival revela el counter; nuestro lado tiene 2 picks neutros; la víctima es candidato
    const filler = [...heroIds].filter((h) => h !== victim && h !== counter).slice(0, 4);
    const state: DraftState = {
      ...createIdleDraftState(`synthetic-hc-${victim}`),
      schema: "draft-state/v1",
      format: "captains_mode",
      patch: "60",
      localSide: "radiant",
      phase: "active",
      banned: [],
      picks: { radiant: [filler[0]!, filler[1]!], dire: [counter, filler[2]!] },
      lastSeq: 4,
    };
    out.push({
      state,
      side: "radiant",
      decisionContext: "response_pick",
      suggestedStratum: "hard_counter",
      reason: `sintético: ${counter} (hard counter curado de ${victim}) ya revelado en el rival; ¿el motor evita ${victim}?`,
      v6Top6: RANKERS.v6Full(state, meta).slice(0, 6),
      actualPick: null,
      score: 5,
    });
  }
  return out;
}

async function main(): Promise<number> {
  const { loadReplayCasesFromDb } = await import("./benchmark-pro-agreement");
  const { Database } = await import("bun:sqlite");
  const { writeFileSync, mkdirSync } = await import("node:fs");

  const ENGINE_DB = process.env.ENGINE_DB_PATH ?? "apps/engine/data/dota2coach.sqlite";
  const PRO_DB = process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite";
  const TARGET = Number(process.env.D2K_PROPOSAL_TARGET ?? "30");

  const db = new Database(ENGINE_DB, { readonly: true });
  const heroes: Record<number, { id: number; localizedName: string; roles?: string[] }> = {};
  for (const r of db.query("SELECT id, localized_name AS ln FROM heroes").all() as { id: number; ln: string }[]) {
    heroes[r.id] = { id: r.id, localizedName: r.ln, roles: [] };
  }
  const matchups: Record<number, { vsHero: number; games: number; wins: number }[]> = {};
  for (const r of db.query("SELECT hero_id AS h, vs_hero_id AS v, games, wins FROM hero_matchups").all() as { h: number; v: number; games: number; wins: number }[]) {
    (matchups[r.h] ??= []).push({ vsHero: r.v, games: r.games, wins: r.wins });
  }
  const patchStats: Record<number, { patch: string; bracket: string; picks: number; wins: number }[]> = {};
  for (const r of db.query("SELECT hero_id AS h, patch, bracket, picks, wins FROM hero_patch_stats").all() as { h: number; patch: string; bracket: string; picks: number; wins: number }[]) {
    (patchStats[r.h] ??= []).push({ patch: r.patch, bracket: r.bracket, picks: r.picks, wins: r.wins });
  }
  db.close();
  const meta = { heroes, matchups, patchStats, heroPool: [], personalBaselineWinrate: null } as unknown as MetaSnapshot;

  const { cases } = loadReplayCasesFromDb(PRO_DB);
  const midCases = cases.filter((_, i) => i % 10 === 5); // ~1 por draft
  const fromCorpus = proposeFromCorpus(midCases, meta, TARGET);
  const synthetic = syntheticHardCounters(meta, 5);
  const proposal = [...synthetic, ...fromCorpus].slice(0, TARGET);

  mkdirSync("eval/scenarios", { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const path = `eval/scenarios/proposal-${stamp}.json`;
  writeFileSync(path, `${JSON.stringify({ generatedAt: new Date().toISOString(), count: proposal.length, proposal }, null, 2)}\n`);

  process.stdout.write(
    `\npropuesta de ${proposal.length} casos → ${path}\n` +
      `  sintéticos hard_counter: ${synthetic.length}\n` +
      `  del corpus: ${proposal.length - synthetic.length}\n` +
      `  estratos: ${[...new Set(proposal.map((p) => p.suggestedStratum))].join(", ")}\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

export { main };
