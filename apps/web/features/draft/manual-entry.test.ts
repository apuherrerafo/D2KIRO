import { afterEach, describe, expect, test } from "bun:test";
import { postManualEvent } from "./manual-entry";

const originalFetch = global.fetch;

describe("postManualEvent", () => {
  afterEach(() => {
    global.fetch = originalFetch;
  });

  test("envía un DraftEventEnvelope válido a /api/session/manual con source:'manual' y confidence:1", async () => {
    let capturedUrl = "";
    let capturedBody: Record<string, unknown> = {};
    global.fetch = (async (url: string, init: RequestInit) => {
      capturedUrl = url;
      capturedBody = JSON.parse(String(init.body));
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    }) as typeof fetch;

    const result = await postManualEvent("session-1", 5, { type: "hero_picked", hero: 1, side: "radiant" });

    expect(capturedUrl).toContain("/api/session/manual");
    expect(capturedBody).toMatchObject({
      schema: "draft-event/v1",
      sessionId: "session-1",
      seq: 6, // lastSeq + 1
      source: "manual",
      confidence: 1,
      payload: { type: "hero_picked", hero: 1, side: "radiant" },
    });
    expect(typeof capturedBody.eventId).toBe("string");
    expect(result).toEqual({ accepted: true });
  });

  test("propaga accepted:false y el motivo de rechazo del motor", async () => {
    global.fetch = (async () =>
      new Response(JSON.stringify({ accepted: false, rejected: "hero_already_taken" }), { status: 202 })) as unknown as typeof fetch;

    const result = await postManualEvent("session-1", 5, { type: "hero_picked", hero: 1, side: "radiant" });

    expect(result).toEqual({ accepted: false, rejected: "hero_already_taken" });
  });
});
