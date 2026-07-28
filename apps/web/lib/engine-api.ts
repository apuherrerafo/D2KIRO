import { createApi, fetchBaseQuery } from "@reduxjs/toolkit/query/react";
import type { HeroMeta } from "@/features/draft/use-hero-catalog";

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
  tagTypes: ["MetaStatus", "Settings"],
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
  }),
});

export const {
  useGetMetaStatusQuery,
  useSyncMetaMutation,
  useGetHeroesQuery,
  useGetSettingsQuery,
  useUpdateSettingMutation,
} = engineApi;
