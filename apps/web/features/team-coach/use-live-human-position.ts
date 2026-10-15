"use client";

import { useCallback, useState } from "react";
import { LiveHumanPositionError, putLiveHumanPosition } from "./client";
import { LIVE_SEAT_APPLY_FAILED, LIVE_SEAT_NOT_LINKED } from "./constants";
import { useLiveTeamCoachStore } from "./live-store";
import type { TeamPosition } from "./types";

// Live Dota: "Soy Pos N". The engine keeps the seat (it is what binds the Player's hero to a position); this hook only
// sends the declaration and puts the ENGINE'S answer on screen at once, so the board is recomputed on the next poll
// instead of after the next heartbeat. A refused declaration changes nothing and says why, in plain words.

export interface UseLiveHumanPositionOptions {
  sessionId: string;
  fetchImpl?: typeof fetch;
}

export interface UseLiveHumanPositionResult {
  applying: boolean;
  /** Plain-language reason the last declaration was not saved; null when fine. */
  notice: string | null;
  select(position: TeamPosition | null): void;
}

export function useLiveHumanPosition({ sessionId, fetchImpl }: UseLiveHumanPositionOptions): UseLiveHumanPositionResult {
  const doFetch = fetchImpl ?? fetch;
  const [applying, setApplying] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const select = useCallback(function select(position: TeamPosition | null): void {
    setApplying(true);
    setNotice(null);
    putLiveHumanPosition(position, doFetch).then(
      function applied(result) {
        const store = useLiveTeamCoachStore.getState();
        // Only this session's status is updated, and only with what the engine said back.
        if (store.captureStatus !== null && store.captureStatus.sessionId === sessionId) store.setCaptureStatus({ ...store.captureStatus, localPlayer: result.localPlayer });
        setApplying(false);
      },
      function refused(error: unknown) {
        const notLinked = error instanceof LiveHumanPositionError && error.status === 409;
        setNotice(notLinked ? LIVE_SEAT_NOT_LINKED : LIVE_SEAT_APPLY_FAILED);
        setApplying(false);
      },
    );
  }, [doFetch, sessionId]);

  return { applying, notice, select };
}
