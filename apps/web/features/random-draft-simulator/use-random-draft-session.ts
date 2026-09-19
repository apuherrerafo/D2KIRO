"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TeamSide } from "@/features/draft/types";
import { postLowConfidenceReport } from "@/features/pro-drafter/types";
import { BLIND_ROUND_SPECS } from "./constants";
import { useLowConfidenceStore } from "./low-confidence-store";
import { loadMetaSnapshot } from "./meta-loader";
import {
  createSimulatorProtocolSession,
  fetchRecommendations,
  protocolViewToDraftState,
  requestEnemyAutoDrive,
  resolveSimulatorBans,
  submitProtocolCommand,
  type ProtocolPerspectiveView,
  type ProtocolSnapshot,
} from "./protocol-client";
import { useRandomDraftStore, type RandomDraftActions, type RandomDraftState } from "./store";
import type { DraftConfig, HeroId, PicksByRound } from "./types";

const TIMER_TICK_MS = 250;
const REVEAL_PAUSE_MS = 2500;
const AUTO_DRIVE_GUARD = 8;

export function otherSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

export function specForRound(round: 1 | 2 | 3) {
  return BLIND_ROUND_SPECS.find((spec) => spec.round === round)!;
}

/** Roster seat of the first slot of a round (round 1 -> 0, round 2 -> 2, round 3 -> 4). A seat is a chronological seat, never a position. */
export function roundSeatOffset(round: 1 | 2 | 3): number {
  return round === 1 ? 0 : round === 2 ? 2 : 4;
}

function roundFromView(view: ProtocolPerspectiveView): 1 | 2 | 3 | null {
  if (view.rankedAp === null) return null; // this hook only ever drives Ranked All Pick sessions.
  if (view.rankedAp.phase === "PICK_ROUND_1") return 1;
  if (view.rankedAp.phase === "PICK_ROUND_2") return 2;
  if (view.rankedAp.phase === "PICK_ROUND_3") return 3;
  return null;
}

function visibleIds(slots: ProtocolPerspectiveView["ownPicks"]): HeroId[] {
  return slots.flatMap((slot) => (slot.visibility === "HIDDEN" ? [] : [slot.heroId]));
}

/** Own-side round slots the Player may fill right now, lowest first. The Player controls ALL of them. */
export function ownOpenSlotIndexes(snapshot: ProtocolSnapshot): number[] {
  return snapshot.legalActions
    .flatMap((action) => (action.type === "SUBMIT_SEALED_SELECTION" && action.side === snapshot.view.viewerSide ? [action.slotIndex] : []))
    .sort((a, b) => a - b);
}

function describeBanFailure(error: string, retryable: boolean): string {
  if (error === "engine_unreachable") return "No se pudo contactar al motor para resolver los bans. No se inició el draft.";
  if (error === "invalid_ban_preferences") return "Tus preferencias de ban no son válidas. Corregilas y reintentá.";
  const suffix = retryable ? " Podés reintentar con los mismos datos." : "";
  return `La resolución de bans falló (${error}); no se inició la Ronda 1 ni se inventaron bans.${suffix}`;
}

export type StartDraftConfig = Omit<DraftConfig, "patch">;

export interface UseRandomDraftSessionResult {
  state: RandomDraftState;
  actions: Pick<RandomDraftActions, "confirmPick"> & {
    /** Sella la selección del Player para el siguiente asiento abierto (inmediato; el asiento deja de acumular penalización). */
    lockPick(heroId: HeroId): Promise<void>;
    resetDraft(): void;
    retryPreview(): void;
    /** Reintenta la resolución de bans con los mismos datos y la misma seed (fail closed). */
    retryBans(): Promise<void>;
  };
  startDraft(config: StartDraftConfig): Promise<void>;
}

export interface UseRandomDraftSessionOptions {
  fetchImpl?: typeof fetch;
  /** Pausa visual tras revelar una ronda. Sólo se sobreescribe en pruebas. */
  revealPauseMs?: number;
}

export function useRandomDraftSession(options: UseRandomDraftSessionOptions = {}): UseRandomDraftSessionResult {
  const fetchImpl = options.fetchImpl ?? fetch;
  const revealPauseMs = options.revealPauseMs ?? REVEAL_PAUSE_MS;
  const config = useRandomDraftStore((state) => state.config);
  const phase = useRandomDraftStore((state) => state.phase);
  const sessionId = useRandomDraftStore((state) => state.sessionId);
  const draftState = useRandomDraftStore((state) => state.draftState);
  const engineStatus = useRandomDraftStore((state) => state.engineStatus);
  const recommendations = useRandomDraftStore((state) => state.recommendations);
  const previewStatus = useRandomDraftStore((state) => state.previewStatus);
  const staleWarning = useRandomDraftStore((state) => state.staleWarning);
  const lastSyncedAt = useRandomDraftStore((state) => state.lastSyncedAt);
  const confirmPick = useRandomDraftStore((state) => state.confirmPick);
  const resetSession = useRandomDraftStore((state) => state.resetSession);

  const protocolRef = useRef<ProtocolSnapshot | null>(null);
  const timerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedRoundsRef = useRef<PicksByRound[]>([]);
  const roundConflictsRef = useRef<{ round: number; bans: HeroId[] }>({ round: 0, bans: [] });
  const lockingRef = useRef(false);
  const attemptCounterRef = useRef(0);

  const stopTimer = useCallback(function stopTimer(): void {
    if (timerIdRef.current !== null) clearInterval(timerIdRef.current);
    timerIdRef.current = null;
  }, []);

  const resetDraft = useCallback(function resetDraft(): void {
    stopTimer();
    protocolRef.current = null;
    revealedRoundsRef.current = [];
    roundConflictsRef.current = { round: 0, bans: [] };
    lockingRef.current = false;
    resetSession();
  }, [resetSession, stopTimer]);

  useEffect(function cleanupOnUnmount() {
    return stopTimer;
  }, [stopTimer]);

  // R1 S5 (blocker 1) -- the ONLY recommendation source for this simulator's human Copilot.
  // Sends nothing but the already-existing ProtocolSession id; the server derives the perspective
  // from session metadata. Never builds or sends a hypothetical DraftState, never calls
  // /api/suggestions/preview, never calls the Pro-Drafter route (blocker 8) -- CopilotPanel.tsx
  // renders whatever RecommendationSet/v2 this returns, unconditionally.
  const refreshRecommendations = useCallback(async function refreshRecommendations(): Promise<void> {
    const current = useRandomDraftStore.getState();
    if (!current.sessionId) return;
    const requestSessionId = current.sessionId;
    useRandomDraftStore.getState().setPreviewStatus("loading");
    try {
      const result = await fetchRecommendations(requestSessionId, fetchImpl);
      if (useRandomDraftStore.getState().sessionId !== requestSessionId) return; // superseded by a new/reset session
      useRandomDraftStore.getState().setRecommendations(result);
      useRandomDraftStore.getState().setPreviewStatus("ready");
    } catch {
      if (useRandomDraftStore.getState().sessionId === requestSessionId) useRandomDraftStore.getState().setPreviewStatus("failed");
    }
  }, [fetchImpl]);

  const retryPreview = useCallback(function retryPreview(): void {
    void refreshRecommendations();
  }, [refreshRecommendations]);

  const syncSnapshot = useCallback(function syncSnapshot(snapshot: ProtocolSnapshot): void {
    protocolRef.current = snapshot;
    const current = useRandomDraftStore.getState();
    if (!current.config) return;
    const authoritative = protocolViewToDraftState(snapshot.view, current.config.patch);
    useRandomDraftStore.getState().setDraftState(authoritative);
    useRandomDraftStore.getState().setEngineStatus("ok");
  }, []);

  // The countdown is visual only. When the base time runs out NOTHING is picked for the Player:
  // the still-pending seats simply start losing gold (shown on screen; the engine owns the number).
  const startTicker = useCallback(function startTicker(round: number): void {
    stopTimer();
    timerIdRef.current = setInterval(function tick(): void {
      const current = useRandomDraftStore.getState().phase;
      if (current.type !== "blind_round" || current.round !== round) {
        stopTimer();
        return;
      }
      useRandomDraftStore.getState().tickTimer(TIMER_TICK_MS);
    }, TIMER_TICK_MS);
  }, [stopTimer]);

  const beginAttempt = useCallback(function beginAttempt(snapshot: ProtocolSnapshot, notice: string | null): void {
    const round = roundFromView(snapshot.view);
    if (!round) throw new Error("human input requested without an AP round");
    const timer = snapshot.simulator;
    const seats = timer?.pendingSeats ?? ownOpenSlotIndexes(snapshot).map((slotIndex) => roundSeatOffset(round) + slotIndex);
    if (roundConflictsRef.current.round !== round) roundConflictsRef.current = { round, bans: [] };
    useRandomDraftStore.getState().setVisualPhase({
      type: "blind_round",
      round,
      timerRemainingMs: timer?.remainingMs ?? specForRound(round).timerMs,
      timerDurationMs: timer?.durationMs ?? specForRound(round).timerMs,
      pendingUserPicks: [],
      attemptSeats: seats,
      pendingSeats: seats,
      goldPenaltyBySlot: timer?.goldPenaltyBySlot ?? [0, 0, 0, 0, 0],
      penaltyRatePerSecond: timer?.penaltyRatePerSecond ?? 2,
      penaltyElapsedMs: 0,
      conflictBans: roundConflictsRef.current.bans,
      conflictCount: roundConflictsRef.current.bans.length,
      attemptId: (attemptCounterRef.current += 1),
      notice,
    });
    void refreshRecommendations();
    startTicker(round);
  }, [refreshRecommendations, startTicker]);

  const completeDraft = useCallback(function completeDraft(snapshot: ProtocolSnapshot): void {
    stopTimer();
    const current = useRandomDraftStore.getState();
    if (!current.config) return;
    useRandomDraftStore.getState().setVisualPhase({
      type: "complete",
      summary: {
        draftSeed: current.config.draftSeed,
        userSide: current.config.userSide,
        personalBanList: current.config.personalBanList,
        resolvedBans: snapshot.view.bannedHeroes,
        picksByRound: revealedRoundsRef.current,
      },
    });
    const { sightings, reset } = useLowConfidenceStore.getState();
    if (sightings.size > 0) {
      void postLowConfidenceReport(snapshot.view.sessionId, current.config.patch || "unknown", [...sightings.values()]);
      reset();
    }
  }, [stopTimer]);

  const revealRound = useCallback(async function revealRound(round: 1 | 2 | 3, snapshot: ProtocolSnapshot): Promise<void> {
    const start = roundSeatOffset(round);
    const count = round === 3 ? 1 : 2;
    const userPicks = visibleIds(snapshot.view.ownPicks).slice(start, start + count);
    const botPicks = visibleIds(snapshot.view.enemyPicks).slice(start, start + count);
    revealedRoundsRef.current[round - 1] = { userPicks, botPicks };
    roundConflictsRef.current = { round: 0, bans: [] };
    useRandomDraftStore.getState().setVisualPhase({ type: "round_revealed", round, userPicks, botPicks, conflictBans: [] });
    await new Promise((resolve) => setTimeout(resolve, revealPauseMs));
  }, [revealPauseMs]);

  // Drives the ENEMY side until the Player must act again (or the draft is over). Enemy decisions,
  // collision reconciliation and hidden-information handling all live in the engine.
  const advance = useCallback(async function advance(notice: string | null): Promise<void> {
    const currentSessionId = useRandomDraftStore.getState().sessionId;
    if (!currentSessionId) return;
    try {
      for (let guard = 0; guard < AUTO_DRIVE_GUARD; guard += 1) {
        const result = await requestEnemyAutoDrive(currentSessionId, fetchImpl);
        syncSnapshot(result);
        if (result.stopReason === "human_input") {
          beginAttempt(result, notice);
          return;
        }
        if (result.stopReason === "round_revealed" && result.completedRound !== null) {
          await revealRound(result.completedRound, result);
        }
        if (result.view.status === "COMPLETE" || result.stopReason === "complete") {
          completeDraft(result);
          return;
        }
      }
      throw new Error("enemy auto-drive guard exhausted");
    } catch (error) {
      console.error("[useRandomDraftSession] protocol drive failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [beginAttempt, completeDraft, fetchImpl, revealRound, syncSnapshot]);

  // After the LAST own seat of an attempt is sealed the kernel resolves the round: either it is
  // revealed (phase advances / draft completes) or a collision reopens seats (heroes banned, or the
  // authority resolves the third collision). Nothing here decides any of that -- it only reads it.
  const closeAttempt = useCallback(async function closeAttempt(
    round: 1 | 2 | 3,
    previousPhase: string | undefined,
    previousBans: readonly HeroId[],
    next: ProtocolSnapshot,
  ): Promise<void> {
    stopTimer();
    const newBans = next.view.bannedHeroes.filter((heroId) => !previousBans.includes(heroId));
    const roundClosed = next.view.status === "COMPLETE" || next.view.rankedAp?.phase !== previousPhase;
    if (roundClosed) {
      await revealRound(round, next);
      if (next.view.status === "COMPLETE") {
        completeDraft(next);
        return;
      }
      await advance(null);
      return;
    }
    if (roundConflictsRef.current.round !== round) roundConflictsRef.current = { round, bans: [] };
    roundConflictsRef.current = { round, bans: [...roundConflictsRef.current.bans, ...newBans] };
    const notice = newBans.length > 0
      ? "Colisión: elegiste el mismo héroe que el rival. Quedó baneado y los asientos afectados deben elegir de nuevo."
      : "Tercera colisión de la ronda: el Simulator la resolvió y tu selección debe repetirse.";
    await advance(notice);
  }, [advance, completeDraft, revealRound, stopTimer]);

  const lockPick = useCallback(async function lockPick(heroId: HeroId): Promise<void> {
    const current = useRandomDraftStore.getState();
    const snapshot = protocolRef.current;
    if (lockingRef.current || current.phase.type !== "blind_round" || !current.sessionId || !snapshot) return;
    const openSlots = ownOpenSlotIndexes(snapshot);
    const slotIndex = openSlots[0];
    if (slotIndex === undefined) return;
    const round = current.phase.round;
    const previousPhase = snapshot.view.rankedAp?.phase;
    const previousBans = [...snapshot.view.bannedHeroes];
    lockingRef.current = true;
    try {
      const next = await submitProtocolCommand(
        current.sessionId,
        { type: "SUBMIT_SEALED_SELECTION", side: snapshot.view.viewerSide, slotIndex, heroId },
        fetchImpl,
      );
      syncSnapshot(next);
      if (next.accepted === false) {
        useRandomDraftStore.getState().setRoundNotice(`Ese héroe no está disponible (${next.rejected ?? "rechazado"}). Elegí otro.`);
        return;
      }
      useRandomDraftStore.getState().confirmPick(heroId);
      useRandomDraftStore.getState().setRoundNotice(null);
      if (openSlots.length > 1) {
        if (next.simulator) useRandomDraftStore.getState().syncRoundTimer(next.simulator);
        void refreshRecommendations();
        return;
      }
      await closeAttempt(round, previousPhase, previousBans, next);
    } catch (error) {
      console.error("[useRandomDraftSession] protocol pick submission failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    } finally {
      lockingRef.current = false;
    }
  }, [closeAttempt, fetchImpl, refreshRecommendations, syncSnapshot]);

  // Fail closed: if ban resolution fails the session stays in ban configuration (phase "ban_failed")
  // and the very same request can be retried. Round 1 is never started without a resolved ban set.
  const resolveBans = useCallback(async function resolveBans(): Promise<void> {
    const current = useRandomDraftStore.getState();
    if (!current.sessionId || !current.config) return;
    const outcome = await resolveSimulatorBans(current.sessionId, current.config.personalBanList, fetchImpl);
    if (!outcome.ok) {
      useRandomDraftStore.getState().setVisualPhase({ type: "ban_failed", message: describeBanFailure(outcome.error, outcome.retryable) });
      return;
    }
    syncSnapshot(outcome.snapshot);
    useRandomDraftStore.getState().setVisualPhase({ type: "ban_phase_complete", resolvedBans: outcome.resolvedBans });
    await advance(null);
  }, [advance, fetchImpl, syncSnapshot]);

  const retryBans = useCallback(async function retryBans(): Promise<void> {
    try {
      await resolveBans();
    } catch (error) {
      console.error("[useRandomDraftSession] ban retry failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [resolveBans]);

  const startDraft = useCallback(async function startDraft(input: StartDraftConfig): Promise<void> {
    stopTimer();
    try {
      const { currentPatch } = await loadMetaSnapshot();
      const nextConfig: DraftConfig = { ...input, patch: currentPatch, partySize: 5 };
      const nextSessionId = await createSimulatorProtocolSession(nextConfig.patch, nextConfig.userSide, fetchImpl, {
        partySize: 5,
        humanPosition: nextConfig.playerPosition,
        simulatorSeed: nextConfig.draftSeed,
      });
      revealedRoundsRef.current = [];
      roundConflictsRef.current = { round: 0, bans: [] };
      useRandomDraftStore.getState().startSession(nextConfig, nextSessionId, { resolvedBans: [], rounds: [] });
      await resolveBans();
    } catch (error) {
      console.error("[useRandomDraftSession] protocol start failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [fetchImpl, resolveBans, stopTimer]);

  return {
    state: { config, phase, sessionId, draftState, recommendations, previewStatus, staleWarning, lastSyncedAt, engineStatus },
    actions: { confirmPick, lockPick, resetDraft, retryPreview, retryBans },
    startDraft,
  };
}
