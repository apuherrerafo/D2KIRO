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
import { evaluateLane2v2 } from "../lane/evaluate";
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

// El rival a "denegar" es el de mayor entropía entre los picks rivales confirmados -- el flex
// pick más ambiguo es el que más vale la pena atacar. Sin picks rivales -> undefined, y
// denial_score cae a null para todos los candidatos (nunca se fabrica un objetivo).
function rivalFlexTarget(state: DraftState, heroPositions: HeroPositions): FlexInferenceResult | undefined {
  const enemies = enemyHeroes(state);
  if (enemies.length === 0) return undefined;
  const inferences = enemies.map((h) => inferFlexPick(h, heroPositions, DEFAULT_ENTROPY_THRESHOLD));
  return inferences.reduce((max, cur) => (cur.distribution.entropy > max.distribution.entropy ? cur : max));
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

  // Sin inferencia real de asignación de línea (fuera de alcance, Fase 6 §2.2): el candidato se
  // empareja con el primer pick propio conocido; el rival, con sus dos primeros picks conocidos.
  const allyPartner = own[0];
  const [enemy1, enemy2] = enemyHeroes(state);
  const matchupWinrate = corpusMatchupWinrate(corpus);
  const earlyPressure = earlyPressureFromProfiles(profiles);
  const flexTarget = rivalFlexTarget(state, heroPositions);

  const results: PipelineCandidateResult[] = candidates.map((candidateHero) => {
    const laneResult = evaluateLane2v2(
      [features.get(candidateHero), resolveProfile(allyPartner, profiles)], // 3. Lane Sim
      [resolveProfile(enemy1, profiles), resolveProfile(enemy2, profiles)],
      LANE_WEIGHTS,
    );

    const denialRaw = flexTarget // 4. Intent Decoder
      ? calculateDenialScore(candidateHero, flexTarget, matchupWinrate, earlyPressure, DEFAULT_BETA)
      : null;

    const signals: PipelineSignalContribution[] = [
      { signal: "knn_similarity", raw: knnScores.get(candidateHero) ?? null },
      { signal: "lane_score", raw: laneResult.laneScore },
      { signal: "denial_score", raw: denialRaw },
    ];

    return { heroId: candidateHero, score: mergePipelineSignals(signals, weights), signals }; // 5. Merger
  });

  return results.sort((a, b) => b.score - a.score).slice(0, TOP_N); // 6. Top 3
}
