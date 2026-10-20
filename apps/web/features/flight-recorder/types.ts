// Flight Recorder -- grabadora de diagnóstico TEMPORAL del simulador. Sólo observa: nunca decide,
// puntúa ni cambia el draft. Todo lo que graba pasa por `sanitize.ts` antes de entrar al buffer.

export const FLIGHT_RECORDER_SCHEMA = "d2kiro-flight-recorder/v1";

export type FlightEntryKind =
  | "session_start"
  | "pools_effective"
  | "pools_unavailable"
  | "transition"
  | "user_action"
  | "engine_team_board"
  | "engine_current_decision"
  | "engine_error"
  | "ui_render";

export interface FlightEntry {
  /** Orden total de la grabación (1, 2, 3 ...). */
  seq: number;
  /** ISO-8601 del reloj inyectado. */
  at: string;
  /** Milisegundos desde que se armó la grabadora. */
  elapsedMs: number;
  kind: FlightEntryKind;
  data: Record<string, unknown>;
}

/** Qué pasó con una respuesta del motor al llegar al navegador. */
export type ResponseDisposition = "accepted" | "discarded_superseded" | "discarded_older_revision";

export interface FlightExportBuild {
  /** Siempre true: la grabadora sólo existe si el build la habilitó explícitamente. */
  flagEnabled: boolean;
  userAgentFamily: string | null;
}

export interface FlightExport {
  schema: typeof FLIGHT_RECORDER_SCHEMA;
  exportedAt: string;
  build: FlightExportBuild;
  entryCount: number;
  droppedEntries: number;
  analysis: FlightAnalysis;
  entries: FlightEntry[];
}

export interface Top5Variant {
  heroIds: number[];
  firstSeenSeq: number;
  firstSeenStateIdentity: string;
  occurrences: number;
}

export interface PositionVariation {
  position: number;
  /** Cuántos tableros aceptados traían esta posición con candidatos. */
  boardsSeen: number;
  distinctTop5: Top5Variant[];
}

export interface UiVsEngineMismatch {
  uiSeq: number;
  engineSeq: number;
  position: number;
  uiHeroIds: number[];
  engineHeroIds: number[];
  uiStateIdentity: string | null;
  engineStateIdentity: string | null;
}

/** Resumen calculado al exportar: contesta "¿el Top 5 cambió alguna vez, y la UI mostró lo que devolvió el motor?". */
export interface FlightAnalysis {
  acceptedBoards: number;
  discardedBoards: number;
  distinctBoardStateIdentities: number;
  acceptedDecisions: number;
  discardedDecisions: number;
  distinctDecisionStateIdentities: number;
  perPosition: PositionVariation[];
  uiVsEngineMismatches: UiVsEngineMismatch[];
}
