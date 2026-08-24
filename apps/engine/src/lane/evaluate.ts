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

// Gobernanza 2.0 (ampliación 5v5, evt-107): generalización deliberada de evaluateLane2v2 a un
// roster de tamaño variable -- `run-pipeline.ts` antes emparejaba el candidato solo con el
// primer aliado propio y los dos primeros rivales confirmados (ventana fija 1v2), descartando el
// resto del draft ya conocido. Acá Φ_k pasa de "(A1[k]+A2[k])/2 − (E1[k]+E2[k])/2" (interactions.ts,
// fijo a 2v2, sigue existiendo tal cual para quien la use) a un promedio sobre TODOS los perfiles
// confirmados de cada lado -- misma fórmula sigmoide(Σω·Φ), misma sustitución neutra 0.5 para un
// héroe sin perfil curado. `evaluateLane2v2` NO se toca ni se reimplementa: sigue siendo el
// primitivo 2v2 exacto que documenta pro-drafter-spec-v1.md §2.2, esta función es la única
// consumidora nueva de `run-pipeline.ts`.
function meanOfDimension(profiles: readonly HeroLineProfile[], dimension: LaneDimension): number {
  if (profiles.length === 0) return NEUTRAL_VALUE; // lado sin ningún pick confirmado -- neutro, no 0
  return profiles.reduce((sum, profile) => sum + profile[dimension], 0) / profiles.length;
}

export function evaluateLaneRoster(
  ally: readonly (HeroLineProfile | undefined)[],
  enemy: readonly (HeroLineProfile | undefined)[],
  weights: readonly [number, number, number, number, number],
): LaneInteractionResult {
  const confidence: LaneConfidence = [...ally, ...enemy].every((profile) => profile !== undefined)
    ? "full"
    : "partial_signals";

  const resolvedAlly = ally.map(resolveProfile);
  const resolvedEnemy = enemy.map(resolveProfile);

  const perDimension = {} as Record<LaneDimension, number>;
  let weightedSum = 0;

  LANE_DIMENSIONS.forEach((dimension, i) => {
    const delta = meanOfDimension(resolvedAlly, dimension) - meanOfDimension(resolvedEnemy, dimension);
    perDimension[dimension] = delta;
    weightedSum += (weights[i] ?? 0) * delta;
  });

  return { laneScore: sigmoid(weightedSum), perDimension, confidence };
}
