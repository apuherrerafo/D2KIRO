"use client";

import { useCallback, useEffect, useRef } from "react";
import { getProtocolSession } from "@/features/random-draft-simulator/protocol-client";
import { reportClientError } from "@/lib/telemetry-client";
import { fetchLiveStatus, fetchTeamBoard, openLiveSession, postLiveObservation } from "./client";
import { LIVE_POLL_MS } from "./constants";
import { useLiveTeamCoachStore } from "./live-store";
import type { LiveCaptureStatus, LiveObservationInput, TeamPosition } from "./types";

// Live draft: the game (Dota GSI -> the deployed site -> engine; or a local capturer in development) is the source of picks. This hook only asks the
// engine what happened -- capture status every LIVE_POLL_MS, and the draft snapshot + Team Coach Board
// ONLY when the draft actually changed (the board ranks five positions; it is not recomputed for nothing).
// The manual fallback posts the same kind of fact the capturer does, then refreshes at once.

/** Team Context is recommendation context (not draft state): preset id + which of positions 1..5 carry a pool, in fixed order. */
function teamContextKey(context: LiveCaptureStatus["teamContext"]): string {
  if (!context) return "ctx:none";
  const { positions } = context;
  return ["ctx", context.teamGroupId ?? "-", positions["1"] ? 1 : 0, positions["2"] ? 1 : 0, positions["3"] ? 1 : 0, positions["4"] ? 1 : 0, positions["5"] ? 1 : 0].join(":");
}

/** What must change for the board to be recomputed: the draft facts and the active Team Context, never a heartbeat. */
export function liveDraftChangeKey(status: LiveCaptureStatus): string {
  return [status.bans, status.picks, status.localSide ?? "-", status.draftPhase, status.lastDetectedPick?.at ?? "-", status.deferredPicks, teamContextKey(status.teamContext)].join("|");
}

export interface UseLiveTeamCoachOptions {
  fetchImpl?: typeof fetch;
  pollMs?: number;
}

export interface UseLiveTeamCoachResult {
  selectPosition(position: TeamPosition): void;
  report(observation: LiveObservationInput): Promise<void>;
  refresh(): Promise<void>;
}

export function useLiveTeamCoach(sessionId: string, options: UseLiveTeamCoachOptions = {}): UseLiveTeamCoachResult {
  const fetchImpl = options.fetchImpl ?? fetch;
  const pollMs = options.pollMs ?? LIVE_POLL_MS;
  const changeKeyRef = useRef<string | null>(null);
  const tickingRef = useRef(false);
  const openedRef = useRef(false);

  const refreshDraft = useCallback(async function refreshDraft(): Promise<void> {
    const store = useLiveTeamCoachStore.getState();
    try {
      store.setSnapshot(await getProtocolSession(sessionId, fetchImpl));
    } catch {
      // The board below still shows what the engine can compute; the next change retries.
    }
    if (useLiveTeamCoachStore.getState().board === null) store.setBoard(null, "loading");
    try {
      store.setBoard(await fetchTeamBoard(sessionId, fetchImpl), "ready");
    } catch {
      store.setBoard(useLiveTeamCoachStore.getState().board, "failed");
    }
  }, [fetchImpl, sessionId]);

  const tick = useCallback(async function tick(force = false): Promise<void> {
    if (tickingRef.current) return;
    tickingRef.current = true;
    const store = useLiveTeamCoachStore.getState();
    try {
      if (!openedRef.current) {
        await openLiveSession(sessionId, fetchImpl);
        openedRef.current = true;
      }
      const status = await fetchLiveStatus(sessionId, fetchImpl);
      store.setCaptureStatus(status);
      store.setEngineStatus("ok");
      const key = liveDraftChangeKey(status);
      if (force || key !== changeKeyRef.current) {
        changeKeyRef.current = key;
        await refreshDraft();
        // A board that failed for this draft is retried on the next poll, not only when the draft changes.
        if (useLiveTeamCoachStore.getState().boardStatus === "failed") changeKeyRef.current = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "";
      // The engine forgot the live session (restart / idle eviction): open it again on the next tick.
      if (/\(404\)/.test(message)) openedRef.current = false;
      store.setEngineStatus(/\((401|403)\)/.test(message) ? "forbidden" : "unreachable");
    } finally {
      tickingRef.current = false;
    }
  }, [fetchImpl, refreshDraft, sessionId]);

  useEffect(function pollLiveSession() {
    useLiveTeamCoachStore.getState().reset(sessionId);
    changeKeyRef.current = null;
    openedRef.current = false;
    void tick(true);
    const timer = setInterval(function pollTick() {
      void tick();
    }, pollMs);
    return function stopPolling() {
      clearInterval(timer);
    };
  }, [pollMs, sessionId, tick]);

  const selectPosition = useCallback(function selectPosition(position: TeamPosition): void {
    useLiveTeamCoachStore.getState().setSelectedPosition(position);
  }, []);

  const report = useCallback(async function report(observation: LiveObservationInput): Promise<void> {
    const store = useLiveTeamCoachStore.getState();
    try {
      await postLiveObservation(sessionId, observation, fetchImpl);
      store.setManualError(null);
    } catch {
      store.setManualError("El motor no aceptó ese dato. Revisa que el héroe no esté ya baneado o elegido.");
      void reportClientError("draft_session_failure", "live_manual_entry", "live observation rejected", sessionId, fetchImpl);
    }
    await tick(true);
  }, [fetchImpl, sessionId, tick]);

  const refresh = useCallback(function refresh(): Promise<void> {
    return tick(true);
  }, [tick]);

  return { selectPosition, report, refresh };
}
