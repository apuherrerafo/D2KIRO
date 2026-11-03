import type { SessionRateLimiter } from "../edge";

// MVP P0.1 -- minimal client error reporting foundation. POST /api/telemetry/error.
//
// The payload is sanitized and minimal ON PURPOSE (task spec, section 7): event, sessionId (if
// available), phase, message, client timestamp. Nothing else is accepted -- an unknown key is a
// 400, not a silently-dropped field, so a client bug that starts sending more never becomes a
// silent leak. NEVER Steam name/id, cookies, tokens, or a stack dump: there is no field for any of
// those, and `message` is additionally screened for secret-shaped substrings and rejected (not
// redacted-and-logged) if it matches, so a rejected event is never partially logged either.

const MAX_BODY_BYTES = 4096;
const MAX_MESSAGE_LENGTH = 500;
const EVENT_PATTERN = /^[a-z][a-z0-9_]{2,63}$/;
const PHASE_PATTERN = /^[a-z][a-z0-9_]{1,31}$/;
const SESSION_ID_PATTERN = /^[A-Za-z0-9-]{1,128}$/;
const ALLOWED_KEYS = new Set(["event", "sessionId", "phase", "message", "clientTimestamp"]);

// Defense in depth against exactly the categories the spec forbids transmitting: a long
// opaque token/hash (session cookies, JWTs, capture tokens are all long contiguous
// alphanumeric/base64 runs), an explicit secret-shaped keyword, or a Steam64 id (17 digits,
// always starting with 7656119). A stack dump is multi-line, which the newline check below
// already refuses regardless of this pattern.
const SECRET_LIKE_PATTERN = /[A-Za-z0-9+/_-]{32,}|(?:token|secret|password|cookie|bearer|steamid)/i;
const STEAM64_PATTERN = /\b7656119\d{10}\b/;

export interface ClientErrorEvent {
  event: string;
  sessionId: string | null;
  phase: string;
  message: string;
  clientTimestamp: string;
}

export type TelemetryValidationError =
  | "invalid_body"
  | "unknown_field"
  | "invalid_event"
  | "invalid_phase"
  | "invalid_session_id"
  | "invalid_message"
  | "message_too_long"
  | "message_multiline"
  | "message_secret_like"
  | "invalid_timestamp";

export type TelemetryValidationResult =
  | { ok: true; value: ClientErrorEvent }
  | { ok: false; reason: TelemetryValidationError };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Validates in the border, before anything touches a log line. FAILS CLOSED: any reason to
 * doubt the shape or content of the payload rejects the whole event -- there is no partial
 * acceptance and no field-level redaction-then-log.
 */
export function validateClientErrorEvent(raw: unknown): TelemetryValidationResult {
  if (!isRecord(raw)) return { ok: false, reason: "invalid_body" };
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_KEYS.has(key)) return { ok: false, reason: "unknown_field" };
  }
  if (typeof raw.event !== "string" || !EVENT_PATTERN.test(raw.event)) return { ok: false, reason: "invalid_event" };
  if (typeof raw.phase !== "string" || !PHASE_PATTERN.test(raw.phase)) return { ok: false, reason: "invalid_phase" };
  let sessionId: string | null = null;
  if (raw.sessionId !== undefined && raw.sessionId !== null) {
    if (typeof raw.sessionId !== "string" || !SESSION_ID_PATTERN.test(raw.sessionId)) return { ok: false, reason: "invalid_session_id" };
    sessionId = raw.sessionId;
  }
  if (typeof raw.message !== "string" || raw.message.length === 0) return { ok: false, reason: "invalid_message" };
  if (raw.message.length > MAX_MESSAGE_LENGTH) return { ok: false, reason: "message_too_long" };
  if (raw.message.includes("\n") || raw.message.includes("\r")) return { ok: false, reason: "message_multiline" };
  if (SECRET_LIKE_PATTERN.test(raw.message) || STEAM64_PATTERN.test(raw.message)) return { ok: false, reason: "message_secret_like" };
  if (typeof raw.clientTimestamp !== "string" || Number.isNaN(Date.parse(raw.clientTimestamp))) return { ok: false, reason: "invalid_timestamp" };

  return { ok: true, value: { event: raw.event, sessionId, phase: raw.phase, message: raw.message, clientTimestamp: raw.clientTimestamp } };
}

export interface TelemetryRouteDeps {
  rateLimiter: SessionRateLimiter;
}

function badRequest(reason: TelemetryValidationError): Response {
  return Response.json({ accepted: false, error: reason }, { status: 400 });
}

export function createTelemetryRoutes(deps: TelemetryRouteDeps) {
  async function postError(request: Request): Promise<Response> {
    const contentLength = request.headers.get("content-length");
    if (contentLength !== null && Number(contentLength) > MAX_BODY_BYTES) {
      return Response.json({ accepted: false, error: "payload_too_large" }, { status: 413 });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) return Response.json({ accepted: false, error: "payload_too_large" }, { status: 413 });

    const body: unknown = (() => {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    })();
    if (body === null) return badRequest("invalid_body");

    const validation = validateClientErrorEvent(body);
    if (!validation.ok) return badRequest(validation.reason);

    const sourceIp = request.headers.get("x-forwarded-for") ?? "unknown";
    const rateLimitKey = validation.value.sessionId ?? sourceIp;
    if (!deps.rateLimiter.allow(rateLimitKey)) {
      return Response.json({ accepted: false, error: "rate_limit_exceeded" }, { status: 429 });
    }

    // Structured JSON to stdout -- same logging discipline as the rest of this server
    // (protocol-sessions.ts's recommendations_computed, app.ts's rate_limit_exceeded). Only the
    // validated, allowlisted fields ever reach this line.
    console.log(JSON.stringify({
      timestamp: new Date().toISOString(),
      logEvent: "client_error_reported",
      event: validation.value.event,
      sessionId: validation.value.sessionId,
      phase: validation.value.phase,
      message: validation.value.message,
      clientTimestamp: validation.value.clientTimestamp,
    }));

    return Response.json({ accepted: true }, { status: 202 });
  }

  return { postError };
}
