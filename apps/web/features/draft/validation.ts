import type { CaptureStatus, DraftState, ErrorPayload, ServerMessage, SuggestionSet } from "./types";

// Los mensajes de WebSocket son input externo igual que un envelope HTTP -- JSON.parse produce
// `any`, un cast `as` no protege nada en runtime (hallazgo de @redteam ronda 1, TSK-012, mismo
// patrón que edge.ts en apps/engine). Se valida aquí, en el punto donde el store confía el dato.
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDraftState(value: unknown): value is DraftState {
  if (!isRecord(value) || value.schema !== "draft-state/v1") return false;
  if (typeof value.sessionId !== "string" || typeof value.patch !== "string") return false;
  if (value.phase !== "idle" && value.phase !== "active" && value.phase !== "complete" && value.phase !== "aborted") return false;
  if (!Array.isArray(value.banned) || typeof value.lastSeq !== "number") return false;
  if (!isRecord(value.picks) || !Array.isArray(value.picks.radiant) || !Array.isArray(value.picks.dire)) return false;
  return isRecord(value.quality) && Array.isArray(value.quality.unconfirmed);
}

function isSuggestionSet(value: unknown): value is SuggestionSet {
  return isRecord(value) && value.schema === "suggestions/v1" && Array.isArray(value.suggestions) && Array.isArray(value.degraded);
}

function isErrorPayload(value: unknown): value is ErrorPayload {
  return isRecord(value) && typeof value.code === "string" && typeof value.message === "string";
}

function isCaptureStatus(value: unknown): value is CaptureStatus {
  return isRecord(value) && (value.status === "ok" || value.status === "degraded" || value.status === "lost");
}

export function isValidServerMessage(value: unknown): value is ServerMessage {
  if (!isRecord(value) || value.schema !== "draft-ws/v1") return false;
  if (typeof value.seq !== "number" || typeof value.sentAt !== "string") return false;
  switch (value.type) {
    case "snapshot":
    case "draft_state":
      return isDraftState(value.payload);
    case "suggestions":
      return isSuggestionSet(value.payload);
    case "capture_status":
      return isCaptureStatus(value.payload);
    case "error":
      return isErrorPayload(value.payload);
    default:
      return false;
  }
}
