import { afterEach, beforeEach, describe, expect, spyOn, test, type Mock } from "bun:test";
import { buildGsiConfig, GSI_CFG_FILENAME, gsiIngestUri } from "@/lib/gsi-config";
import { createGsiConfigHandler, type GsiConfigDependencies } from "@/lib/gsi-config-download";
import { buildWindowsGsiInstaller, GSI_WINDOWS_INSTALLER_FILENAME, GSI_WINDOWS_UNINSTALLER_FILENAME } from "@/lib/gsi-windows-installer";
import { WINDOWS_INSTALLER_ARTIFACT } from "./gsi-installer/route";
import { GET as uninstallerGet } from "./gsi-uninstaller/route";
import { createGsiRelayHandler, GSI_RELAY_MAX_BYTES, type FetchLike, type RelayRequest } from "./gsi/[liveId]/route";

// TSK-219 -- apps/web's two GSI routes: the public relay (Dota -> engine) and the authenticated cfg
// download. The engine is a fake `fetch` here: these tests lock the web boundary, not the engine.
// Requests are explicit fakes (headers + body only): in the full `apps/web` run happy-dom replaces the
// global Request, which -- like a browser -- drops forbidden headers such as Origin.

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

const ORIGIN = "https://d2kiro-test.up.railway.app";
const LIVE_ID = "L".repeat(43);
const TOKEN = "ab".repeat(32);
const INTERNAL_KEY = "test-internal-" + "credential-with-at-least-thirty-two-characters";

let consoleSpies: Mock<(...args: unknown[]) => void>[] = [];
beforeEach(() => {
  consoleSpies = (["log", "info", "warn", "error", "debug"] as const).map((method) => spyOn(console, method).mockImplementation(() => undefined));
});
afterEach(() => {
  for (const spy of consoleSpies) spy.mockRestore();
});

describe("gsi-config (pure)", () => {
  test("the cfg points to the site's HTTPS origin and carries the link token", () => {
    const uri = gsiIngestUri(ORIGIN, LIVE_ID);
    expect(uri).toBe(`${ORIGIN}/api/live/gsi/${LIVE_ID}`);
    const cfg = buildGsiConfig(uri!, TOKEN);
    expect(cfg).toContain(`"uri"           "${ORIGIN}/api/live/gsi/${LIVE_ID}"`);
    expect(cfg).toContain(`"token"         "${TOKEN}"`);
    expect(cfg).toContain(`"draft"         "1"`);
    expect(cfg).not.toMatch(/localhost|127\.0\.0\.1|http:\/\//);
  });

  test("never http, never localhost, never a malformed id or token in the file", () => {
    expect(gsiIngestUri("http://d2kiro-test.up.railway.app", LIVE_ID)).toBeNull();
    expect(gsiIngestUri("http://localhost:3000", LIVE_ID)).toBeNull();
    expect(gsiIngestUri(null, LIVE_ID)).toBeNull();
    expect(gsiIngestUri(ORIGIN, `${"L".repeat(42)}"`)).toBeNull();
    expect(gsiIngestUri("https://user:pw@d2kiro-test.up.railway.app", LIVE_ID)).toBeNull();
    expect(() => buildGsiConfig("http://x/api", TOKEN)).toThrow();
    expect(() => buildGsiConfig(`${ORIGIN}/api/live/gsi/${LIVE_ID}`, `${TOKEN.slice(0, 63)}"`)).toThrow();
  });
});

describe("public GSI relay", () => {
  function relay(engine: (body: Uint8Array) => Response = () => new Response(null, { status: 200 })) {
    const calls: { url: string; body: Uint8Array }[] = [];
    const handler = createGsiRelayHandler({
      engineUrl: () => "http://engine.internal:4000",
      fetch: (async (url: string, init: RequestInit) => {
        const body = init.body as Uint8Array;
        calls.push({ url, body });
        return engine(body);
      }) as unknown as FetchLike,
    });
    return { handler, calls };
  }
  const post = (body: string, headers: Record<string, string> = {}) => fakeRequest(body, headers);

  test("forwards the exact body to the engine's single ingest path and returns only a status", async () => {
    const { handler, calls } = relay(() => Response.json({ leaked: TOKEN }, { status: 200 }));
    const payload = JSON.stringify({ auth: { token: TOKEN }, map: { game_state: "DOTA_GAMERULES_STATE_HERO_SELECTION" } });
    const response = await handler(post(payload), LIVE_ID);
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe(`http://engine.internal:4000/api/live/gsi/${LIVE_ID}`);
    expect(new TextDecoder().decode(calls[0]?.body)).toBe(payload);
  });

  test("engine refusals pass through as bare statuses; unknown engine statuses become 502", async () => {
    for (const status of [400, 401, 409, 413, 429]) expect((await relay(() => new Response(null, { status })).handler(post("{}"), LIVE_ID)).status).toBe(status);
    expect((await relay(() => new Response("boom", { status: 500 })).handler(post("{}"), LIVE_ID)).status).toBe(502);
  });

  test("a malformed live id never reaches the engine", async () => {
    const { handler, calls } = relay();
    for (const id of ["short", "../../api/hero-pool", `${"L".repeat(42)}/`]) expect((await handler(post("{}"), id)).status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  test("oversized bodies are cut at the edge (declared or streamed) and never forwarded", async () => {
    const { handler, calls } = relay();
    expect((await handler(post("{}", { "content-length": String(GSI_RELAY_MAX_BYTES + 1) }), LIVE_ID)).status).toBe(413);
    expect((await handler(fakeRequest(new Uint8Array(GSI_RELAY_MAX_BYTES + 1)), LIVE_ID)).status).toBe(413);
    expect((await handler(fakeRequest(null), LIVE_ID)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("a slow-trickle body is cut at the read deadline (408) and never forwarded", async () => {
    const calls: string[] = [];
    const handler = createGsiRelayHandler({
      engineUrl: () => "http://engine.internal:4000",
      fetch: async (url) => {
        calls.push(url);
        return new Response(null, { status: 200 });
      },
      readDeadlineMs: 30,
    });
    const neverEnds = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("{"));
      },
    });
    expect((await handler({ headers: fakeHeaders({}), body: neverEnds }, LIVE_ID)).status).toBe(408);
    expect(calls).toHaveLength(0);
  });

  test("a client that aborts mid-body gets a bare 400, never an error", async () => {
    const calls: string[] = [];
    const handler = createGsiRelayHandler({ engineUrl: () => "http://engine.internal:4000", fetch: async (url) => { calls.push(url); return new Response(null, { status: 200 }); } });
    const aborted = new ReadableStream<Uint8Array<ArrayBuffer>>({
      start(controller) {
        controller.error(new Error("client aborted"));
      },
    });
    expect((await handler({ headers: fakeHeaders({}), body: aborted }, LIVE_ID)).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  test("engine down -> 503, and nothing is logged", async () => {
    const handler = createGsiRelayHandler({ engineUrl: () => "http://engine.internal:4000", fetch: () => Promise.reject(new Error(TOKEN)) });
    expect((await handler(post(JSON.stringify({ auth: { token: TOKEN } })), LIVE_ID)).status).toBe(503);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("cfg download (POST /api/live/gsi-config)", () => {
  function deps(overrides: Partial<GsiConfigDependencies> = {}) {
    const engineCalls: { url: string; headers: Record<string, string> }[] = [];
    const dependencies: GsiConfigDependencies = {
      getSession: async () => ({ accountId: 101 }) as Awaited<ReturnType<GsiConfigDependencies["getSession"]>>,
      renewSession: async () => true,
      canonicalOrigin: () => ORIGIN,
      secret: () => INTERNAL_KEY,
      engineUrl: () => "http://engine.internal:4000",
      mint: (accountId) => `minted-for-${accountId}`,
      fetch: (async (url: string, init: RequestInit) => {
        engineCalls.push({ url, headers: init.headers as Record<string, string> });
        return Response.json({ liveId: LIVE_ID, token: TOKEN, sessionId: "s-1", expiresAt: "2026-11-01T00:00:00.000Z" }, { status: 201 });
      }) as unknown as GsiConfigDependencies["fetch"],
      ...overrides,
    };
    return { handler: createGsiConfigHandler(dependencies), engineCalls };
  }
  const form = (origin: string | null = ORIGIN) => ({ headers: fakeHeaders(origin === null ? {} : { origin }) });

  test("signed-in, same-origin: issues a link for THIS session's account and downloads the cfg", async () => {
    const { handler, engineCalls } = deps();
    const response = await handler(form());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${GSI_CFG_FILENAME}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const cfg = await response.text();
    expect(cfg).toContain(`"uri"           "${ORIGIN}/api/live/gsi/${LIVE_ID}"`);
    expect(cfg).toContain(TOKEN);
    expect(engineCalls).toEqual([{ url: "http://engine.internal:4000/api/live/gsi-link/issue", headers: { "x-account-token": "minted-for-101" } }]);
  });

  test("no session -> back to /live-draft, nothing issued", async () => {
    const { handler, engineCalls } = deps({ renewSession: async () => false });
    const response = await handler(form());
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(`${ORIGIN}/live-draft?setup=session`);
    expect(engineCalls).toHaveLength(0);
  });

  test("cross-site or missing Origin (CSRF) -> refused before touching the session or the engine", async () => {
    let sessionRead = false;
    const { handler, engineCalls } = deps({ getSession: async () => { sessionRead = true; return ({ accountId: 101 }) as Awaited<ReturnType<GsiConfigDependencies["getSession"]>>; } });
    expect((await handler(form("https://evil.example"))).headers.get("location")).toBe(`${ORIGIN}/live-draft?setup=origin`);
    expect((await handler(form(null))).headers.get("location")).toBe(`${ORIGIN}/live-draft?setup=origin`);
    expect(sessionRead).toBe(false);
    expect(engineCalls).toHaveLength(0);
  });

  test("a non-https site origin never produces a cfg", async () => {
    const { handler } = deps({ canonicalOrigin: () => "http://localhost:3000" });
    const response = await handler(form("http://localhost:3000"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("http://localhost:3000/live-draft?setup=unavailable");
  });

  test("engine refusal or garbage -> 'unavailable', never a half-written file, nothing logged", async () => {
    for (const engine of [() => new Response(null, { status: 401 }), () => Response.json({ liveId: LIVE_ID }), () => Promise.reject(new Error("down"))]) {
      const { handler } = deps({ fetch: engine as unknown as GsiConfigDependencies["fetch"] });
      const response = await handler(form());
      expect(response.status).toBe(303);
      expect(response.headers.get("location")).toBe(`${ORIGIN}/live-draft?setup=unavailable`);
    }
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("Windows installer download (POST /api/live/gsi-installer)", () => {
  function deps(overrides: Partial<GsiConfigDependencies> = {}) {
    const engineCalls: string[] = [];
    const dependencies: GsiConfigDependencies = {
      getSession: async () => ({ accountId: 101 }) as Awaited<ReturnType<GsiConfigDependencies["getSession"]>>,
      renewSession: async () => true,
      canonicalOrigin: () => ORIGIN,
      secret: () => INTERNAL_KEY,
      engineUrl: () => "http://engine.internal:4000",
      mint: (accountId) => `minted-for-${accountId}`,
      fetch: (async (url: string) => {
        engineCalls.push(url);
        return Response.json({ liveId: LIVE_ID, token: TOKEN, sessionId: "s-1", expiresAt: "2026-11-01T00:00:00.000Z" }, { status: 201 });
      }) as unknown as GsiConfigDependencies["fetch"],
      ...overrides,
    };
    return { handler: createGsiConfigHandler(dependencies, WINDOWS_INSTALLER_ARTIFACT), engineCalls };
  }
  const form = (origin: string | null = ORIGIN) => ({ headers: fakeHeaders(origin === null ? {} : { origin }) });

  test("signed-in, same-origin: a fresh link wrapped in the double-click installer, never cached", async () => {
    const { handler, engineCalls } = deps();
    const response = await handler(form());
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${GSI_WINDOWS_INSTALLER_FILENAME}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    const body = await response.text();
    expect(body).toBe(buildWindowsGsiInstaller(buildGsiConfig(gsiIngestUri(ORIGIN, LIVE_ID)!, TOKEN)));
    expect(body.split(TOKEN)).toHaveLength(2);
    expect(engineCalls).toEqual(["http://engine.internal:4000/api/live/gsi-link/issue"]);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });

  test("same locks as the cfg: no session, cross-site, or engine trouble -> back to /live-draft, no file", async () => {
    const noSession = deps({ renewSession: async () => false });
    expect((await noSession.handler(form())).headers.get("location")).toBe(`${ORIGIN}/live-draft?setup=session`);
    expect(noSession.engineCalls).toHaveLength(0);
    const crossSite = deps();
    expect((await crossSite.handler(form("https://evil.example"))).headers.get("location")).toBe(`${ORIGIN}/live-draft?setup=origin`);
    expect(crossSite.engineCalls).toHaveLength(0);
    const engineDown = deps({ fetch: (() => Promise.reject(new Error(TOKEN))) as unknown as GsiConfigDependencies["fetch"] });
    expect((await engineDown.handler(form())).headers.get("location")).toBe(`${ORIGIN}/live-draft?setup=unavailable`);
    for (const spy of consoleSpies) expect(spy).not.toHaveBeenCalled();
  });
});

describe("Windows uninstaller download (GET /api/live/gsi-uninstaller)", () => {
  test("a credential-free file that only removes the D2KIRO cfg", async () => {
    const response = uninstallerGet();
    expect(response.status).toBe(200);
    expect(response.headers.get("content-disposition")).toBe(`attachment; filename="${GSI_WINDOWS_UNINSTALLER_FILENAME}"`);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const body = await response.text();
    expect(body).not.toMatch(/[0-9a-f]{64}/);
    expect(body).toContain('set "D2KIRO_MODE=uninstall"');
    expect(body).toContain(GSI_CFG_FILENAME);
  });
});
