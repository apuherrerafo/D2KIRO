"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TeamSide } from "@/features/draft/types";
import { postLowConfidenceReport } from "@/features/pro-drafter/types";
import { BLIND_ROUND_SPECS } from "./constants";
import { useLowConfidenceStore } from "./low-confidence-store";
import { loadMetaSnapshot } from "./meta-loader";
import { initDraft } from "./orchestrator";
import {
  createSimulatorProtocolSession,
  fetchRecommendations,
  protocolViewToDraftState,
  requestSoloMidAutoDrive,
  submitProtocolCommand,
  type ProtocolPerspectiveView,
  type ProtocolSnapshot,
} from "./protocol-client";
import type { SeededRng } from "./seeded-rng";
import { createSeededRng } from "./seeded-rng";
import { useRandomDraftStore, type RandomDraftActions, type RandomDraftState } from "./store";
import type { DraftConfig, HeroId, PicksByRound } from "./types";

const TIMER_TICK_MS = 250;
const REVEAL_PAUSE_MS = 2500;

export function otherSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

export function specForRound(round: 1 | 2 | 3) {
  return BLIND_ROUND_SPECS.find((spec) => spec.round === round)!;
}

export function randomPickForSlots(
  count: number,
  rng: SeededRng,
  resolvedBans: HeroId[],
  alreadyTaken: HeroId[],
  allHeroIds: HeroId[],
): HeroId[] {
  const taken = new Set<HeroId>([...resolvedBans, ...alreadyTaken]);
  const pool = allHeroIds.filter((heroId) => !taken.has(heroId));
  const picks: HeroId[] = [];
  for (let i = 0; i < count; i += 1) {
    const picked = rng.pick(pool.filter((heroId) => !picks.includes(heroId)));
    if (picked === undefined) break;
    picks.push(picked);
  }
  return picks;
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

export type StartDraftConfig = Omit<DraftConfig, "patch">;

export interface UseRandomDraftSessionResult {
  state: RandomDraftState;
  actions: Pick<RandomDraftActions, "confirmPick" | "deselectPick"> & {
    resetDraft(): void;
    retryPreview(): void;
  };
  startDraft(config: StartDraftConfig): Promise<void>;
  confirmRound(): Promise<void>;
}

export interface UseRandomDraftSessionOptions {
  fetchImpl?: typeof fetch;
}

export function useRandomDraftSession(options: UseRandomDraftSessionOptions = {}): UseRandomDraftSessionResult {
  const fetchImpl = options.fetchImpl ?? fetch;
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
  const deselectPick = useRandomDraftStore((state) => state.deselectPick);
  const resetSession = useRandomDraftStore((state) => state.resetSession);

  const rngRef = useRef<SeededRng | null>(null);
  const allHeroIdsRef = useRef<HeroId[]>([]);
  const protocolRef = useRef<ProtocolSnapshot | null>(null);
  const timerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedRoundsRef = useRef<PicksByRound[]>([]);

  const stopTimer = useCallback(function stopTimer(): void {
    if (timerIdRef.current !== null) clearInterval(timerIdRef.current);
    timerIdRef.current = null;
  }, []);

  const resetDraft = useCallback(function resetDraft(): void {
    stopTimer();
    protocolRef.current = null;
    revealedRoundsRef.current = [];
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

  const beginRound = useCallback(function beginRound(round: 1 | 2 | 3, conflictBans: HeroId[] = []): void {
    stopTimer();
    useRandomDraftStore.getState().setVisualPhase({
      type: "blind_round",
      round,
      timerRemainingMs: specForRound(round).timerMs,
      pendingUserPicks: [],
      conflictBans,
      conflictCount: conflictBans.length > 0 ? 1 : 0,
    });
    void refreshRecommendations(); // one compound recommendation covers the whole round upfront
    timerIdRef.current = setInterval(function tick(): void {
      const current = useRandomDraftStore.getState().phase;
      if (current.type !== "blind_round" || current.round !== round) {
        stopTimer();
        return;
      }
      useRandomDraftStore.getState().tickTimer(TIMER_TICK_MS);
      if (current.timerRemainingMs - TIMER_TICK_MS <= 0) {
        stopTimer();
        const rng = rngRef.current;
        const state = useRandomDraftStore.getState();
        if (!rng || state.phase.type !== "blind_round") return;
        const missing = 1 - state.phase.pendingUserPicks.length;
        const filled = randomPickForSlots(missing, rng, state.draftState?.banned ?? [], state.phase.pendingUserPicks, allHeroIdsRef.current);
        for (const heroId of filled) useRandomDraftStore.getState().confirmPick(heroId);
      }
    }, TIMER_TICK_MS);
  }, [refreshRecommendations, stopTimer]);

  const driveExternalDraft = useCallback(async function driveExternalDraft(): Promise<void> {
    const currentSessionId = useRandomDraftStore.getState().sessionId;
    if (!currentSessionId || !protocolRef.current) return;
    try {
      for (let guard = 0; guard < 8; guard += 1) {
        const result = await requestSoloMidAutoDrive(currentSessionId, fetchImpl);
        syncSnapshot(result);
        if (result.stopReason === "human_input") {
          const humanRound = roundFromView(result.view);
          if (!humanRound) throw new Error("human input requested without an AP round");
          beginRound(humanRound);
          return;
        }
        if (result.stopReason === "round_revealed" && result.completedRound !== null) {
          const round = result.completedRound;
          const start = round === 1 ? 0 : round === 2 ? 2 : 4;
          const count = round === 3 ? 1 : 2;
          const userPicks = visibleIds(result.view.ownPicks).slice(start, start + count);
          const botPicks = visibleIds(result.view.enemyPicks).slice(start, start + count);
          const revealedRound = { userPicks, botPicks };
          revealedRoundsRef.current[round - 1] = revealedRound;
          useRandomDraftStore.getState().setVisualPhase({ type: "round_revealed", round, userPicks, botPicks, conflictBans: [] });
          await new Promise((resolve) => setTimeout(resolve, REVEAL_PAUSE_MS));
        }
        if (result.view.status === "COMPLETE" || result.stopReason === "complete") {
          const current = useRandomDraftStore.getState();
          if (!current.config) return;
          useRandomDraftStore.getState().setVisualPhase({
            type: "complete",
            summary: {
              draftSeed: current.config.draftSeed,
              userSide: current.config.userSide,
              personalBanList: current.config.personalBanList,
              resolvedBans: result.view.bannedHeroes,
              picksByRound: revealedRoundsRef.current,
            },
          });
          const { sightings, reset } = useLowConfidenceStore.getState();
          if (sightings.size > 0) {
            void postLowConfidenceReport(result.view.sessionId, current.config.patch || "unknown", [...sightings.values()]);
            reset();
          }
          return;
        }
      }
      throw new Error("solo-mid auto-drive guard exhausted");
    } catch (error) {
      console.error("[useRandomDraftSession] protocol drive failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [beginRound, fetchImpl, syncSnapshot]);

  const confirmRound = useCallback(async function confirmRound(): Promise<void> {
    stopTimer();
    const current = useRandomDraftStore.getState();
    const snapshot = protocolRef.current;
    if (current.phase.type !== "blind_round" || !current.sessionId || !snapshot) return;
    if (current.phase.pendingUserPicks.length !== 1) return;
    try {
      const action = snapshot.legalActions.find((candidate) => candidate.type === "SUBMIT_SEALED_SELECTION");
      if (!action || action.type !== "SUBMIT_SEALED_SELECTION") throw new Error("no authorized human slot");
      const next = await submitProtocolCommand(current.sessionId, { ...action, heroId: current.phase.pendingUserPicks[0]! }, fetchImpl);
      syncSnapshot(next);
      await driveExternalDraft();
    } catch (error) {
      console.error("[useRandomDraftSession] protocol round submission failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [driveExternalDraft, fetchImpl, stopTimer, syncSnapshot]);

  const startDraft = useCallback(async function startDraft(input: StartDraftConfig): Promise<void> {
    stopTimer();
    try {
      const { meta, allHeroIds, metaBanPool, currentPatch } = await loadMetaSnapshot();
      const nextConfig: DraftConfig = { ...input, patch: currentPatch };
      const orchestratorResult = await initDraft({
        draftSeed: nextConfig.draftSeed,
        userSide: nextConfig.userSide,
        personalBanList: nextConfig.personalBanList,
        meta,
        metaBanPool,
        patch: nextConfig.patch,
      });
      const nextSessionId = await createSimulatorProtocolSession(nextConfig.patch, nextConfig.userSide, fetchImpl, {
        partySize: 1,
        humanPosition: 2,
        humanRosterSlot: 4,
        simulatorSeed: nextConfig.draftSeed,
      });
      rngRef.current = createSeededRng(nextConfig.draftSeed);
      allHeroIdsRef.current = allHeroIds;
      revealedRoundsRef.current = [];
      useRandomDraftStore.getState().startSession(nextConfig, nextSessionId, orchestratorResult);

      let snapshot = await submitProtocolCommand(nextSessionId, { type: "RECORD_RESOLVED_BANS", heroes: orchestratorResult.resolvedBans }, fetchImpl);
      syncSnapshot(snapshot);
      snapshot = await submitProtocolCommand(nextSessionId, { type: "BAN_RESOLUTION_COMPLETE" }, fetchImpl);
      syncSnapshot(snapshot);
      await driveExternalDraft();
    } catch (error) {
      console.error("[useRandomDraftSession] protocol start failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [driveExternalDraft, fetchImpl, stopTimer, syncSnapshot]);

  return {
    state: { config, phase, sessionId, draftState, recommendations, previewStatus, staleWarning, lastSyncedAt, engineStatus },
    actions: { confirmPick, deselectPick, resetDraft, retryPreview },
    startDraft,
    confirmRound,
  };
}
