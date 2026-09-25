"use client";

import { create } from "zustand";
import type { DraftState } from "@/features/draft/types";
import type { CoachOutput } from "./coach-client";
import type { RecommendationSetV2 } from "./protocol-client";
import type { OrchestratorResult } from "./orchestrator";
import type { DraftConfig, DraftPhase, HeroId, SessionMode } from "./types";

export type PreviewStatus = "idle" | "loading" | "ready" | "failed";
export type EngineStatus = "ok" | "unreachable";

export interface RandomDraftState {
  config: DraftConfig | null;
  // MVP P0.1 -- "simulation" (default, matches every behavior before this field existed) or
  // "live_companion" (no Enemy Bot; manual entry). Fixed for the lifetime of a session -- set only
  // by startSession, cleared only by resetSession.
  sessionMode: SessionMode;
  phase: DraftPhase;
  sessionId: string | null;
  draftState: DraftState | null;
  // R1 S5 (blocker 1): RecommendationSet/v2, the ONE recommendation truth for this session family
  // -- never a suggestions/v1 SuggestionSet built from a client-side hypothetical DraftState.
  recommendations: RecommendationSetV2 | null;
  // AP Ranked Roles V1 / Wave 2: the Coach's RecommendationOutputV3 (primary action + shortlist),
  // built by the engine ON the V2 set above. Null until the first computation, or when the engine
  // has nothing to advise (no open seat).
  coach: CoachOutput | null;
  staleWarning: boolean;
  lastSyncedAt: string | null;
  previewStatus: PreviewStatus;
  engineStatus: EngineStatus;
}

export interface RandomDraftActions {
  startSession(config: DraftConfig, sessionId: string, orchestratorResult: OrchestratorResult, mode?: SessionMode): void;
  /** Registra un héroe que el Player ya selló (lock) en el intento actual de la ronda. */
  confirmPick(heroId: HeroId, rosterSeat?: number): void;
  resetSession(): void;
  setDraftState(state: DraftState): void;
  setRecommendations(recommendations: RecommendationSetV2 | null): void;
  setCoach(coach: CoachOutput | null): void;
  setVisualPhase(phase: DraftPhase): void;
  setStaleInfo(isStale: boolean, syncedAt: string | null): void;
  setPreviewStatus(status: PreviewStatus): void;
  setEngineStatus(status: EngineStatus): void;
  /** Sincroniza timer/penalización con la proyección del Simulator (fuente de verdad: el motor). */
  syncRoundTimer(timer: { remainingMs: number; pendingSeats: number[]; goldPenaltyBySlot: number[]; penaltyRatePerSecond: number }): void;
  setRoundNotice(notice: string | null): void;
  tickTimer(deltaMs: number): void;
}

type RandomDraftStore = RandomDraftState & RandomDraftActions;

export const useRandomDraftStore = create<RandomDraftStore>((set, get) => ({
  config: null,
  sessionMode: "simulation",
  phase: { type: "idle" },
  sessionId: null,
  draftState: null,
  recommendations: null,
  coach: null,
  staleWarning: false,
  lastSyncedAt: null,
  previewStatus: "idle",
  engineStatus: "ok",

  startSession(config, sessionId, orchestratorResult, mode = "simulation") {
    set({
      config,
      sessionId,
      sessionMode: mode,
      draftState: null,
      recommendations: null,
      coach: null,
      phase: mode === "live_companion"
        ? { type: "live_ban_entry", observedBans: [], error: null }
        : { type: "ban_phase_complete", resolvedBans: orchestratorResult.resolvedBans },
      previewStatus: "idle",
      engineStatus: "ok",
    });
  },

  confirmPick(heroId, rosterSeat) {
    const { phase } = get();
    if (phase.type !== "blind_round" || phase.pendingUserPicks.includes(heroId)) return;
    const targetSeat = rosterSeat ?? phase.attemptSeats.find((seat) => phase.lockedUserPicks[seat] === undefined);
    if (targetSeat === undefined || !phase.attemptSeats.includes(targetSeat)) return;
    set({
      phase: {
        ...phase,
        pendingUserPicks: [...phase.pendingUserPicks, heroId],
        lockedUserPicks: { ...phase.lockedUserPicks, [targetSeat]: heroId },
      },
    });
  },

  resetSession() {
    set({
      config: null,
      sessionMode: "simulation",
      phase: { type: "idle" },
      sessionId: null,
      draftState: null,
      recommendations: null,
      coach: null,
      staleWarning: false,
      lastSyncedAt: null,
      previewStatus: "idle",
      engineStatus: "ok",
    });
  },

  setDraftState(draftState) {
    set({ draftState });
  },

  setRecommendations(recommendations) {
    set({ recommendations });
  },

  setCoach(coach) {
    set({ coach });
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

  syncRoundTimer(timer) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    set({
      phase: {
        ...phase,
        timerRemainingMs: timer.remainingMs,
        pendingSeats: timer.pendingSeats,
        goldPenaltyBySlot: timer.goldPenaltyBySlot,
        penaltyRatePerSecond: timer.penaltyRatePerSecond,
        penaltyElapsedMs: 0,
      },
    });
  },

  setRoundNotice(notice) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    set({ phase: { ...phase, notice } });
  },

  // Visual only: the countdown never advances the phase, resolves the protocol, or picks a hero.
  // Once the base time is exhausted the elapsed overflow only feeds the on-screen gold-penalty
  // estimate for the seats still pending -- the engine's timer is the source of truth.
  tickTimer(deltaMs) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    const overflow = Math.max(0, deltaMs - phase.timerRemainingMs);
    set({
      phase: {
        ...phase,
        timerRemainingMs: Math.max(0, phase.timerRemainingMs - deltaMs),
        penaltyElapsedMs: phase.pendingSeats.length > 0 ? phase.penaltyElapsedMs + overflow : phase.penaltyElapsedMs,
      },
    });
  },
}));
