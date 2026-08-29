// Fase 9.0 — Benchmark A: Engine Quality (SPEC.md §15.4.3). El benchmark PRINCIPAL de calidad
// del motor: sobre el Golden Dataset graduado etiquetado a mano, NO sobre el pick profesional.
// Titular NDCG@5; acompañantes obligatorios Bad Pick Rate@5 y Pairwise Accuracy.

import { createIdleDraftState, type DraftState, type HeroId } from "../../apps/engine/src/draft/reducer";
import type { DraftDecisionContext } from "../../apps/engine/src/drafter/decision-context";
import type { MetaSnapshot } from "../../apps/engine/src/signals/types";
import { BASELINE_IDS, OMITTED_BASELINES, RANKERS, type BaselineId, type Ranker } from "./baselines";
import { GOLDEN_STRATA, toGradedMap, toMetricLabels, type GoldenCase, type GoldenStratum } from "./golden";
import { badPickRateAt5, ndcg5, pairwiseAccuracy } from "./metrics";

const DECISION_CONTEXTS: DraftDecisionContext[] = [
  "team_opening",
  "blind_second_pick",
  "response_pick",
  "closing_pick",
];

export interface QualityNumbers {
  n: number;
  ndcg5: number;
  badPickRate5: number;
  pairwiseAccuracy: number;
}

export interface QualitySegment {
  overall: QualityNumbers;
  byDecisionContext: Record<DraftDecisionContext, QualityNumbers>;
  byStratum: Record<GoldenStratum, QualityNumbers>;
}

export interface QualityBootstrapCI {
  metric: "NDCG@5";
  ranker: "v6Full";
  point: number;
  lo: number;
  hi: number;
}

export interface EngineQualityResult {
  valid: boolean;
  constraintViolationRate: number;
  violations: { caseId: string; ranker: BaselineId; hero: HeroId; why: string }[];
  omittedBaselines: typeof OMITTED_BASELINES;
  recallCeilingK: number;
  perRanker: Record<BaselineId, QualitySegment>;
  bootstrap: QualityBootstrapCI | null;
  corpus: { cases: number };
}

export interface EngineQualityOptions {
  bootstrapIterations?: number;
  /** override sólo para tests del gate. */
  rankers?: Partial<Record<BaselineId, Ranker>>;
  /**
   * SPEC §16.4 — mismo `patchOverride` que el backtest de replays. Los estados del Golden se
   * congelaron con `patch: "60"`; sin forzar el patch semántico, `patch_meta` sería null también
   * en el Benchmark A (el juez de calidad). El motor no se toca — es el `state` del caso el que
   * se ajusta al correr.
   */
  patchOverride?: string;
}

/** Rehidrata el DraftState completo desde el subconjunto serializado del Golden case. */
export function hydrateState(c: GoldenCase, patchOverride?: string): DraftState {
  return {
    ...createIdleDraftState(c.id),
    schema: "draft-state/v1",
    format: c.state.format,
    patch: patchOverride ?? c.state.patch,
    localSide: c.state.localSide,
    phase: c.state.phase,
    banned: [...c.state.banned],
    picks: { radiant: [...c.state.picks.radiant], dire: [...c.state.picks.dire] },
    lastSeq: c.state.lastSeq,
  };
}

function emptyNumbers(): QualityNumbers {
  return { n: 0, ndcg5: 0, badPickRate5: 0, pairwiseAccuracy: 0 };
}

function accumulate(acc: QualityNumbers, c: GoldenCase, ranking: HeroId[]): void {
  acc.n += 1;
  acc.ndcg5 += ndcg5(ranking, toGradedMap(c));
  const labels = toMetricLabels(c);
  acc.badPickRate5 += badPickRateAt5(ranking, labels);
  acc.pairwiseAccuracy += pairwiseAccuracy(ranking, labels);
}

function finalize(acc: QualityNumbers): QualityNumbers {
  if (acc.n === 0) return acc;
  return {
    n: acc.n,
    ndcg5: acc.ndcg5 / acc.n,
    badPickRate5: acc.badPickRate5 / acc.n,
    pairwiseAccuracy: acc.pairwiseAccuracy / acc.n,
  };
}

function segmentFor(rows: { c: GoldenCase; ranking: HeroId[] }[]): QualitySegment {
  const overall = emptyNumbers();
  const byDC = Object.fromEntries(DECISION_CONTEXTS.map((d) => [d, emptyNumbers()])) as Record<DraftDecisionContext, QualityNumbers>;
  const byStr = Object.fromEntries(GOLDEN_STRATA.map((s) => [s, emptyNumbers()])) as Record<GoldenStratum, QualityNumbers>;
  for (const { c, ranking } of rows) {
    accumulate(overall, c, ranking);
    accumulate(byDC[c.decisionContext], c, ranking);
    for (const s of c.strata) accumulate(byStr[s], c, ranking); // un caso cuenta en cada estrato suyo
  }
  return {
    overall: finalize(overall),
    byDecisionContext: Object.fromEntries(DECISION_CONTEXTS.map((d) => [d, finalize(byDC[d])])) as Record<DraftDecisionContext, QualityNumbers>,
    byStratum: Object.fromEntries(GOLDEN_STRATA.map((s) => [s, finalize(byStr[s])])) as Record<GoldenStratum, QualityNumbers>,
  };
}

function bootstrapNdcg(rows: { c: GoldenCase; ranking: HeroId[] }[], seedBase: number, iterations: number): QualityBootstrapCI | null {
  if (rows.length === 0) return null;
  let seed = seedBase >>> 0;
  const rand = (): number => {
    seed = (seed + 0x6d2b79f5) >>> 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const scoreOf = (r: { c: GoldenCase; ranking: HeroId[] }): number => ndcg5(r.ranking, toGradedMap(r.c));
  const samples: number[] = [];
  for (let it = 0; it < iterations; it++) {
    let sum = 0;
    for (let k = 0; k < rows.length; k++) sum += scoreOf(rows[Math.floor(rand() * rows.length)]!);
    samples.push(sum / rows.length);
  }
  samples.sort((a, b) => a - b);
  return {
    metric: "NDCG@5",
    ranker: "v6Full",
    point: rows.reduce((s, r) => s + scoreOf(r), 0) / rows.length,
    lo: samples[Math.floor(iterations * 0.025)] ?? 0,
    hi: samples[Math.floor(iterations * 0.975)] ?? 0,
  };
}

export function runEngineQuality(cases: GoldenCase[], meta: MetaSnapshot, opts: EngineQualityOptions = {}): EngineQualityResult {
  const heroExists = new Set<HeroId>(Object.keys(meta.heroes).map(Number));
  const rankers: Record<BaselineId, Ranker> = { ...RANKERS, ...opts.rankers };

  const violations: EngineQualityResult["violations"] = [];
  const rowsByRanker = Object.fromEntries(BASELINE_IDS.map((b) => [b, [] as { c: GoldenCase; ranking: HeroId[] }[]])) as Record<
    BaselineId,
    { c: GoldenCase; ranking: HeroId[] }[]
  >;
  let totalSuggestions = 0;
  let invalidSuggestions = 0;

  for (const c of cases) {
    const state = hydrateState(c, opts.patchOverride);
    const taken = new Set<HeroId>([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
    for (const b of BASELINE_IDS) {
      const ranking = rankers[b](state, meta);
      for (const hero of ranking) {
        totalSuggestions += 1;
        if (taken.has(hero)) {
          invalidSuggestions += 1;
          violations.push({ caseId: c.id, ranker: b, hero, why: "héroe ya baneado o pickeado" });
        } else if (!heroExists.has(hero)) {
          invalidSuggestions += 1;
          violations.push({ caseId: c.id, ranker: b, hero, why: "héroe inexistente en el meta" });
        }
      }
      rowsByRanker[b].push({ c, ranking });
    }
  }

  const constraintViolationRate = totalSuggestions === 0 ? 0 : invalidSuggestions / totalSuggestions;
  if (constraintViolationRate > 0) {
    return {
      valid: false,
      constraintViolationRate,
      violations: violations.slice(0, 50),
      omittedBaselines: OMITTED_BASELINES,
      recallCeilingK: 6,
      perRanker: {} as Record<BaselineId, QualitySegment>,
      bootstrap: null,
      corpus: { cases: 0 },
    };
  }

  const perRanker = Object.fromEntries(BASELINE_IDS.map((b) => [b, segmentFor(rowsByRanker[b])])) as Record<BaselineId, QualitySegment>;
  const bootstrap = bootstrapNdcg(rowsByRanker.v6Full, 0x1d2c6fe3, opts.bootstrapIterations ?? 500);

  return {
    valid: true,
    constraintViolationRate: 0,
    violations: [],
    omittedBaselines: OMITTED_BASELINES,
    recallCeilingK: 6,
    perRanker,
    bootstrap,
    corpus: { cases: cases.length },
  };
}
