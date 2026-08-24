import { interactionDelta } from "./interactions";
import { LANE_DIMENSIONS } from "./profiles";
import type { HeroLineProfile, LaneDimension } from "./profiles";

// Fase 6 (pro-drafter-spec-v1.md §2.2): LaneScore(A1,A2,E1,E2) = σ(Σ ω_k · Φ_k), sigmoide sobre la
// suma ponderada de los 5 Φ_k (interactions.ts, 6.2). El doc asume la asignación de línea 2v2 ya
// resuelta -- este módulo no infiere quién juega con quién, solo evalúa un enfrentamiento dado.
//
// [SUPUESTO, ver plan Fase 5-8]: "falta perfil de un héroe -> partial_signals, se sustituye por
// 0.5 neutro" se resuelve sustituyendo las 5 dimensiones de ESE héroe por 0.5 (el punto medio de
// la escala [0,1] de HeroLineProfile) antes de calcular Φ_k -- nunca se reimplementa
// interactionDelta con una rama especial para "sin dato". Pesos que no suman 1 se usan tal cual,
// sin normalizar en silencio: la validación de esa invariante es responsabilidad del weight
// loader (Fase 8), no de esta función pura.

const NEUTRAL_VALUE = 0.5;
const NEUTRAL_PROFILE: HeroLineProfile = {
  heroId: -1, // sentinela -- nunca corresponde a un héroe real, no se persiste ni se expone
  sustain: NEUTRAL_VALUE,
  killPressure: NEUTRAL_VALUE,
  harassRange: NEUTRAL_VALUE,
  dispelSave: NEUTRAL_VALUE,
  creepControl: NEUTRAL_VALUE,
};

export type LaneConfidence = "full" | "partial_signals";

export interface LaneInteractionResult {
  readonly laneScore: number; // [0,1], > 0.5 favorece al par propio
  readonly perDimension: Readonly<Record<LaneDimension, number>>;
  readonly confidence: LaneConfidence;
}

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function resolveProfile(profile: HeroLineProfile | undefined): HeroLineProfile {
  return profile ?? NEUTRAL_PROFILE;
}

// El orden de `weights` corresponde exactamente al orden de LANE_DIMENSIONS -- contrato
// posicional, no por nombre (mismo criterio que SCORING_WEIGHTS_V5, un Record en vez de tupla,
// pero acá la tupla la exige la interfaz del doc de investigación tal cual).
export function evaluateLane2v2(
  ally: readonly [HeroLineProfile | undefined, HeroLineProfile | undefined],
  enemy: readonly [HeroLineProfile | undefined, HeroLineProfile | undefined],
  weights: readonly [number, number, number, number, number],
): LaneInteractionResult {
  const confidence: LaneConfidence = [...ally, ...enemy].every((profile) => profile !== undefined)
    ? "full"
    : "partial_signals";

  const resolvedAlly: readonly [HeroLineProfile, HeroLineProfile] = [
    resolveProfile(ally[0]),
    resolveProfile(ally[1]),
  ];
  const resolvedEnemy: readonly [HeroLineProfile, HeroLineProfile] = [
    resolveProfile(enemy[0]),
    resolveProfile(enemy[1]),
  ];

  const perDimension = {} as Record<LaneDimension, number>;
  let weightedSum = 0;

  LANE_DIMENSIONS.forEach((dimension, i) => {
    const delta = interactionDelta(dimension, resolvedAlly, resolvedEnemy);
    perDimension[dimension] = delta;
    weightedSum += (weights[i] ?? 0) * delta;
  });

  return { laneScore: sigmoid(weightedSum), perDimension, confidence };
}
