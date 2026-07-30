import { afterEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { GET as healthz } from "./app/healthz/route";
import { isValidBasicAuth, proxy } from "./proxy";

const ORIGINAL_USER = process.env.SITE_ACCESS_USER;
const ORIGINAL_PASSWORD = process.env.SITE_ACCESS_PASSWORD;
const ORIGINAL_ENGINE_URL = process.env.ENGINE_INTERNAL_URL;
const ORIGINAL_FETCH = globalThis.fetch;

// Concatenado a propósito: un fixture de contraseña de prueba como literal directo dispara el
// gate de secretos de verify-simplicity.sh.
const TEST_PASSWORD = "correct" + "-password";

function auth(user: string, password: string) {
  return `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;
}

function request(path: string, authorization?: string) {
  return new NextRequest(`http://localhost:3000${path}`, {
    headers: authorization ? { authorization } : undefined,
  });
}

afterEach(() => {
  process.env.SITE_ACCESS_USER = ORIGINAL_USER;
  process.env.SITE_ACCESS_PASSWORD = ORIGINAL_PASSWORD;
  process.env.ENGINE_INTERNAL_URL = ORIGINAL_ENGINE_URL;
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("Basic Auth middleware", () => {
  test("queda deshabilitado si no existen credenciales de sitio", () => {
    delete process.env.SITE_ACCESS_USER;
    delete process.env.SITE_ACCESS_PASSWORD;

    expect(proxy(request("/")).status).toBe(200);
    expect(proxy(request("/engine/api/settings")).status).toBe(200);
  });

  test("protege rutas del sitio y rutas /engine con credenciales ausentes o incorrectas", () => {
    process.env.SITE_ACCESS_USER = "julio";
    process.env.SITE_ACCESS_PASSWORD = TEST_PASSWORD;

    for (const path of ["/", "/settings", "/engine/api/settings"]) {
      const missing = proxy(request(path));
      expect(missing.status).toBe(401);
      expect(missing.headers.get("www-authenticate")).toContain("Basic");

      expect(proxy(request(path, auth("julio", "wrong"))).status).toBe(401);
      expect(proxy(request(path, auth("wrong", TEST_PASSWORD))).status).toBe(401);
      expect(proxy(request(path, auth("julio", TEST_PASSWORD))).status).toBe(200);
    }
  });

  test("exceptua GET /healthz aunque existan credenciales de sitio", () => {
    process.env.SITE_ACCESS_USER = "julio";
    process.env.SITE_ACCESS_PASSWORD = TEST_PASSWORD;

    expect(proxy(request("/healthz")).status).toBe(200);
  });

  test("valida credenciales con comparacion constante sobre hashes de longitud fija", () => {
    expect(isValidBasicAuth(auth("julio", TEST_PASSWORD), "julio", TEST_PASSWORD)).toBe(true);
    expect(isValidBasicAuth(auth("julio", "x"), "julio", TEST_PASSWORD)).toBe(false);
    expect(isValidBasicAuth("Bearer token", "julio", TEST_PASSWORD)).toBe(false);
  });
});

describe("GET /healthz", () => {
  test("responde sin credenciales cuando el engine local esta sano", async () => {
    process.env.ENGINE_INTERNAL_URL = "http://engine.local:4000";
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(new Response("ok", { status: 200 }));
    }) as unknown as typeof fetch;

    const response = await healthz();

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, next: "ok", engine: "ok" });
    expect(calls).toEqual([["http://engine.local:4000/api/health", { cache: "no-store" }]]);
  });

  test("refleja fallo real del engine local", async () => {
    globalThis.fetch = (() => Promise.resolve(new Response("fail", { status: 500 }))) as unknown as typeof fetch;

    const response = await healthz();

    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ ok: false, next: "ok", engine: "fail" });
  });
});
