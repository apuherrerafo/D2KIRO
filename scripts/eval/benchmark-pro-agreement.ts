// Fase 9.0 — Benchmark B: Professional Pick Agreement (SPEC.md §15.4.3, ADR-002).
//
// INSTRUMENTO COMPARATIVO, NUNCA PREDICTIVO. No existe snapshot de meta point-in-time, así que
// el valor absoluto de cualquier métrica no es interpretable — sólo el delta entre baselines
// calculados en la misma corrida. Se comunica como "Professional Pick Agreement", jamás como
// "accuracy" ni "qué tan bueno es el motor".

import { Database } from "bun:sqlite";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import type { DraftDecisionContext } from "../../apps/engine/src/drafter/decision-context";
import type { HeroId } from "../../apps/engine/src/draft/reducer";
import { BASELINE_IDS, OMITTED_BASELINES, RANKERS, type BaselineId, type Ranker } from "./baselines";
import { buildReplayCases } from "./replay";
import type { BuildReplayResult, ProDraftTurn, ReplayCase } from "./types";
import { mrr, recallAtK } from "./metrics";
import { foldOf, type FrozenSplit } from "./split";

const DECISION_CONTEXTS: DraftDecisionContext[] = [
  "team_opening",
  "blind_second_pick",
  "response_pick",
  "closing_pick",
];
const TIERS = ["premium", "professional", "unknown"] as const;
const RECALL_KS = [1, 3, 5, 6] as const; // 6 = techo de TOP_N; k>6 == k=6 en 9.0 (ver baselines.ts)

export interface AgreementNumbers {
  n: number;
  recall: Record<(typeof RECALL_KS)[number], number>;
  mrr: number;
}

export interface Segment {
  overall: AgreementNumbers;
  byDecisionContext: Record<DraftDecisionContext, AgreementNumbers>;
  byTier: Record<(typeof TIERS)[number], AgreementNumbers>;
}

export interface BootstrapCI {
  metric: string;
  point: number;
  lo: number;
  hi: number;
  level: "tournament" | "draft";
  note?: string;
}

export interface ProAgreementResult {
  valid: boolean;
  constraintViolationRate: number;
  violations: { matchId: string; turnIndex: number; baseline: BaselineId; hero: HeroId; why: string }[];
  omittedBaselines: typeof OMITTED_BASELINES;
  recallCeilingK: number;
  perBaseline: Record<BaselineId, Segment>;
  bootstrap: BootstrapCI[];
  corpus: { cases: number; drafts: number; tournaments: number };
}

interface Row {
  matchId: string;
  leagueId: number;
  tier: (typeof TIERS)[number];
  decisionContext: DraftDecisionContext;
  ranking: HeroId[];
  target: HeroId;
}

function emptyNumbers(): AgreementNumbers {
  return { n: 0, recall: { 1: 0, 3: 0, 5: 0, 6: 0 }, mrr: 0 };
}

function accumulate(acc: AgreementNumbers, ranking: HeroId[], target: HeroId): void {
  acc.n += 1;
  for (const k of RECALL_KS) acc.recall[k] += recallAtK(ranking, target, k);
  acc.mrr += mrr(ranking, target);
}

function finalize(acc: AgreementNumbers): AgreementNumbers {
  if (acc.n === 0) return acc;
  const out: AgreementNumbers = { n: acc.n, recall: { 1: 0, 3: 0, 5: 0, 6: 0 }, mrr: acc.mrr / acc.n };
  for (const k of RECALL_KS) out.recall[k] = acc.recall[k] / acc.n;
  return out;
}

function segmentFrom(rows: Row[]): Segment {
  const overall = emptyNumbers();
  const byDC = Object.fromEntries(DECISION_CONTEXTS.map((c) => [c, emptyNumbers()])) as Record<DraftDecisionContext, AgreementNumbers>;
  const byTier = Object.fromEntries(TIERS.map((t) => [t, emptyNumbers()])) as Record<(typeof TIERS)[number], AgreementNumbers>;
  for (const r of rows) {
    accumulate(overall, r.ranking, r.target);
    accumulate(byDC[r.decisionContext], r.ranking, r.target);
    accumulate(byTier[r.tier], r.ranking, r.target);
  }
  return {
    overall: finalize(overall),
    byDecisionContext: Object.fromEntries(DECISION_CONTEXTS.map((c) => [c, finalize(byDC[c])])) as Record<DraftDecisionContext, AgreementNumbers>,
    byTier: Object.fromEntries(TIERS.map((t) => [t, finalize(byTier[t])])) as Record<(typeof TIERS)[number], AgreementNumbers>,
  };
}

// bootstrap por clúster: resamplea GRUPOS con reemplazo y recomputa Recall@3 de v6Full.
function bootstrap(
  rows: Row[],
  groupKey: (r: Row) => string,
  level: "tournament" | "draft",
  seedBase: number,
  iterations = 500,
): BootstrapCI {
  const groups = new Map<string, Row[]>();
  for (const r of rows) {
    const g = groupKey(r);
    (groups.get(g) ?? groups.set(g, []).get(g)!).push(r);
  }
  const keys = [...groups.keys()];
  const samples: number[] = [];
  let seed = seedBase >>> 0;
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let it = 0; it < iterations; it++) {
    let hits = 0;
    let n = 0;
    for (let g = 0; g < keys.length; g++) {
      const picked = groups.get(keys[Math.floor(rand() * keys.length)]!)!;
      for (const r of picked) {
        hits += recallAtK(r.ranking, r.target, 3);
        n += 1;
      }
    }
    samples.push(n === 0 ? 0 : hits / n);
  }
  samples.sort((a, b) => a - b);
  const point = rows.length === 0 ? 0 : rows.filter((r) => recallAtK(r.ranking, r.target, 3) === 1).length / rows.length;
  return {
    metric: "Professional Pick Agreement @3 (v6Full)",
    point,
    lo: samples[Math.floor(iterations * 0.025)] ?? 0,
    hi: samples[Math.floor(iterations * 0.975)] ?? 0,
    level,
    note: level === "draft" ? "OPTIMISTA: los turnos de un mismo draft no son independientes" : undefined,
  };
}

export interface RunOptions {
  /** por defecto usa todos los folds; para train/test se pasa el subconjunto */
  folds?: number[];
  bootstrapIterations?: number;
  /** override de rankeadores — sólo para tests del gate de ConstraintViolationRate. */
  rankers?: Partial<Record<BaselineId, Ranker>>;
}

/**
 * Lee pro-drafts.sqlite (SÓLO LECTURA) y arma los ReplayCase por partida. El motor no ve esto;
 * es un script offline. Los 826 drafts `tier_not_accepted` de Fase 7 ENTRAN al backtest con
 * `tier: "unknown"` (SPEC §15.1 C1) — es política de curación de ingesta, no un defecto de dato.
 * Un draft con `ingest_reason = 'invalid_draft_shape'` o shape inválido se descarta con motivo.
 */
export function loadReplayCasesFromDb(dbPath: string, patchOverride?: string): BuildReplayResult {
  const db = new Database(dbPath, { readonly: true });
  try {
    const drafts = db
      .query(
        `SELECT d.match_id AS matchId, d.league_id AS leagueId, d.patch AS patch,
                COALESCE(t.tier, 'unknown') AS tier
         FROM pro_drafts d
         LEFT JOIN tournaments t ON t.league_id = d.league_id
         WHERE d.ingest_reason IS NULL OR d.ingest_reason <> 'invalid_draft_shape'`,
      )
      .all() as { matchId: string; leagueId: number; patch: string; tier: string }[];

    const turnStmt = db.query(
      `SELECT draft_order AS ord, is_pick AS isPick, hero_id AS hero, team
       FROM pro_draft_turns WHERE match_id = ? ORDER BY draft_order`,
    );

    const cases: ReplayCase[] = [];
    const skipped: { matchId: string; reason: string }[] = [];
    for (const d of drafts) {
      const rows = turnStmt.all(d.matchId) as { ord: number; isPick: number; hero: number; team: number }[];
      const turns: ProDraftTurn[] = rows.map((r) => ({
        order: r.ord,
        isPick: r.isPick === 1,
        hero: r.hero,
        team: (r.team === 1 ? 1 : 0) as 0 | 1,
      }));
      const tier = d.tier === "premium" || d.tier === "professional" ? d.tier : "unknown";
      const res = buildReplayCases(turns, { matchId: d.matchId, leagueId: d.leagueId, tier, patch: d.patch, patchOverride });
      cases.push(...res.cases);
      skipped.push(...res.skipped);
    }
    return { cases, skipped };
  } finally {
    db.close();
  }
}

export function runProAgreement(
  cases: ReplayCase[],
  meta: MetaSnapshot,
  split: FrozenSplit,
  opts: RunOptions = {},
): ProAgreementResult {
  const heroExists = new Set<HeroId>(Object.keys(meta.heroes).map(Number));
  const foldFilter = opts.folds ? new Set(opts.folds) : null;
  const rankers: Record<BaselineId, Ranker> = { ...RANKERS, ...opts.rankers };

  const violations: ProAgreementResult["violations"] = [];
  const rowsByBaseline = Object.fromEntries(BASELINE_IDS.map((b) => [b, [] as Row[]])) as Record<BaselineId, Row[]>;
  const seenDrafts = new Set<string>();
  const seenTournaments = new Set<number>();
  let totalSuggestions = 0;
  let invalidSuggestions = 0;

  for (const c of cases) {
    const fold = foldOf(split, c.leagueId);
    if (fold === null) continue; // torneo fuera del split congelado
    if (foldFilter && !foldFilter.has(fold)) continue;

    seenDrafts.add(c.matchId);
    seenTournaments.add(c.leagueId);
    const taken = new Set<HeroId>([...c.state.banned, ...c.state.picks.radiant, ...c.state.picks.dire]);

    for (const baseline of BASELINE_IDS) {
      const ranking = rankers[baseline](c.state, meta);
      for (const hero of ranking) {
        totalSuggestions += 1;
        if (taken.has(hero)) {
          invalidSuggestions += 1;
          violations.push({ matchId: c.matchId, turnIndex: c.turnIndex, baseline, hero, why: "héroe ya baneado o pickeado" });
        } else if (!heroExists.has(hero)) {
          invalidSuggestions += 1;
          violations.push({ matchId: c.matchId, turnIndex: c.turnIndex, baseline, hero, why: "héroe inexistente en el meta" });
        }
      }
      rowsByBaseline[baseline].push({
        matchId: c.matchId,
        leagueId: c.leagueId,
        tier: c.tier,
        decisionContext: c.decisionContext,
        ranking,
        target: c.actualHero,
      });
    }
  }

  const constraintViolationRate = totalSuggestions === 0 ? 0 : invalidSuggestions / totalSuggestions;
  if (constraintViolationRate > 0) {
    // Gate duro: la corrida es inválida, no se reporta ninguna otra métrica.
    return {
      valid: false,
      constraintViolationRate,
      violations: violations.slice(0, 50),
      omittedBaselines: OMITTED_BASELINES,
      recallCeilingK: 6,
      perBaseline: {} as Record<BaselineId, Segment>,
      bootstrap: [],
      corpus: { cases: 0, drafts: seenDrafts.size, tournaments: seenTournaments.size },
    };
  }

  const perBaseline = Object.fromEntries(
    BASELINE_IDS.map((b) => [b, segmentFrom(rowsByBaseline[b])]),
  ) as Record<BaselineId, Segment>;

  const v6Rows = rowsByBaseline.v6Full;
  const iters = opts.bootstrapIterations ?? 500;
  const bootstrapResult = [
    bootstrap(v6Rows, (r) => String(r.leagueId), "tournament", 0x51ed270b, iters),
    bootstrap(v6Rows, (r) => r.matchId, "draft", 0x2545f491, iters),
  ];

  return {
    valid: true,
    constraintViolationRate: 0,
    violations: [],
    omittedBaselines: OMITTED_BASELINES,
    recallCeilingK: 6,
    perBaseline,
    bootstrap: bootstrapResult,
    corpus: { cases: v6Rows.length, drafts: seenDrafts.size, tournaments: seenTournaments.size },
  };
}
