import type { DraftState, HeroId } from "../draft/reducer";
import { counterScorer } from "./counter";
import { patchMetaScorer } from "./patch-meta";
import { roleGapScorer } from "./role-gap";
import { teamSynergyScorer } from "./team-synergy";
import type { MetaSnapshot, SignalContribution, SignalId, SignalScorer } from "./types";
import { SCORING_WEIGHTS_V1 } from "./weights";

export interface Suggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;
  signals: SignalContribution[]; // siempre las 4, incluidas las que dieron null
  reason: string;
  confidence: "alta" | "media" | "baja";
}

export type DegradationFlag = "stale_meta" | "partial_signals" | "unconfirmed_state" | "unknown_format";

export interface SuggestionSet {
  schema: "suggestions/v1";
  sessionId: string;
  basedOnSeq: number;
  suggestions: Suggestion[];
  degraded: DegradationFlag[];
  computedInMs: number;
}

export interface BuildSuggestionsOptions {
  metaIsStale?: boolean;
  now?: () => number; // inyectable para pruebas de rendimiento determinísticas
}

// TSK-022 extendió SignalId a 5 valores (hero_pool_fit) pero SCORERS/RAW_RANGE/SCORING_WEIGHTS_V1
// siguen siendo el motor de 4 señales de fase 1 -- integrarlo de verdad (añadirlo aquí, crear
// SCORING_WEIGHTS_V2, el candado de regresión cero) es responsabilidad de TSK-023, no de este
// archivo todavía. `SignalIdV1` documenta esa frontera temporal en un solo lugar: mientras
// hero_pool_fit no esté en SCORERS, ninguna `SignalContribution` que pase por esta función es
// realmente esa quinta señal en runtime, aunque el tipo `SignalId` ya la permita.
type SignalIdV1 = Exclude<SignalId, "hero_pool_fit">;

const SCORERS: SignalScorer[] = [counterScorer, patchMetaScorer, teamSynergyScorer, roleGapScorer];
const TOP_N = 3;
const HARD_CUTOFF_MS = 500;

// Cada señal tiene una escala de `raw` distinta (deltas de winrate, fracciones 0-1, penalizaciones
// negativas) -- este rango define cómo se estira cada una a 0-100 antes de aplicar el peso. No hay
// un estándar único: son rangos razonables documentados aquí, no medidos.
const RAW_RANGE: Record<SignalIdV1, [number, number]> = {
  counter: [-0.3, 0.3],
  patch_meta: [0.3, 0.7],
  team_synergy: [0, 1],
  role_gap: [-1, 0],
};

function normalize(signal: SignalId, raw: number): number {
  const [min, max] = RAW_RANGE[signal as SignalIdV1];
  const clamped = Math.min(max, Math.max(min, raw));
  return ((clamped - min) / (max - min)) * 100;
}

function weightV1(signal: SignalId): number {
  return SCORING_WEIGHTS_V1[signal as SignalIdV1];
}

function safeScore(scorer: SignalScorer, state: DraftState, hero: HeroId, meta: MetaSnapshot): SignalContribution {
  try {
    return scorer.score(state, hero, meta);
  } catch {
    // Un scorer que lanza cuenta como raw: null para esa señal -- las otras 3 siguen (engine.md).
    return { signal: scorer.id, raw: null, weighted: 0, explanation: "La señal falló al calcularse", sampleSize: 0 };
  }
}

function mixScore(signals: SignalContribution[]): number {
  const withData = signals.filter((s) => s.raw !== null);
  if (withData.length === 0) return 50; // sin ninguna señal con dato: neutro, no 0 ni un extremo
  const totalWeight = withData.reduce((sum, s) => sum + weightV1(s.signal), 0);
  return withData.reduce((sum, s) => {
    const share = weightV1(s.signal) / totalWeight; // redistribución proporcional
    return sum + normalize(s.signal, s.raw as number) * share;
  }, 0);
}

function computeConfidence(signals: SignalContribution[], metaIsStale: boolean): Suggestion["confidence"] {
  const nullCount = signals.filter((s) => s.raw === null).length;
  if (nullCount >= 2) return "baja";
  if (nullCount === 1 || metaIsStale) return "media";
  return "alta";
}

function buildReason(signals: SignalContribution[]): string {
  const informative = signals
    .filter((s) => s.raw !== null)
    .sort((a, b) => weightV1(b.signal) - weightV1(a.signal))
    .slice(0, 2)
    .map((s) => s.explanation);
  if (informative.length > 0) return informative.join("; ");
  return signals[0]?.explanation ?? "Sin datos suficientes para explicar esta sugerencia";
}

function candidatePool(state: DraftState, meta: MetaSnapshot): HeroId[] {
  const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  return Object.keys(meta.heroes)
    .map(Number)
    .filter((hero) => !excluded.has(hero));
}

export function buildSuggestions(
  state: DraftState,
  meta: MetaSnapshot,
  options: BuildSuggestionsOptions = {},
): SuggestionSet {
  const now = options.now ?? Date.now;
  const start = now();
  const degraded: DegradationFlag[] = [];
  if (options.metaIsStale) degraded.push("stale_meta");
  if (state.quality.unconfirmed.length > 0) degraded.push("unconfirmed_state");
  if (state.format === "unknown") degraded.push("unknown_format");

  const candidates = candidatePool(state, meta);
  if (candidates.length === 0) {
    return {
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      suggestions: [],
      degraded,
      computedInMs: now() - start,
    };
  }

  const scored: { hero: HeroId; score: number; signals: SignalContribution[] }[] = [];
  for (const hero of candidates) {
    if (now() - start > HARD_CUTOFF_MS) {
      degraded.push("partial_signals");
      break;
    }
    const signals = SCORERS.map((scorer) => safeScore(scorer, state, hero, meta));
    scored.push({ hero, score: mixScore(signals), signals });
  }

  scored.sort((a, b) => b.score - a.score);
  const suggestions: Suggestion[] = scored.slice(0, TOP_N).map((entry, index) => ({
    hero: entry.hero,
    rank: (index + 1) as 1 | 2 | 3,
    score: entry.score,
    signals: entry.signals,
    reason: buildReason(entry.signals),
    confidence: computeConfidence(entry.signals, options.metaIsStale ?? false),
  }));

  return {
    schema: "suggestions/v1",
    sessionId: state.sessionId,
    basedOnSeq: state.lastSeq,
    suggestions,
    degraded,
    computedInMs: now() - start,
  };
}
