import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { DraftPathSet } from "@/features/draft-paths/types";
import type { CalculatePoolResult, HeroPoolEntry, HeroPoolPutEntry } from "@/features/hero-pool/types";
import type { ProDrafterRequest, ProRecommendationsResponse } from "@/features/pro-drafter/types";
import type { TeamGroupEntry, TeamGroupPutBody } from "@/features/team-groups/types";
import { ENGINE_HTTP_BASE_URL } from "./engine-url";

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
  tagTypes: ["MetaStatus", "Heroes", "HeroPool", "TeamGroups", "DraftPaths"],
  endpoints: (builder) => ({
    getMetaStatus: builder.query<MetaStatus, void>({
      query: () => "/api/meta/status",
      providesTags: ["MetaStatus"],
    }),
    syncMeta: builder.mutation<{ syncId: number }, void>({
      query: () => ({ url: "/api/meta/sync", method: "POST" }),
      invalidatesTags: ["MetaStatus", "Heroes"],
    }),
    getHeroes: builder.query<HeroMeta[], void>({
      query: () => "/api/heroes",
      providesTags: ["Heroes"],
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
    // TSK-214 revierte la regla de TSK-037/038 ("el draft en vivo siempre habla directo al engine
    // local, nunca vía /engine"). Esa regla nació cuando el draft en vivo asumía un motor en la
    // máquina del propio visitante; hoy `DRAFT_LIVE_ENABLED` está apagado por defecto y quien usa
    // estas rutas de verdad es el Simulador, servido desde Railway. Una URL absoluta a
    // http://127.0.0.1:4000 desde el navegador falla siempre en producción. Vía `/engine` el
    // comportamiento local no cambia: en `bun run dev` el rewrite de Next apunta al mismo motor
    // local del visitante.
    getDraftPaths: builder.query<DraftPathSet, string>({
      query: (sessionId) => `${ENGINE_HTTP_BASE_URL}/api/session/${encodeURIComponent(sessionId)}/draft-paths`,
      providesTags: ["DraftPaths"],
    }),
    // Endpoint experimental tras ENABLE_PRO_DRAFTER (server/app.ts) -- mismo criterio que
    // getDraftPaths arriba: desde TSK-214 va por el proxy `/engine`, no a un loopback que el
    // navegador de un visitante remoto nunca puede alcanzar. Tipado como `ProRecommendationsResponse`
    // (unión, no solo `ProDrafterResponse`) -- retrocompatibilidad real: con el flag apagado del
    // lado del motor esta misma URL responde con el shape v5 (`suggestions/v1`), no una hipótesis
    // (ver server/app.ts:258-260 y features/pro-drafter/types.ts).
    postProRecommendations: builder.mutation<ProRecommendationsResponse, ProDrafterRequest | { body: ProDrafterRequest; accountToken: string }>({
      query: (arg) => {
        const body = "body" in arg ? arg.body : arg;
        const accountToken = "body" in arg ? arg.accountToken : undefined;
        return { url: `${ENGINE_HTTP_BASE_URL}/api/v1/draft/pro-recommendations`, method: "POST", body, ...(accountToken ? { headers: { "x-account-token": accountToken } } : {}) };
      },
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
