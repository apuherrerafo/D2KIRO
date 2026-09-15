"use client";

import { create } from "zustand";
import type { DraftState, SuggestionSet } from "@/features/draft/types";
import type { OrchestratorResult } from "./orchestrator";
import type { DraftConfig, DraftPhase, HeroId } from "./types";

export type PreviewStatus = "idle" | "loading" | "ready" | "failed";
export type EngineStatus = "ok" | "unreachable";

export interface RandomDraftState {
  config: DraftConfig | null;
  phase: DraftPhase;
  sessionId: string | null;
  draftState: DraftState | null;
  suggestions: SuggestionSet | null;
  staleWarning: boolean;
  lastSyncedAt: string | null;
  previewStatus: PreviewStatus;
  engineStatus: EngineStatus;
}

export interface RandomDraftActions {
  startSession(config: DraftConfig, sessionId: string, orchestratorResult: OrchestratorResult): void;
  confirmPick(heroId: HeroId): void;
  deselectPick(heroId: HeroId): void;
  resetSession(): void;
  setDraftState(state: DraftState, suggestions: SuggestionSet | null): void;
  setVisualPhase(phase: DraftPhase): void;
  setStaleInfo(isStale: boolean, syncedAt: string | null): void;
  setPreviewStatus(status: PreviewStatus): void;
  setEngineStatus(status: EngineStatus): void;
  tickTimer(deltaMs: number): void;
}

type RandomDraftStore = RandomDraftState & RandomDraftActions;

export const useRandomDraftStore = create<RandomDraftStore>((set, get) => ({
  config: null,
  phase: { type: "idle" },
  sessionId: null,
  draftState: null,
  suggestions: null,
  staleWarning: false,
  lastSyncedAt: null,
  previewStatus: "idle",
  engineStatus: "ok",

  startSession(config, sessionId, orchestratorResult) {
    set({
      config,
      sessionId,
      draftState: null,
      suggestions: null,
      phase: { type: "ban_phase_complete", resolvedBans: orchestratorResult.resolvedBans },
      previewStatus: "idle",
      engineStatus: "ok",
    });
  },

  confirmPick(heroId) {
    const { phase } = get();
    if (phase.type !== "blind_round" || phase.pendingUserPicks.includes(heroId)) return;
    set({ phase: { ...phase, pendingUserPicks: [...phase.pendingUserPicks, heroId] } });
  },

  deselectPick(heroId) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    set({ phase: { ...phase, pendingUserPicks: phase.pendingUserPicks.filter((id) => id !== heroId) } });
  },

  resetSession() {
    set({
      config: null,
      phase: { type: "idle" },
      sessionId: null,
      draftState: null,
      suggestions: null,
      staleWarning: false,
      lastSyncedAt: null,
      previewStatus: "idle",
      engineStatus: "ok",
    });
  },

  setDraftState(draftState, suggestions) {
    set({ draftState, suggestions });
  },

  setVisualPhase(phase) {
    set({ phase });
  },

  setStaleInfo(isStale, syncedAt) {
    set({ staleWarning: isStale, lastSyncedAt: syncedAt });
  },

  setPreviewStatus(status) {
    set({ previewStatus: status });
  },

  setEngineStatus(status) {
    set({ engineStatus: status });
  },

  tickTimer(deltaMs) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    set({ phase: { ...phase, timerRemainingMs: Math.max(0, phase.timerRemainingMs - deltaMs) } });
  },
}));
