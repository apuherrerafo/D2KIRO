import type { DraftState, HeroId } from "../draft/reducer";
import { counterScorer } from "./counter";
import { heroPoolFitScorer } from "./hero-pool-fit";
import { loadHeroPositions, type HeroPositions } from "./hero-positions";
import { patchMetaScorer } from "./patch-meta";
import { createPositionFitScorer } from "./position-fit";
import { teamSynergyScorer } from "./team-synergy";
import type { MetaSnapshot, SignalContribution, SignalId, SignalScorer } from "./types";
import { SCORING_WEIGHTS_V5 } from "./weights";

export interface Suggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;
  signals: SignalContribution[]; // siempre las 5, incluidas las que dieron null o no aplican
  reason: string;
  confidence: "alta" | "media" | "baja";
}

export type DegradationFlag = "stale_meta" | "partial_signals" | "unconfirmed_state" | "unknown_format";

// TSK-032: comparación explícita entre el pick #1 y el #2 -- "por qué le gana a la otra opción",
// no solo la explicación independiente de cada sugerencia (`reason`). `signal` es la señal que
// más favorece al #1 sobre `vsHero` (el #2), entre las comparables en ambos lados.
export interface SuggestionComparison {
  vsHero: HeroId;
  signal: SignalId;
  delta: number;
}

export interface SuggestionSet {
  schema: "suggestions/v1";
  sessionId: string;
  basedOnSeq: number;
  suggestions: Suggestion[];
  comparison: SuggestionComparison | null;
  degraded: DegradationFlag[];
  computedInMs: number;
}

export interface BuildSuggestionsOptions {
  metaIsStale?: boolean;
  now?: () => number; // inyectable para pruebas de rendimiento determinísticas
  // TSK-045 (Fase 3, SPEC.md §10.2, costura S10): ausente -> carga hero-positions.json real
  // (loadHeroPositions()). Las pruebas inyectan su propio fixture -- nunca dependen del archivo
  // real, que se regenera por parche.
  heroPositions?: HeroPositions;
}

// TSK-045 (Fase 3): role_gap y role_safety se fusionan en position_fit. Las 4 señales que no
// necesitan configuración por llamada siguen siendo instancias únicas a nivel de módulo;
// position_fit se construye por llamada dentro de buildSuggestions() porque depende del dato
// inyectable de heroPositions (no puede ser un singleton de módulo, a diferencia del resto).
// SCORING_WEIGHTS_V1/V2/V3/V4 (weights.ts) quedan intactas y congeladas -- SCORING_WEIGHTS_V5 es
// la única constante que usa este archivo de aquí en adelante (auditoría 2026-08-22).
const STATIC_SCORERS: SignalScorer[] = [counterScorer, patchMetaScorer, teamSynergyScorer, heroPoolFitScorer];

// Loaded once at module initialisation — hero-positions.json is never re-parsed per call.
// Test seam S10: BuildSuggestionsOptions.heroPositions overrides this constant.
const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
const TOP_N = 3;
const HARD_CUTOFF_MS = 500;

// Cada señal tiene una escala de `raw` distinta (deltas de winrate, fracciones 0-1, penalizaciones
// negativas) -- este rango define cómo se estira cada una a 0-100 antes de aplicar el peso. No hay
// un estándar único: son rangos razonables documentados aquí, no medidos contra datos reales
// sincronizados (pendiente: script offline de percentiles p5/p95 sobre heroMatchups/patchStats).
//
// `counter` recalibrado (auditoría 2026-08-22): el rango anterior [-0.3, 0.3] asumía deltas de
// matchup que en la práctica casi no ocurren -- un hard counter real con muestra de 200+ partidas
// rara vez supera ±0.10/±0.12. Con el rango viejo, un delta real de 0.08 normalizaba a solo ~63,
// dejando que `patch_meta` (peso menor, 0.17 contra 0.27 de counter) le ganara por tener su propio
// rango mejor calibrado a la varianza real de winrate. [-0.12, 0.12] es una estimación de dominio
// más ajustada, todavía no medida -- candado de regresión en mix.test.ts.
const RAW_RANGE: Record<SignalId, [number, number]> = {
  counter: [-0.12, 0.12],
  patch_meta: [0.3, 0.7],
  team_synergy: [0, 1],
  hero_pool_fit: [0, 1],
  position_fit: [0, 1],
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

// TSK-032: mismo cálculo que ya hacía mixScore por dentro, extraído para reutilizarlo en
// buildComparison sin duplicar la redistribución proporcional. Solo incluye señales con voto real
// (hasVote) -- una señal en `raw: null` o `applicable: false` nunca aparece en el resultado, ni
// con valor 0 (0 sería indistinguible de "sin ventaja", cuando en realidad es "sin dato").
function weightedContributions(signals: SignalContribution[]): Partial<Record<SignalId, number>> {
  const withData = signals.filter(hasVote);
  const totalWeight = withData.reduce((sum, s) => sum + SCORING_WEIGHTS_V5[s.signal], 0);
  const result: Partial<Record<SignalId, number>> = {};
  for (const s of withData) {
    const share = SCORING_WEIGHTS_V5[s.signal] / totalWeight; // redistribución proporcional
    result[s.signal] = normalize(s.signal, s.raw as number) * share;
  }
  return result;
}

// Exportado para el candado de regresión cero (mix.test.ts, TSK-023 §9.3): probarlo directamente
// con SignalContribution[] fijos es más preciso que reconstruirlo indirectamente vía
// buildSuggestions, que exigiría fixtures de los 4 scorers reales solo para fijar sus `raw`.
export function mixScore(signals: SignalContribution[]): number {
  const contributions = weightedContributions(signals);
  const values = Object.values(contributions) as number[];
  if (values.length === 0) return 50; // sin ninguna señal con dato: neutro, no 0 ni un extremo
  return values.reduce((sum, v) => sum + v, 0);
}

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
    .sort((a, b) => SCORING_WEIGHTS_V5[b.signal] - SCORING_WEIGHTS_V5[a.signal])
    .slice(0, 2)
    .map((s) => s.explanation);
  if (informative.length > 0) return informative.join("; ");
  return signals[0]?.explanation ?? "Sin datos suficientes para explicar esta sugerencia";
}

// Solo señales con voto real en AMBOS candidatos son comparables -- comparar contra un `raw:
// null` o `applicable: false` de cualquiera de los dos lados no sería una comparación real, sería
// inventar una ventaja donde en realidad hay un hueco de datos o una función no configurada.
function bestFavoringSignal(top: SignalContribution[], second: SignalContribution[]): { signal: SignalId; delta: number } | null {
  const topWeighted = weightedContributions(top);
  const secondWeighted = weightedContributions(second);
  let best: { signal: SignalId; delta: number } | null = null;
  for (const [signal, topValue] of Object.entries(topWeighted) as [SignalId, number][]) {
    const secondValue = secondWeighted[signal];
    if (secondValue === undefined) continue;
    const delta = topValue - secondValue;
    if (best === null || delta > best.delta) best = { signal, delta };
  }
  return best;
}

// TSK-032: `null` cuando ninguna señal comparable favorece al #1 -- dos casos reales, no uno: (a)
// empate exacto en todas las señales comparables, o (b) la ventaja real del #1 vive en una señal
// que el #2 no tiene (`applicable:false`/`raw:null` de ese lado), así que no es comparable -- en
// ese caso null es la respuesta honesta, nunca se le atribuye el mérito a una señal comparable
// que en realidad no fue la razón. Menos de 2 sugerencias -> null.
export function buildComparison(suggestions: Suggestion[]): SuggestionComparison | null {
  const top = suggestions.find((s) => s.rank === 1);
  const second = suggestions.find((s) => s.rank === 2);
  if (!top || !second) return null;
  const best = bestFavoringSignal(top.signals, second.signals);
  if (!best || best.delta <= 0) return null;
  return { vsHero: second.hero, signal: best.signal, delta: best.delta };
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

  // position_fit no puede ser un singleton de módulo como el resto -- depende del dato inyectable
  // de heroPositions, así que se construye una vez por llamada (costura S10).
  const heroPositions = options.heroPositions ?? MODULE_HERO_POSITIONS;
  const scorers: SignalScorer[] = [...STATIC_SCORERS, createPositionFitScorer(heroPositions)];

  const candidates = candidatePool(state, meta);
  if (candidates.length === 0) {
    return {
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      suggestions: [],
      comparison: null,
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
    const signals = scorers.map((scorer) => safeScore(scorer, state, hero, meta));
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
    comparison: buildComparison(suggestions),
    degraded,
    computedInMs: now() - start,
  };
}
