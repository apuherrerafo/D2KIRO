import type { DraftFormatId, DraftState, HeroId, TeamSide } from "@/features/draft/types";

// Espejo a mano del contrato de POST /api/v1/draft/pro-recommendations
// (apps/engine/src/server/routes/pro-drafter.ts) -- mismo criterio que `SignalId` en
// features/draft/types.ts (web.md, Fase 3): apps/web y apps/engine son procesos independientes,
// nunca un import cruzado. Nunca se amplía el `SignalId` de v5 con estos 3 valores -- el propio
// motor los mantiene en un árbol de tipos separado (`PipelineSignalId`, pipeline/merge.ts) por la
// misma razón: `SIGNAL_LABELS`/`SCORING_WEIGHTS_V5` son Records totales que se romperían.
export type ProSignalId = "knn_similarity" | "lane_score" | "denial_score";

export interface ProSignalContribution {
  signal: ProSignalId;
  raw: number | null;
}

export interface ProSuggestion {
  hero: HeroId;
  rank: 1 | 2 | 3;
  score: number;
  signals: ProSignalContribution[];
}

export type ProEngineVersion = "pro-drafter" | "v5";

export interface ProDrafterResponse {
  schema: "pro-drafter-suggestions/v1";
  suggestions: ProSuggestion[];
  fallback_applied: boolean;
  cache_hit: boolean;
  engine_version: ProEngineVersion;
}

// Retrocompatibilidad real, no hipotética (Fase 3, sesión Gobernanza 2.0): con ENABLE_PRO_DRAFTER
// apagado del lado del motor, server/app.ts responde en esta MISMA URL con el shape v5 real
// (`schema: "suggestions/v1"`) en vez de ProDrafterResponse -- ver server/app.ts:258-260. Espejo
// mínimo, solo lo que este cliente necesita para distinguirlo y seguir mostrando algo útil: nunca
// se importa el `SuggestionSet`/`Suggestion` real de apps/engine (regla dura de este archivo,
// arriba) ni se declaran sus 5 señales (`SignalId`) -- el desglose de v5 no cabe en un panel
// rotulado "Pro-Drafter" sin confundir, así que se descarta a propósito (ver toProDrafterView).
export interface LegacySuggestionSetResponse {
  schema: "suggestions/v1";
  suggestions: { hero: HeroId; rank: 1 | 2 | 3; score: number }[];
}

export type ProRecommendationsResponse = ProDrafterResponse | LegacySuggestionSetResponse;

export function isProDrafterSchema(data: ProRecommendationsResponse): data is ProDrafterResponse {
  return data.schema === "pro-drafter-suggestions/v1";
}

export interface ProDrafterView {
  engineVersion: ProEngineVersion;
  fallbackApplied: boolean;
  cacheHit: boolean;
  suggestions: ProSuggestion[];
}

// Une las dos formas reales posibles de la respuesta en una sola vista -- ProDrafterPanel nunca
// necesita conocer el shape v5 directamente. `fallbackApplied: true` en la rama legacy es honesto
// aunque la causa real sea distinta de un fallback en tiempo de ejecución (Pro-Drafter ni se
// intentó, el flag del motor está apagado) -- desde la UI, el efecto observable es el mismo: estas
// sugerencias no salieron de Pro-Drafter, y eso es exactamente lo que el badge comunica.
export function toProDrafterView(data: ProRecommendationsResponse): ProDrafterView {
  if (isProDrafterSchema(data)) {
    return { engineVersion: data.engine_version, fallbackApplied: data.fallback_applied, cacheHit: data.cache_hit, suggestions: data.suggestions };
  }
  return {
    engineVersion: "v5",
    fallbackApplied: true,
    cacheHit: false,
    suggestions: data.suggestions.map((s) => ({ ...s, signals: [] })),
  };
}

// Mismo shape que `SuggestionsPreviewRequest` del motor (server/edge.ts) -- reutilizado a
// propósito, un solo contrato de entrada para las dos rutas (v5 y pro-drafter) sin importar el
// estado del flag.
export interface ProDrafterRequest {
  format: DraftFormatId | "unknown";
  patch: string;
  localSide: TeamSide | "unknown";
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
}

export function buildProDrafterRequest(draftState: DraftState): ProDrafterRequest {
  return {
    format: draftState.format,
    patch: draftState.patch,
    localSide: draftState.localSide,
    banned: draftState.banned,
    picks: draftState.picks,
  };
}

export const PRO_SIGNAL_LABELS: Record<ProSignalId, string> = {
  knn_similarity: "Similitud con drafts pro",
  lane_score: "Línea (2v2)",
  denial_score: "Denial de flex-pick",
};

export const ENGINE_VERSION_LABELS: Record<ProEngineVersion, string> = {
  "pro-drafter": "Pro-Drafter (KNN 5v5)",
  v5: "Fallback (v5)",
};
