import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";
import type { CalculatePoolResult, HeroPoolEntry, HeroPoolPutEntry } from "@/features/hero-pool/types";
import type { TeamGroupEntry, TeamGroupPutBody } from "@/features/team-groups/types";

const ENGINE_HTTP_URL = process.env.NEXT_PUBLIC_ENGINE_HTTP_URL ?? "http://127.0.0.1:4000";

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

export interface SettingEntry {
  key: string;
  value: string;
}

// Régimen de datos por defecto del sitio -- RTK Query contra apps/engine (web.md). La vista de
// draft en vivo (TSK-012) es la única excepción, nunca pasa por aquí.
export const engineApi = createApi({
  reducerPath: "engineApi",
  baseQuery: fetchBaseQuery({ baseUrl: ENGINE_HTTP_URL }),
  tagTypes: ["MetaStatus", "Settings", "HeroPool", "TeamGroups"],
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
    getSettings: builder.query<SettingEntry[], void>({
      query: () => "/api/settings",
      providesTags: ["Settings"],
    }),
    updateSetting: builder.mutation<SettingEntry, SettingEntry>({
      query: (body) => ({ url: "/api/settings", method: "PUT", body }),
      invalidatesTags: ["Settings"],
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
    calculateHeroPool: builder.mutation<CalculatePoolResult, { accountId: string; days?: number }>({
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
  }),
});

export const {
  useGetMetaStatusQuery,
  useSyncMetaMutation,
  useGetHeroesQuery,
  useGetSettingsQuery,
  useUpdateSettingMutation,
  useGetHeroPoolQuery,
  useUpdateHeroPoolMutation,
  useCalculateHeroPoolMutation,
  useGetTeamGroupsQuery,
  useCreateTeamGroupMutation,
  useUpdateTeamGroupMutation,
  useDeleteTeamGroupMutation,
} = engineApi;
