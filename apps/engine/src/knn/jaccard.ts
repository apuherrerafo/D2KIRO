import type { DraftCandidate } from "./corpus";
import type { InMemoryDraftIndex } from "./draft-index";
import type { HeroId } from "../draft/reducer";
import type { HeroPositions } from "../signals/hero-positions";

// Fase 5 (pro-drafter-spec-v1.md §2.1): sim(D,C) = sum(w_i, i in D∩C) / sum(w_i, i in D∪C),
// w_i = alphaRole(i) * betaHero(i) * gammaSide(side).
//
// [SUPUESTO, ver plan Fase 5-8]: el doc no define contra qué conjunto de C se compara "own", ni
// qué "position" recibe alphaRole cuando el llamador solo tiene un HeroId. Se resuelve acá:
// - C se compara siempre contra `candidate.winningSide` -- el KNN busca composiciones parecidas
//   que GANARON, no cualquier lado del draft.
// - alphaRole se evalúa en las 5 posiciones y se toma el máximo por héroe (`roleWeight`): el peso
//   de rol de un ítem es "qué tan especialista es este héroe en su mejor posición", reutilizando
//   HeroPositions (S10) tal como decidió el plan -- ningún dato nuevo.

export interface JaccardWeights {
  readonly alphaRole: (heroId: HeroId, position: 1 | 2 | 3 | 4 | 5) => number;
  readonly betaHero: (heroId: HeroId) => number;
  readonly gammaSide: (side: "radiant" | "dire") => number;
}

export interface WeightedJaccardEngine {
  similarity(own: readonly HeroId[], candidate: DraftCandidate, weights: JaccardWeights): number;
  nearestNeighbors(
    own: readonly HeroId[],
    k: number,
    weights: JaccardWeights,
  ): readonly { candidate: DraftCandidate; sim: number }[];
}

const POSITIONS = [1, 2, 3, 4, 5] as const;

function roleWeight(heroId: HeroId, alphaRole: JaccardWeights["alphaRole"]): number {
  let max = 0;
  for (const position of POSITIONS) {
    const w = alphaRole(heroId, position);
    if (w > max) max = w;
  }
  return max;
}

function itemWeight(heroId: HeroId, side: "radiant" | "dire", weights: JaccardWeights): number {
  return roleWeight(heroId, weights.alphaRole) * weights.betaHero(heroId) * weights.gammaSide(side);
}

export function similarity(
  own: readonly HeroId[],
  candidate: DraftCandidate,
  weights: JaccardWeights,
): number {
  const ownSet = new Set(own);
  const winningHeroes = candidate.winningSide === "radiant" ? candidate.radiantHeroes : candidate.direHeroes;
  const candidateSet = new Set(winningHeroes);
  const union = new Set<HeroId>([...ownSet, ...candidateSet]);

  let numerator = 0;
  let denominator = 0;
  for (const heroId of union) {
    const weight = itemWeight(heroId, candidate.winningSide, weights);
    denominator += weight;
    if (ownSet.has(heroId) && candidateSet.has(heroId)) numerator += weight;
  }

  return denominator === 0 ? 0 : numerator / denominator;
}

// El KNN busca por SIMILITUD, no por contener exactamente los héroes de `own` -- por eso no usa
// `index.candidatesFor(own)` (esa es intersección AND estricta, de 5.2). `candidatesFor([])`
// devuelve el corpus completo, que acá se recorre exhaustivo y se ordena por `similarity`.
export function createJaccardEngine(index: InMemoryDraftIndex): WeightedJaccardEngine {
  function nearestNeighbors(own: readonly HeroId[], k: number, weights: JaccardWeights) {
    const scored = index
      .candidatesFor([])
      .map((candidate) => ({ candidate, sim: similarity(own, candidate, weights) }));

    scored.sort((a, b) => b.sim - a.sim);
    return k <= 0 ? [] : scored.slice(0, k);
  }

  return { similarity, nearestNeighbors };
}

// Pesos por defecto, reutilizando HeroPositions (S10) -- sin dato nuevo. betaHero/gammaSide
// quedan como hooks neutros (siempre 1): no hay fuente de fuerza de meta ni de sesgo real
// radiant/dire cableada al KNN todavía -- documentado como hueco real, no simulado con un número
// inventado (mismo criterio que el resto del motor frente a `raw: null`).
export function defaultJaccardWeights(heroPositions: HeroPositions): JaccardWeights {
  return {
    alphaRole: (heroId, position) => {
      const shares = heroPositions[heroId] ?? [];
      const total = shares.reduce((sum, s) => sum + s.matches, 0);
      if (total === 0) return 1; // sin dato de posición -> peso neutro, nunca penaliza el hueco
      const atPosition = shares.find((s) => s.position === position)?.matches ?? 0;
      return atPosition / total;
    },
    betaHero: () => 1,
    gammaSide: () => 1,
  };
}
