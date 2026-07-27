import type { DraftEvent, DraftEventEnvelope, TeamSide } from "../draft/reducer";
import type { ClientMessage } from "./session";

const RATE_WINDOW_MS = 1000;
const MAX_EVENTS_PER_WINDOW = 20; // 20 eventos/segundo por sesión (§5)

export function checkCaptureToken(request: Request, expectedToken: string): boolean {
  return request.headers.get("x-capture-token") === expectedToken;
}

export interface SessionRateLimiter {
  allow(sessionId: string, now?: number): boolean;
}

export function createSessionRateLimiter(): SessionRateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(sessionId: string, now: number = Date.now()): boolean {
      const recent = (hits.get(sessionId) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
      if (recent.length >= MAX_EVENTS_PER_WINDOW) {
        hits.set(sessionId, recent);
        return false;
      }
      recent.push(now);
      hits.set(sessionId, recent);
      return true;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isTeamSide(value: unknown): value is TeamSide {
  return value === "radiant" || value === "dire";
}

// Todo DraftEventEnvelope entrante es input externo -- se valida en el borde antes de tocar el
// reductor (TSK-004), igual que un formulario (security.md).
function isValidPayload(value: unknown): value is DraftEvent {
  if (!isRecord(value) || typeof value.type !== "string") return false;
  switch (value.type) {
    case "session_started":
      return (
        (value.format === "all_pick" || value.format === "captains_mode" || value.format === "unknown") &&
        typeof value.patch === "string"
      );
    case "local_side_identified":
      return isTeamSide(value.side);
    case "hero_banned":
      return typeof value.hero === "number" && (isTeamSide(value.side) || value.side === "unknown");
    case "hero_picked":
    case "pick_reverted":
      return typeof value.hero === "number" && isTeamSide(value.side);
    case "session_ended":
      return value.reason === "completed" || value.reason === "aborted" || value.reason === "lost_capture";
    case "capture_health":
      return (
        (value.status === "ok" || value.status === "degraded" || value.status === "lost") &&
        (value.detail === undefined || typeof value.detail === "string")
      );
    default:
      return false;
  }
}

export function isValidDraftEventEnvelope(value: unknown): value is DraftEventEnvelope {
  if (!isRecord(value)) return false;
  return (
    value.schema === "draft-event/v1" &&
    typeof value.eventId === "string" &&
    value.eventId.length > 0 &&
    typeof value.sessionId === "string" &&
    value.sessionId.length > 0 &&
    typeof value.seq === "number" &&
    typeof value.emittedAt === "string" &&
    (value.source === "simulator" || value.source === "manual" || value.source === "overwolf" || value.source === "ocr") &&
    typeof value.confidence === "number" &&
    value.confidence >= 0 &&
    value.confidence <= 1 &&
    isValidPayload(value.payload)
  );
}

// Mensajes de cliente WebSocket también son input externo -- JSON.parse devuelve `any`, así que
// el tipo estático ClientMessage no protege nada en runtime sin este chequeo (hallazgo de
// @redteam ronda 1, TSK-010).
export function isValidClientMessage(value: unknown): value is ClientMessage {
  if (!isRecord(value) || value.schema !== "draft-ws/v1") return false;
  if (value.type !== "hello" && value.type !== "ping") return false;
  if (value.type === "hello" && (typeof value.sessionId !== "string" || value.sessionId.length === 0)) return false;
  return value.sessionId === undefined || typeof value.sessionId === "string";
}
