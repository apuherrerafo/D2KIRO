import { describe, expect, test } from "bun:test";
import { checkCaptureToken, createSessionRateLimiter, isValidClientMessage, isValidDraftEventEnvelope } from "./edge";

function envelope(overrides: Record<string, unknown> = {}) {
  return {
    schema: "draft-event/v1",
    eventId: "evt-1",
    sessionId: "s1",
    seq: 1,
    emittedAt: "2026-07-27T00:00:00Z",
    source: "simulator",
    confidence: 1,
    payload: { type: "hero_picked", hero: 1, side: "radiant" },
    ...overrides,
  };
}

describe("checkCaptureToken", () => {
  test("acepta solo cuando el header coincide exactamente", () => {
    const req = new Request("http://x", { headers: { "x-capture-token": "abc" } });
    expect(checkCaptureToken(req, "abc")).toBe(true);
    expect(checkCaptureToken(req, "otro")).toBe(false);
  });

  test("sin header -> rechazado", () => {
    const req = new Request("http://x");
    expect(checkCaptureToken(req, "abc")).toBe(false);
  });
});

describe("createSessionRateLimiter", () => {
  test("permite hasta 20/seg por sesión, rechaza el exceso", () => {
    const limiter = createSessionRateLimiter();
    const now = 1000;
    for (let i = 0; i < 20; i++) expect(limiter.allow("s1", now)).toBe(true);
    expect(limiter.allow("s1", now)).toBe(false);
  });

  test("sesiones distintas tienen ventanas independientes", () => {
    const limiter = createSessionRateLimiter();
    for (let i = 0; i < 20; i++) limiter.allow("s1", 1000);
    expect(limiter.allow("s2", 1000)).toBe(true);
  });

  test("la ventana se libera después de 1 segundo", () => {
    const limiter = createSessionRateLimiter();
    for (let i = 0; i < 20; i++) limiter.allow("s1", 1000);
    expect(limiter.allow("s1", 1000)).toBe(false);
    expect(limiter.allow("s1", 2001)).toBe(true);
  });
});

describe("isValidDraftEventEnvelope", () => {
  test("acepta un envelope válido para cada tipo de DraftEvent", () => {
    const payloads = [
      { type: "session_started", format: "all_pick", patch: "7.36" },
      { type: "local_side_identified", side: "radiant" },
      { type: "hero_banned", hero: 1, side: "unknown" },
      { type: "hero_picked", hero: 1, side: "dire" },
      { type: "pick_reverted", hero: 1, side: "dire" },
      { type: "session_ended", reason: "completed" },
      { type: "capture_health", status: "degraded", detail: "ocr" },
    ];
    for (const payload of payloads) {
      expect(isValidDraftEventEnvelope(envelope({ payload }))).toBe(true);
    }
  });

  test("rechaza forma inválida sin lanzar", () => {
    expect(isValidDraftEventEnvelope(null)).toBe(false);
    expect(isValidDraftEventEnvelope({})).toBe(false);
    expect(isValidDraftEventEnvelope(envelope({ schema: "otro" }))).toBe(false);
    expect(isValidDraftEventEnvelope(envelope({ confidence: 1.5 }))).toBe(false);
    expect(isValidDraftEventEnvelope(envelope({ payload: { type: "hero_picked", hero: "1", side: "radiant" } }))).toBe(false);
    expect(isValidDraftEventEnvelope(envelope({ payload: { type: "unknown_event" } }))).toBe(false);
  });
});

describe("isValidClientMessage", () => {
  test("acepta hello con sessionId string y ping sin sessionId", () => {
    expect(isValidClientMessage({ schema: "draft-ws/v1", type: "hello", sessionId: "s1" })).toBe(true);
    expect(isValidClientMessage({ schema: "draft-ws/v1", type: "ping" })).toBe(true);
  });

  test("rechaza hello con sessionId que no es string, sin lanzar (hallazgo de @redteam ronda 1, TSK-010)", () => {
    expect(isValidClientMessage({ schema: "draft-ws/v1", type: "hello", sessionId: 123 })).toBe(false);
    expect(isValidClientMessage({ schema: "draft-ws/v1", type: "hello", sessionId: { evil: true } })).toBe(false);
    expect(isValidClientMessage({ schema: "draft-ws/v1", type: "hello" })).toBe(false);
    expect(isValidClientMessage({ schema: "draft-ws/v1", type: "hello", sessionId: "" })).toBe(false);
  });

  test("rechaza schema/type inválidos o valores no-objeto", () => {
    expect(isValidClientMessage(null)).toBe(false);
    expect(isValidClientMessage(123)).toBe(false);
    expect(isValidClientMessage({ schema: "otro", type: "hello", sessionId: "s1" })).toBe(false);
    expect(isValidClientMessage({ schema: "draft-ws/v1", type: "unknown" })).toBe(false);
  });
});
