import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { createOverwolfRelay, OVERWOLF_RELAY_MAX_BYTES, type FetchLike, type RelayRequest } from "./overwolf-relay";

// The public relay of the Overwolf adapter (Internet -> engine on 127.0.0.1). The engine is a fake `fetch` here:
// these tests lock the web boundary only. Requests are explicit fakes (headers + body stream), because in the full
// `apps/web` run happy-dom replaces the global Request.

const CAPTURE_ID = "C".repeat(43);
const TOKEN = "ab".repeat(32);
const SENTINEL = "SENTINEL-ENGINE-DETAIL";

function fakeHeaders(values: Record<string, string>): Headers {
  const lower = new Map(Object.entries(values).map(([name, value]) => [name.toLowerCase(), value]));
  return { get: (name: string) => lower.get(name.toLowerCase()) ?? null } as unknown as Headers;
}

function streamOf(bytes: Uint8Array<ArrayBuffer>): ReadableStream<Uint8Array<ArrayBuffer>> {
  return new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      controller.enqueue(bytes);
      controller.close();
    },
  });
}

function fakeRequest(body: string | Uint8Array<ArrayBuffer> | null, headers: Record<string, string> = {}): RelayRequest {
  const bytes = typeof body === "string" ? new TextEncoder().encode(body) : body;
  return { headers: fakeHeaders(headers), body: bytes === null ? null : streamOf(bytes) };
}

interface Call {
  url: string;
  init: RequestInit;
}

function relayWith(respond: () => Response | Promise<Response>) {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    calls.push({ url, init });
    return respond();
  };
  return { calls, relay: createOverwolfRelay({ engineUrl: () => "http://127.0.0.1:4000", fetch: fetchImpl, readDeadlineMs: 200 }) };
}

let consoleSpies: Mock<(...args: unknown[]) => void>[] = [];
beforeEach(() => {
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => spyOn(console, method).mockImplementation(() => undefined));
});
afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("batch relay", () => {
  test("forwards the body and the credential header to the engine path of THAT capture id, and answers by status only", async () => {
    const { calls, relay } = relayWith(() => Response.json({ accepted: true, detail: SENTINEL }, { status: 200 }));
    const response = await relay.batch(fakeRequest(`{"schema":"overwolf-capture/v1"}`, { "x-capture-credential": TOKEN }), CAPTURE_ID);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`http://127.0.0.1:4000/api/live/overwolf/${CAPTURE_ID}`);
    expect((calls[0]!.init.headers as Record<string, string>)["x-capture-credential"]).toBe(TOKEN);
    expect(new TextDecoder().decode(calls[0]!.init.body as Uint8Array)).toBe(`{"schema":"overwolf-capture/v1"}`);
  });

  test("a malformed capture id or credential never reaches the engine", async () => {
    const { calls, relay } = relayWith(() => new Response(null, { status: 200 }));
    expect((await relay.batch(fakeRequest("{}", { "x-capture-credential": TOKEN }), "../../etc/passwd")).status).toBe(401);
    expect((await relay.batch(fakeRequest("{}", { "x-capture-credential": TOKEN }), "short")).status).toBe(401);
    expect((await relay.batch(fakeRequest("{}", {}), CAPTURE_ID)).status).toBe(401);
    expect((await relay.batch(fakeRequest("{}", { "x-capture-credential": "not-hex" }), CAPTURE_ID)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test("an oversized body is 413 and never forwarded; so is a declared oversize; a missing body is 400", async () => {
    const { calls, relay } = relayWith(() => new Response(null, { status: 200 }));
    const headers = { "x-capture-credential": TOKEN };
    expect((await relay.batch(fakeRequest(new Uint8Array(OVERWOLF_RELAY_MAX_BYTES + 1), headers), CAPTURE_ID)).status).toBe(413);
    expect((await relay.batch(fakeRequest("{}", { ...headers, "content-length": String(OVERWOLF_RELAY_MAX_BYTES + 1) }), CAPTURE_ID)).status).toBe(413);
    expect((await relay.batch(fakeRequest(null, headers), CAPTURE_ID)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("a slow-trickle body is cut by the read deadline (408)", async () => {
    const { calls, relay } = relayWith(() => new Response(null, { status: 200 }));
    const stalled: RelayRequest = { headers: fakeHeaders({ "x-capture-credential": TOKEN }), body: new ReadableStream<Uint8Array<ArrayBuffer>>({ start() {} }) };
    expect((await relay.batch(stalled, CAPTURE_ID)).status).toBe(408);
    expect(calls).toHaveLength(0);
  });

  test("engine statuses 401/409/429/400 pass through; anything else is 502; an unreachable engine is 503", async () => {
    for (const status of [400, 401, 409, 429]) {
      const { relay } = relayWith(() => new Response(`${SENTINEL}`, { status }));
      const response = await relay.batch(fakeRequest("{}", { "x-capture-credential": TOKEN }), CAPTURE_ID);
      expect(response.status).toBe(status);
      expect(await response.text()).toBe("");
    }
    const odd = relayWith(() => new Response(SENTINEL, { status: 500 }));
    expect((await odd.relay.batch(fakeRequest("{}", { "x-capture-credential": TOKEN }), CAPTURE_ID)).status).toBe(502);
    const down = createOverwolfRelay({ engineUrl: () => "http://127.0.0.1:4000", fetch: async () => { throw new Error(SENTINEL); } });
    const response = await down.batch(fakeRequest("{}", { "x-capture-credential": TOKEN }), CAPTURE_ID);
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(SENTINEL);
  });
});

describe("pair + heroes relay", () => {
  test("pair forwards the code body and hands the credential response back to the adapter", async () => {
    const credential = { schema: "live-capture-credential/v1", captureId: CAPTURE_ID, token: TOKEN, expiresAt: "2026-10-05T10:00:00.000Z" };
    const { calls, relay } = relayWith(() => Response.json(credential, { status: 200 }));
    const response = await relay.pair(fakeRequest(`{"code":"ABCD2345"}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual(credential);
    expect(calls[0]!.url).toBe("http://127.0.0.1:4000/api/live/overwolf/pair");
    expect(new TextDecoder().decode(calls[0]!.init.body as Uint8Array)).toBe(`{"code":"ABCD2345"}`);
  });

  test("a refused code is a bare 401 (the engine's reason never leaves the container)", async () => {
    const { relay } = relayWith(() => new Response(SENTINEL, { status: 401 }));
    const response = await relay.pair(fakeRequest(`{"code":"ABCD2345"}`));
    expect(response.status).toBe(401);
    expect(await response.text()).toBe("");
  });

  test("an oversized pairing body is 413", async () => {
    const { calls, relay } = relayWith(() => new Response(null, { status: 200 }));
    expect((await relay.pair(fakeRequest(new Uint8Array(OVERWOLF_RELAY_MAX_BYTES + 1)))).status).toBe(413);
    expect(calls).toHaveLength(0);
  });

  test("heroes needs a well-formed credential, forwards a GET, and passes the catalog body through", async () => {
    const { calls, relay } = relayWith(() => Response.json([{ id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage" }], { status: 200 }));
    expect((await relay.heroes(fakeRequest(null, {}), CAPTURE_ID)).status).toBe(401);
    expect(calls).toHaveLength(0);
    const response = await relay.heroes(fakeRequest(null, { "x-capture-credential": TOKEN }), CAPTURE_ID);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ id: 1, name: "npc_dota_hero_antimage", localizedName: "Anti-Mage" }]);
    expect(calls[0]!.url).toBe(`http://127.0.0.1:4000/api/live/overwolf/${CAPTURE_ID}/heroes`);
    expect(calls[0]!.init.method).toBe("GET");
  });

  test("nothing is logged", async () => {
    const { relay } = relayWith(() => new Response(null, { status: 200 }));
    await relay.batch(fakeRequest("{}", { "x-capture-credential": TOKEN }), CAPTURE_ID);
    await relay.pair(fakeRequest(`{"code":"ABCD2345"}`));
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});
