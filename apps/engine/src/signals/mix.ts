import type { DraftState, HeroId } from "../draft/reducer";
import { counterScorer } from "./counter";
import { heroPoolFitScorer } from "./hero-pool-fit";
import { patchMetaScorer } from "./patch-meta";
import { roleGapScorer } from "./role-gap";
import { roleSafetyScorer } from "./role-safety";
import { teamSynergyScorer } from "./team-synergy";
import type { MetaSnapshot, SignalContribution, SignalId, SignalScorer } from "./types";
import { SCORING_WEIGHTS_V3 } from "./weights";

export interface Suggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;
  signals: SignalContribution[]; // siempre las 6, incluidas las que dieron null o no aplican
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

// TSK-027: role_safety entra al pipeline real. SCORING_WEIGHTS_V1/V2 (weights.ts) quedan
// intactos y congelados -- SCORING_WEIGHTS_V3 es la única constante que usa este archivo de aquí
// en adelante.
const SCORERS: SignalScorer[] = [counterScorer, patchMetaScorer, teamSynergyScorer, roleGapScorer, heroPoolFitScorer, roleSafetyScorer];
const TOP_N = 3;
const HARD_CUTOFF_MS = 500;

// Cada señal tiene una escala de `raw` distinta (deltas de winrate, fracciones 0-1, penalizaciones
// negativas) -- este rango define cómo se estira cada una a 0-100 antes de aplicar el peso. No hay
// un estándar único: son rangos razonables documentados aquí, no medidos.
const RAW_RANGE: Record<SignalId, [number, number]> = {
  counter: [-0.3, 0.3],
  patch_meta: [0.3, 0.7],
  team_synergy: [0, 1],
  role_gap: [-1, 0],
  hero_pool_fit: [0, 1],
  role_safety: [0, 1],
};

function normalize(signal: SignalId, raw: number): number {
  const [min, max] = RAW_RANGE[signal];
  const clamped = Math.min(max, Math.max(min, raw));
  return ((clamped - min) / (max - min)) * 100;
}

function safeScore(scorer: SignalScorer, state: DraftState, hero: HeroId, meta: MetaSnapshot): SignalContribution {
  try {
    return scorer.score(state, hero, meta);
  } catch {
    // Un scorer que lanza cuenta como raw: null para esa señal -- las otras 3 siguen (engine.md).
    return { signal: scorer.id, raw: null, weighted: 0, explanation: "La señal falló al calcularse", sampleSize: 0 };
  }
}

// TSK-023 (SPEC.md §9.3): `applicable: false` ("esta señal no aplica a este usuario ahora mismo",
// hoy solo hero_pool_fit sin pool configurado) se excluye del cálculo exactamente igual que
// `raw: null` ("hay hueco de datos") -- ninguna de las dos vota. La distinción vive en
// computeConfidence, no aquí: una señal no aplicable no debe bajar la confianza de nadie.
function hasVote(signal: SignalContribution): boolean {
  return signal.raw !== null && signal.applicable !== false;
}

// Exportado para el candado de regresión cero (mix.test.ts, TSK-023 §9.3): probarlo directamente
// con SignalContribution[] fijos es más preciso que reconstruirlo indirectamente vía
// buildSuggestions, que exigiría fixtures de los 4 scorers reales solo para fijar sus `raw`.
export function mixScore(signals: SignalContribution[]): number {
  const withData = signals.filter(hasVote);
  if (withData.length === 0) return 50; // sin ninguna señal con dato: neutro, no 0 ni un extremo
  const totalWeight = withData.reduce((sum, s) => sum + SCORING_WEIGHTS_V3[s.signal], 0);
  return withData.reduce((sum, s) => {
    const share = SCORING_WEIGHTS_V3[s.signal] / totalWeight; // redistribución proporcional
    return sum + normalize(s.signal, s.raw as number) * share;
  }, 0);
}

// Candado de regresión cero, doble (§9.3, TSK-027): con hero_pool_fit no aplicable Y role_safety
// fuera de ventana (raw:null), totalWeight en mixScore es 0.288+0.18+0.144+0.108=0.72 -- cada
// share individual (ej. 0.288/0.72) reproduce exactamente los pesos de V1 (0.40/0.25/0.20/0.15).
// Verificado con números exactos en mix.test.ts, no a ojo.
function computeConfidence(signals: SignalContribution[], metaIsStale: boolean): Suggestion["confidence"] {
  // Una señal no aplicable no cuenta como null para la confianza -- "no configuraste la función"
  // no es lo mismo que "hay un hueco de datos" (D10). Sin esto, todo usuario sin pool vería su
  // confianza bajar de "alta" a "media" para siempre, por una función que no está usando.
  const applicableSignals = signals.filter((s) => s.applicable !== false);
  const nullCount = applicableSignals.filter((s) => s.raw === null).length;
  if (nullCount >= 2) return "baja";
  if (nullCount === 1 || metaIsStale) return "media";
  return "alta";
}

function buildReason(signals: SignalContribution[]): string {
  const informative = signals
    .filter(hasVote)
    .sort((a, b) => SCORING_WEIGHTS_V3[b.signal] - SCORING_WEIGHTS_V3[a.signal])
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
