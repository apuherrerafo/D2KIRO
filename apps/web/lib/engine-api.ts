import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { DraftPathSet } from "@/features/draft-paths/types";
import type { CalculatePoolResult, HeroPoolEntry, HeroPoolPutEntry } from "@/features/hero-pool/types";
import type { ProDrafterRequest, ProRecommendationsResponse } from "@/features/pro-drafter/types";
import type { TeamGroupEntry, TeamGroupPutBody } from "@/features/team-groups/types";
import { ENGINE_HTTP_BASE_URL, LOCAL_DRAFT_ENGINE_HTTP_BASE_URL } from "./engine-url";

export interface MetaSyncAttempt {
  status: "running" | "ok" | "failed";
  finishedAt: string | null;
  error: string | null;
}

export interface MetaStatus {
  syncedAt: string | null;
  isStale: boolean;
  lastSync: MetaSyncAttempt | null;
}

// Régimen de datos por defecto del sitio -- RTK Query contra apps/engine (web.md). La vista de
// draft en vivo (TSK-012) es la única excepción, nunca pasa por aquí.
export const engineApi = createApi({
  reducerPath: "engineApi",
  baseQuery: fetchBaseQuery({ baseUrl: ENGINE_HTTP_BASE_URL }),
  tagTypes: ["MetaStatus", "HeroPool", "TeamGroups", "DraftPaths"],
  endpoints: (builder) => ({
    getMetaStatus: builder.query<MetaStatus, void>({
      query: () => "/api/meta/status",
      providesTags: ["MetaStatus"],
    }),
    syncMeta: builder.mutation<{ syncId: number }, void>({
      query: () => ({ url: "/api/meta/sync", method: "POST" }),
      invalidatesTags: ["MetaStatus"],
    }),
    getHeroes: builder.query<HeroMeta[], void>({
      query: () => "/api/heroes",
    }),
    // TSK-024/025 (fase 1b): mismo régimen "página normal" -- el pool se edita en configuración,
    // nunca por WebSocket (web.md).
    getHeroPool: builder.query<HeroPoolEntry[], void>({
      query: () => "/api/hero-pool",
      providesTags: ["HeroPool"],
    }),
    updateHeroPool: builder.mutation<HeroPoolEntry[], { entries: HeroPoolPutEntry[] }>({
      query: (body) => ({ url: "/api/hero-pool", method: "PUT", body }),
      invalidatesTags: ["HeroPool"],
    }),
    calculateHeroPool: builder.mutation<CalculatePoolResult, { days?: number }>({
      query: (body) => ({ url: "/api/hero-pool/calculate", method: "POST", body }),
      // No invalida HeroPool -- TSK-021 nunca escribe en SQLite, solo propone.
    }),
    getTeamGroups: builder.query<TeamGroupEntry[], void>({
      query: () => "/api/team-groups",
      providesTags: ["TeamGroups"],
    }),
    createTeamGroup: builder.mutation<TeamGroupEntry, TeamGroupPutBody>({
      query: (body) => ({ url: "/api/team-groups", method: "POST", body }),
      invalidatesTags: ["TeamGroups"],
    }),
    updateTeamGroup: builder.mutation<TeamGroupEntry, { id: number; body: TeamGroupPutBody }>({
      query: ({ id, body }) => ({ url: `/api/team-groups/${id}`, method: "PUT", body }),
      invalidatesTags: ["TeamGroups"],
    }),
    deleteTeamGroup: builder.mutation<void, number>({
      query: (id) => ({ url: `/api/team-groups/${id}`, method: "DELETE" }),
      invalidatesTags: ["TeamGroups"],
    }),
    // TSK-036 vive fuera del proxy de páginas de configuración a propósito -- "caminos de draft"
    // solo tiene sentido con un draft activo, y esa ruta nunca está en el allowlist de
    // next.config.ts (regla dura, TSK-037/038: /draft en vivo siempre habla directo al engine
    // local, nunca vía /engine). Se le da una URL absoluta -- fetchBaseQuery la usa tal cual, sin
    // anteponerle el baseUrl relativo compartido con el resto de engineApi.
    getDraftPaths: builder.query<DraftPathSet, string>({
      query: (sessionId) => `${LOCAL_DRAFT_ENGINE_HTTP_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/draft-paths`,
      providesTags: ["DraftPaths"],
    }),
    // Endpoint experimental tras ENABLE_PRO_DRAFTER (server/app.ts) -- mismo criterio que
    // getDraftPaths: la vista de draft en vivo nunca pasa por el proxy /engine (regla dura,
    // TSK-037/038), URL absoluta directa al motor local. Tipado como `ProRecommendationsResponse`
    // (unión, no solo `ProDrafterResponse`) -- retrocompatibilidad real: con el flag apagado del
    // lado del motor esta misma URL responde con el shape v5 (`suggestions/v1`), no una hipótesis
    // (ver server/app.ts:258-260 y features/pro-drafter/types.ts).
    postProRecommendations: builder.mutation<ProRecommendationsResponse, ProDrafterRequest>({
      query: (body) => ({ url: `${LOCAL_DRAFT_ENGINE_HTTP_BASE_URL}/api/v1/draft/pro-recommendations`, method: "POST", body }),
    }),
  }),
});

export const {
  useGetMetaStatusQuery,
  useSyncMetaMutation,
  useGetHeroesQuery,
  useGetHeroPoolQuery,
  useUpdateHeroPoolMutation,
  useCalculateHeroPoolMutation,
  useGetTeamGroupsQuery,
  useCreateTeamGroupMutation,
  useUpdateTeamGroupMutation,
  useDeleteTeamGroupMutation,
  useGetDraftPathsQuery,
  usePostProRecommendationsMutation,
} = engineApi;
