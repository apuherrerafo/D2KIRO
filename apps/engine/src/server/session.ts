import { applyDraftEvent, createIdleDraftState, type DraftEventEnvelope, type DraftState, type RejectionReason } from "../draft/reducer";
import type { DraftTurn } from "../draft/turn-clock";
import type { SuggestionSet } from "../signals/mix";
import type { AccountId } from "../meta/provider";

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

export type WireDraftState = DraftState & { turn: DraftTurn | null };

interface ServerMessageBase<TType extends string, TPayload> {
  schema: "draft-ws/v1";
  type: TType;
  seq: number;
  sentAt: string;
  payload: TPayload;
}

// Unión discriminada: el compilador impide emitir un DraftState sin `turn`, o una suggestion
// como si fuera un snapshot. Esta es la mitad servidor del gate de contrato con Zustand.
export type ServerMessage =
  | ServerMessageBase<"snapshot", WireDraftState>
  | ServerMessageBase<"draft_state", WireDraftState>
  | ServerMessageBase<"suggestions", SuggestionSet>
  | ServerMessageBase<"capture_status", CaptureStatus>
  | ServerMessageBase<"error", ErrorPayload>;

export interface ClientMessage {
  schema: "draft-ws/v1";
  type: "hello" | "ping";
  sessionId?: string;
  accountToken?: string;
}

type ServerMessageFor<TType extends ServerMessage["type"]> = Extract<ServerMessage, { type: TType }>;

export function buildServerMessage<TType extends ServerMessage["type"]>(
  type: TType,
  seq: number,
  payload: ServerMessageFor<TType>["payload"],
): ServerMessageFor<TType> {
  return { schema: "draft-ws/v1", type, seq, sentAt: new Date().toISOString(), payload } as ServerMessageFor<TType>;
}

// TSK-055: mismo criterio de TTL que ya usa simulatorSessions (app.ts, SIMULATOR_SESSION_TTL_MS)
// -- constante propia y no importada de ahí para no crear una dependencia entre los dos stores,
// que son independientes a propósito.
const SESSION_TTL_MS = 45 * 60 * 1000;

interface SessionEntry {
  state: DraftState;
  lastAccessedAt: number;
  ownerAccountId: AccountId | null;
}

// Estado de cada sesión de draft en curso, en memoria -- el motor no persiste sesiones a SQLite
// (esa tabla solo guarda meta de OpenDota, C4). Un reinicio del proceso pierde sesiones activas,
// comportamiento aceptado: el capturador reconecta y reenvía session_started.
export class SessionStore {
  private readonly states = new Map<string, SessionEntry>();

  get(sessionId: string, now = Date.now()): DraftState {
    const entry = this.states.get(sessionId);
    if (!entry) return createIdleDraftState(sessionId);
    entry.lastAccessedAt = now;
    return entry.state;
  }

  get size(): number {
    return this.states.size;
  }

  apply(envelope: DraftEventEnvelope, now = Date.now()): { state: DraftState; rejected?: RejectionReason } {
    const result = applyDraftEvent(this.get(envelope.sessionId, now), envelope);
    this.states.set(envelope.sessionId, { state: result.state, lastAccessedAt: now, ownerAccountId: this.states.get(envelope.sessionId)?.ownerAccountId ?? null });
    return result;
  }

  claimOwner(sessionId: string, accountId: AccountId): boolean {
    const entry = this.states.get(sessionId);
    if (!entry) {
      this.states.set(sessionId, { state: createIdleDraftState(sessionId), lastAccessedAt: Date.now(), ownerAccountId: accountId });
      return true;
    }
    if (entry.ownerAccountId !== null && entry.ownerAccountId !== accountId) return false;
    entry.ownerAccountId = accountId;
    return true;
  }

  ownerAccountId(sessionId: string): AccountId | null {
    return this.states.get(sessionId)?.ownerAccountId ?? null;
  }

  // TSK-055: sin esto, toda sesión que alguna vez recibió un evento vivía en memoria para
  // siempre -- el mismo patrón de TTL que simulatorSessions ya tenía nunca se retroaplicó acá.
  // Llamado oportunistamente (ver app.ts), nunca con un scheduler propio.
  evictStale(now = Date.now(), ttlMs = SESSION_TTL_MS): void {
    for (const [sessionId, entry] of this.states) {
      if (now - entry.lastAccessedAt > ttlMs) {
        this.states.delete(sessionId);
      }
    }
  }
}
