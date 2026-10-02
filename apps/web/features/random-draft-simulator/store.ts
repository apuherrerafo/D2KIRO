"use client";

import { create } from "zustand";
import type { DraftState } from "@/features/draft/types";
import type { TeamCoachBoardData } from "@/features/team-coach/types";
import type { CoachOutput, CurrentDecisionOutput } from "./coach-client";
import type { HumanActionability, OwnAssignedPositionBinding, RecommendationSetV2 } from "./protocol-client";
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
  /**
   * Product Semantics Recovery WP3 -- the Simulator's ONE current human decision
   * (RecommendationOutputV4). When present it is the only current-action source: neither `coach` (V3)
   * nor `recommendations` (V2) is rendered next to it. Cleared the instant the state it described
   * changes (own pick, yield, navigation) so a stale target/card set is never on screen.
   */
  currentDecision: CurrentDecisionOutput | null;
  /** Position the Player chose to view in the selector; the engine validates it. Reset after every own pick. */
  requestedTarget: 1 | 2 | 3 | 4 | 5 | null;
  /** WP1 -- server-derived eligibility vs. round capacity, from the latest snapshot. */
  humanActionability: HumanActionability | null;
  staleWarning: boolean;
  lastSyncedAt: string | null;
  previewStatus: PreviewStatus;
  engineStatus: EngineStatus;
  /** PD-026/PD-027 -- Own Team's session-layer position binding, `[]` before the first own pick. */
  ownAssignedPositions: OwnAssignedPositionBinding[];
  /**
   * Team Coach Board -- every human position ranked against the same snapshot. Advisory next to the V4
   * currentDecision (which stays the ONE canonical decision); cleared the instant an own pick lands.
   */
  teamBoard: TeamCoachBoardData | null;
  teamBoardStatus: PreviewStatus;
}

export interface RandomDraftActions {
  startSession(config: DraftConfig, sessionId: string, orchestratorResult: OrchestratorResult, mode?: SessionMode): void;
  /** Registra un héroe que el Player ya selló (lock) para una posición del intento actual de la ronda. */
  confirmPick(heroId: HeroId, position?: 1 | 2 | 3 | 4 | 5): void;
  resetSession(): void;
  setDraftState(state: DraftState): void;
  setRecommendations(recommendations: RecommendationSetV2 | null): void;
  setCoach(coach: CoachOutput | null): void;
  setCurrentDecision(currentDecision: CurrentDecisionOutput | null): void;
  setRequestedTarget(position: 1 | 2 | 3 | 4 | 5 | null): void;
  setHumanActionability(actionability: HumanActionability | null): void;
  setVisualPhase(phase: DraftPhase): void;
  setStaleInfo(isStale: boolean, syncedAt: string | null): void;
  setPreviewStatus(status: PreviewStatus): void;
  setEngineStatus(status: EngineStatus): void;
  setOwnAssignedPositions(bindings: OwnAssignedPositionBinding[]): void;
  setTeamBoard(board: TeamCoachBoardData | null, status: PreviewStatus): void;
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
  currentDecision: null,
  requestedTarget: null,
  humanActionability: null,
  staleWarning: false,
  lastSyncedAt: null,
  previewStatus: "idle",
  engineStatus: "ok",
  ownAssignedPositions: [],
  teamBoard: null,
  teamBoardStatus: "idle",

  startSession(config, sessionId, orchestratorResult, mode = "simulation") {
    set({
      config,
      sessionId,
      sessionMode: mode,
      draftState: null,
      recommendations: null,
      coach: null,
      currentDecision: null,
      requestedTarget: null,
      humanActionability: null,
      phase: mode === "live_companion"
        ? { type: "live_ban_entry", observedBans: [], error: null }
        : { type: "ban_phase_complete", resolvedBans: orchestratorResult.resolvedBans },
      previewStatus: "idle",
      engineStatus: "ok",
      ownAssignedPositions: [],
      teamBoard: null,
      teamBoardStatus: "idle",
    });
  },

  confirmPick(heroId, position) {
    const { phase } = get();
    if (phase.type !== "blind_round" || phase.pendingUserPicks.includes(heroId)) return;
    const targetPosition = position ?? phase.attemptPositions.find((candidate) => phase.lockedUserPicks[candidate] === undefined);
    if (targetPosition === undefined || !phase.attemptPositions.includes(targetPosition)) return;
    const pendingPositions = phase.pendingPositions.filter((candidate) => candidate !== targetPosition);
    set({
      phase: {
        ...phase,
        pendingUserPicks: [...phase.pendingUserPicks, heroId],
        lockedUserPicks: { ...phase.lockedUserPicks, [targetPosition]: heroId },
        pendingPositions,
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
      currentDecision: null,
      requestedTarget: null,
      humanActionability: null,
      staleWarning: false,
      lastSyncedAt: null,
      previewStatus: "idle",
      engineStatus: "ok",
      ownAssignedPositions: [],
      teamBoard: null,
      teamBoardStatus: "idle",
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

  setCurrentDecision(currentDecision) {
    set({ currentDecision });
  },

  setRequestedTarget(requestedTarget) {
    set({ requestedTarget });
  },

  setHumanActionability(humanActionability) {
    set({ humanActionability });
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

  setOwnAssignedPositions(bindings) {
    set({ ownAssignedPositions: bindings });
  },

  setTeamBoard(teamBoard, teamBoardStatus) {
    set({ teamBoard, teamBoardStatus });
  },

  syncRoundTimer(timer) {
    const { phase } = get();
    if (phase.type !== "blind_round") return;
    set({
      phase: {
        ...phase,
        timerRemainingMs: timer.remainingMs,
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
        penaltyElapsedMs: phase.pendingPositions.length > 0 ? phase.penaltyElapsedMs + overflow : phase.penaltyElapsedMs,
      },
    });
  },
}));
