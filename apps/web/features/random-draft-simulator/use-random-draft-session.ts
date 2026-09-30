"use client";

import { useCallback, useEffect, useRef } from "react";
import type { TeamSide } from "@/features/draft/types";
import { postLowConfidenceReport } from "@/features/pro-drafter/types";
import { reportClientError } from "@/lib/telemetry-client";
import { BLIND_ROUND_SPECS } from "./constants";
import { assignOwnCoachPosition, fetchCurrentDecision, fetchRecommendationsWithCoach } from "./coach-client";
import { describeLiveCompanionRejection } from "./live-companion-rejection";
import { useLowConfidenceStore } from "./low-confidence-store";
import { loadMetaSnapshot } from "./meta-loader";
import {
  createSimulatorProtocolSession,
  getProtocolSession,
  ProtocolRequestError,
  protocolViewToDraftState,
  requestEnemyAutoDrive,
  requestYield,
  resolveSimulatorBans,
  submitProtocolCommand,
  type ProtocolLegalAction,
  type ProtocolPerspectiveView,
  type ProtocolSnapshot,
} from "./protocol-client";
import { useRandomDraftStore, type RandomDraftActions, type RandomDraftState } from "./store";
import { controlledPositionsForConfig } from "./roster";
import type { DraftConfig, HeroId, PicksByRound, SessionMode } from "./types";

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

// LIVE_COMPANION -- SIMULATION populates revealedRoundsRef incrementally, one round at a time, via
// revealRound() (never called in this mode: there is no artificial reveal pause to hang it off of).
// At COMPLETE every slot is visible, so the same round/count slicing revealRound() uses can be
// applied once, directly to the final view, to produce the identical PicksByRound[] shape the
// session summary already expects.
function picksByRoundFromView(view: ProtocolPerspectiveView): PicksByRound[] {
  const own = visibleIds(view.ownPicks);
  const enemy = visibleIds(view.enemyPicks);
  return ([1, 2, 3] as const).map((round) => {
    const start = roundSeatOffset(round);
    const count = round === 3 ? 1 : 2;
    return { userPicks: own.slice(start, start + count), botPicks: enemy.slice(start, start + count) };
  });
}

// LIVE_COMPANION -- every currently open seat, EITHER side. A "manual" adapterKind session's
// legalActions already carries both (protocol-session.ts's isCommandAuthorized/authorizedLegalActions
// widen exactly this, and only for adapterKind "manual" -- SIMULATION's legalActions never include
// the enemy side). This hook never filters by side itself: it shows/accepts whatever the engine
// advertises as open, nothing invented client-side.
function openSlotsFromLegalActions(actions: ProtocolLegalAction[]): { side: TeamSide; slotIndex: number }[] {
  return actions.flatMap((action) => (action.type === "SUBMIT_SEALED_SELECTION" ? [{ side: action.side, slotIndex: action.slotIndex }] : []));
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

/** P0-3 (INV-YIELD-002) -- a domain-level rejection of POST /yield, explained in place (round notice), never mapped to "engine unreachable". */
function describeYieldRejection(errorCode: string | null): string {
  if (errorCode === "ally_bot_cannot_absorb_capacity") return "El Ally Bot ya no puede absorber el resto de esta ronda. Elegí vos las posiciones que faltan.";
  if (errorCode === "no_ally_bot_capacity") return "Tu party controla las 5 posiciones: no hay Ally Bot al que cederle la ronda.";
  if (errorCode === "no_open_round") return "No hay una ronda abierta para ceder en este momento.";
  return `No se pudo ceder la ronda (${errorCode ?? "rechazado"}). Elegí manualmente.`;
}

export type StartDraftConfig = Omit<DraftConfig, "patch">;

export interface UseRandomDraftSessionResult {
  state: RandomDraftState;
  actions: Pick<RandomDraftActions, "confirmPick"> & {
    /** Sella la selección del Player para una posición humana controlada explícita (PD-026/PD-027). */
    lockPick(heroId: HeroId, position?: 1 | 2 | 3 | 4 | 5): Promise<void>;
    /** PD-026 ALLY BOT SCHEDULING -- cede la capacidad restante de la ronda al Ally Bot. */
    yieldRound(): Promise<void>;
    resetDraft(): void;
    retryPreview(): void;
    /** Reintenta la resolución de bans con los mismos datos y la misma seed (fail closed). */
    retryBans(): Promise<void>;
    assignOwnPosition(heroId: HeroId, position: 1 | 2 | 3 | 4 | 5 | null): Promise<void>;
    /**
     * WP3 -- el selector de posición pide ver otra posición pendiente. El motor valida y responde con
     * el objetivo real; hasta entonces la decisión anterior se retira (nunca queda un objetivo viejo).
     */
    selectTarget(position: 1 | 2 | 3 | 4 | 5): void;
    /**
     * LIVE_COMPANION -- registra la lista completa de bans observados en el draft REAL y cierra
     * la fase de bans (RECORD_RESOLVED_BANS + BAN_RESOLUTION_COMPLETE). Nunca inventa ni completa
     * bans que el Player no escribió.
     */
    recordObservedBans(heroIds: HeroId[]): Promise<void>;
    /**
     * LIVE_COMPANION -- reporta un pick observado para `side` (propio o rival) en el próximo
     * asiento abierto de ese lado. Nunca llama al Enemy Bot ni a auto-drive.
     */
    submitLiveSelection(side: TeamSide, heroId: HeroId): Promise<void>;
  };
  startDraft(config: StartDraftConfig, mode?: SessionMode): Promise<void>;
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
  const sessionMode = useRandomDraftStore((state) => state.sessionMode);
  const sessionId = useRandomDraftStore((state) => state.sessionId);
  const draftState = useRandomDraftStore((state) => state.draftState);
  const engineStatus = useRandomDraftStore((state) => state.engineStatus);
  const recommendations = useRandomDraftStore((state) => state.recommendations);
  const coach = useRandomDraftStore((state) => state.coach);
  const previewStatus = useRandomDraftStore((state) => state.previewStatus);
  const staleWarning = useRandomDraftStore((state) => state.staleWarning);
  const lastSyncedAt = useRandomDraftStore((state) => state.lastSyncedAt);
  const confirmPick = useRandomDraftStore((state) => state.confirmPick);
  const resetSession = useRandomDraftStore((state) => state.resetSession);
  const ownAssignedPositions = useRandomDraftStore((state) => state.ownAssignedPositions);
  const currentDecision = useRandomDraftStore((state) => state.currentDecision);
  const requestedTarget = useRandomDraftStore((state) => state.requestedTarget);
  const humanActionability = useRandomDraftStore((state) => state.humanActionability);

  const protocolRef = useRef<ProtocolSnapshot | null>(null);
  const timerIdRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const revealedRoundsRef = useRef<PicksByRound[]>([]);
  const roundConflictsRef = useRef<{ round: number; bans: HeroId[] }>({ round: 0, bans: [] });
  const lockingRef = useRef(false);
  const attemptCounterRef = useRef(0);
  // WP3 (COHERENCE-014) -- only the LATEST recommendation request may write the store: a slower
  // response for a state the Player already moved past (a pick, a navigation) is dropped.
  const refreshSeqRef = useRef(0);

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
    const requestSeq = (refreshSeqRef.current += 1);
    useRandomDraftStore.getState().setPreviewStatus("loading");
    // Product Semantics Recovery WP3 -- SIMULATION reads ONLY the V4 CurrentHumanDecision. V2/V3 are
    // cleared so no second target, shortlist or degradation can render next to it. Live Companion
    // (manual sessions carry no HumanActionability) keeps the V3 path below.
    if (current.sessionMode === "simulation") {
      try {
        const output = await fetchCurrentDecision(requestSessionId, current.requestedTarget, fetchImpl);
        if (useRandomDraftStore.getState().sessionId !== requestSessionId || refreshSeqRef.current !== requestSeq) return;
        // Same monotonic-revision rule as the V3 path: an older computation never overwrites a newer one.
        const heldDecision = useRandomDraftStore.getState().currentDecision;
        if (heldDecision !== null && output.meta.revision < heldDecision.meta.revision) {
          useRandomDraftStore.getState().setPreviewStatus("ready");
          return;
        }
        useRandomDraftStore.getState().setRecommendations(null);
        useRandomDraftStore.getState().setCoach(null);
        useRandomDraftStore.getState().setCurrentDecision(output);
        useRandomDraftStore.getState().setPreviewStatus("ready");
      } catch {
        if (useRandomDraftStore.getState().sessionId === requestSessionId && refreshSeqRef.current === requestSeq) useRandomDraftStore.getState().setPreviewStatus("failed");
      }
      return;
    }
    try {
      const result = await fetchRecommendationsWithCoach(requestSessionId, fetchImpl);
      if (useRandomDraftStore.getState().sessionId !== requestSessionId) return; // superseded by a new/reset session
      // The Coach revision is monotonic per session: a slower, older response never overwrites a newer one.
      const held = useRandomDraftStore.getState().coach;
      const outdated = result.coach !== null && held !== null && result.coach.meta.revision < held.meta.revision;
      if (!outdated) {
        useRandomDraftStore.getState().setRecommendations(result.recommendationSet);
        useRandomDraftStore.getState().setCoach(result.coach);
      }
      useRandomDraftStore.getState().setPreviewStatus("ready");
    } catch {
      if (useRandomDraftStore.getState().sessionId === requestSessionId) useRandomDraftStore.getState().setPreviewStatus("failed");
    }
  }, [fetchImpl]);

  const retryPreview = useCallback(function retryPreview(): void {
    void refreshRecommendations();
  }, [refreshRecommendations]);

  const assignOwnPosition = useCallback(async function assignOwnPosition(heroId: HeroId, position: 1 | 2 | 3 | 4 | 5 | null): Promise<void> {
    const current = useRandomDraftStore.getState();
    if (!current.sessionId) return;
    await assignOwnCoachPosition(current.sessionId, heroId, position, fetchImpl);
    await refreshRecommendations();
  }, [fetchImpl, refreshRecommendations]);

  const selectTarget = useCallback(function selectTarget(position: 1 | 2 | 3 | 4 | 5): void {
    const current = useRandomDraftStore.getState();
    if (current.phase.type !== "blind_round" || current.requestedTarget === position) return;
    const shownTarget = current.currentDecision?.decision.kind === "ACTIONABLE" ? current.currentDecision.decision.targetPosition : null;
    if (current.requestedTarget === null && shownTarget === position) return;
    useRandomDraftStore.getState().setRequestedTarget(position);
    useRandomDraftStore.getState().setCurrentDecision(null);
    void refreshRecommendations();
  }, [refreshRecommendations]);

  const syncSnapshot = useCallback(function syncSnapshot(snapshot: ProtocolSnapshot): void {
    protocolRef.current = snapshot;
    const current = useRandomDraftStore.getState();
    useRandomDraftStore.getState().setOwnAssignedPositions(snapshot.ownAssignedPositions);
    useRandomDraftStore.getState().setHumanActionability(snapshot.humanActionability ?? null);
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

  // PD-026/PD-027 WEB INTERACTION -- the human target picker shows ALL currently unfilled
  // human-controlled positions, in every valid round (never a fixed round<->position schedule).
  const beginAttempt = useCallback(function beginAttempt(snapshot: ProtocolSnapshot, notice: string | null): void {
    const round = roundFromView(snapshot.view);
    if (!round) throw new Error("human input requested without an AP round");
    const timer = snapshot.simulator;
    const config = useRandomDraftStore.getState().config;
    const controlledPositions = config ? controlledPositionsForConfig(config) : [];
    const boundPositions = new Set(snapshot.ownAssignedPositions.map((binding) => binding.assignedPosition));
    const attemptPositions = controlledPositions.filter((position) => !boundPositions.has(position));
    // P0-3 (INV-YIELD-001) -- server-provided truth (ProtocolSessionStore.canYield, the SAME
    // precondition POST /yield itself enforces), never re-derived here. The web must not duplicate
    // the server's Ally Bot absorption formula (round capacity vs. unfilled Ally positions) --
    // a local approximation is exactly what let the web advertise Yield in states the server
    // would reject (Party2 round 1 deferred entirely, round 2 opens with more own-side slots than
    // the Ally Bot has unfilled positions left to absorb).
    const canYield = snapshot.canYield;
    if (roundConflictsRef.current.round !== round) roundConflictsRef.current = { round, bans: [] };
    // A new attempt is a new decision: nothing from the previous one (target, cards) survives it.
    useRandomDraftStore.getState().setRequestedTarget(null);
    useRandomDraftStore.getState().setCurrentDecision(null);
    useRandomDraftStore.getState().setVisualPhase({
      type: "blind_round",
      round,
      timerRemainingMs: timer?.remainingMs ?? specForRound(round).timerMs,
      timerDurationMs: timer?.durationMs ?? specForRound(round).timerMs,
      pendingUserPicks: [],
      lockedUserPicks: {},
      attemptPositions,
      pendingPositions: attemptPositions,
      goldPenaltyBySlot: timer?.goldPenaltyBySlot ?? [0, 0, 0, 0, 0],
      penaltyRatePerSecond: timer?.penaltyRatePerSecond ?? 2,
      penaltyElapsedMs: 0,
      conflictBans: roundConflictsRef.current.bans,
      conflictCount: roundConflictsRef.current.bans.length,
      attemptId: (attemptCounterRef.current += 1),
      notice,
      canYield,
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
        playerPosition: current.config.playerPosition,
        partySize: current.config.partySize,
        partyPositions: current.config.partyPositions ?? (current.config.partySize === 5 ? [1, 2, 3, 4, 5] : [current.config.playerPosition]),
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

  // PD-026/PD-027 ATOMIC OWN PICK: `assignedPosition` travels as a sibling field to the kernel
  // command. Any currently open own round slot may be used -- the position is the human's choice,
  // never derived from which slot it happens to land in.
  const lockPick = useCallback(async function lockPick(heroId: HeroId, requestedPosition?: 1 | 2 | 3 | 4 | 5): Promise<void> {
    const current = useRandomDraftStore.getState();
    const snapshot = protocolRef.current;
    if (lockingRef.current || current.phase.type !== "blind_round" || !current.sessionId || !snapshot) return;
    const position = requestedPosition ?? current.phase.attemptPositions[0];
    if (position === undefined || !current.phase.attemptPositions.includes(position)) return;
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
        position,
      );
      syncSnapshot(next);
      if (next.accepted === false) {
        useRandomDraftStore.getState().setRoundNotice(`Ese héroe no está disponible (${next.rejected ?? "rechazado"}). Elegí otro.`);
        return;
      }
      useRandomDraftStore.getState().confirmPick(heroId, position);
      useRandomDraftStore.getState().setRoundNotice(null);
      // COHERENCE-014 -- the decision the Player just acted on is gone: its target and cards leave the
      // screen now, and the next decision is recomputed from the new binding (never the old target).
      useRandomDraftStore.getState().setRequestedTarget(null);
      useRandomDraftStore.getState().setCurrentDecision(null);
      // The number of open round seats is not the number of remaining human decisions: in a
      // Solo/Party session an open own seat may belong to the Ally Bot. Keep waiting only while
      // an actual human-controlled position remains unbound; otherwise resume auto-drive so the
      // Ally Bot can complete the round.
      const hasRemainingHumanPosition = current.config !== null
        && controlledPositionsForConfig(current.config).some(
          (candidate) => !next.ownAssignedPositions.some((binding) => binding.assignedPosition === candidate),
        );
      const roundStillOpen = next.view.status !== "COMPLETE" && next.view.rankedAp?.phase === previousPhase;
      if (hasRemainingHumanPosition && roundStillOpen && openSlots.length > 1) {
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

  // PD-026 ALLY BOT SCHEDULING -- the human explicitly hands the round's remaining Own Team
  // capacity to the Ally Bot. The server is the final authority: a yield it cannot honor comes back
  // as a rejection, surfaced as a round notice, never silently ignored.
  const yieldRound = useCallback(async function yieldRound(): Promise<void> {
    const current = useRandomDraftStore.getState();
    if (lockingRef.current || current.phase.type !== "blind_round" || !current.sessionId || !current.phase.canYield) return;
    lockingRef.current = true;
    try {
      const snapshot = await requestYield(current.sessionId, fetchImpl);
      // After a yield there is no human action for this round: nothing from the previous decision stays up.
      useRandomDraftStore.getState().setRequestedTarget(null);
      useRandomDraftStore.getState().setCurrentDecision(null);
      syncSnapshot(snapshot);
      await advance(null);
    } catch (error) {
      // P0-3 (INV-YIELD-002) -- a domain-level rejection (the server responded; it just said no,
      // e.g. 409 ally_bot_cannot_absorb_capacity) is NOT engine/network unreachability. The server
      // is the final authority (this callback only runs when the LAST-KNOWN snapshot said
      // canYield -- a race can still make the actual attempt land after state moved on): surfaced
      // as a round notice, the same pattern lockPick already uses for a rejected pick, never as
      // "unreachable".
      if (error instanceof ProtocolRequestError) {
        useRandomDraftStore.getState().setRoundNotice(describeYieldRejection(error.errorCode));
        return;
      }
      console.error("[useRandomDraftSession] yieldRound failed", error);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    } finally {
      lockingRef.current = false;
    }
  }, [advance, fetchImpl, syncSnapshot]);

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

  // LIVE_COMPANION -- the only "next state" computation this mode needs: read whatever the engine
  // currently advertises as open (both sides) and show it. No timer, no reveal pause, no Enemy
  // Bot call anywhere in this function -- the Player already told us what happened; the engine
  // already applied it before this ran.
  const beginLivePending = useCallback(function beginLivePending(snapshot: ProtocolSnapshot, notice: string | null): void {
    if (snapshot.view.status === "COMPLETE") {
      if (revealedRoundsRef.current.length === 0) revealedRoundsRef.current = picksByRoundFromView(snapshot.view);
      completeDraft(snapshot);
      return;
    }
    if (snapshot.view.status === "WAITING_FOR_COLLISION_AUTHORITY") {
      // R1 P0.1 (documented scope cut) -- a 3rd+ blind collision within the SAME round needs an
      // external authority (APPLY_AUTHORITATIVE_COLLISION_RESOLUTION), which this MVP does not yet
      // expose for manual sessions. Surfaced explicitly, never silently stuck.
      void reportClientError("collision_authority_unsupported", "live_pending", "kernel reached WAITING_FOR_COLLISION_AUTHORITY", sessionId ?? null, fetchImpl);
      useRandomDraftStore.getState().setVisualPhase({ type: "live_collision_unsupported" });
      return;
    }
    const round = roundFromView(snapshot.view);
    if (!round) return;
    useRandomDraftStore.getState().setVisualPhase({ type: "live_pending", round, openSlots: openSlotsFromLegalActions(snapshot.legalActions), notice });
    void refreshRecommendations();
  }, [completeDraft, fetchImpl, refreshRecommendations, sessionId]);

  const recordObservedBans = useCallback(async function recordObservedBans(heroIds: HeroId[]): Promise<void> {
    const current = useRandomDraftStore.getState();
    if (!current.sessionId || current.phase.type !== "live_ban_entry") return;
    try {
      const afterBans = await submitProtocolCommand(current.sessionId, { type: "RECORD_RESOLVED_BANS", heroes: heroIds }, fetchImpl);
      if (afterBans.accepted === false) {
        useRandomDraftStore.getState().setVisualPhase({ type: "live_ban_entry", observedBans: heroIds, error: describeLiveCompanionRejection(afterBans.rejected) });
        return;
      }
      const afterComplete = await submitProtocolCommand(current.sessionId, { type: "BAN_RESOLUTION_COMPLETE" }, fetchImpl);
      syncSnapshot(afterComplete);
      if (afterComplete.accepted === false) {
        useRandomDraftStore.getState().setVisualPhase({ type: "live_ban_entry", observedBans: heroIds, error: describeLiveCompanionRejection(afterComplete.rejected) });
        return;
      }
      beginLivePending(afterComplete, null);
    } catch (error) {
      console.error("[useRandomDraftSession] recordObservedBans failed", error);
      void reportClientError("draft_session_failure", "live_ban_entry", "recordObservedBans request failed", sessionId ?? null, fetchImpl);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [beginLivePending, fetchImpl, sessionId, syncSnapshot]);

  const submitLiveSelection = useCallback(async function submitLiveSelection(side: TeamSide, heroId: HeroId): Promise<void> {
    const current = useRandomDraftStore.getState();
    const snapshot = protocolRef.current;
    if (lockingRef.current || current.phase.type !== "live_pending" || !current.sessionId || !snapshot) return;
    const slot = openSlotsFromLegalActions(snapshot.legalActions).find((candidate) => candidate.side === side);
    if (!slot) return;
    lockingRef.current = true;
    try {
      const next = await submitProtocolCommand(
        current.sessionId,
        { type: "SUBMIT_SEALED_SELECTION", side, slotIndex: slot.slotIndex, heroId },
        fetchImpl,
      );
      syncSnapshot(next);
      if (next.accepted === false) {
        const fresh = useRandomDraftStore.getState().phase;
        if (fresh.type === "live_pending") {
          useRandomDraftStore.getState().setVisualPhase({ ...fresh, notice: describeLiveCompanionRejection(next.rejected) });
        }
        return;
      }
      beginLivePending(next, null);
    } catch (error) {
      console.error("[useRandomDraftSession] submitLiveSelection failed", error);
      void reportClientError("draft_session_failure", "live_pending", "submitLiveSelection request failed", sessionId ?? null, fetchImpl);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    } finally {
      lockingRef.current = false;
    }
  }, [beginLivePending, fetchImpl, sessionId, syncSnapshot]);

  const startDraft = useCallback(async function startDraft(input: StartDraftConfig, mode: SessionMode = "simulation"): Promise<void> {
    stopTimer();
    try {
      const { currentPatch } = await loadMetaSnapshot();
      const partySize = input.partySize ?? 5;
      const nextConfig: DraftConfig = { ...input, patch: currentPatch, partySize };
      const nextSessionId = await createSimulatorProtocolSession(nextConfig.patch, nextConfig.userSide, fetchImpl, {
        partySize,
        partyPositions: nextConfig.partyPositions,
        humanPosition: nextConfig.playerPosition,
        // LIVE_COMPANION never sends a simulatorSeed: there is no seeded bot/ban-policy to drive,
        // and isApSimulatorMetadata (engine side) requires adapterKind "simulator" anyway.
        simulatorSeed: mode === "simulation" ? nextConfig.draftSeed : undefined,
        adapterKind: mode === "simulation" ? "simulator" : "manual",
      });
      revealedRoundsRef.current = [];
      roundConflictsRef.current = { round: 0, bans: [] };
      useRandomDraftStore.getState().startSession(nextConfig, nextSessionId, { resolvedBans: [], rounds: [] }, mode);
      if (mode === "live_companion") {
        const initial = await getProtocolSession(nextSessionId, fetchImpl);
        syncSnapshot(initial);
        return;
      }
      await resolveBans();
    } catch (error) {
      console.error("[useRandomDraftSession] protocol start failed", error);
      void reportClientError("draft_session_failure", "start_draft", "startDraft request failed", null, fetchImpl);
      useRandomDraftStore.getState().setEngineStatus("unreachable");
    }
  }, [fetchImpl, resolveBans, stopTimer, syncSnapshot]);

  return {
    state: { config, sessionMode, phase, sessionId, draftState, recommendations, coach, currentDecision, requestedTarget, humanActionability, previewStatus, staleWarning, lastSyncedAt, engineStatus, ownAssignedPositions },
    actions: { confirmPick, lockPick, yieldRound, resetDraft, retryPreview, retryBans, assignOwnPosition, selectTarget, recordObservedBans, submitLiveSelection },
    startDraft,
  };
}
