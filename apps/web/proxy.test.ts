import { afterEach, describe, expect, test } from "bun:test";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { verifyAccountToken } from "../engine/src/server/account-token";
import { GET as healthz } from "./app/healthz/route";
import { mintAccountToken } from "./lib/account-token";
import { sessionOptions } from "./lib/session";
import { isPublicCoachAsset } from "./lib/public-coach-assets";
import { proxy } from "./proxy";

const SESSION_SECRET_ENV = "SESSION" + "_SECRET";
const INTERNAL_SECRET_ENV = "INTERNAL" + "_AUTH_SECRET";
const ORIGINAL_SESSION_SECRET = process.env[SESSION_SECRET_ENV];
const ORIGINAL_INTERNAL_SECRET = process.env[INTERNAL_SECRET_ENV];
const ORIGINAL_ENGINE_URL = process.env.ENGINE_INTERNAL_URL;
const ORIGINAL_FETCH = globalThis.fetch;
const SESSION_KEY = "test-session-" + "credential-with-at-least-thirty-two-characters";
const INTERNAL_KEY = "test-internal-" + "credential-with-at-least-thirty-two-characters";

function configureAuth() {
  process.env[SESSION_SECRET_ENV] = SESSION_KEY;
  process.env[INTERNAL_SECRET_ENV] = INTERNAL_KEY;
}

async function authenticatedRequest(path: string, accountId = 35488109) {
  configureAuth();
  const now = Date.now();
  const sealed = await sealData({ accountId, issuedAt: now, firstLoginAt: now }, sessionOptions());
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: { cookie: `d2k_session=${sealed}` },
  });
}

afterEach(() => {
  process.env[SESSION_SECRET_ENV] = ORIGINAL_SESSION_SECRET;
  process.env[INTERNAL_SECRET_ENV] = ORIGINAL_INTERNAL_SECRET;
  process.env.ENGINE_INTERNAL_URL = ORIGINAL_ENGINE_URL;
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("proxy de sesión y token interno", () => {
  test("deja públicas la landing (/), login, auth y healthz", async () => {
    for (const path of ["/", "/login", "/access-denied", "/api/auth/steam/login", "/healthz"]) {
      expect((await proxy(new NextRequest(`http://localhost:3000${path}`))).status).toBe(200);
    }
  });

  test("TSK-219: sólo la ingesta GSI de Dota es pública; la descarga del cfg y la gestión del enlace exigen sesión", async () => {
    configureAuth();
    const ingest = await proxy(new NextRequest(`http://localhost:3000/api/live/gsi/${"A".repeat(43)}`, { method: "POST" }));
    expect(ingest.status).toBe(200);
    expect(ingest.headers.get("x-middleware-request-x-account-token")).toBeNull();
    // local visual capture shares the door (and the link credential), and only that prefix
    const visual = await proxy(new NextRequest(`http://localhost:3000/api/live/visual/${"A".repeat(43)}`, { method: "POST" }));
    expect(visual.status).toBe(200);
    expect(visual.headers.get("x-middleware-request-x-account-token")).toBeNull();
    // the D2KIRO Companion heartbeat shares it too -- but its personal installer download needs a session
    const companion = await proxy(new NextRequest(`http://localhost:3000/api/live/companion/${"A".repeat(43)}`, { method: "POST" }));
    expect(companion.status).toBe(200);
    expect(companion.headers.get("x-middleware-request-x-account-token")).toBeNull();
    for (const path of ["/api/live/gsi-config", "/api/live/gsi-installer", "/api/live/gsi-uninstaller", "/api/live/companion-installer", "/api/live/companion", "/api/live/gsi", "/api/live/visual", "/engine/api/live/gsi-link", "/live-draft"]) {
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`, { method: "POST" }));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    }
  });

  test("Landing V2: los assets del Coach que la página pide son públicos (exactos); el resto de /coach-* exige sesión", async () => {
    configureAuth();
    const publicDir = join(import.meta.dir, "public");
    const shipped = [
      ...readdirSync(join(publicDir, "coach-motion-v2/prod/384")).map((f) => `/coach-motion-v2/prod/384/${f}`),
      ...readdirSync(join(publicDir, "coach-web-pack/hero")).map((f) => `/coach-web-pack/hero/${f}`),
      ...readdirSync(join(publicDir, "coach-web-pack/memory")).map((f) => `/coach-web-pack/memory/${f}`),
      "/coach-web-pack/reconstruct-memory.webp",
    ];
    expect(shipped.length).toBeGreaterThan(300);
    for (const path of shipped) expect(isPublicCoachAsset(path)).toBe(true);
    expect((await proxy(new NextRequest("http://localhost:3000/coach-motion-v2/prod/384/manifest.json"))).status).toBe(200);

    const closed = [
      "/coach-motion-v2/manifest.json",
      "/coach-motion-v2/prod/512/manifest.json",
      "/coach-motion-v2/prod/384/",
      "/coach-motion-v2/prod/384/../512/manifest.json",
      "/coach-motion-v2/prod/384/watching-00.avif",
      "/coach-motion-v2/prod/384/notes.json",
      "/coach-motion-v2/calibration/manifest.json",
      "/coach-motion-v2/A/manifest.json",
      "/coach-motion-v2/watching-idle.webp",
      "/coach-gold-master/coach-modular.bin",
      "/coach-web-pack/hero/",
      "/coach-web-pack/hero/watching-c.png",
      "/lab/coach-motion-v2/full-pack",
      "/lab/landing-v2",
    ];
    for (const path of closed) {
      expect(isPublicCoachAsset(path)).toBe(false);
      const response = await proxy(new NextRequest(`http://localhost:3000${path}`));
      expect(response.status).toBe(307);
      expect(response.headers.get("location")).toBe("http://localhost:3000/login");
    }
  });

  test("sin sesión rechaza antes de llegar al motor", async () => {
    configureAuth();
    const response = await proxy(new NextRequest("http://localhost:3000/engine/api/hero-pool"));

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost:3000/login");
  });

  test("una sesión válida inyecta un token HMAC verificable sólo para el rewrite del motor", async () => {
    const response = await proxy(await authenticatedRequest("/engine/api/hero-pool"));
    const header = response.headers.get("x-middleware-request-x-account-token");

    expect(header).toBeString();
    expect(verifyAccountToken(header ?? undefined, INTERNAL_KEY, () => Date.now(), new Map())).toEqual({ ok: true, accountId: 35488109 });
    expect(response.headers.get("x-account-token")).toBeNull();
  });

  test("el vector compartido acuña la firma exacta que verifica el motor", () => {
    expect(mintAccountToken(123456789, "d2k-test-vector-key-0123456789ab", 1787500000000, "0123456789abcdef0123456789abcdef"))
      .toBe("123456789.1787500000000.0123456789abcdef0123456789abcdef.033834d055eb3497adbe0188a53b636815f15e9f7e6836b0e66e9228a7f0be98");
  });

  test("el arranque Railway falla cerrado sin secretos de identidad", async () => {
    const child = Bun.spawn(["bash", "../../scripts/start-railway.sh"], {
      cwd: import.meta.dir,
      env: { PATH: process.env.PATH ?? "" },
      stdout: "pipe",
      stderr: "pipe",
    });

    await expect(child.exited).resolves.toBe(1);
  });
});

describe("GET /healthz", () => {
  test("responde sin credenciales cuando el engine local esta sano", async () => {
    process.env.ENGINE_INTERNAL_URL = "http://engine.local:4000";
    globalThis.fetch = (() => Promise.resolve(new Response("ok", { status: 200 }))) as unknown as typeof fetch;

    const response = await healthz();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, next: "ok", engine: "ok" });
  });
});
