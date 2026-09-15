"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DraftArchetype, DraftSocketFactory, DraftState as EngineDraftState, SuggestionSet, TeamSide } from "@/features/draft/types";
import { isValidSuggestionSet } from "@/features/draft/validation";
import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";
import { postLowConfidenceReport } from "@/features/pro-drafter/types";
import { BLIND_ROUND_SPECS } from "./constants";
import { useLowConfidenceStore } from "./low-confidence-store";
import { loadMetaSnapshot } from "./meta-loader";
import { initDraft } from "./orchestrator";
import {
  createSimulatorProtocolSession,
  protocolViewToDraftState,
  requestBotSelection,
  resolveSimulatorAuthority,
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

async function fetchEngineToken(fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const response = await fetchImpl("/api/auth/engine-token", { credentials: "same-origin", cache: "no-store" });
    if (!response.ok) return null;
    const payload = (await response.json()) as { token?: string };
    return payload.token ?? null;
  } catch {
    return null;
  }
}

export function otherSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

export function bindPreviewSuggestions(payload: unknown, draftState: Pick<EngineDraftState, "sessionId" | "lastSeq">): SuggestionSet | null {
  if (!isValidSuggestionSet(payload)) return null;
  return { ...payload, sessionId: draftState.sessionId, basedOnSeq: draftState.lastSeq };
}

export function specForRound(round: 1 | 2 | 3) {
  return BLIND_ROUND_SPECS.find((spec) => spec.round === round)!;
}

export function isPreviewReadyForRound(draftState: EngineDraftState, userSide: TeamSide, round: 1 | 2 | 3): boolean {
  if (round === 1) return true;
  const expectedRevealedPicks = (round - 1) * 2;
  return draftState.picks[userSide].length >= expectedRevealedPicks
    && draftState.picks[otherSide(userSide)].length >= expectedRevealedPicks;
}

export function buildPendingPickPreview(
  draftState: EngineDraftState,
  userSide: TeamSide,
  previousPendingPicks: HeroId[],
  pendingUserPicks: HeroId[],
): EngineDraftState {
  const pendingBefore = new Set(previousPendingPicks);
  const visiblePicks = draftState.picks[userSide].filter((heroId) => !pendingBefore.has(heroId));
  return {
    ...draftState,
    picks: { ...draftState.picks, [userSide]: [...visiblePicks, ...pendingUserPicks] },
  };
}

function sameHeroIds(left: HeroId[], right: HeroId[]): boolean {
  return left.length === right.length && left.every((heroId, index) => heroId === right[index]);
}

function matchesPreviewState(current: EngineDraftState, preview: EngineDraftState): boolean {
  return current.localSide === preview.localSide
    && sameHeroIds(current.banned, preview.banned)
    && sameHeroIds(current.picks.radiant, preview.picks.radiant)
    && sameHeroIds(current.picks.dire, preview.picks.dire);
}

export function rebasePreviewSuggestions(
  previewState: EngineDraftState,
  authoritativeState: EngineDraftState,
  suggestions: SuggestionSet,
): SuggestionSet | null {
  if (!matchesPreviewState(authoritativeState, previewState)) return null;
  return { ...suggestions, sessionId: authoritativeState.sessionId, basedOnSeq: authoritativeState.lastSeq };
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
  state: RandomDraftState & { archetypeIntent: DraftArchetype | null };
  actions: Pick<RandomDraftActions, "confirmPick" | "deselectPick"> & {
    resetDraft(): void;
    retryPreview(): void;
    setArchetypeIntent(intent: DraftArchetype | null): void;
  };
  startDraft(config: StartDraftConfig): Promise<void>;
  confirmRound(): Promise<void>;
}

export interface UseRandomDraftSessionOptions {
  fetchImpl?: typeof fetch;
  /** Kept only for source compatibility with old test callers; protocol sessions use HTTP now. */
  socketFactory?: DraftSocketFactory;
  wsUrl?: string;
}

export function useRandomDraftSession(options: UseRandomDraftSessionOptions = {}): UseRandomDraftSessionResult {
  const fetchImpl = options.fetchImpl ?? fetch;
  const config = useRandomDraftStore((state) => state.config);
  const phase = useRandomDraftStore((state) => state.phase);
  const sessionId = useRandomDraftStore((state) => state.sessionId);
  const draftState = useRandomDraftStore((state) => state.draftState);
  const engineStatus = useRandomDraftStore((state) => state.engineStatus);
  const suggestions = useRandomDraftStore((state) => state.suggestions);
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
  const previewRequestKeyRef = useRef<string | null>(null);
  const previewPendingRef = useRef<{ round: 1 | 2 | 3; picks: HeroId[] } | null>(null);
  const revealedRoundsRef = useRef<PicksByRound[]>([]);
  const archetypeIntentRef = useRef<DraftArchetype | null>(null);
  const [archetypeIntent, setArchetypeIntentState] = useState<DraftArchetype | null>(null);

  const stopTimer = useCallback(function stopTimer(): void {
    if (timerIdRef.current !== null) clearInterval(timerIdRef.current);
    timerIdRef.current = null;
  }, []);

  const resetDraft = useCallback(function resetDraft(): void {
    stopTimer();
    protocolRef.current = null;
    previewRequestKeyRef.current = null;
    previewPendingRef.current = null;
    revealedRoundsRef.current = [];
    archetypeIntentRef.current = null;
    setArchetypeIntentState(null);
    resetSession();
  }, [resetSession, stopTimer]);

  useEffect(function cleanupOnUnmount() {
    return stopTimer;
  }, [stopTimer]);

  const refreshPendingPickPreview = useCallback(async function refreshPendingPickPreview(
    previousPendingPicks: HeroId[],
    pendingUserPicks: HeroId[],
  ): Promise<void> {
    const current = useRandomDraftStore.getState();
    if (!current.config || !current.sessionId || !current.draftState) return;
    const previewState = buildPendingPickPreview(current.draftState, current.config.userSide, previousPendingPicks, pendingUserPicks);
    useRandomDraftStore.getState().setDraftState(previewState, null);
    useRandomDraftStore.getState().setPreviewStatus("loading");

    function stillCurrent(): boolean {
      const latest = useRandomDraftStore.getState();
      return latest.phase.type === "blind_round"
        && latest.phase.pendingUserPicks.join(",") === pendingUserPicks.join(",")
        && latest.draftState !== null
        && matchesPreviewState(latest.draftState, previewState);
    }

    const teamOpening = previewState.picks.radiant.length === 0 && previewState.picks.dire.length === 0;
    const engineToken = teamOpening ? null : await fetchEngineToken(fetchImpl);
    try {
      const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/suggestions/preview`, {
        method: "POST",
        headers: { "content-type": "application/json", ...(engineToken ? { "x-account-token": engineToken } : {}) },
        body: JSON.stringify({
          format: previewState.format,
          patch: previewState.patch,
          localSide: previewState.localSide,
          banned: previewState.banned,
          picks: previewState.picks,
          teamOpening,
          targetPosition: current.config.playerPosition,
          diversitySeed: current.config.draftSeed,
          archetypeIntent: archetypeIntentRef.current ?? undefined,
        }),
      });
      if (!response.ok || !stillCurrent()) {
        if (stillCurrent()) useRandomDraftStore.getState().setPreviewStatus("failed");
        return;
      }
      const bound = bindPreviewSuggestions(await response.json(), useRandomDraftStore.getState().draftState!);
      if (!bound) {
        useRandomDraftStore.getState().setPreviewStatus("failed");
        return;
      }
      useRandomDraftStore.getState().setDraftState(useRandomDraftStore.getState().draftState!, bound);
      useRandomDraftStore.getState().setPreviewStatus("ready");
    } catch {
      if (stillCurrent()) useRandomDraftStore.getState().setPreviewStatus("failed");
    }
  }, [fetchImpl]);

  useEffect(function refreshPreviewForBlindRound() {
    if (!config || phase.type !== "blind_round") return;
    if (phase.round > 1 && (!draftState || !isPreviewReadyForRound(draftState, config.userSide, phase.round))) return;
    const requestKey = `${sessionId}:${phase.round}:${phase.pendingUserPicks.join(",")}`;
    if (previewRequestKeyRef.current === requestKey) return;
    previewRequestKeyRef.current = requestKey;
    const previous = previewPendingRef.current?.round === phase.round ? previewPendingRef.current.picks : [];
    previewPendingRef.current = { round: phase.round, picks: phase.pendingUserPicks };
    void refreshPendingPickPreview(previous, phase.pendingUserPicks);
  }, [config, draftState, phase, refreshPendingPickPreview, sessionId]);

  const retryPreview = useCallback(function retryPreview(): void {
    const current = useRandomDraftStore.getState().phase;
    if (current.type !== "blind_round") return;
    const previous = previewPendingRef.current?.round === current.round ? previewPendingRef.current.picks : [];
    void refreshPendingPickPreview(previous, current.pendingUserPicks);
  }, [refreshPendingPickPreview]);

  const setArchetypeIntent = useCallback(function setArchetypeIntent(next: DraftArchetype | null): void {
    archetypeIntentRef.current = next;
    setArchetypeIntentState(next);
    const current = useRandomDraftStore.getState().phase;
    if (current.type !== "blind_round") return;
    const previous = previewPendingRef.current?.round === current.round ? previewPendingRef.current.picks : [];
    void refreshPendingPickPreview(previous, current.pendingUserPicks);
  }, [refreshPendingPickPreview]);

  const syncSnapshot = useCallback(function syncSnapshot(snapshot: ProtocolSnapshot): void {
    protocolRef.current = snapshot;
    const current = useRandomDraftStore.getState();
    if (!current.config) return;
    const authoritative = protocolViewToDraftState(snapshot.view, current.config.patch);
    const rebased = current.draftState && current.suggestions
      ? rebasePreviewSuggestions(current.draftState, authoritative, current.suggestions)
      : null;
    useRandomDraftStore.getState().setDraftState(authoritative, rebased);
    useRandomDraftStore.getState().setEngineStatus("ok");
  }, []);

  const beginRound = useCallback(function beginRound(round: 1 | 2 | 3, conflictBans: HeroId[] = []): void {
    stopTimer();
    previewRequestKeyRef.current = null;
    previewPendingRef.current = null;
    useRandomDraftStore.getState().setVisualPhase({
      type: "blind_round",
      round,
      timerRemainingMs: specForRound(round).timerMs,
      pendingUserPicks: [],
      conflictBans,
      conflictCount: conflictBans.length > 0 ? 1 : 0,
    });
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
        const missing = specForRound(round).picksPerTeam - state.phase.pendingUserPicks.length;
        const filled = randomPickForSlots(missing, rng, state.draftState?.banned ?? [], state.phase.pendingUserPicks, allHeroIdsRef.current);
        for (const heroId of filled) useRandomDraftStore.getState().confirmPick(heroId);
      }
    }, TIMER_TICK_MS);
  }, [stopTimer]);

  const revealAndAdvance = useCallback(async function revealAndAdvance(round: 1 | 2 | 3, snapshot: ProtocolSnapshot): Promise<void> {
    stopTimer();
    syncSnapshot(snapshot);
    const alreadyRevealed = (round - 1) * 2;
    const userPicks = visibleIds(snapshot.view.ownPicks).slice(alreadyRevealed);
    const botPicks = visibleIds(snapshot.view.enemyPicks).slice(alreadyRevealed);
    const revealedRound = { userPicks, botPicks };
    revealedRoundsRef.current = [...revealedRoundsRef.current.slice(0, round - 1), revealedRound];
    useRandomDraftStore.getState().setVisualPhase({ type: "round_revealed", round, userPicks, botPicks, conflictBans: [] });
    await new Promise((resolve) => setTimeout(resolve, REVEAL_PAUSE_MS));
    if (protocolRef.current !== snapshot) return;

    if (snapshot.view.status === "COMPLETE") {
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
      return;
    }
    const nextRound = roundFromView(snapshot.view);
    if (nextRound) beginRound(nextRound);
  }, [beginRound, stopTimer, syncSnapshot]);

  const driveKernelUntilLocalInputOrReveal = useCallback(async function driveKernelUntilLocalInputOrReveal(
    round: 1 | 2 | 3,
    bansBefore: readonly HeroId[],
  ): Promise<void> {
    const currentSessionId = useRandomDraftStore.getState().sessionId;
    if (!currentSessionId || !protocolRef.current) return;
    try {
      for (let guard = 0; guard < 12; guard += 1) {
        let snapshot = protocolRef.current;
        if (snapshot.view.status === "WAITING_FOR_COLLISION_AUTHORITY") {
          snapshot = await resolveSimulatorAuthority(currentSessionId, useRandomDraftStore.getState().config!.draftSeed, fetchImpl);
          syncSnapshot(snapshot);
          continue;
        }
        const protocolRound = roundFromView(snapshot.view);
        if (snapshot.view.status === "COMPLETE" || protocolRound !== round) {
          await revealAndAdvance(round, snapshot);
          return;
        }
        const localOpen = snapshot.legalActions.filter((action) => action.type === "SUBMIT_SEALED_SELECTION");
        if (localOpen.length > 0) {
          const conflictBans = snapshot.view.bannedHeroes.filter((heroId) => !bansBefore.includes(heroId));
          beginRound(round, conflictBans);
          return;
        }
        snapshot = await requestBotSelection(currentSessionId, fetchImpl);
        syncSnapshot(snapshot);
      }
      throw new Error("protocol adapter guard exhausted");
    } catch (error) {
      console.error("[useRandomDraftSession] protocol drive failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [beginRound, fetchImpl, revealAndAdvance, syncSnapshot]);

  const confirmRound = useCallback(async function confirmRound(): Promise<void> {
    stopTimer();
    const current = useRandomDraftStore.getState();
    const snapshot = protocolRef.current;
    if (current.phase.type !== "blind_round" || !current.sessionId || !snapshot) return;
    const round = current.phase.round;
    if (current.phase.pendingUserPicks.length !== specForRound(round).picksPerTeam) return;
    const bansBefore = [...snapshot.view.bannedHeroes];
    try {
      for (const heroId of current.phase.pendingUserPicks) {
        const action = protocolRef.current!.legalActions.find((candidate) => candidate.type === "SUBMIT_SEALED_SELECTION");
        if (!action || action.type !== "SUBMIT_SEALED_SELECTION") throw new Error("no authorized local slot");
        const next = await submitProtocolCommand(current.sessionId, { ...action, heroId }, fetchImpl);
        syncSnapshot(next);
      }
      await driveKernelUntilLocalInputOrReveal(round, bansBefore);
    } catch (error) {
      console.error("[useRandomDraftSession] protocol round submission failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [driveKernelUntilLocalInputOrReveal, fetchImpl, stopTimer, syncSnapshot]);

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
      const nextSessionId = await createSimulatorProtocolSession(nextConfig.patch, nextConfig.userSide, fetchImpl);
      rngRef.current = createSeededRng(nextConfig.draftSeed);
      allHeroIdsRef.current = allHeroIds;
      revealedRoundsRef.current = [];
      useRandomDraftStore.getState().startSession(nextConfig, nextSessionId, orchestratorResult);

      let snapshot = await submitProtocolCommand(nextSessionId, { type: "RECORD_RESOLVED_BANS", heroes: orchestratorResult.resolvedBans }, fetchImpl);
      syncSnapshot(snapshot);
      snapshot = await submitProtocolCommand(nextSessionId, { type: "BAN_RESOLUTION_COMPLETE" }, fetchImpl);
      syncSnapshot(snapshot);
      beginRound(1);
    } catch (error) {
      console.error("[useRandomDraftSession] protocol start failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [beginRound, fetchImpl, stopTimer, syncSnapshot]);

  return {
    state: { config, phase, sessionId, draftState, suggestions, previewStatus, staleWarning, lastSyncedAt, archetypeIntent, engineStatus },
    actions: { confirmPick, deselectPick, resetDraft, retryPreview, setArchetypeIntent },
    startDraft,
    confirmRound,
  };
}
