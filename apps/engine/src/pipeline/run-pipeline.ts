import { extractCandidateFeatures } from "./feature-extractor";
import { mergePipelineSignals } from "./merge";
import type { PipelineSignalContribution } from "./merge";
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
import type { HeroPositions } from "../signals/hero-positions";

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
): readonly PipelineCandidateResult[] {
  const candidates = candidatesFromCorpus(state, corpus);
  const features = extractCandidateFeatures(state, candidates, profiles); // 1. Feature Extractor

  const own = ownHeroes(state);
  const knnScores = knnScoresByHero(own, index, heroPositions, candidates); // 2. KNN

  // Gobernanza 2.0 (ampliación 5v5, evt-107): sin inferencia real de asignación de línea (fuera
  // de alcance, Fase 6 §2.2) sigue sin resolverse -- pero antes el candidato solo se emparejaba
  // con el PRIMER pick propio conocido y los DOS primeros rivales, descartando el resto del draft
  // ya confirmado. Ahora lane_score/denial_score usan el roster COMPLETO de aliados/rivales
  // confirmados. Ambos precomputados una sola vez por corrida (no dependen del candidato) --
  // memoización real: sin esto, cada uno de los ~100+ candidatos repetiría la misma resolución de
  // perfiles/distribuciones de posición para el mismo roster fijo.
  const ownPartnerProfiles = own.map((h) => resolveProfile(h, profiles));
  const enemyProfiles = enemyHeroes(state).map((h) => resolveProfile(h, profiles));
  const flexTargets = rivalFlexTargets(state, heroPositions);
  const matchupWinrate = corpusMatchupWinrate(corpus);
  const earlyPressure = earlyPressureFromProfiles(profiles);

  const results: PipelineCandidateResult[] = candidates.map((candidateHero) => {
    const laneResult = evaluateLaneRoster(
      [features.get(candidateHero), ...ownPartnerProfiles], // 3. Lane Sim
      enemyProfiles,
      LANE_WEIGHTS,
    );

    const denialRaw = // 4. Intent Decoder
      flexTargets.length === 0
        ? null
        : average(flexTargets.map((target) => calculateDenialScore(candidateHero, target, matchupWinrate, earlyPressure, DEFAULT_BETA)));

    const signals: PipelineSignalContribution[] = [
      { signal: "knn_similarity", raw: knnScores.get(candidateHero) ?? null },
      { signal: "lane_score", raw: laneResult.laneScore },
      { signal: "denial_score", raw: denialRaw },
    ];

    return { heroId: candidateHero, score: mergePipelineSignals(signals, weights), signals }; // 5. Merger
  });

  return results.sort((a, b) => b.score - a.score).slice(0, TOP_N); // 6. Top 3
}
