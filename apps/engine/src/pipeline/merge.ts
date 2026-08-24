import type { PipelineWeights } from "./weight-loader";

// Fase 8 (pro-drafter-spec-v1.md §3): "Weighted Signal Merger -- mismo mecanismo de mix.ts: raw
// -> [0,1] -> ponderado; raw:null se redistribuye proporcionalmente."
//
// Reimplementación paralela y deliberada del algoritmo de signals/mix.ts (normalize + redistri-
// bución proporcional), NUNCA un import directo. `SignalId` es un Record TOTAL congelado en
// SCORING_WEIGHTS_V4/V5 (engine.md, Fase 4) -- ampliarlo con "knn_similarity"/"lane_score"/
// "denial_score" rompería esa compilación, el mismo motivo por el que archetype_fit (4.1) usa una
// vista de tipo derivada en vez de tocar SignalId. Este pipeline vive en un árbol de tipos y
// pesos completamente separado (PipelineWeights, weight-loader.ts, 8.2) -- ni este archivo ni
// weight-loader.ts importan signals/mix.ts, signals/weights.ts ni SignalId.

export type PipelineSignalId = "knn_similarity" | "lane_score" | "denial_score";

export interface PipelineSignalContribution {
  readonly signal: PipelineSignalId;
  readonly raw: number | null;
}

// [SUPUESTO, ver plan Fase 5-8]: knn_similarity y lane_score ya viven en [0,1] por construcción
// (Jaccard normalizado, sigmoide). denial_score NO tiene una cota dada por el doc -- su término de
// matchup está en [0,1] (promedio ponderado de winrates), pero el término β·earlyPressure·H(F)
// puede sumar más arriba (H(F) llega hasta log2(5)~=2.32). [0,2] es una estimación documentada,
// no medida contra datos reales todavía -- mismo estado inicial que tuvo RAW_RANGE.counter en
// mix.ts antes de su auditoría de Fase 3 (engine.md). Recalibrar cuando exista el pipeline de
// auto-tuning (§2.4 del doc, fuera de alcance de Fase 5-8).
const PIPELINE_RAW_RANGE: Record<PipelineSignalId, [number, number]> = {
  knn_similarity: [0, 1],
  lane_score: [0, 1],
  denial_score: [0, 2],
};

function normalize(signal: PipelineSignalId, raw: number): number {
  const [min, max] = PIPELINE_RAW_RANGE[signal];
  const clamped = Math.min(max, Math.max(min, raw));
  return ((clamped - min) / (max - min)) * 100;
}

export function mergePipelineSignals(
  signals: readonly PipelineSignalContribution[],
  weights: PipelineWeights,
): number {
  const withData = signals.filter(
    (s): s is PipelineSignalContribution & { raw: number } => s.raw !== null,
  );
  const totalWeight = withData.reduce((sum, s) => sum + weights[s.signal], 0);

  if (withData.length === 0 || totalWeight === 0) return 50; // neutro -- nunca 0 ni un extremo

  return withData.reduce((sum, s) => {
    const share = weights[s.signal] / totalWeight;
    return sum + normalize(s.signal, s.raw) * share;
  }, 0);
}
