import type { DraftState, HeroId } from "../draft/reducer";
import { loadHeroCapabilities } from "../draft-paths/capabilities";
import { openingStrategy } from "../draft-paths/strategy";
import type { DraftPathArchetype, HeroCapabilities } from "../draft-paths/types";
import { createArchetypeFitScorer } from "./archetype-fit";
import { createCounterScorer } from "./counter";
import { loadHeroCounters, type CuratedCounter } from "./hero-counters";
import { heroPoolFitScorer } from "./hero-pool-fit";
import { loadHeroPositions, type HeroPositions } from "./hero-positions";
import { patchMetaScorer } from "./patch-meta";
import { createPositionFitScorer } from "./position-fit";
import { createTeamSynergyScorer } from "./team-synergy";
import { recommendTeamOpeners } from "../drafter/team-opener";
import { deriveDecisionPolicy, type DraftDecisionContext, type DraftDecisionPolicy } from "../drafter/decision-context";
import { observedDraftFacts } from "../drafter/observed-draft";
import {
  calibratedNormalize,
  enrich,
  EMPTY_CALIBRATION,
  FALLBACK_RAW_RANGE,
  type Calibration,
} from "./calibration";
import type { MetaSnapshot, SignalContribution, SignalId, SignalScorer } from "./types";
import { SCORING_WEIGHTS_V6 } from "./weights";

export interface Suggestion {
  hero: HeroId;
  rank: 1 | 2 | 3 | 4 | 5 | 6;
  score: number;
  signals: SignalContribution[]; // siempre las 6, incluidas las que dieron null o no aplican
  reason: string;
  confidence: "alta" | "media" | "baja";
  // TSK-210 (Fase 9.1, SPEC.md §16.8): fracción del peso redistribuido de `A(S)` que este
  // candidato respalda con dato real (`raw !== null`). `guessingIndex = 1 − evidenceCoverage`.
  // No se renderiza en apps/web en 9.1 (D4) -- lo consumen los reportes de `bun run eval`.
  evidenceCoverage: number;
  guessingIndex: number;
  evidence?: SuggestionEvidence[];
}

export interface SuggestionEvidence {
  kind: "opening" | "counter" | "synergy" | "flex" | "risk";
  text: string;
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
  decisionContext: DraftDecisionContext;
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
  // TSK-069 (Fase 2 de la auditoría de inteligencia del motor, misma costura S9 que ya usa
  // draft-paths): ausente -> carga draft-paths/capabilities.json real (loadHeroCapabilities()).
  // Las pruebas inyectan su propio fixture -- nunca dependen del archivo real.
  heroCapabilities?: HeroCapabilities[];
  // TSK-186 (Fase 8, SPEC.md §14.5, familia S9): ausente -> carga signals/hero-counters.json real
  // (loadHeroCounters()). Las pruebas inyectan su propio Map -- nunca dependen del archivo real,
  // que se cura por parche.
  heroCounters?: Map<HeroId, CuratedCounter[]>;
  targetPosition?: 1 | 2 | 3 | 4 | 5;
  usePersonalPool?: boolean;
  // El simulador abre una composición completa bajo el control del capitán. No tiene sentido
  // aplicar todavía el rol personal ni el pool de una sola persona; esos filtros siguen siendo
  // válidos para la vista de draft individual fuera de esta política.
  teamOpening?: boolean;
  // Solo para el simulador: rota alternativas dentro de una banda de calidad equivalente. La
  // misma semilla y el mismo estado producen el mismo orden; un draft nuevo explora otra terna.
  diversitySeed?: string;
  // TSK-180 (Fase 4.2, SPEC.md §11.13): intención de draft para la señal archetype_fit. Ausente ->
  // el scorer recibe intent === undefined -> applicable: false (nunca vota, nunca baja la
  // confianza). En 4.2 lo fija sólo el llamador dentro del proceso; el transporte por request/WS y
  // su validación de borde contra la unión cerrada de 4 literales son 4.3.
  archetypeIntent?: DraftPathArchetype;
  // TSK-210 (Fase 9.1, SPEC.md §16.7 punto 10): calibración empírica inyectable. TSK-213: el
  // default es EMPTY_CALIBRATION (fallback a RAW_RANGE) -- el QA midió que los percentiles restan
  // NDCG@5. Para activarla, pasar `MODULE_CALIBRATION` (o una Calibration propia). Las pruebas
  // inyectan la suya -- nunca dependen del archivo real (costura S18).
  calibration?: Calibration;
  // TSK-210: modo legacy SÓLO para el candado de regresión cero (§16.7 E7 / mix.test.ts). Con él,
  // buildSuggestions vuelve a la redistribución candidate-specific de V6 (mixScore + normalize
  // sobre RAW_RANGE + computeConfidence por conteo de nulls), byte a byte. No lo usa producción.
  _legacyMixMode?: boolean;
}

// TSK-045 (Fase 3): role_gap y role_safety se fusionan en position_fit. TSK-069: team_synergy
// deja de ser un singleton de módulo -- ahora depende de heroCapabilities inyectable, mismo
// motivo que ya sacó a position_fit de STATIC_SCORERS. Las 3 señales que no necesitan
// configuración por llamada siguen siendo instancias únicas a nivel de módulo; position_fit y
// team_synergy se construyen por llamada dentro de buildSuggestions().
// SCORING_WEIGHTS_V1..V5 (weights.ts) quedan intactas y congeladas -- SCORING_WEIGHTS_V6
// (TSK-180, Fase 4.2) es la única constante que usa este archivo de aquí en adelante.
// TSK-186 (Fase 8): counter deja STATIC_SCORERS -- ahora depende de la capa curada inyectable
// (heroCounters), igual que position_fit/team_synergy/archetype_fit dependen de sus datos.
const STATIC_SCORERS: SignalScorer[] = [patchMetaScorer, heroPoolFitScorer];

// Loaded once at module initialisation — ninguno de los archivos se re-parsea por llamada.
// Costura S10/S9: BuildSuggestionsOptions.heroPositions/heroCapabilities/heroCounters sobrescriben
// estas constantes en las pruebas.
const MODULE_HERO_POSITIONS: HeroPositions = loadHeroPositions();
const MODULE_HERO_CAPABILITIES: HeroCapabilities[] = loadHeroCapabilities();
const MODULE_HERO_COUNTERS: Map<HeroId, CuratedCounter[]> = loadHeroCounters();
const TOP_N = 6;
const HARD_CUTOFF_MS = 500;

// TSK-210 (Fase 9.1): `RAW_RANGE` se movió a `calibration.ts` como `FALLBACK_RAW_RANGE` -- mismos
// valores exactos, ahora es el fallback dentro de `calibratedNormalize` cuando `percentiles.json`
// no calibra una señal. `RAW_RANGE` no se borra (SPEC §16.7-8): sigue vivo bajo este alias, con
// una sola definición. La calibración empírica (ADR-004) reemplaza el estiramiento lineal sobre
// estos rangos adivinados por uno sobre percentiles p05/p95 medidos en drafts profesionales.
//
// `counter` histórico (auditoría 2026-08-22): [-0.3, 0.3] -> [-0.12, 0.12] al confirmar que un
// hard counter real con 200+ partidas rara vez supera ±0.12. La calibración de 9.1 midió el rango
// real todavía más angosto (~[-0.041, 0.057]).
const RAW_RANGE = FALLBACK_RAW_RANGE;

// Normalización legacy de V6: estiramiento lineal sobre `RAW_RANGE`, sin calibración empírica.
// La usa `mixScore` (candado de regresión cero, §16.7 E7). El camino activo de `buildSuggestions`
// usa `calibratedNormalize` (abajo), salvo `_legacyMixMode`.
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
  const totalWeight = withData.reduce((sum, s) => sum + SCORING_WEIGHTS_V6[s.signal], 0);
  const result: Partial<Record<SignalId, number>> = {};
  for (const s of withData) {
    const share = SCORING_WEIGHTS_V6[s.signal] / totalWeight; // redistribución proporcional
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

// Legacy (V6): confianza por conteo de nulls entre señales aplicables. Sólo se usa con
// `_legacyMixMode` (candado de regresión cero). El camino activo usa
// `confidenceFromCoverage` (abajo, §16.7 punto 7).
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

// ---------- TSK-210 (Fase 9.1, SPEC.md §16.7): mezcla por estado ----------

// `A(S)` -- señales estructuralmente aplicables al estado `S`, IGUAL para todos los candidatos
// (§16.7 punto 1). El peso de una señal fuera de `A(S)` se saca del denominador de la
// redistribución; no vota con `μ` ni con 0 "que cuenta" -- simplemente no participa.
function availableSignals(
  state: DraftState,
  meta: MetaSnapshot,
  options: BuildSuggestionsOptions,
  calibration: Calibration,
): Set<SignalId> {
  const available = new Set<SignalId>();
  const facts = observedDraftFacts(state);

  if (state.localSide !== "unknown") available.add("position_fit");

  const curated = options.heroCounters ?? MODULE_HERO_COUNTERS;
  const curatedHitsABan =
    state.banned.length > 0 &&
    [...curated.values()].some((entries) => entries.some((entry) => state.banned.includes(entry.vs)));
  if (facts.revealedEnemyPicks.length > 0 || curatedHitsABan) available.add("counter");

  if (facts.ownPicks.length > 0) available.add("team_synergy");

  // proxy de "hay datos de parche": la señal está calibrada. En modo legacy (sin calibración
  // cargada) cae a "su raw no es null para algún candidato" -- se resuelve fuera, en el llamador.
  if (calibration.signals.patch_meta) available.add("patch_meta");

  if ((meta.heroPool?.length ?? 0) > 0) available.add("hero_pool_fit");

  if (options.archetypeIntent !== undefined) available.add("archetype_fit");

  return available;
}

function confidenceFromCoverage(evidenceCoverage: number, metaIsStale: boolean): Suggestion["confidence"] {
  if (evidenceCoverage >= 0.75 && !metaIsStale) return "alta";
  if (evidenceCoverage >= 0.5 || metaIsStale) return "media";
  return "baja";
}

interface StateMixResult {
  score: number;
  signals: SignalContribution[];
  evidenceCoverage: number;
  guessingIndex: number;
}

// §16.7 puntos 2-6. `enriched` ya trae `normalized`/`evidenceConfidence` (vía `enrich()`). Una
// pasada previa junta `μᵢ(S)` (media de `normalizedᵢ` sobre los candidatos con dato); este mezcla
// un candidato contra ese `μ` fijo del estado.
function mixByState(
  enriched: SignalContribution[],
  available: Set<SignalId>,
  wPrime: Partial<Record<SignalId, number>>,
  stateMean: Partial<Record<SignalId, number>>,
): StateMixResult {
  let score = 0;
  let evidenceCoverage = 0;
  for (const contribution of enriched) {
    let weighted = 0;
    if (available.has(contribution.signal)) {
      const w = wPrime[contribution.signal] ?? 0;
      if (contribution.raw !== null && contribution.normalized != null) {
        weighted = w * contribution.normalized;
        evidenceCoverage += w;
      } else {
        // `raw: null` en una señal de `A(S)` -> el candidato "adivina" con la media del estado.
        // `μ` nunca se escribe en `raw` (sigue null en el desglose) -- sólo alimenta `weighted`.
        weighted = w * (stateMean[contribution.signal] ?? 50);
      }
    }
    contribution.weighted = weighted;
    score += weighted;
  }
  return { score, signals: enriched, evidenceCoverage, guessingIndex: 1 - evidenceCoverage };
}

// El único neutro del pipeline (§16.7 punto 3): si una señal está en `A(S)` pero NINGÚN candidato
// del estado tiene `raw` para ella, su `μ` es 50. Nunca se escribe en `raw`.
function stateMeansFor(
  scored: { signals: SignalContribution[] }[],
  available: Set<SignalId>,
): Partial<Record<SignalId, number>> {
  const means: Partial<Record<SignalId, number>> = {};
  for (const signal of available) {
    const values: number[] = [];
    for (const { signals } of scored) {
      const contribution = signals.find((c) => c.signal === signal);
      if (contribution && contribution.raw !== null && contribution.normalized != null) {
        values.push(contribution.normalized);
      }
    }
    means[signal] = values.length > 0 ? values.reduce((a, b) => a + b, 0) / values.length : 50;
  }
  return means;
}

// Coverage legacy (para `_legacyMixMode`): fracción de peso de V6 que las señales con voto real
// aportan. No es `A(S)` -- es el conjunto candidate-specific de siempre.
function legacyCoverage(signals: SignalContribution[]): number {
  return signals.filter(hasVote).reduce((sum, s) => sum + SCORING_WEIGHTS_V6[s.signal], 0);
}

// TSK-069 (fase 3 de la auditoría de inteligencia): antes unía las 2 explicaciones con "; ",
// leyéndose como una sola oración cortada a la mitad. Cerrar cada una en punto y unirlas con
// espacio las deja como 2 oraciones completas -- sin tocar el contenido de cada `explanation`
// (solo se le agrega un punto final si no lo tiene), así que `reason` sigue conteniendo el string
// exacto de cada señal (candado de mix.test.ts, "Suggestion.reason es trazable a los signals").
function asSentence(explanation: string): string {
  if (explanation.length === 0 || explanation.endsWith(".")) return explanation;
  return `${explanation}.`;
}

const POSITION_LABELS = {
  1: "carry",
  2: "midlane",
  3: "offlane",
  4: "support",
  5: "hard support",
} as const;

function joinSpanish(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  if (items.length === 2) return `${items[0]} y ${items[1]}`;
  return `${items.slice(0, -1).join(", ")} y ${items.at(-1)}`;
}

// El position_fit explica la necesidad global del equipo; no sabe que el usuario eligió un rol
// para practicar. Este prefijo completa ese contexto sin alterar la señal ni inventar un flex:
// solo nombra posiciones presentes en el catálogo curado de 200+ partidas.
function targetPositionReason(hero: HeroId, options: BuildSuggestionsOptions): string | null {
  if (options.targetPosition === undefined) return null;
  const shares = (options.heroPositions ?? MODULE_HERO_POSITIONS)[hero] ?? [];
  const flexPositions = shares
    .filter((share) => share.position !== options.targetPosition)
    .sort((a, b) => b.matches - a.matches)
    .map((share) => POSITION_LABELS[share.position]);
  const target = POSITION_LABELS[options.targetPosition];
  if (flexPositions.length === 0) return `Encaja en tu posición elegida: ${target}.`;
  return `Encaja en tu posición elegida: ${target}. También puede flexearse a ${joinSpanish(flexPositions)}.`;
}

// Sin un rol individual impuesto (caso del capitán en el simulador), la flexibilidad sigue siendo
// información útil, pero solo si el catálogo curado registra al héroe en dos o más posiciones.
// No inferimos posiciones desde las etiquetas ruidosas de OpenDota ni llamamos "flex" a un héroe
// de una sola posición.
function flexibilityReason(hero: HeroId, positions: HeroPositions): string | null {
  const shares = positions[hero] ?? [];
  if (shares.length < 2) return null;
  const labels = shares
    .slice()
    .sort((left, right) => right.matches - left.matches)
    .map((share) => POSITION_LABELS[share.position]);
  return `Puede flexearse entre ${joinSpanish(labels)} y mantiene abierta la composición.`;
}

function buildEvidence(
  signals: SignalContribution[],
  flexReason: string | null,
  policy: DraftDecisionPolicy,
  openingReason: string | null,
): SuggestionEvidence[] {
  const evidence: SuggestionEvidence[] = [];
  const counter = signals.find((signal) => signal.signal === "counter");
  const synergy = signals.find((signal) => signal.signal === "team_synergy");
  if (openingReason !== null) evidence.push({ kind: "opening", text: openingReason });
  if (policy.usesRevealedCounterEvidence && counter?.raw !== null && counter?.raw !== undefined && counter.raw > 0) {
    evidence.push({ kind: "counter", text: counter.explanation });
  }
  if (synergy?.raw !== null && synergy?.raw !== undefined && synergy.raw > 0) {
    evidence.push({ kind: "synergy", text: synergy.explanation });
  }
  if (flexReason !== null) evidence.push({ kind: "flex", text: flexReason });
  if (policy.usesRevealedCounterEvidence && (counter?.raw === null || counter?.raw === undefined || counter.raw <= 0)) {
    evidence.push({ kind: "risk", text: "No hay una ventaja de contrapick verificable contra los rivales revelados; evita tratar esta respuesta como segura." });
  }
  if (policy.closesComposition && (synergy?.raw === null || synergy?.raw === undefined || synergy.raw <= 0)) {
    evidence.push({ kind: "risk", text: "No hay evidencia suficiente de que complete una necesidad táctica pendiente del equipo." });
  }
  return evidence;
}

function buildReason(signals: SignalContribution[], positionReason: string | null): string {
  const informative = signals
    .filter(hasVote)
    .sort((a, b) => SCORING_WEIGHTS_V6[b.signal] - SCORING_WEIGHTS_V6[a.signal])
    .slice(0, 2)
    .map((s) => s.explanation);
  const signalReason = informative.length > 0 ? informative.map(asSentence).join(" ") : signals[0]?.explanation ?? "Sin datos suficientes para explicar esta sugerencia";
  if (positionReason === null) return signalReason;
  return `${positionReason} ${signalReason}`;
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

function candidatePool(state: DraftState, meta: MetaSnapshot, options: BuildSuggestionsOptions): HeroId[] {
  const excluded = new Set([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  let candidates = Object.keys(meta.heroes)
    .map(Number)
    .filter((hero) => !excluded.has(hero));
  if (options.teamOpening || options.targetPosition === undefined) return candidates;

  const positions = options.heroPositions ?? MODULE_HERO_POSITIONS;
  candidates = candidates.filter((hero) => positions[hero]?.some((share) => share.position === options.targetPosition));
  if (!options.usePersonalPool) return candidates;

  const personalPool = new Set(meta.heroPool?.map((entry) => entry.hero) ?? []);
  const poolCandidates = candidates.filter((hero) => personalPool.has(hero));
  return poolCandidates.length > 0 ? poolCandidates : candidates;
}

function stableSeedOffset(seed: string, length: number): number {
  let hash = 0;
  for (const character of seed) hash = (hash * 31 + character.charCodeAt(0)) >>> 0;
  return hash % length;
}

// La apertura no debe proponer el mismo trío por el simple desempate de ID. Solo se rota una
// frontera de calidad equivalente (máximo 3 puntos del mejor score); un candidato claramente
// superior conserva su prioridad y el resultado nunca cambia al re-renderizar la misma partida.
function diversifyEquivalentCandidates<T extends { hero: HeroId; score: number }>(
  scored: T[],
  diversitySeed: string | undefined,
): T[] {
  if (diversitySeed === undefined || scored.length <= TOP_N) return scored;
  const frontier = scored.filter((entry) => scored[0]!.score - entry.score <= 3);
  if (frontier.length <= TOP_N) return scored;
  const offset = stableSeedOffset(diversitySeed, frontier.length);
  const rotated = [...frontier.slice(offset), ...frontier.slice(0, offset)];
  const frontierHeroes = new Set(frontier.map((entry) => entry.hero));
  return [...rotated, ...scored.filter((entry) => !frontierHeroes.has(entry.hero))];
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

  // position_fit y team_synergy no pueden ser singletons de módulo como el resto -- dependen de
  // datos inyectables (heroPositions/heroCapabilities), así que se construyen una vez por llamada
  // (costura S10/S9).
  const heroPositions = options.heroPositions ?? MODULE_HERO_POSITIONS;
  const heroCapabilities = options.heroCapabilities ?? MODULE_HERO_CAPABILITIES;
  // Al abrir un draft de equipo no existe todavía un "héroe del usuario". Excluir la señal de
  // hero pool evita que la comodidad de una sola cuenta decida la composición que el capitán está
  // armando para cinco jugadores; no es un cambio de peso sino una restricción de contexto.
  const baseScorers = options.teamOpening ? STATIC_SCORERS.filter((scorer) => scorer.id !== "hero_pool_fit") : STATIC_SCORERS;
  // position_fit, team_synergy y archetype_fit no pueden ser singletons de módulo: dependen de
  // datos inyectables (heroPositions/heroCapabilities/archetypeIntent). Se construyen por llamada.
  const scorers: SignalScorer[] = [
    ...baseScorers,
    createCounterScorer(options.heroCounters ?? MODULE_HERO_COUNTERS),
    createPositionFitScorer(heroPositions),
    createTeamSynergyScorer(heroCapabilities),
    createArchetypeFitScorer(heroCapabilities, options.archetypeIntent),
  ];
  const isTeamOpening = options.teamOpening === true && state.picks.radiant.length === 0 && state.picks.dire.length === 0;
  const decisionPolicy = deriveDecisionPolicy(state, isTeamOpening);

  const candidates = candidatePool(state, meta, options);
  if (candidates.length === 0) {
    return {
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: decisionPolicy.context,
      suggestions: [],
      comparison: null,
      degraded,
      computedInMs: now() - start,
    };
  }

  const legacyMix = options._legacyMixMode === true;
  // TSK-213 (Fase 9.1-D.1): el default es SIN calibración empírica -> `calibratedNormalize` cae a
  // `RAW_RANGE`. El QA de 9.1 (TSK-212) midió que los percentiles de `percentiles.json` restan
  // NDCG@5 (0.736 con per-state solo -> 0.566 con calibración). La mezcla por estado se queda; la
  // calibración empírica es opt-in vía `options.calibration` (p. ej. `MODULE_CALIBRATION`) hasta
  // que 9.3 la rehaga con percentiles por contexto.
  const calibration = options.calibration ?? EMPTY_CALIBRATION;

  // Pasada 1: cada scorer una sola vez por candidato. En el camino activo, `enrich()` agrega
  // `normalized` (calibrado) y `evidenceConfidence` sin tocar `raw`. En legacy se salta -- el
  // candado de regresión cero exige el `SignalContribution` crudo de V6.
  const raw: { hero: HeroId; signals: SignalContribution[] }[] = [];
  for (const hero of candidates) {
    if (now() - start > HARD_CUTOFF_MS) {
      degraded.push("partial_signals");
      break;
    }
    const bare = scorers.map((scorer) => safeScore(scorer, state, hero, meta));
    // `bracket`: un DraftState no lleva bracket -> siempre `global` (SPEC §16.7 punto 8).
    const signals = legacyMix ? bare : bare.map((c) => enrich(c, null, calibration));
    raw.push({ hero, signals });
  }

  type Scored = { hero: HeroId; score: number; signals: SignalContribution[]; evidenceCoverage: number; guessingIndex: number };
  let scored: Scored[];
  if (legacyMix) {
    scored = raw.map(({ hero, signals }) => {
      const coverage = legacyCoverage(signals);
      return { hero, signals, score: mixScore(signals), evidenceCoverage: coverage, guessingIndex: 1 - coverage };
    });
  } else {
    // `A(S)` y el denominador de la redistribución: una vez por estado, igual para todo candidato.
    const available = availableSignals(state, meta, options, calibration);
    const denom = [...available].reduce((sum, id) => sum + SCORING_WEIGHTS_V6[id], 0);
    const wPrime: Partial<Record<SignalId, number>> = {};
    for (const id of available) wPrime[id] = denom > 0 ? SCORING_WEIGHTS_V6[id] / denom : 0;
    const stateMean = stateMeansFor(raw, available);
    scored = raw.map(({ hero, signals }) => ({ hero, ...mixByState(signals, available, wPrime, stateMean) }));
  }

  scored.sort((a, b) => b.score - a.score);
  const teamOpening = isTeamOpening
    ? recommendTeamOpeners({
        candidates: scored.map((entry) => ({
          hero: entry.hero,
          baseScore: entry.score / 100,
          strategy: openingStrategy(entry.hero, heroCapabilities),
          matchups: meta.matchups[entry.hero] ?? [],
          // TSK-191: la capa curada de counter-picks alimenta el alivio por bans de la apertura,
          // no sólo los matchups estadísticos ≥200 partidas.
          curatedCounters: (options.heroCounters ?? MODULE_HERO_COUNTERS).get(entry.hero)?.map((c) => ({ vs: c.vs, level: c.level })) ?? [],
        })),
        banned: state.banned,
        heroNames: Object.fromEntries(Object.values(meta.heroes).map((entry) => [entry.id, entry.localizedName])),
        limit: TOP_N,
      })
    : null;
  const scoreByHero = new Map(scored.map((entry) => [entry.hero, entry]));
  const ranked = teamOpening
    ? teamOpening.map((option) => ({ ...scoreByHero.get(option.hero)!, score: option.score * 100, openingReason: option.summary }))
    : diversifyEquivalentCandidates(scored, options.diversitySeed).map((entry) => ({ ...entry, openingReason: null }));
  // TSK-192: 6 recomendaciones en apertura y en picks normales (el Copilot del Simulador las
  // muestra en grid 2×3).
  const limit = TOP_N;
  const suggestions: Suggestion[] = ranked.slice(0, limit).map((entry, index) => {
    const roleReason = targetPositionReason(entry.hero, options.teamOpening ? {} : options) ?? flexibilityReason(entry.hero, heroPositions);
    return {
    hero: entry.hero,
    rank: (index + 1) as Suggestion["rank"],
    score: entry.score,
    signals: entry.signals,
    // decisionPolicy.headline NO se repite acá -- ya lo comunica `decisionContext` (arriba, una
    // sola vez por SuggestionSet). Repetirlo en cada `reason` clonaba el mismo encabezado en las
    // 5 tarjetas de la ronda, el hallazgo real de producto que originó TSK-124.
    reason: [
      entry.openingReason,
      buildReason(
        entry.signals,
        roleReason,
      ),
    ]
      .filter(Boolean)
      .join(" "),
    confidence: legacyMix
      ? computeConfidence(entry.signals, options.metaIsStale ?? false)
      : confidenceFromCoverage(entry.evidenceCoverage, options.metaIsStale ?? false),
    evidenceCoverage: entry.evidenceCoverage,
    guessingIndex: entry.guessingIndex,
    evidence: buildEvidence(entry.signals, roleReason, decisionPolicy, entry.openingReason),
  };
  });

  return {
    schema: "suggestions/v1",
    sessionId: state.sessionId,
    basedOnSeq: state.lastSeq,
    decisionContext: decisionPolicy.context,
    suggestions,
    comparison: buildComparison(suggestions),
    degraded,
    computedInMs: now() - start,
  };
}
