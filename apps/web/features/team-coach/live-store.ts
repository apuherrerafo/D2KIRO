"use client";

import { create } from "zustand";
import type { ProtocolSnapshot } from "@/features/random-draft-simulator/protocol-client";
import type { LiveCaptureStatus, RequestStatus, TeamCoachBoardData, TeamPosition } from "./types";

// Estado de la vista de draft en vivo (régimen Zustand, la única excepción de datos para el draft en
// vivo -- web.md). Todo lo que contiene viene del motor; nada se deriva acá.

export type LiveEngineStatus = "connecting" | "ok" | "unreachable" | "forbidden";

export interface LiveTeamCoachState {
  sessionId: string | null;
  engineStatus: LiveEngineStatus;
  captureStatus: LiveCaptureStatus | null;
  snapshot: ProtocolSnapshot | null;
  board: TeamCoachBoardData | null;
  boardStatus: RequestStatus;
  selectedPosition: TeamPosition | null;
  /** Last manual report the engine refused (shown in place, never silent). */
  manualError: string | null;
}

export interface LiveTeamCoachActions {
  reset(sessionId: string): void;
  setEngineStatus(status: LiveEngineStatus): void;
  setCaptureStatus(status: LiveCaptureStatus): void;
  setSnapshot(snapshot: ProtocolSnapshot): void;
  setBoard(board: TeamCoachBoardData | null, status: RequestStatus): void;
  setSelectedPosition(position: TeamPosition | null): void;
  setManualError(message: string | null): void;
}

const INITIAL: LiveTeamCoachState = {
  sessionId: null,
  engineStatus: "connecting",
  captureStatus: null,
  snapshot: null,
  board: null,
  boardStatus: "idle",
  selectedPosition: null,
  manualError: null,
};

export const useLiveTeamCoachStore = create<LiveTeamCoachState & LiveTeamCoachActions>((set) => ({
  ...INITIAL,
  reset(sessionId) {
    set({ ...INITIAL, sessionId });
  },
  setEngineStatus(engineStatus) {
    set({ engineStatus });
  },
  setCaptureStatus(captureStatus) {
    set({ captureStatus });
  },
  setSnapshot(snapshot) {
    set({ snapshot });
  },
  setBoard(board, boardStatus) {
    set({ board, boardStatus });
  },
  setSelectedPosition(selectedPosition) {
    set({ selectedPosition });
  },
  setManualError(manualError) {
    set({ manualError });
  },
}));
