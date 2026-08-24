import rawWeights from "./pro-drafter-weights-v6.json";

// Fase 8 (pro-drafter-spec-v1.md §2.4/§3): "Export Format: JSON de pesos pre-calculados,
// consumible por apps/engine en O(1) -- nunca reemplaza SCORING_WEIGHTS_V5 directamente."
//
// Árbol de pesos completamente separado -- este archivo nunca importa signals/weights.ts ni
// SignalId, a propósito. `pro-drafter-weights-v6.json` es una propuesta candidata (SCORING_
// WEIGHTS_V6 hipotética, per el doc): promoverla a activa es una decisión manual con su propio
// /blueprint, no algo que este loader haga.
//
// [SUPUESTO, ver plan Fase 5-8]: a diferencia del resto de los loaders del motor (hero-positions,
// capabilities, corpus, hero-line-profiles -- todos degradan en silencio ante un dato corrupto),
// este SÍ lanza. Es un archivo de config chico y curado a mano, no una lista de entradas donde
// "descartar la inválida y seguir" tenga sentido: un pipeline de pesos mal sumado es un bug de
// configuración real que debe fallar ruidoso al cargar, no degradar en silencio el ranking de
// todo el pipeline.

export interface PipelineWeights {
  readonly knn_similarity: number;
  readonly lane_score: number;
  readonly denial_score: number;
}

const REQUIRED_KEYS = ["knn_similarity", "lane_score", "denial_score"] as const;
const SUM_EPSILON = 1e-9;

export function parsePipelineWeights(raw: unknown): PipelineWeights {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("parsePipelineWeights: el archivo no es un objeto válido");
  }
  const record = raw as Record<string, unknown>;

  for (const key of REQUIRED_KEYS) {
    if (typeof record[key] !== "number") {
      throw new Error(`parsePipelineWeights: falta la clave requerida "${key}" (o no es numérica)`);
    }
  }

  const weights: PipelineWeights = {
    knn_similarity: record.knn_similarity as number,
    lane_score: record.lane_score as number,
    denial_score: record.denial_score as number,
  };

  const sum = weights.knn_similarity + weights.lane_score + weights.denial_score;
  if (Math.abs(sum - 1) > SUM_EPSILON) {
    throw new Error(`parsePipelineWeights: los pesos deben sumar 1.0, suman ${sum}`);
  }

  return weights;
}

export function loadPipelineWeights(): PipelineWeights {
  return parsePipelineWeights(rawWeights);
}
