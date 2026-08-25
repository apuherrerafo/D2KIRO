import { afterEach, describe, expect, test } from "bun:test";
import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { verifyAccountToken } from "../engine/src/server/account-token";
import { GET as healthz } from "./app/healthz/route";
import { mintAccountToken } from "./lib/account-token";
import { sessionOptions } from "./lib/session";
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
  test("deja públicas login, auth y healthz", async () => {
    for (const path of ["/login", "/api/auth/steam/login", "/healthz"]) {
      expect((await proxy(new NextRequest(`http://localhost:3000${path}`))).status).toBe(200);
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
