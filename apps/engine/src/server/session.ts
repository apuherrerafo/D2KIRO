import { applyDraftEvent, createIdleDraftState, type DraftEventEnvelope, type DraftState, type RejectionReason } from "../draft/reducer";
import type { SuggestionSet } from "../signals/mix";

// CaptureStatus/ErrorPayload no están definidos en ningún lado del repo ni de SPEC.md más allá
// de nombrarse en la unión de ServerMessage.payload -- se definen aquí con el alcance mínimo:
// CaptureStatus espeja la forma del evento capture_health (S1); ErrorPayload es genérico.
export interface CaptureStatus {
  status: "ok" | "degraded" | "lost";
  detail?: string;
}

export interface ErrorPayload {
  code: string;
  message: string;
}

export interface ServerMessage {
  schema: "draft-ws/v1";
  type: "snapshot" | "draft_state" | "suggestions" | "capture_status" | "error";
  seq: number;
  sentAt: string;
  payload: DraftState | SuggestionSet | CaptureStatus | ErrorPayload;
}

export interface ClientMessage {
  schema: "draft-ws/v1";
  type: "hello" | "ping";
  sessionId?: string;
}

export function buildServerMessage(type: ServerMessage["type"], seq: number, payload: ServerMessage["payload"]): ServerMessage {
  return { schema: "draft-ws/v1", type, seq, sentAt: new Date().toISOString(), payload };
}

// Estado de cada sesión de draft en curso, en memoria -- el motor no persiste sesiones a SQLite
// (esa tabla solo guarda meta de OpenDota, C4). Un reinicio del proceso pierde sesiones activas,
// comportamiento aceptado: el capturador reconecta y reenvía session_started.
export class SessionStore {
  private readonly states = new Map<string, DraftState>();

  get(sessionId: string): DraftState {
    return this.states.get(sessionId) ?? createIdleDraftState(sessionId);
  }

  get size(): number {
    return this.states.size;
  }

  apply(envelope: DraftEventEnvelope): { state: DraftState; rejected?: RejectionReason } {
    const result = applyDraftEvent(this.get(envelope.sessionId), envelope);
    this.states.set(envelope.sessionId, result.state);
    return result;
  }
}
