import { extractCandidateFeatures, extractCandidateStrategies } from "./feature-extractor";
import { createOpportunityWindowScore, createTeamOpeningMatchupWinrate, createPositionalCommitment, BETA_OPENING } from "./ban-relief";
import { mergePipelineSignals } from "./merge";
import type { PipelineSignalContribution } from "./merge";
import { deriveContinuousPipelineWeights, deriveDynamicPipelineWeights } from "./phase-decay";
import { createMetaMatchupWinrate, type MatchupWinrateFn } from "./meta-matchup";
import type { PipelineWeights } from "./weight-loader";
import { calculateDenialScore } from "../intent/denial-score";
import { inferFlexPick } from "../intent/flex-inference";
import type { FlexInferenceResult } from "../intent/flex-inference";
import type { DraftState, HeroId } from "../draft/reducer";
import { createJaccardEngine, defaultJaccardWeights } from "../knn/jaccard";
import type { DraftCandidate } from "../knn/corpus";
import type { InMemoryDraftIndex } from "../knn/draft-index";
import { evaluateLaneRoster } from "../lane/evaluate";
import { loadHeroLineProfiles } from "../lane/profiles";
import type { HeroLineProfile } from "../lane/profiles";
import type { DraftPathArchetype, HeroCapabilities } from "../draft-paths/types";
import type { HeroPositions } from "../signals/hero-positions";
import type { HeroMatchupStat } from "../signals/types";
import { adjustOpeningFlexScore } from "./flex-score";
import { applyTacticalOverrides, type TacticalOverrideConfig } from "./tactical-overrides";

// Fase 6 (SPEC.md §13.8): 7º parámetro, sin usar todavía el modo `teamOpening` completo (TSK-132)
// -- este ticket (TSK-131) solo conecta los pesos por fase y la fuente real de matchups.
export interface ProDrafterPipelineOptions {
  readonly teamOpening?: boolean;
  readonly targetPosition?: 1 | 2 | 3 | 4 | 5;
  readonly topN?: 3 | 5;
  readonly matchups?: Record<HeroId, HeroMatchupStat[]>;
  readonly heroCapabilities?: readonly HeroCapabilities[];
  readonly tacticalOverrides?: TacticalOverrideConfig;
}

// Fase 8 (pro-drafter-spec-v1.md §3): orquestación estricta Feature Extractor -> KNN -> Lane Sim
// -> Intent -> Signal Merger -> Top 3. Apagado a propósito: nada bajo server/ importa este
// archivo todavía (verificado por test) -- promover esto a producción es una decisión aparte.
//
// [SUPUESTO, ver plan Fase 5-8]: sin `meta: MetaSnapshot` en esta firma, varias piezas se derivan
// de datos que ya existen en vez de inventar una fuente nueva -- documentado función por función.

export interface PipelineCandidateResult {
  readonly heroId: HeroId;
  readonly score: number;
  readonly signals: readonly PipelineSignalContribution[];
}

const K_NEIGHBORS = 10;
const DEFAULT_BETA = 0.5;
const DEFAULT_ENTROPY_THRESHOLD = 1.0;
const LANE_WEIGHTS: readonly [number, number, number, number, number] = [0.2, 0.2, 0.2, 0.2, 0.2];
const TOP_N = 3;

// Fase 6 (SPEC.md §13.8/§13.9): el modo de apertura de equipo.
export const OPENING_TOP_N = 5;
export const OPENING_REPEAT_STRATEGY_PENALTY = 4.0; // escala [0,100] del pipeline, NO 0.04 -- ese vive en [0,1] (team-opener.ts)

/** Presencia observada del héroe en la posición objetivo (0..1), basada en el corpus curado. */
export function positionFitScore(heroId: HeroId, targetPosition: 1 | 2 | 3 | 4 | 5, heroPositions: HeroPositions): number {
  const shares = heroPositions[heroId];
  if (!shares || shares.length === 0) return 0;
  const total = shares.reduce((sum, share) => sum + Math.max(0, share.matches), 0);
  if (total === 0) return 0;
  return (shares.find((share) => share.position === targetPosition)?.matches ?? 0) / total;
}

function ownHeroes(state: DraftState): readonly HeroId[] {
  return state.localSide === "unknown" ? [] : state.picks[state.localSide];
}

function enemyHeroes(state: DraftState): readonly HeroId[] {
  if (state.localSide === "unknown") return [];
  return state.picks[state.localSide === "radiant" ? "dire" : "radiant"];
}

// Sin meta.heroes disponible, el universo de candidatos se deriva del propio corpus del KNN
// (5.1) -- fuente distinta a la `candidatePool` privada de signals/mix.ts, misma responsabilidad
// de excluir baneados/pickeados.
function candidatesFromCorpus(state: DraftState, corpus: readonly DraftCandidate[]): HeroId[] {
  const excluded = new Set<HeroId>([...state.banned, ...state.picks.radiant, ...state.picks.dire]);
  const heroes = new Set<HeroId>();
  for (const draft of corpus) {
    for (const h of [...draft.radiantHeroes, ...draft.direHeroes]) heroes.add(h);
  }
  return [...heroes].filter((h) => !excluded.has(h));
}

// Sin fuente real de MatchupWinrate segmentado por posición (STRATZ, hueco heredado desde Fase
// 1b -- denial-score.ts), se deriva una aproximación real del corpus del KNN: winrate agregado
// cuando candidateHero y rivalHero aparecieron en lados opuestos, ignorando `position` (el corpus
// no la trae). Sin enfrentamientos registrados -> null, nunca un 0 fabricado. Como el resultado no
// depende de `position`, se cachea por par (candidate,rival): calculateDenialScore llama esta
// función una vez por cada una de las 5 posiciones, y sin cache repetiría el escaneo del corpus
// 5 veces por candidato para el mismo resultado.
function corpusMatchupWinrate(corpus: readonly DraftCandidate[]) {
  const cache = new Map<string, number | null>();
  return (candidateHero: HeroId, rivalHero: HeroId, _position: 1 | 2 | 3 | 4 | 5): number | null => {
    const key = `${candidateHero}:${rivalHero}`;
    const cached = cache.get(key);
    if (cached !== undefined) return cached;

    let wins = 0;
    let total = 0;
    for (const draft of corpus) {
      const cSide = draft.radiantHeroes.includes(candidateHero) ? "radiant" : draft.direHeroes.includes(candidateHero) ? "dire" : null;
      const rSide = draft.radiantHeroes.includes(rivalHero) ? "radiant" : draft.direHeroes.includes(rivalHero) ? "dire" : null;
      if (!cSide || !rSide || cSide === rSide) continue;
      total += 1;
      if (draft.winningSide === cSide) wins += 1;
    }
    const result = total === 0 ? null : wins / total;
    cache.set(key, result);
    return result;
  };
}

// EarlyPressure no tiene fuente propia -- reutiliza killPressure de HeroLineProfile (Fase 6).
// Sin perfil -> 0: la interfaz del doc no admite null acá, a diferencia de matchupWinrate.
function earlyPressureFromProfiles(profiles: Map<HeroId, HeroLineProfile>) {
  return (heroId: HeroId): number => profiles.get(heroId)?.killPressure ?? 0;
}

// Gobernanza 2.0 (ampliación 5v5, evt-107): antes solo se "denegaba" al rival de mayor entropía
// (single flex target) -- ahora se evalúa denial_score contra TODOS los rivales confirmados y se
// promedia (nunca se suma: sumar sobre hasta 5 rivales rompería la calibración de
// PIPELINE_RAW_RANGE.denial_score=[0,2] en pipeline/merge.ts, pensada para un único rival).
// Precomputado UNA vez por corrida (no depende del candidato) -- memoización real: sin esto, cada
// uno de los ~100+ candidatos volvería a llamar deriveFlexDistribution() por cada rival. Sin
// picks rivales -> array vacío, y denial_score cae a null para todos los candidatos (nunca se
// fabrica un objetivo).
function rivalFlexTargets(state: DraftState, heroPositions: HeroPositions): FlexInferenceResult[] {
  return enemyHeroes(state).map((h) => inferFlexPick(h, heroPositions, DEFAULT_ENTROPY_THRESHOLD));
}

// Fase 6 (SPEC.md §13.8): mismo patrón de precomputación que rivalFlexTargets, pero sobre los
// héroes BANEADOS -- en apertura no hay picks rivales todavía, así que el único insumo real para
// el término de "denial" son los bans. Hasta 16 llamadas por corrida, nunca 110 candidatos x 16.
function banFlexTargets(state: DraftState, heroPositions: HeroPositions): FlexInferenceResult[] {
  return state.banned.map((h) => inferFlexPick(h, heroPositions, DEFAULT_ENTROPY_THRESHOLD));
}

// Fase 6 (SPEC.md §13.8): desempate por heroId, exclusivo de la rama de apertura -- con ~110
// candidatos y un lane_score idéntico para los ~111 héroes sin perfil de línea, los empates son
// la norma. Sin esto el orden lo decidiría el orden de iteración del Set del corpus (no
// determinista para efectos prácticos de la prueba). El camino normal (fuera de apertura) no
// gana este desempate -- SPEC.md §13.17-4, cambiar sus números por una razón ajena a esta fase.
function sortForOpening(results: readonly PipelineCandidateResult[]): PipelineCandidateResult[] {
  return [...results].sort((a, b) => b.score - a.score || a.heroId - b.heroId);
}

// Fase 6 (SPEC.md §13.9): selección greedy -- penaliza (nunca elimina) un candidato cuya
// estrategia ya está entre los seleccionados. Nunca es un filtro duro: si las OPENING_TOP_N
// mejores opciones son todas la misma estrategia, se devuelven igual.
function diversifyByStrategy(
  sorted: readonly PipelineCandidateResult[],
  strategyOf: Map<HeroId, DraftPathArchetype>,
  limit: number,
  penalty: number,
): PipelineCandidateResult[] {
  const selected: PipelineCandidateResult[] = [];
  const remaining = [...sorted];
  const usedStrategies = new Set<DraftPathArchetype>();

  while (selected.length < limit && remaining.length > 0) {
    remaining.sort((a, b) => {
      const scoreA = a.score - (usedStrategies.has(strategyOf.get(a.heroId) ?? "scaling") ? penalty : 0);
      const scoreB = b.score - (usedStrategies.has(strategyOf.get(b.heroId) ?? "scaling") ? penalty : 0);
      return scoreB - scoreA || a.heroId - b.heroId;
    });
    const next = remaining.shift()!;
    selected.push(next);
    usedStrategies.add(strategyOf.get(next.heroId) ?? "scaling");
  }

  return selected;
}

function average(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function resolveProfile(heroId: HeroId | undefined, profiles: Map<HeroId, HeroLineProfile>): HeroLineProfile | undefined {
  return heroId === undefined ? undefined : profiles.get(heroId);
}

// El KNN (5.3) rankea DRAFTS por similitud, no héroes -- acá se deriva un score por héroe
// candidato: el mejor sim entre los k vecinos ganadores donde ese héroe aparece. Un candidato
// ausente de los k vecinos no tiene entrada -> null.
function knnScoresByHero(
  own: readonly HeroId[],
  index: InMemoryDraftIndex,
  heroPositions: HeroPositions,
  candidates: readonly HeroId[],
): Map<HeroId, number> {
  const candidateSet = new Set(candidates);
  const engine = createJaccardEngine(index);
  const neighbors = engine.nearestNeighbors(own, K_NEIGHBORS, defaultJaccardWeights(heroPositions));

  const scores = new Map<HeroId, number>();
  for (const { candidate, sim } of neighbors) {
    const winningHeroes = candidate.winningSide === "radiant" ? candidate.radiantHeroes : candidate.direHeroes;
    for (const heroId of winningHeroes) {
      if (!candidateSet.has(heroId)) continue;
      scores.set(heroId, Math.max(scores.get(heroId) ?? 0, sim));
    }
  }
  return scores;
}

export function runProDrafterPipeline(
  state: DraftState,
  index: InMemoryDraftIndex,
  corpus: readonly DraftCandidate[],
  heroPositions: HeroPositions,
  weights: PipelineWeights,
  profiles: Map<HeroId, HeroLineProfile> = loadHeroLineProfiles(),
  options?: ProDrafterPipelineOptions,
): readonly PipelineCandidateResult[] {
  const candidates = candidatesFromCorpus(state, corpus);
  const features = extractCandidateFeatures(state, candidates, profiles); // 1. Feature Extractor

  const own = ownHeroes(state);
  const enemies = enemyHeroes(state);

  // Fase 6 (SPEC.md §13.8): guarda de apertura, byte a byte la misma que signals/mix.ts ya usa.
  // Deliberadamente NO usa deriveDecisionContext(state, true) === "team_opening" -- esa función
  // devuelve arrays vacíos con state.localSide === "unknown" y reportaría "team_opening" sobre un
  // tablero con 10 picks (SPEC.md §13.16-C). Si options.teamOpening es true pero ya hay picks, cae
  // al camino normal sin error.
  const isTeamOpening = options?.teamOpening === true && state.picks.radiant.length === 0 && state.picks.dire.length === 0;

  // Fase 6 (SPEC.md §13.8-2): en apertura, el KNN no se ejecuta -- con own=[] los 502 drafts del
  // corpus empatarían en 0 y el desempate quedaría arbitrario por orden de archivo (SPEC.md
  // §13.16-A). knn_similarity queda raw:null para todos, nunca un 0 fabricado.
  const knnScores = isTeamOpening ? new Map<HeroId, number>() : knnScoresByHero(own, index, heroPositions, candidates); // 2. KNN

  // Fase 6 (SPEC.md §13.4): pesos decaídos continuamente por fase -- con own+enemy >= 4 devuelve
  // `weights` idéntico. En apertura, el KNN queda fuera y la calibración reserva 20% a posición
  // y 80% a evidencia de bans; la transición evita un salto al cerrar la primera ronda.
  const phaseWeights = isTeamOpening
    ? deriveDynamicPipelineWeights(weights, own.length, enemies.length)
    : deriveContinuousPipelineWeights(weights, own.length, enemies.length);

  // Gobernanza 2.0 (ampliación 5v5, evt-107): sin inferencia real de asignación de línea (fuera
  // de alcance, Fase 6 §2.2) sigue sin resolverse -- pero antes el candidato solo se emparejaba
  // con el PRIMER pick propio conocido y los DOS primeros rivales, descartando el resto del draft
  // ya confirmado. Ahora lane_score/denial_score usan el roster COMPLETO de aliados/rivales
  // confirmados. Ambos precomputados una sola vez por corrida (no dependen del candidato) --
  // memoización real: sin esto, cada uno de los ~100+ candidatos repetiría la misma resolución de
  // perfiles/distribuciones de posición para el mismo roster fijo.
  const ownPartnerProfiles = own.map((h) => resolveProfile(h, profiles));
  const enemyProfiles = enemies.map((h) => resolveProfile(h, profiles));

  // Fase 6 (SPEC.md §13.6/§13.8): en apertura, el objetivo del "denial" son los héroes BANEADOS
  // (no hay picks rivales todavía), y la combinación es por SUMA, no promedio -- al revés del
  // camino normal (varios rivales confirmados se promedian; varios bans se acumulan, cada uno es
  // un evento de información independiente). Sin bans -> null para todos, nunca 0 (regla dura de
  // engine.md).
  const flexTargets = isTeamOpening ? banFlexTargets(state, heroPositions) : rivalFlexTargets(state, heroPositions);

  // Fase 6 (SPEC.md §13.5/§13.6): con options.matchups inyectado, usa la fuente real respaldada
  // por OpenDota; si no, corpusMatchupWinrate sin cambios -- scripts/evaluate-pro-drafter.ts
  // depende de su metodología leave-one-out restringida al corpus. En apertura, el término de
  // matchup es el de alivio por solapamiento posicional (ban-relief.ts), nunca el proxy normal.
  const matchupWinrate: MatchupWinrateFn = isTeamOpening
    ? createTeamOpeningMatchupWinrate(options?.matchups ?? {}, heroPositions)
    : options?.matchups
      ? createMetaMatchupWinrate(options.matchups)
      : corpusMatchupWinrate(corpus);
  const opportunityWinrate: MatchupWinrateFn = isTeamOpening
    ? createOpportunityWindowScore(options?.matchups ?? {}, heroPositions)
    : matchupWinrate;
  const earlyPressure = isTeamOpening ? createPositionalCommitment(heroPositions) : earlyPressureFromProfiles(profiles);
  const beta = isTeamOpening ? BETA_OPENING : DEFAULT_BETA;

  const strategyOf = isTeamOpening
    ? extractCandidateStrategies(candidates, options?.heroCapabilities ?? [])
    : new Map<HeroId, DraftPathArchetype>();

  const results: PipelineCandidateResult[] = candidates.map((candidateHero) => {
    const laneResult = evaluateLaneRoster(
      [features.get(candidateHero), ...ownPartnerProfiles], // 3. Lane Sim
      enemyProfiles,
      LANE_WEIGHTS,
    );

    const denialRaw = // 4. Intent Decoder
      flexTargets.length === 0
        ? null
        : isTeamOpening
        ? flexTargets.reduce((sum, target) => {
          const direct = calculateDenialScore(candidateHero, target, matchupWinrate, earlyPressure, beta);
          const opportunity = calculateDenialScore(candidateHero, target, opportunityWinrate, () => 0, 0);
          return sum + direct + opportunity;
        }, 0)
          : average(flexTargets.map((target) => calculateDenialScore(candidateHero, target, matchupWinrate, earlyPressure, beta)));

    const signals: PipelineSignalContribution[] = [
      { signal: "knn_similarity", raw: knnScores.get(candidateHero) ?? null },
      { signal: "lane_score", raw: laneResult.laneScore },
      { signal: "denial_score", raw: denialRaw },
    ];

    const mergedScore = mergePipelineSignals(signals, phaseWeights);
    return {
      heroId: candidateHero,
      score: (() => {
        const openingScore = isTeamOpening ? adjustOpeningFlexScore(mergedScore, candidateHero, heroPositions) : mergedScore;
        if (options?.targetPosition === undefined) return openingScore;
        const fit = positionFitScore(candidateHero, options.targetPosition, heroPositions);
        // La posición guía el ranking, pero no elimina una excepción respaldada por las demás señales.
        // La posición elegida es una restricción de producto: una excepción flex sigue
        // disponible, pero no puede desplazar a un héroe compatible cuando hay candidatos.
        return openingScore + fit * 35 - (fit === 0 ? 25 : 0);
      })(),
      signals,
    }; // 5. Merger
  });

  if (isTeamOpening) {
    // 6. Overrides tácticos post-scoring y selección determinista.
    const overridden = applyTacticalOverrides(results, state.banned, options?.tacticalOverrides);
    return diversifyByStrategy(sortForOpening(overridden), strategyOf, OPENING_TOP_N, OPENING_REPEAT_STRATEGY_PENALTY);
  }
  return results.sort((a, b) => b.score - a.score).slice(0, options?.topN ?? TOP_N);
}
