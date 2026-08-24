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

export interface ProDrafterResponse {
  schema: "pro-drafter-suggestions/v1";
  suggestions: ProSuggestion[];
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
