import type { HeroId } from "../draft/reducer";
import type { HeroPositions } from "../signals/hero-positions";

// Fase 7 (pro-drafter-spec-v1.md §2.3): PositionDistribution por héroe.
//
// [SUPUESTO, ver plan Fase 5-8]: el doc no da una fuente para la "belief propagation" sobre
// posiciones -- en vez de inventar un modelo bayesiano nuevo sin corpus, el prior se deriva
// normalizando los `matches` reales por posición que ya vive en hero-positions.json (S10, el
// mismo archivo que usa `position_fit`). Sin datos del héroe (ausente, o matches totales en 0) ->
// fallback explícito a distribución uniforme: máxima incertidumbre real, nunca un cero disfrazado
// de dato ni una excepción.

const POSITIONS = [1, 2, 3, 4, 5] as const;
const UNIFORM_PROBABILITY = 1 / POSITIONS.length;

export interface PositionDistribution {
  readonly heroId: HeroId;
  readonly probabilities: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>;
  readonly entropy: number; // bits -- 0 = certero, log2(5) ~= 2.32 = máxima incertidumbre
}

// Shannon: -Σ p·log2(p), con p=0 tratado como aporte 0 (evita log2(0) = -Infinity).
function shannonEntropy(probabilities: Readonly<Record<1 | 2 | 3 | 4 | 5, number>>): number {
  let entropy = 0;
  for (const position of POSITIONS) {
    const p = probabilities[position];
    if (p > 0) entropy -= p * Math.log2(p);
  }
  return entropy;
}

function uniformDistribution(heroId: HeroId): PositionDistribution {
  const probabilities = {
    1: UNIFORM_PROBABILITY,
    2: UNIFORM_PROBABILITY,
    3: UNIFORM_PROBABILITY,
    4: UNIFORM_PROBABILITY,
    5: UNIFORM_PROBABILITY,
  };
  return { heroId, probabilities, entropy: shannonEntropy(probabilities) };
}

export function deriveFlexDistribution(heroId: HeroId, heroPositions: HeroPositions): PositionDistribution {
  const shares = heroPositions[heroId] ?? [];
  const total = shares.reduce((sum, s) => sum + s.matches, 0);

  if (total === 0) return uniformDistribution(heroId);

  const probabilities = {} as Record<1 | 2 | 3 | 4 | 5, number>;
  for (const position of POSITIONS) {
    const matches = shares.find((s) => s.position === position)?.matches ?? 0;
    probabilities[position] = matches / total;
  }

  return { heroId, probabilities, entropy: shannonEntropy(probabilities) };
}
