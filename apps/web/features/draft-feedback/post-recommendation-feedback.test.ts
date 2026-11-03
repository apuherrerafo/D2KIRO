import { afterEach, describe, expect, test } from "bun:test";
import { postRecommendationFeedback } from "./post-recommendation-feedback";

const originalFetch = global.fetch;

describe("postRecommendationFeedback", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("envía feedback positivo con la identidad de la recomendación", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};

    global.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as unknown as typeof fetch;

    const result = await postRecommendationFeedback({
      sessionId: "session-test-1",
      heroId: 7,
      rating: "positive",
      targetPosition: 4,
      stateIdentity: "state-hash-xyz",
      rulesetVersion: "7.41e",
    });

    expect(capturedUrl).toContain("/api/session/session-test-1/feedback");
    expect(capturedBody).toEqual({
      rating: "positive",
      heroId: 7,
      targetPosition: 4,
      stateIdentity: "state-hash-xyz",
      rulesetVersion: "7.41e",
    });
    expect(result).toEqual({ accepted: true });
  });

  test("envía feedback negativo con motivo y comentario", async () => {
    let capturedBody: Record<string, unknown> = {};

    global.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as unknown as typeof fetch;

    const result = await postRecommendationFeedback({
      sessionId: "session-test-1",
      heroId: 25,
      rating: "negative",
      targetPosition: 2,
      reason: "questionable_counter",
      comment: "Lina no contesta bien a este draft.",
      stateIdentity: "state-hash-xyz",
    });

    expect(capturedBody).toEqual({
      rating: "negative",
      heroId: 25,
      targetPosition: 2,
      reason: "questionable_counter",
      comment: "Lina no contesta bien a este draft.",
      stateIdentity: "state-hash-xyz",
    });
    expect(result).toEqual({ accepted: true });
  });

  test("omite comentario si es cadena vacía o solo espacios", async () => {
    let capturedBody: Record<string, unknown> = {};

    global.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as unknown as typeof fetch;

    await postRecommendationFeedback({
      sessionId: "session-test-1",
      heroId: 1,
      rating: "positive",
      comment: "   ",
    });

    expect(capturedBody.comment).toBeUndefined();
  });

  test("maneja error 409 de envío repetido devolviendo duplicate_submission", async () => {
    global.fetch = (async () => {
      return new Response(JSON.stringify({ error: "duplicate_submission" }), { status: 409 });
    }) as unknown as typeof fetch;

    const result = await postRecommendationFeedback({
      sessionId: "session-test-1",
      heroId: 1,
      rating: "positive",
    });

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("duplicate_submission");
  });

  test("maneja error HTTP con payload no JSON devolviendo fallback", async () => {
    global.fetch = (async () => {
      return new Response("Service Unavailable", { status: 503 });
    }) as unknown as typeof fetch;

    const result = await postRecommendationFeedback({
      sessionId: "session-test-1",
      heroId: 1,
      rating: "positive",
    });

    expect(result.accepted).toBe(false);
    expect(result.error).toBe("http_503");
  });
});
