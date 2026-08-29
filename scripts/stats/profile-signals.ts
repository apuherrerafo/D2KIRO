#!/usr/bin/env bun
// Fase 9.0 — perfil de señales (SPEC.md §15.4.5, C5). ENTRADA DEL GATE DE 9.1.
//
// Corrige R1-1: la pendiente efectiva sola no dice quién decide un ranking. Lo que importa es la
// INFLUENCIA REALIZADA = pendiente efectiva × SD del `raw` ENTRE candidatos del mismo estado.
// Una pendiente alta sobre un `raw` que casi no varía entre candidatos no mueve nada.
//
// Offline: consume los building blocks YA exportados del motor (los mismos scorers que
// buildSuggestions ensambla). No modifica apps/engine/src/**. SQLite readonly, cero red.

import { Database } from "bun:sqlite";
import { mkdirSync, writeFileSync } from "node:fs";
import { createIdleDraftState, type DraftState, type HeroId } from "../../apps/engine/src/draft/reducer";
import { deriveDecisionContext, type DraftDecisionContext } from "../../apps/engine/src/drafter/decision-context";
import { createArchetypeFitScorer } from "../../apps/engine/src/signals/archetype-fit";
import { createCounterScorer } from "../../apps/engine/src/signals/counter";
import { heroPoolFitScorer } from "../../apps/engine/src/signals/hero-pool-fit";
import { loadHeroCounters } from "../../apps/engine/src/signals/hero-counters";
import { loadHeroPositions } from "../../apps/engine/src/signals/hero-positions";
import { mixScore } from "../../apps/engine/src/signals/mix";
import { patchMetaScorer } from "../../apps/engine/src/signals/patch-meta";
import { createPositionFitScorer } from "../../apps/engine/src/signals/position-fit";
import { createTeamSynergyScorer } from "../../apps/engine/src/signals/team-synergy";
import type { MetaSnapshot, SignalContribution, SignalId, SignalScorer } from "../../apps/engine/src/signals/types";
import { SCORING_WEIGHTS_V6 } from "../../apps/engine/src/signals/weights";
import { loadHeroCapabilities } from "../../apps/engine/src/draft-paths/capabilities";
import { buildReplayCases } from "../eval/replay";
import type { ProDraftTurn } from "../eval/types";

// ESPEJO de RAW_RANGE (mix.ts:117 — NO está exportado). Si cambia allá, cambia acá.
// 9.1 reemplaza este mecanismo por percentiles empíricos (ADR-004), así que este espejo es
// transitorio por diseño.
const RAW_RANGE: Record<SignalId, [number, number]> = {
  counter: [-0.12, 0.12],
  patch_meta: [0.3, 0.7],
  team_synergy: [0, 1],
  hero_pool_fit: [0, 1],
  position_fit: [0, 1],
  archetype_fit: [0, 1],
};
const SIGNALS: SignalId[] = ["position_fit", "counter", "patch_meta", "team_synergy", "hero_pool_fit", "archetype_fit"];

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

function loadStates(proDbPath: string, sampleSize: number): { state: DraftState; ctx: DraftDecisionContext }[] {
  const db = new Database(proDbPath, { readonly: true });
  try {
    const drafts = db
      .query("SELECT match_id AS m, league_id AS l, patch AS p FROM pro_drafts WHERE ingest_reason IS NULL OR ingest_reason <> 'invalid_draft_shape'")
      .all() as { m: string; l: number; p: string }[];
    const stmt = db.query("SELECT draft_order AS o, is_pick AS ip, hero_id AS h, team AS t FROM pro_draft_turns WHERE match_id = ? ORDER BY draft_order");
    const out: { state: DraftState; ctx: DraftDecisionContext }[] = [];
    // muestreo determinista: cada k-ésimo draft, y de cada uno el estado de un pick "medio"
    const step = Math.max(1, Math.floor(drafts.length / sampleSize));
    for (let i = 0; i < drafts.length && out.length < sampleSize; i += step) {
      const d = drafts[i]!;
      const rows = stmt.all(d.m) as { o: number; ip: number; h: number; t: number }[];
      const turns: ProDraftTurn[] = rows.map((r) => ({ order: r.o, isPick: r.ip === 1, hero: r.h, team: (r.t === 1 ? 1 : 0) as 0 | 1 }));
      const { cases } = buildReplayCases(turns, { matchId: d.m, leagueId: d.l, tier: "professional", patch: d.p });
      if (cases.length === 0) continue;
      // tomamos hasta 3 estados por draft (temprano / medio / tardío) para cubrir contextos
      for (const idx of [0, Math.floor(cases.length / 2), cases.length - 1]) {
        const c = cases[idx];
        if (c) out.push({ state: c.state, ctx: c.decisionContext });
      }
    }
    return out;
  } finally {
    db.close();
  }
}

function assembleScorers(meta: MetaSnapshot): SignalScorer[] {
  return [
    patchMetaScorer,
    heroPoolFitScorer,
    createCounterScorer(loadHeroCounters()),
    createPositionFitScorer(loadHeroPositions()),
    createTeamSynergyScorer(loadHeroCapabilities()),
    createArchetypeFitScorer(loadHeroCapabilities(), undefined),
  ];
}

function candidatesOf(state: DraftState, meta: MetaSnapshot): HeroId[] {
  const taken = new Set<HeroId>([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  return Object.keys(meta.heroes).map(Number).filter((h) => !taken.has(h));
}

function stddev(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / xs.length);
}

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.floor(p * sorted.length)));
  return sorted[idx]!;
}

export interface SignalProfile {
  signal: SignalId;
  rawPercentiles: { p05: number; p25: number; p50: number; p75: number; p95: number };
  meanIntraStateSD: number;
  effectiveSlope: number;
  realizedInfluence: number;
  rawNullRate: number;
  applicableFalseRate: number;
}

export interface AblationEntry {
  signal: SignalId;
  meanAbsDelta: number;
  byContext: Record<DraftDecisionContext, number>;
}

export interface ProfileResult {
  sampleStates: number;
  sampleCandidateEvaluations: number;
  signals: SignalProfile[];
  ablation: AblationEntry[];
  voteCountHistogram: number[]; // índice = nº de señales con voto (0..6), valor = fracción
}

export function profileFromStates(
  states: { state: DraftState; ctx: DraftDecisionContext }[],
  meta: MetaSnapshot,
): ProfileResult {
  const scorers = assembleScorers(meta);
  const CONTEXTS: DraftDecisionContext[] = ["team_opening", "blind_second_pick", "response_pick", "closing_pick"];

  const rawPool: Record<SignalId, number[]> = Object.fromEntries(SIGNALS.map((s) => [s, []])) as Record<SignalId, number[]>;
  const intraStateSDs: Record<SignalId, number[]> = Object.fromEntries(SIGNALS.map((s) => [s, []])) as Record<SignalId, number[]>;
  const nullCount: Record<SignalId, number> = Object.fromEntries(SIGNALS.map((s) => [s, 0])) as Record<SignalId, number>;
  const applicableFalse: Record<SignalId, number> = Object.fromEntries(SIGNALS.map((s) => [s, 0])) as Record<SignalId, number>;
  const totalPerSignal: Record<SignalId, number> = Object.fromEntries(SIGNALS.map((s) => [s, 0])) as Record<SignalId, number>;

  const ablSum: Record<SignalId, number> = Object.fromEntries(SIGNALS.map((s) => [s, 0])) as Record<SignalId, number>;
  const ablByCtxSum: Record<SignalId, Record<DraftDecisionContext, number>> = Object.fromEntries(
    SIGNALS.map((s) => [s, Object.fromEntries(CONTEXTS.map((c) => [c, 0])) as Record<DraftDecisionContext, number>]),
  ) as Record<SignalId, Record<DraftDecisionContext, number>>;
  const ablByCtxN: Record<DraftDecisionContext, number> = Object.fromEntries(CONTEXTS.map((c) => [c, 0])) as Record<DraftDecisionContext, number>;

  const voteHist = new Array(SIGNALS.length + 1).fill(0);
  let ablN = 0;
  let candidateEvals = 0;

  for (const { state, ctx } of states) {
    const cands = candidatesOf(state, meta);
    if (cands.length === 0) continue;

    // raw por señal para todos los candidatos de ESTE estado
    const perSignalThisState: Record<SignalId, number[]> = Object.fromEntries(SIGNALS.map((s) => [s, []])) as Record<SignalId, number[]>;

    for (const hero of cands) {
      candidateEvals += 1;
      const contribs: SignalContribution[] = scorers.map((sc) => {
        try {
          return sc.score(state, hero, meta);
        } catch {
          return { signal: sc.id, raw: null, weighted: 0, explanation: "", sampleSize: 0 };
        }
      });

      let votes = 0;
      for (const c of contribs) {
        totalPerSignal[c.signal] += 1;
        if (c.applicable === false) applicableFalse[c.signal] += 1;
        else if (c.raw === null) nullCount[c.signal] += 1;
        else {
          votes += 1;
          rawPool[c.signal].push(c.raw);
          perSignalThisState[c.signal].push(c.raw);
        }
      }
      voteHist[votes] += 1;

      // ablación sobre este candidato
      const full = mixScore(contribs);
      for (const s of SIGNALS) {
        const without = mixScore(contribs.filter((c) => c.signal !== s));
        const d = Math.abs(full - without);
        ablSum[s] += d;
        ablByCtxSum[s][ctx] += d;
      }
      ablByCtxN[ctx] += 1;
      ablN += 1;
    }

    for (const s of SIGNALS) {
      if (perSignalThisState[s].length >= 2) intraStateSDs[s].push(stddev(perSignalThisState[s]));
    }
  }

  const signals: SignalProfile[] = SIGNALS.map((s) => {
    const sorted = [...rawPool[s]].sort((a, b) => a - b);
    const [min, max] = RAW_RANGE[s];
    const slope = (100 * SCORING_WEIGHTS_V6[s]) / (max - min);
    const meanSD = intraStateSDs[s].length > 0 ? intraStateSDs[s].reduce((a, b) => a + b, 0) / intraStateSDs[s].length : 0;
    return {
      signal: s,
      rawPercentiles: {
        p05: percentile(sorted, 0.05),
        p25: percentile(sorted, 0.25),
        p50: percentile(sorted, 0.5),
        p75: percentile(sorted, 0.75),
        p95: percentile(sorted, 0.95),
      },
      meanIntraStateSD: meanSD,
      effectiveSlope: slope,
      realizedInfluence: slope * meanSD,
      rawNullRate: totalPerSignal[s] === 0 ? 0 : nullCount[s] / totalPerSignal[s],
      applicableFalseRate: totalPerSignal[s] === 0 ? 0 : applicableFalse[s] / totalPerSignal[s],
    };
  });

  const ablation: AblationEntry[] = SIGNALS.map((s) => ({
    signal: s,
    meanAbsDelta: ablN === 0 ? 0 : ablSum[s] / ablN,
    byContext: Object.fromEntries(
      CONTEXTS.map((c) => [c, ablByCtxN[c] === 0 ? 0 : ablByCtxSum[s][c] / ablByCtxN[c]]),
    ) as Record<DraftDecisionContext, number>,
  }));

  const totalVotes = voteHist.reduce((a: number, b: number) => a + b, 0) || 1;
  return {
    sampleStates: states.length,
    sampleCandidateEvaluations: candidateEvals,
    signals,
    ablation,
    voteCountHistogram: voteHist.map((v: number) => v / totalVotes),
  };
}

async function main(): Promise<number> {
  const ENGINE_DB = process.env.ENGINE_DB_PATH ?? "apps/engine/data/dota2coach.sqlite";
  const PRO_DB = process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite";
  const SAMPLE = Number(process.env.D2K_PROFILE_SAMPLE ?? "300");
  const OUT = process.env.D2K_PROFILE_OUT ?? "data/generated/signal-profile.json";
  const META_OUT = process.env.D2K_PROFILE_META_OUT ?? "data/metadata/signal-profile.json";

  const meta = loadMeta(ENGINE_DB);
  const states = loadStates(PRO_DB, SAMPLE);
  const result = profileFromStates(states, meta);

  mkdirSync("data/generated", { recursive: true });
  mkdirSync("data/metadata", { recursive: true });
  writeFileSync(OUT, `${JSON.stringify(result, null, 2)}\n`);
  writeFileSync(
    META_OUT,
    `${JSON.stringify(
      {
        source: `${ENGINE_DB} + ${PRO_DB}`,
        generatedAt: new Date().toISOString(),
        generatorVersion: "profile-signals@1",
        sampleWindow: null,
        patch: "60",
        rowCount: result.signals.length,
        schemaVersion: 1,
        note: "Entrada del gate de 9.1 (ADR-004). RAW_RANGE es un espejo de mix.ts:117.",
      },
      null,
      2,
    )}\n`,
  );

  process.stdout.write(
    `\nperfil de señales: ${result.sampleStates} estados, ${result.sampleCandidateEvaluations} evaluaciones\n` +
      result.signals
        .map((s) => `  ${s.signal.padEnd(14)} slope ${s.effectiveSlope.toFixed(1).padStart(6)}  SD_intra ${s.meanIntraStateSD.toFixed(4)}  influencia ${s.realizedInfluence.toFixed(3).padStart(7)}  null ${(s.rawNullRate * 100).toFixed(1)}%`)
        .join("\n") +
      `\n  → ${OUT}\n`,
  );
  return 0;
}

if (import.meta.main) {
  process.exit(await main());
}

export { main };
