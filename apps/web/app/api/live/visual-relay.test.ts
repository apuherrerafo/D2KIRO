import { describe, expect, test } from "bun:test";
import { parseLiveCaptureStatus } from "@/features/team-coach/validation";
import { createGsiRelayHandler, type FetchLike, type RelayRequest } from "./gsi/[liveId]/route";
import { VISUAL_RELAY_MAX_BYTES } from "./visual/[liveId]/route";

// Local visual capture, web side: the relay shares the GSI relay handler with a different engine path and a
// few-KB cap, and the status mirror accepts the new "ocr" source / visual health. The engine is a fake fetch.

const LIVE_ID = "L".repeat(43);

function fakeRequest(body: string | null, headers: Record<string, string> = {}): RelayRequest {
  const bytes = body === null ? null : new TextEncoder().encode(body);
  const lower = new Map(Object.entries(headers).map(([name, value]) => [name.toLowerCase(), value]));
  return {
    headers: { get: (name: string) => lower.get(name.toLowerCase()) ?? null } as unknown as Headers,
    body: bytes === null ? null : new ReadableStream<Uint8Array<ArrayBuffer>>({ start(controller) { controller.enqueue(bytes as Uint8Array<ArrayBuffer>); controller.close(); } }),
  };
}

function visualRelay(fetchLike: FetchLike) {
  return createGsiRelayHandler({ engineUrl: () => "http://127.0.0.1:4000", enginePath: "/api/live/visual/", maxBytes: VISUAL_RELAY_MAX_BYTES, fetch: fetchLike });
}

describe("visual relay", () => {
  test("forwards an envelope to the engine's visual path and answers by status only", async () => {
    const calls: { url: string; body: string }[] = [];
    const relay = visualRelay(async (input, init) => {
      calls.push({ url: input, body: new TextDecoder().decode(init.body as Uint8Array) });
      return new Response('{"leak":"engine detail"}', { status: 200 });
    });
    const response = await relay(fakeRequest('{"auth":{"token":"t"},"envelope":{}}'), LIVE_ID);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(calls).toEqual([{ url: `http://127.0.0.1:4000/api/live/visual/${LIVE_ID}`, body: '{"auth":{"token":"t"},"envelope":{}}' }]);
  });

  test("a frame-sized body is refused (413) without reaching the engine", async () => {
    let reached = false;
    const relay = visualRelay(async () => {
      reached = true;
      return new Response(null, { status: 200 });
    });
    const big = "x".repeat(VISUAL_RELAY_MAX_BYTES + 1);
    expect((await relay(fakeRequest(big), LIVE_ID)).status).toBe(413);
    expect((await relay(fakeRequest("{}", { "content-length": String(VISUAL_RELAY_MAX_BYTES * 100) }), LIVE_ID)).status).toBe(413);
    expect(reached).toBe(false);
  });

  test("a malformed live id never reaches the engine; an engine outage is a bare 503", async () => {
    const relay = visualRelay(async () => {
      throw new Error("engine down");
    });
    expect((await relay(fakeRequest("{}"), "../../etc")).status).toBe(401);
    expect((await relay(fakeRequest("{}"), LIVE_ID)).status).toBe(503);
  });
});

describe("status mirror", () => {
  const base = { schema: "live-capture-status/v1", sessionId: "s", connection: "connected", lastEventAt: null, captureHealth: "ok", captureDetail: null, draftPhase: "hero_selection", localSide: "radiant", bans: 0, picks: 1, deferredPicks: 0, rejectedFacts: 0, gsi: null };

  test("accepts a last pick detected by the visual source and the visual health block", () => {
    const parsed = parseLiveCaptureStatus({ ...base, lastDetectedPick: { side: "radiant", heroId: 11, position: null, source: "ocr", at: "2026-10-04T12:00:00.000Z" }, visual: { active: true, health: "ok", detail: "VISUAL_OK", lastEventAgeMs: 200 } });
    expect(parsed?.lastDetectedPick?.source).toBe("ocr");
    expect(parsed?.visual).toMatchObject({ active: true, health: "ok" });
  });

  test("older engines (no visual field) still parse; a malformed visual block does not", () => {
    expect(parseLiveCaptureStatus({ ...base, lastDetectedPick: null })).not.toBeNull();
    expect(parseLiveCaptureStatus({ ...base, lastDetectedPick: null, visual: { active: "yes" } })).toBeNull();
    expect(parseLiveCaptureStatus({ ...base, lastDetectedPick: { side: "radiant", heroId: 11, position: null, source: "camera", at: "x" } })).toBeNull();
  });
});
