import { describe, expect, test } from "bun:test";
import { createSessionRateLimiter } from "../edge";
import { createTelemetryRoutes, validateClientErrorEvent } from "./telemetry";

function jsonRequest(body: unknown, headers: Record<string, string> = {}): Request {
  return new Request("http://127.0.0.1/api/telemetry/error", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "content-type": "application/json", ...headers },
  });
}

const VALID_EVENT = {
  event: "draft_session_failure",
  sessionId: "abc-123",
  phase: "live_pending",
  message: "protocol command rejected: HERO_ALREADY_TAKEN",
  clientTimestamp: new Date().toISOString(),
};

describe("validateClientErrorEvent", () => {
  test("accepts a well-formed, minimal event", () => {
    const result = validateClientErrorEvent(VALID_EVENT);
    expect(result.ok).toBe(true);
  });

  test("accepts a well-formed event with no sessionId", () => {
    const { sessionId: _sessionId, ...rest } = VALID_EVENT;
    const result = validateClientErrorEvent(rest);
    expect(result.ok).toBe(true);
  });

  test("rejects an unknown field (no silent drop)", () => {
    const result = validateClientErrorEvent({ ...VALID_EVENT, stackTrace: "at foo (bar.ts:1:1)" });
    expect(result).toEqual({ ok: false, reason: "unknown_field" });
  });

  test("rejects a multiline message (stack-dump shaped)", () => {
    const result = validateClientErrorEvent({ ...VALID_EVENT, message: "line one\nline two" });
    expect(result).toEqual({ ok: false, reason: "message_multiline" });
  });

  test("rejects a message containing a long opaque token", () => {
    const result = validateClientErrorEvent({ ...VALID_EVENT, message: "token=" + "a".repeat(40) });
    expect(result).toEqual({ ok: false, reason: "message_secret_like" });
  });

  test("rejects a message containing a Steam64 id", () => {
    const result = validateClientErrorEvent({ ...VALID_EVENT, message: "account 76561197960265728 failed" });
    expect(result).toEqual({ ok: false, reason: "message_secret_like" });
  });

  test("rejects an oversized message", () => {
    const result = validateClientErrorEvent({ ...VALID_EVENT, message: "x".repeat(501) });
    expect(result).toEqual({ ok: false, reason: "message_too_long" });
  });

  test("rejects a malformed clientTimestamp", () => {
    const result = validateClientErrorEvent({ ...VALID_EVENT, clientTimestamp: "not-a-date" });
    expect(result).toEqual({ ok: false, reason: "invalid_timestamp" });
  });

  test("rejects a non-object body", () => {
    expect(validateClientErrorEvent("nope")).toEqual({ ok: false, reason: "invalid_body" });
    expect(validateClientErrorEvent(null)).toEqual({ ok: false, reason: "invalid_body" });
  });
});

describe("createTelemetryRoutes -- POST /api/telemetry/error", () => {
  test("valid sanitized event -> 202 accepted", async () => {
    const routes = createTelemetryRoutes({ rateLimiter: createSessionRateLimiter() });
    const response = await routes.postError(jsonRequest(VALID_EVENT));
    expect(response.status).toBe(202);
    const body = (await response.json()) as { accepted: boolean };
    expect(body.accepted).toBe(true);
  });

  test("malformed JSON body -> 400, never accepted", async () => {
    const routes = createTelemetryRoutes({ rateLimiter: createSessionRateLimiter() });
    const request = new Request("http://127.0.0.1/api/telemetry/error", {
      method: "POST",
      body: "{not json",
      headers: { "content-type": "application/json" },
    });
    const response = await routes.postError(request);
    expect(response.status).toBe(400);
  });

  test("oversized payload -> 413, never parsed or logged", async () => {
    const routes = createTelemetryRoutes({ rateLimiter: createSessionRateLimiter() });
    const response = await routes.postError(jsonRequest({ ...VALID_EVENT, message: "x".repeat(10_000) }));
    expect(response.status).toBe(413);
  });

  test("a secret-shaped message is rejected -> 400, and the raw message never reaches stdout", async () => {
    const routes = createTelemetryRoutes({ rateLimiter: createSessionRateLimiter() });
    const secretMarker = "SECRET_MARKER_" + "z".repeat(40);
    const originalLog = console.log;
    const logged: string[] = [];
    console.log = (...args: unknown[]) => {
      logged.push(args.map(String).join(" "));
    };
    try {
      const response = await routes.postError(jsonRequest({ ...VALID_EVENT, message: secretMarker }));
      expect(response.status).toBe(400);
    } finally {
      console.log = originalLog;
    }
    expect(logged.some((line) => line.includes(secretMarker))).toBe(false);
  });

  test("rate limit exceeded -> 429", async () => {
    const routes = createTelemetryRoutes({ rateLimiter: { allow: () => false } });
    const response = await routes.postError(jsonRequest(VALID_EVENT));
    expect(response.status).toBe(429);
  });
});
