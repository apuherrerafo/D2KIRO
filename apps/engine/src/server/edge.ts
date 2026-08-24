import type { DraftEvent, DraftEventEnvelope, DraftFormatId, HeroId, TeamSide } from "../draft/reducer";
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

const TOKEN_RATE_WINDOW_MS = 1000;
const MAX_EVENTS_PER_TOKEN_WINDOW = 200; // 200 eventos/segundo por token (§7)

export interface TokenRateLimiter {
  allow(token: string, now?: number): boolean;
}

export function createTokenRateLimiter(): TokenRateLimiter {
  const hits = new Map<string, number[]>();
  return {
    allow(token: string, now: number = Date.now()): boolean {
      const recent = (hits.get(token) ?? []).filter((t) => now - t < TOKEN_RATE_WINDOW_MS);
      if (recent.length >= MAX_EVENTS_PER_TOKEN_WINDOW) {
        hits.set(token, recent);
        return false;
      }
      recent.push(now);
      hits.set(token, recent);
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

// TSK-082: contrato de entrada de POST /api/suggestions/preview -- deliberadamente MÁS ANGOSTO
// que DraftState completo, honesto sobre lo que buildSuggestions realmente usa (nunca
// sessionId/phase/lastSeq/quality/campos de turno). El handler completa el resto con valores
// neutros antes de llamar al motor real.
export interface SuggestionsPreviewRequest {
  format: DraftFormatId | "unknown";
  patch: string;
  localSide: TeamSide | "unknown";
  banned: HeroId[];
  picks: { radiant: HeroId[]; dire: HeroId[] };
}

function isHeroIdArray(value: unknown): value is HeroId[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

// Input externo -- el bot de /random-draft (u otro cliente futuro) manda este body por su cuenta,
// se valida en el borde antes de tocar buildSuggestions, mismo criterio que cualquier otro
// endpoint que recibe datos externos (security.md).
export function isValidSuggestionsPreviewRequest(value: unknown): value is SuggestionsPreviewRequest {
  if (!isRecord(value)) return false;
  if (value.format !== "all_pick" && value.format !== "captains_mode" && value.format !== "unknown") return false;
  if (typeof value.patch !== "string") return false;
  if (!isTeamSide(value.localSide) && value.localSide !== "unknown") return false;
  if (!isHeroIdArray(value.banned)) return false;
  if (!isRecord(value.picks)) return false;
  return isHeroIdArray(value.picks.radiant) && isHeroIdArray(value.picks.dire);
}
