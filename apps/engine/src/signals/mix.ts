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
import { deriveDecisionContext, deriveDecisionPolicy, type DraftDecisionContext, type DraftDecisionPolicy } from "../drafter/decision-context";
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
import type { FunctionalRecommendationEvidence } from "../recommendation/evidence";

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

export type DegradationFlag = "stale_meta" | "partial_signals" | "unconfirmed_state" | "unknown_format" | "no_signal_available";

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
  /** Internal provenance transport for RecommendationSet/v2. Non-enumerable at runtime, so the
   * legacy suggestions/v1 wire response remains byte-identical. */
  functionalEvidence?: FunctionalRecommendationEvidence;
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
  // R1 S5 (independent architecture review, blocker 3 -- LEGAL ACTION FIRST): opcional,
  // server-derived, determinista. Ausente -> comportamiento byte-idéntico al actual (ningún
  // llamador legacy pasa esto). Cuando el llamador SÍ conoce un universo de héroes certificado
  // (p. ej. el snapshot de elegibilidad de Captain's Mode), restringe el candidate pool a ESE
  // conjunto ANTES de rankear/recortar a TOP_N -- nunca al revés ("rankear el catálogo global y
  // filtrar después"), que puede perder al mejor héroe legal si cae fuera del top global. No es
  // una segunda fuente de legalidad: el llamador es quien certifica este conjunto (recommendation/
  // decision.ts's `eligibleHeroIds`, derivado de legalGameplayActions), este campo sólo le dice a
  // V6 sobre qué universo rankear.
  candidateHeroIds?: readonly HeroId[];
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

// R0.3 / Task 13: redistribución candidate-specific de V6. Tras Task 13 vive SÓLO en el camino
// legacy (`_legacyMixMode` / `mixScore`) -- `buildComparison`/`buildReason`/`buildEvidence` del
// camino activo se derivan de `StateWeightedContribution[]` (fuente única), no de aquí. Se
// conserva intacta porque el candado de regresión cero de V6 exige reproducirla al bit.
// Solo incluye señales con voto real (hasVote) -- una señal en `raw: null` o `applicable: false`
// nunca aparece en el resultado, ni con valor 0.
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
//
// R0.3 / Task 11 (design §4.3a, requisito 3.2 c1): `structurallyApplicableSignals` depende SÓLO de
// la estructura del `DraftState` (qué lados/picks/bans hay) y de qué funciones pidió el llamador
// (`options`) -- NUNCA de la calibración ni de la frescura/completitud de los datos. Estar en
// `A(S)` NO implica votar: la participación efectiva es `structurallyApplicable AND dataReady`, y
// el gate `dataReady` por señal lo formaliza Task 12. Antes, `patch_meta` sólo entraba si
// `calibration.signals.patch_meta` estaba presente -- ese acoplamiento accidental (design §4.3
// "estado actual" #1) se retira aquí: la calibración es una transformación de normalización, nunca
// un interruptor de disponibilidad.
//
// Exportada para el candado de regresión de Task 11 (`mix.test.ts`): probar `A(S)` directamente es
// más preciso que reconstruirlo vía `buildSuggestions`. Sólo lectura, sin efectos.
export function structurallyApplicableSignals(
  state: DraftState,
  meta: MetaSnapshot,
  options: BuildSuggestionsOptions,
): Set<SignalId> {
  const applicable = new Set<SignalId>();
  const facts = observedDraftFacts(state);

  if (state.localSide !== "unknown") applicable.add("position_fit");

  const curated = options.heroCounters ?? MODULE_HERO_COUNTERS;
  const curatedHitsABan =
    state.banned.length > 0 &&
    [...curated.values()].some((entries) => entries.some((entry) => state.banned.includes(entry.vs)));
  if (facts.revealedEnemyPicks.length > 0 || curatedHitsABan) applicable.add("counter");

  if (facts.ownPicks.length > 0) applicable.add("team_synergy");

  // `patch_meta` aplica a la estructura de CUALQUIER estado -> estructuralmente aplicable siempre.
  // Que vote o no lo decide `dataReady` (Task 12), nunca la calibración ni el `raw` del scorer. En
  // R0 los datos de parche están stale/incompletos (audit §4.3) y `patch_meta` no vota todavía.
  applicable.add("patch_meta");

  // NOTA (Task 12 -- residual DIFERIDO, no resuelto): `hero_pool_fit` sigue mirando la presencia
  // del pool aquí, mezclando estructura con presencia de datos. El split limpio de design §4.3(a)
  // es estructura = `options.mayHaveHeroPool` ("el llamador está en un contexto donde un pool
  // personal tiene sentido"), `dataReady` = "el pool tiene entradas". Ese input de intención del
  // llamador NO existe en `BuildSuggestionsOptions` y cablearlo correctamente cruza `app.ts`, el
  // simulador y cada call site de `buildSuggestions` -- fuera del write scope de Task 12
  // (`mix.ts`). Introducirlo sin cablear a los llamadores lo dejaría siempre falso y `hero_pool_fit`
  // pasaría de votar a nunca votar aun con pool presente, rompiendo "producción idéntica a pre-R0".
  // El objetivo de Task 12 nombra sólo `patch_meta`; este split se difiere a un ticket propio.
  // Mientras tanto el comportamiento es byte-idéntico: con pool presente entra a `A(S)` y
  // `dataReady` (default `true`) lo deja votar igual que hoy; sin pool no entra a `A(S)` y tampoco
  // vota. `votingSignals` (abajo) lo maneja sin ninguna rama especial.
  if ((meta.heroPool?.length ?? 0) > 0) applicable.add("hero_pool_fit");

  if (options.archetypeIntent !== undefined) applicable.add("archetype_fit");

  return applicable;
}

// ---------- R0.3 / Task 12 (design §4.3a-b, requisitos 3.2 c2-c5 / 3.3): data readiness ----------

// Motivo explícito por el que una señal NO vota. Se deriva EXPLÍCITAMENTE de
// `structurallyApplicable=false` (→ `"not_structurally_applicable"`) o de `dataReady=false` con la
// señal sí estructuralmente aplicable (→ `"data_not_ready"`). NUNCA se infiere de `raw:null`
// (`raw` es ortogonal a `votes`). Fijado en design §4.3(b); lo reusan Task 13
// (`StateWeightedContribution`) y Task 16 (`AvailableSignalsReport`).
export type NonVotingReason = "data_not_ready" | "not_structurally_applicable";

// `dataReady` -- flag explícito y verificable por señal: ¿los datos que la señal necesita son
// confiables/frescos/completos? INDEPENDIENTE de structural applicability y de la calibración.
// NUNCA se deriva de `raw`: una señal puede traer `raw` numérico y aun así no estar lista
// (`patch_meta` con `patchStats` >= 500 partidas pero de un parche stale), y `raw:null` NO implica
// `dataReady=false` (es un hueco de dato para ESE candidato, ortogonal a si la señal participa).
//
// `patch_meta`: contrato R0 EXACTO (requisito 3.3) -- `structurallyApplicable=true`,
// `dataReady=false`, `raw=null` aceptable, `votes=false`, `weighted=0`,
// `nonVotingReason="data_not_ready"`. La data de parche está stale/mezclada/incompleta (audit
// §4.3: `"7.35d"`/`""` 1016/1016, 81/127 matchups, meta muerto desde 2026-07-29). R0 **no**
// enciende `patch_meta` ni ninguna señal con `dataReady=false` -- su activación real es una fase
// posterior validada, medida contra el baseline aceptado (R0.2B). Antes de Task 12 esto era un
// filtro ad-hoc por literal (`.filter((id) => id !== "patch_meta")`); ahora es un gate nombrado.
//
// Resto de señales: sus datos ya se validan en el borde de sus loaders/scorers (S9/S10, familia
// S9) y en R0 se consideran listos (`default: true`). El split estructura/`dataReady` de
// `hero_pool_fit` queda DIFERIDO -- ver la NOTA en `structurallyApplicableSignals`; con `default:
// true` aquí el comportamiento es byte-idéntico porque la estructura ya lo gatea por pool presente.
export function dataReady(signal: SignalId, _meta: MetaSnapshot): boolean {
  switch (signal) {
    case "patch_meta":
      return false; // R0: no encender hasta reparar los datos de parche en una fase posterior
    default:
      return true;
  }
}

// `votingSignals` -- participación efectiva en el score: `votes == (structurallyApplicable AND
// dataReady)`, IGUAL para todo candidato del estado. La calibración NUNCA aparece como interruptor.
// Es exactamente el conjunto que entra al denominador de la redistribución de pesos y a `μᵢ(S)`
// (`stateMeansFor`): una señal estructuralmente aplicable pero con `dataReady=false` (p.ej.
// `patch_meta` en R0) NO consume peso, NO diluye a las demás y NO altera `stateMean`.
export function votingSignals(
  state: DraftState,
  meta: MetaSnapshot,
  options: BuildSuggestionsOptions,
): Set<SignalId> {
  const applicable = structurallyApplicableSignals(state, meta, options);
  return new Set([...applicable].filter((signal) => dataReady(signal, meta)));
}

// Etiqueta de no-voto por señal (CP3: "toda señal que no vota se etiqueta con `nonVotingReason`").
// `null` cuando la señal sí vota. Deriva la causa EXPLÍCITAMENTE de los dos flags ortogonales,
// nunca de `raw`. Lo consume el candado de Task 12 y, más adelante, el `AvailableSignalsReport`
// de Task 16.
export function nonVotingReason(
  signal: SignalId,
  state: DraftState,
  meta: MetaSnapshot,
  options: BuildSuggestionsOptions,
): NonVotingReason | null {
  if (!structurallyApplicableSignals(state, meta, options).has(signal)) return "not_structurally_applicable";
  if (!dataReady(signal, meta)) return "data_not_ready";
  return null; // vota
}

// ---------- R0.3 / Task 16 (design §4.3 "Data Models" (e), requisito 3.2 c6, CP3/CP7): AvailableSignalsReport ----------
//
// Vista/artefacto DERIVADO por decisión. NO recalcula applicability, readiness, votes ni
// contribuciones -- cada campo sale de la MISMA fuente canónica que consume `buildSuggestions`:
//   - structurallyApplicable  <- structurallyApplicableSignals()   (Task 11)
//   - dataReady               <- dataReady()                        (Task 12)
//   - votes / voting          <- votingSignals()                    (Task 12: votes == structurallyApplicable AND dataReady)
//   - nonVotingReason         <- nonVotingReason()                  (Task 12: causa explícita, NUNCA inferida de raw:null)
//   - degenerate              <- votingSignals(...).size === 0       (Task 14: predicado canónico del estado degenerado)
//   - decisionContext         <- degenerado ⇒ "no_signal_available"; si no, deriveDecisionContext (idéntico a buildSuggestions)
// `calibrated` refleja únicamente si hay una banda empírica activa para la señal; NUNCA decide
// participación (design §7 / requisito 3.2). Con el default `EMPTY_CALIBRATION` es `false` para las 6.
// El reporte no lleva `raw`: un `raw` numérico no puede leerse como "no aplica" ni un `raw:null`
// como "no vota" -- las tres verdades (structural / ready / raw) se exponen por separado.
//
// Determinismo: el orden de `signals` y de `voting` es el orden congelado de `SCORING_WEIGHTS_V6`
// (`SIGNAL_ORDER`), nunca el orden de iteración de un `Set`/`Object`. Consumible por los reportes
// de `bun run eval` desde este mismo módulo (que el harness de eval ya importa); no se renderiza en
// `apps/web` y NO entra en `SuggestionSet` -- sin espejo de cable nuevo.
export interface SignalStatusReport {
  signal: SignalId;
  structurallyApplicable: boolean; // ¿aplica a la estructura del estado? (Task 11)
  dataReady: boolean; // ¿sus datos son confiables/frescos/completos? (Task 12)
  calibrated: boolean; // ¿hay calibración empírica activa para la señal? NUNCA decide participación
  votes: boolean; // votes == (structurallyApplicable AND dataReady)
  nonVotingReason?: NonVotingReason; // presente sii votes=false; nunca inferido de raw:null
}

export interface AvailableSignalsReport {
  sessionId: string;
  basedOnSeq: number;
  decisionContext: DraftDecisionContext;
  signals: SignalStatusReport[]; // una por SignalId, en SIGNAL_ORDER
  voting: SignalId[]; // señales que efectivamente votan, en SIGNAL_ORDER
  degenerate: boolean; // true sii ninguna señal vota (== votingSignals(...).size === 0)
}

// Orden canónico único: las claves de `SCORING_WEIGHTS_V6` (constante congelada). Evita depender
// del orden de inserción de un `Set` o de `Object.keys(meta.heroes)`.
const SIGNAL_ORDER: readonly SignalId[] = Object.keys(SCORING_WEIGHTS_V6) as SignalId[];

// Un `DraftState` no lleva `bracket` -> en `calibration.ts` sólo la banda `global` puede resolver
// (`resolveBand` con `bracket = null`). Espeja esa condición sin acoplarse a su interna.
function isCalibrated(signal: SignalId, calibration: Calibration): boolean {
  return calibration.signals[signal]?.global != null;
}

export function buildAvailableSignalsReport(
  state: DraftState,
  meta: MetaSnapshot,
  options: BuildSuggestionsOptions = {},
): AvailableSignalsReport {
  const applicable = structurallyApplicableSignals(state, meta, options);
  const voting = votingSignals(state, meta, options);
  const calibration = options.calibration ?? EMPTY_CALIBRATION;
  const degenerate = voting.size === 0;

  // Idéntico a `buildSuggestions`: el degenerado fija `"no_signal_available"`; si no, el contexto
  // sale de `deriveDecisionContext` (lo mismo que `deriveDecisionPolicy(...).context`).
  const isTeamOpening =
    options.teamOpening === true && state.picks.radiant.length === 0 && state.picks.dire.length === 0;
  const decisionContext: DraftDecisionContext = degenerate
    ? "no_signal_available"
    : deriveDecisionContext(state, isTeamOpening);

  const signals: SignalStatusReport[] = SIGNAL_ORDER.map((signal) => {
    const structurallyApplicable = applicable.has(signal);
    const votes = voting.has(signal);
    const report: SignalStatusReport = {
      signal,
      structurallyApplicable,
      dataReady: dataReady(signal, meta),
      calibrated: isCalibrated(signal, calibration),
      votes,
    };
    if (!votes) {
      // `nonVotingReason()` es no-null exactamente cuando la señal no vota (Task 12); el `??` sólo
      // es defensa en profundidad para que el campo nunca falte cuando `votes === false`.
      report.nonVotingReason =
        nonVotingReason(signal, state, meta, options) ??
        (structurallyApplicable ? "data_not_ready" : "not_structurally_applicable");
    }
    return report;
  });

  return {
    sessionId: state.sessionId,
    basedOnSeq: state.lastSeq,
    decisionContext,
    signals,
    voting: SIGNAL_ORDER.filter((signal) => voting.has(signal)),
    degenerate,
  };
}

function confidenceFromCoverage(evidenceCoverage: number, metaIsStale: boolean): Suggestion["confidence"] {
  if (evidenceCoverage >= 0.75 && !metaIsStale) return "alta";
  if (evidenceCoverage >= 0.5 || metaIsStale) return "media";
  return "baja";
}

// ---------- R0.3 / Task 13 (design §4.3 "Data Models" (b), requisito 3.1, CP2/CP4/CP10): fuente única ----------
//
// `StateWeightedContribution` es la ÚNICA representación canónica de la contribución de una señal
// a la recomendación de un candidato. `score`, `reason`, `comparison` y `evidence` se derivan
// TODOS de aquí -- no hay un segundo cálculo (`weightedContributions` legacy queda fuera del
// camino activo, sólo lo usa `_legacyMixMode`). Conserva sin colapsar los flags de Task 12
// (`structurallyApplicable` / `dataReady` / `votes` / `nonVotingReason`): una señal que no vota
// (`patch_meta` en R0) NUNCA reaparece como votante porque `reason`/`comparison`/`evidence` se
// reconstruyan por otra ruta -- su `weighted` es 0 y los derivados filtran por `weighted > 0`.
export interface StateWeightedContribution {
  signal: SignalId;
  raw: number | null; // sagrado: null = hueco de datos. ORTOGONAL a `votes` (Task 12).
  normalized: number | null;
  baseWeight: number; // SCORING_WEIGHTS_V6[signal] (nominal, congelado)
  weightPrime: number; // w' = baseWeight / Σ baseWeight(voting); 0 si no vota
  weighted: number; // contribución final al score; `votes=false` ⇒ 0
  structurallyApplicable: boolean;
  dataReady: boolean;
  votes: boolean; // votes == (structurallyApplicable AND dataReady)
  usedStateMean: boolean; // true si contribuyó con μ del estado por raw:null dentro de A(S)
  nonVotingReason: NonVotingReason | null; // presente sii votes=false; nunca inferido de raw:null
  explanation: string;
  sampleSize: number;
  applicable?: boolean;
  evidenceConfidence?: number;
}

export interface ScoredCandidate {
  hero: HeroId;
  score: number; // Σ contributions[].weighted (invariante CP10, en TODOS los caminos)
  contributions: StateWeightedContribution[]; // ← FUENTE ÚNICA
  evidenceCoverage: number;
  guessingIndex: number;
}

// Proyección fiel de la fuente única al tipo de cable (`SignalContribution`, espejado en
// `apps/web`). NO recalcula nada: copia `weighted`/`normalized` tal cual. `Suggestion.signals`
// sale de aquí, así que leer `.weighted` de `Suggestion.signals` es leer la fuente única.
function toSignalContribution(c: StateWeightedContribution): SignalContribution {
  const base: SignalContribution = {
    signal: c.signal,
    raw: c.raw,
    normalized: c.normalized,
    weighted: c.weighted,
    explanation: c.explanation,
    sampleSize: c.sampleSize,
  };
  if (c.applicable !== undefined) base.applicable = c.applicable;
  if (c.evidenceConfidence !== undefined) base.evidenceConfidence = c.evidenceConfidence;
  return base;
}

// §16.7 puntos 2-6 + Task 11/12/13. `enriched` ya trae `normalized`/`evidenceConfidence` (vía
// `enrich()`). `applicable`/`voting` son IGUALES para todo candidato del estado (Task 11/12);
// `stateMean` es la media de `normalizedᵢ` sobre los candidatos con dato. Produce la fuente única
// `StateWeightedContribution[]` y el `score` como su suma exacta.
function mixCandidateByState(
  hero: HeroId,
  enriched: SignalContribution[],
  applicable: Set<SignalId>,
  voting: Set<SignalId>,
  readyBySignal: Partial<Record<SignalId, boolean>>,
  wPrime: Partial<Record<SignalId, number>>,
  stateMean: Partial<Record<SignalId, number>>,
): ScoredCandidate {
  let score = 0;
  let evidenceCoverage = 0;
  const contributions: StateWeightedContribution[] = enriched.map((c) => {
    const structurallyApplicable = applicable.has(c.signal);
    const dataReadyFlag = readyBySignal[c.signal] ?? true;
    const votes = voting.has(c.signal); // == structurallyApplicable AND dataReadyFlag (Task 12)
    const normalized = c.normalized ?? null;
    const w = wPrime[c.signal] ?? 0;
    let weighted = 0;
    let usedStateMean = false;
    if (votes) {
      if (c.raw !== null && normalized != null) {
        weighted = w * normalized;
        evidenceCoverage += w;
      } else {
        // `raw: null` en una señal de `A(S)` -> el candidato "adivina" con la media del estado.
        // `μ` nunca se escribe en `raw` (sigue null en el desglose) -- sólo alimenta `weighted`.
        weighted = w * (stateMean[c.signal] ?? 50);
        usedStateMean = true;
      }
    }
    score += weighted;
    return {
      signal: c.signal,
      raw: c.raw,
      normalized,
      baseWeight: SCORING_WEIGHTS_V6[c.signal],
      weightPrime: w,
      weighted,
      structurallyApplicable,
      dataReady: dataReadyFlag,
      votes,
      usedStateMean,
      nonVotingReason: votes ? null : structurallyApplicable ? "data_not_ready" : "not_structurally_applicable",
      explanation: c.explanation,
      sampleSize: c.sampleSize,
      ...(c.applicable !== undefined ? { applicable: c.applicable } : {}),
      evidenceConfidence: c.evidenceConfidence,
    };
  });
  return { hero, score, contributions, evidenceCoverage, guessingIndex: 1 - evidenceCoverage };
}

// CP10 en el camino `teamOpening`: `recommendTeamOpeners` reemplaza el `score` (× 100 + alivio por
// bans). Para que `Σ contributions.weighted == score` siga siendo cierto SIN tocar
// `team-opener.ts` ni las fórmulas de señal, se re-escalan las contribuciones al nuevo total. El
// orden (lo fija `recommendTeamOpeners`) y el `score` no cambian; sólo la representación interna
// pasa a ser coherente. Escala uniforme positiva ⇒ el orden por `weighted` de `reason` y el signo
// de los `delta` de `comparison` se preservan.
function reconcileWeightedToScore(
  contributions: StateWeightedContribution[],
  targetScore: number,
): StateWeightedContribution[] {
  const current = contributions.reduce((sum, c) => sum + c.weighted, 0);
  if (Math.abs(current - targetScore) < 1e-9) return contributions;
  if (current > 0) {
    const k = targetScore / current;
    return contributions.map((c) => ({ ...c, weighted: c.weighted * k }));
  }
  // `current === 0` (ninguna contribución del pipeline): el score objetivo lo trajo sólo el alivio
  // por bans. Se reparte a partes iguales entre las señales votantes (o entre todas si ninguna
  // vota) para que la igualdad CP10 se mantenga; caso de medida cero con datos reales.
  const voters = contributions.filter((c) => c.votes);
  const targets = voters.length > 0 ? voters : contributions;
  const share = targets.length > 0 ? targetScore / targets.length : 0;
  return contributions.map((c) => (targets.includes(c) ? { ...c, weighted: share } : c));
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

// Task 13: `evidence` sale de la MISMA fuente única (`StateWeightedContribution[]`) que el score.
// Una señal que no vota (p. ej. `patch_meta` en R0) nunca genera evidencia "usada": la evidencia
// positiva de `counter`/`team_synergy` exige `votes` Y `weighted > 0` además de `raw > 0`. Las
// líneas de riesgo (ausencia de ventaja) son diagnósticas y no citan una contribución votante.
function buildEvidence(
  contributions: StateWeightedContribution[],
  flexReason: string | null,
  policy: DraftDecisionPolicy,
  openingReason: string | null,
): SuggestionEvidence[] {
  const evidence: SuggestionEvidence[] = [];
  const counter = contributions.find((c) => c.signal === "counter");
  const synergy = contributions.find((c) => c.signal === "team_synergy");
  const counterContributed = counter?.votes === true && (counter.raw ?? 0) > 0 && counter.weighted > 0;
  const synergyContributed = synergy?.votes === true && (synergy.raw ?? 0) > 0 && synergy.weighted > 0;
  if (openingReason !== null) evidence.push({ kind: "opening", text: openingReason });
  if (policy.usesRevealedCounterEvidence && counterContributed) {
    evidence.push({ kind: "counter", text: counter!.explanation });
  }
  if (synergyContributed) {
    evidence.push({ kind: "synergy", text: synergy!.explanation });
  }
  if (flexReason !== null) evidence.push({ kind: "flex", text: flexReason });
  if (policy.usesRevealedCounterEvidence && !counterContributed) {
    evidence.push({ kind: "risk", text: "No hay una ventaja de contrapick verificable contra los rivales revelados; evita tratar esta respuesta como segura." });
  }
  if (policy.closesComposition && !synergyContributed) {
    evidence.push({ kind: "risk", text: "No hay evidencia suficiente de que complete una necesidad táctica pendiente del equipo." });
  }
  return evidence;
}

// Task 13 / CP4: `reason` ordena por la contribución REAL al score (`weighted`), no por el peso
// nominal, y sólo cita señales que votaron con dato propio y aportaron algo (`weighted > 0`) --
// así `patch_meta` (que no vota, `weighted = 0`) nunca puede aparecer citada.
function buildReason(contributions: StateWeightedContribution[], positionReason: string | null): string {
  const informative = contributions
    .filter((c) => c.votes && c.raw !== null && c.weighted > 0)
    .sort((a, b) => b.weighted - a.weighted)
    .slice(0, 2)
    .map((c) => c.explanation);
  const signalReason =
    informative.length > 0
      ? informative.map(asSentence).join(" ")
      : contributions[0]?.explanation ?? "Sin datos suficientes para explicar esta sugerencia";
  if (positionReason === null) return signalReason;
  return `${positionReason} ${signalReason}`;
}

// Task 13 / CP2: la ventaja se mide sobre las MISMAS contribuciones `weighted` que formaron el
// score (proyectadas fielmente en `Suggestion.signals`), nunca sobre un cálculo paralelo. Sólo
// son comparables las señales con `raw` real en AMBOS lados (un `raw: null` rellenado con μ no es
// una ventaja verificable) y con aporte positivo del #1 (`weighted > 0` ⇒ CP4).
function bestFavoringSignal(top: SignalContribution[], second: SignalContribution[]): { signal: SignalId; delta: number } | null {
  let best: { signal: SignalId; delta: number } | null = null;
  for (const t of top) {
    if (t.raw === null || t.weighted <= 0) continue;
    const s = second.find((x) => x.signal === t.signal);
    if (!s || s.raw === null) continue;
    const delta = t.weighted - s.weighted;
    if (best === null || delta > best.delta) best = { signal: t.signal, delta };
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
  // Blocker 3: applied BEFORE ranking/TOP_N -- a certified legal universe (Captain's Mode) must
  // never lose its best hero to a global top-N cutoff that never saw it as a candidate.
  if (options.candidateHeroIds) {
    const allowed = new Set(options.candidateHeroIds);
    candidates = candidates.filter((hero) => allowed.has(hero));
  }
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

/** Constructs the input-only provenance passed to RecommendationSet/v2. It intentionally reads
 * the pre-ranking scorer pass (`raw`) and the team-opening inputs, never `ranked`, `suggestions`,
 * scores, final reasons, confidence, or degradations. */
function functionalRecommendationEvidence(
  raw: readonly { hero: HeroId; signals: readonly SignalContribution[] }[],
  meta: MetaSnapshot,
  options: BuildSuggestionsOptions,
  banned: readonly HeroId[],
  heroPositions: HeroPositions,
  heroCapabilities: readonly HeroCapabilities[],
  heroCounters: ReadonlyMap<HeroId, readonly CuratedCounter[]>,
  isTeamOpening: boolean,
): FunctionalRecommendationEvidence {
  const candidateHeroes = new Set(raw.map((candidate) => candidate.hero));
  const candidates = [...candidateHeroes].sort((a, b) => a - b);
  const signalEvidence = raw.map((candidate) => ({
    hero: candidate.hero,
    signals: candidate.signals.map((signal) => ({
      signal: signal.signal,
      raw: signal.raw,
      normalized: signal.normalized ?? null,
      evidenceConfidence: signal.evidenceConfidence ?? null,
      explanation: signal.explanation,
      sampleSize: signal.sampleSize,
      applicable: signal.applicable ?? null,
    })),
  }));
  const positions = candidates.map((hero) => ({
    hero,
    positions: (heroPositions[hero] ?? []).map((entry) => ({ position: entry.position, matches: entry.matches })),
  }));
  if (!isTeamOpening) {
    return { metaIsStale: options.metaIsStale === true, signalEvidence, heroPositions: positions, teamOpening: null, partyPreferredPositions: [] };
  }

  // Names of a candidate and of a banned counter are the only MetaHeroInfo fields read by the
  // opening summary. A name for an unrelated, unbanned non-candidate is deliberately excluded.
  const bannedSet = new Set(banned);
  const referencedBannedCounters = candidates.flatMap((hero) => [
    ...(meta.matchups[hero] ?? []).map((matchup) => matchup.vsHero),
    ...(heroCounters.get(hero) ?? []).map((counter) => counter.vs),
  ]).filter((hero) => bannedSet.has(hero));
  const namedHeroes = new Set([...candidates, ...referencedBannedCounters]);
  return {
    metaIsStale: options.metaIsStale === true,
    signalEvidence,
    heroPositions: positions,
    teamOpening: {
      heroCapabilities: heroCapabilities
        .filter((entry) => candidateHeroes.has(entry.hero))
        .map((entry) => ({
          hero: entry.hero,
          damageType: entry.damageType,
          hasInitiation: entry.hasInitiation,
          hasCatch: entry.hasCatch,
          hasWaveclear: entry.hasWaveclear,
          structuralDamage: entry.structuralDamage,
          teamfight: entry.teamfight,
          scaling: entry.scaling,
        })),
      matchups: candidates.flatMap((hero) => (meta.matchups[hero] ?? []).map((matchup) => ({ hero, ...matchup }))),
      curatedCounters: candidates.flatMap((hero) =>
        (heroCounters.get(hero) ?? []).map((counter) => ({ hero, vsHero: counter.vs, level: counter.level, why: counter.why })),
      ),
      heroNames: [...namedHeroes]
        .sort((a, b) => a - b)
        .flatMap((hero) => (meta.heroes[hero] ? [{ hero, name: meta.heroes[hero]!.localizedName }] : [])),
    },
    partyPreferredPositions: [],
  };
}

function attachFunctionalEvidence(suggestionSet: SuggestionSet, evidence: FunctionalRecommendationEvidence): SuggestionSet {
  Object.defineProperty(suggestionSet, "functionalEvidence", { value: evidence, enumerable: false });
  return suggestionSet;
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
  const heroCounters = options.heroCounters ?? MODULE_HERO_COUNTERS;
  // Al abrir un draft de equipo no existe todavía un "héroe del usuario". Excluir la señal de
  // hero pool evita que la comodidad de una sola cuenta decida la composición que el capitán está
  // armando para cinco jugadores; no es un cambio de peso sino una restricción de contexto.
  const baseScorers = options.teamOpening ? STATIC_SCORERS.filter((scorer) => scorer.id !== "hero_pool_fit") : STATIC_SCORERS;
  // position_fit, team_synergy y archetype_fit no pueden ser singletons de módulo: dependen de
  // datos inyectables (heroPositions/heroCapabilities/archetypeIntent). Se construyen por llamada.
  const scorers: SignalScorer[] = [
    ...baseScorers,
    createCounterScorer(heroCounters),
    createPositionFitScorer(heroPositions),
    createTeamSynergyScorer(heroCapabilities),
    createArchetypeFitScorer(heroCapabilities, options.archetypeIntent),
  ];
  const isTeamOpening = options.teamOpening === true && state.picks.radiant.length === 0 && state.picks.dire.length === 0;
  const decisionPolicy = deriveDecisionPolicy(state, isTeamOpening);
  const emptyFunctionalEvidence = () =>
    functionalRecommendationEvidence([], meta, options, state.banned, heroPositions, heroCapabilities, heroCounters, isTeamOpening);

  const voting = votingSignals(state, meta, options);
  if (voting.size === 0) {
    degraded.push("no_signal_available");
    return attachFunctionalEvidence({
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: "no_signal_available",
      suggestions: [],
      comparison: null,
      degraded,
      computedInMs: now() - start,
    }, emptyFunctionalEvidence());
  }

  const candidates = candidatePool(state, meta, options);
  if (candidates.length === 0) {
    return attachFunctionalEvidence({
      schema: "suggestions/v1",
      sessionId: state.sessionId,
      basedOnSeq: state.lastSeq,
      decisionContext: decisionPolicy.context,
      suggestions: [],
      comparison: null,
      degraded,
      computedInMs: now() - start,
    }, emptyFunctionalEvidence());
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

  // Task 13 (requisito 3.1, CP2/CP4/CP10): TODOS los caminos producen la misma fuente única
  // `ScoredCandidate.contributions` (`StateWeightedContribution[]`), y `score == Σ contributions.weighted`.
  let scored: ScoredCandidate[];
  if (legacyMix) {
    // Camino legacy (`_legacyMixMode`, sólo el candado de regresión cero de V6, nunca producción):
    // conserva la redistribución candidate-specific de V6 (`weightedContributions` + `normalize`
    // sobre `RAW_RANGE`). Es su propia fuente única -- por diseño reproduce V6 al bit. `score` sigue
    // saliendo de `mixScore`, que es exactamente `Σ weightedContributions(...)`.
    scored = raw.map(({ hero, signals }) => {
      const wc = weightedContributions(signals);
      const votingWeight = (Object.keys(wc) as SignalId[]).reduce((sum, id) => sum + SCORING_WEIGHTS_V6[id], 0);
      let evidenceCoverage = 0;
      const contributions: StateWeightedContribution[] = signals.map((c) => {
        const w = wc[c.signal];
        const votes = w !== undefined;
        if (votes) evidenceCoverage += SCORING_WEIGHTS_V6[c.signal];
        return {
          signal: c.signal,
          raw: c.raw,
          normalized: c.normalized ?? null,
          baseWeight: SCORING_WEIGHTS_V6[c.signal],
          weightPrime: votes && votingWeight > 0 ? SCORING_WEIGHTS_V6[c.signal] / votingWeight : 0,
          weighted: w ?? 0,
          structurallyApplicable: votes,
          dataReady: true,
          votes,
          usedStateMean: false,
          nonVotingReason: votes ? null : "not_structurally_applicable",
          explanation: c.explanation,
          sampleSize: c.sampleSize,
          ...(c.applicable !== undefined ? { applicable: c.applicable } : {}),
          evidenceConfidence: c.evidenceConfidence,
        };
      });
      return { hero, score: mixScore(signals), contributions, evidenceCoverage, guessingIndex: 1 - evidenceCoverage };
    });
  } else {
    // Conjunto que efectivamente vota y entra en la redistribución: `votes == (structurallyApplicable
    // AND dataReady)` (Task 12 / design §4.3a-b). Igual para todo candidato del estado. NO depende
    // de la calibración -- ni como estructura (Task 11) ni como readiness. `patch_meta` queda fuera
    // porque `dataReady("patch_meta") === false` (audit §4.3), no por un filtro por literal: así la
    // salida observable de producción no cambia respecto a pre-R0 (donde `patch_meta` tampoco votaba:
    // sólo entraba vía el acoplamiento a `calibration.signals.patch_meta`, ya retirado). Una señal
    // aplicable pero no lista NO entra a `denom` ni a `stateMean`.
    const applicableSet = structurallyApplicableSignals(state, meta, options);
    // `voting` was computed above as the canonical degenerate-state predicate.
    const readyBySignal: Partial<Record<SignalId, boolean>> = {};
    for (const id of applicableSet) readyBySignal[id] = dataReady(id, meta);
    const denom = [...voting].reduce((sum, id) => sum + SCORING_WEIGHTS_V6[id], 0);
    const wPrime: Partial<Record<SignalId, number>> = {};
    for (const id of voting) wPrime[id] = denom > 0 ? SCORING_WEIGHTS_V6[id] / denom : 0;
    const stateMean = stateMeansFor(raw, voting);
    scored = raw.map(({ hero, signals }) =>
      mixCandidateByState(hero, signals, applicableSet, voting, readyBySignal, wPrime, stateMean),
    );
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
          curatedCounters: heroCounters.get(entry.hero)?.map((c) => ({ vs: c.vs, level: c.level })) ?? [],
        })),
        banned: state.banned,
        heroNames: Object.fromEntries(Object.values(meta.heroes).map((entry) => [entry.id, entry.localizedName])),
        limit: TOP_N,
      })
    : null;
  const scoreByHero = new Map(scored.map((entry) => [entry.hero, entry]));
  type RankedCandidate = ScoredCandidate & { openingReason: string | null };
  const ranked: RankedCandidate[] = teamOpening
    ? teamOpening.map((option) => {
        const base = scoreByHero.get(option.hero)!;
        // `recommendTeamOpeners` reemplaza el score (× 100 + alivio por bans). CP10: re-escalar la
        // fuente única al nuevo total para que `Σ contributions.weighted == score` siga cierto sin
        // tocar `team-opener.ts`. Orden y score no cambian.
        const newScore = option.score * 100;
        return {
          ...base,
          score: newScore,
          contributions: reconcileWeightedToScore(base.contributions, newScore),
          openingReason: option.summary,
        };
      })
    : diversifyEquivalentCandidates(scored, options.diversitySeed).map((entry) => ({ ...entry, openingReason: null }));
  // TSK-192: 6 recomendaciones en apertura y en picks normales (el Copilot del Simulador las
  // muestra en grid 2×3).
  const limit = TOP_N;
  const suggestions: Suggestion[] = ranked.slice(0, limit).map((entry, index) => {
    const roleReason = targetPositionReason(entry.hero, options.teamOpening ? {} : options) ?? flexibilityReason(entry.hero, heroPositions);
    // Fuente única -> vista de cable. `reason`/`comparison`/`evidence` se derivan de
    // `entry.contributions` (o de su proyección fiel `signals`), nunca de un cálculo paralelo.
    const signals = entry.contributions.map(toSignalContribution);
    return {
    hero: entry.hero,
    rank: (index + 1) as Suggestion["rank"],
    score: entry.score,
    signals,
    // decisionPolicy.headline NO se repite acá -- ya lo comunica `decisionContext` (arriba, una
    // sola vez por SuggestionSet). Repetirlo en cada `reason` clonaba el mismo encabezado en las
    // 5 tarjetas de la ronda, el hallazgo real de producto que originó TSK-124.
    reason: [
      entry.openingReason,
      buildReason(
        entry.contributions,
        roleReason,
      ),
    ]
      .filter(Boolean)
      .join(" "),
    confidence: legacyMix
      ? computeConfidence(signals, options.metaIsStale ?? false)
      : confidenceFromCoverage(entry.evidenceCoverage, options.metaIsStale ?? false),
    evidenceCoverage: entry.evidenceCoverage,
    guessingIndex: entry.guessingIndex,
    evidence: buildEvidence(entry.contributions, roleReason, decisionPolicy, entry.openingReason),
  };
  });

  return attachFunctionalEvidence({
    schema: "suggestions/v1",
    sessionId: state.sessionId,
    basedOnSeq: state.lastSeq,
    decisionContext: decisionPolicy.context,
    suggestions,
    comparison: buildComparison(suggestions),
    degraded,
    computedInMs: now() - start,
  }, functionalRecommendationEvidence(raw, meta, options, state.banned, heroPositions, heroCapabilities, heroCounters, isTeamOpening));
}
