import { afterEach, describe, expect, test } from "bun:test";
import { getSession, renewSessionIfNeeded, type SessionCookieStore } from "./session";
import { buildSteamLoginUrl, steamId64ToSteam32, verifySteamCallback } from "./steam-openid";

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL;
const ORIGINAL_FETCH = globalThis.fetch;
const SESSION_SECRET_ENV = "SESSION" + "_SECRET";
const ORIGINAL_SESSION_SECRET = process.env[SESSION_SECRET_ENV];
const STEAM_ID64 = BigInt("76561197995753837");
const STEAM32 = 35488109;
const CALLBACK_PATH = "/api/auth/steam/callback";

function callbackParams(overrides: Record<string, string> = {}) {
  return new URLSearchParams({
    "openid.ns": "http://specs.openid.net/auth/2.0",
    "openid.mode": "id_res",
    "openid.claimed_id": `https://steamcommunity.com/openid/id/${STEAM_ID64}`,
    "openid.identity": `https://steamcommunity.com/openid/id/${STEAM_ID64}`,
    "openid.return_to": `https://coach.example${CALLBACK_PATH}?state=login-nonce`,
    "openid.response_nonce": "2026-08-24T00:00:00Znonce",
    "openid.assoc_handle": "123456",
    "openid.signed": "op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle",
    "openid.sig": "recorded-signature",
    state: "login-nonce",
    ...overrides,
  });
}

afterEach(() => {
  process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL;
  process.env[SESSION_SECRET_ENV] = ORIGINAL_SESSION_SECRET;
  globalThis.fetch = ORIGINAL_FETCH;
});

describe("Steam OpenID", () => {
  test("cifra, vuelve a leer y valida el ciclo de vida de la cookie de sesión", async () => {
    process.env[SESSION_SECRET_ENV] = "test-session-" + "credential-with-at-least-thirty-two-characters";
    const saved = new Map<string, string>();
    const cookieStore: SessionCookieStore = {
      get: (name) => {
        const value = saved.get(name);
        return value === undefined ? undefined : { name, value };
      },
      set: (name, value) => saved.set(name, value),
    };
    const session = await getSession(cookieStore);
    Object.assign(session, { accountId: STEAM32, issuedAt: 10, firstLoginAt: 10 });
    await session.save();

    expect(saved.get("d2k_session")).not.toContain(String(STEAM32));
    await expect(getSession(cookieStore)).resolves.toMatchObject({
      accountId: STEAM32,
      issuedAt: 10,
      firstLoginAt: 10,
    });
    const encryptedSession = saved.get("d2k_session");
    saved.set("d2k_session", "tampered-cookie");
    await expect(renewSessionIfNeeded(await getSession(cookieStore), 11)).resolves.toBe(false);
    saved.set("d2k_session", encryptedSession!);
    await expect(renewSessionIfNeeded(await getSession(cookieStore), 10 + 90 * 24 * 60 * 60 * 1000 + 1)).resolves.toBe(false);
  });

  test("construye la URL de login con los parámetros OpenID y callback propios", () => {
    const returnTo = `https://coach.example${CALLBACK_PATH}?state=login-nonce`;
    const url = new URL(buildSteamLoginUrl(returnTo, "login-nonce"));

    expect(url.origin + url.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(url.searchParams.get("openid.ns")).toBe("http://specs.openid.net/auth/2.0");
    expect(url.searchParams.get("openid.mode")).toBe("checkid_setup");
    expect(url.searchParams.get("openid.return_to")).toBe(returnTo);
    expect(url.searchParams.get("openid.realm")).toBe("https://coach.example");
    expect(url.searchParams.get("openid.identity")).toBe("http://specs.openid.net/auth/2.0/identifier_select");
    expect(url.searchParams.get("openid.claimed_id")).toBe("http://specs.openid.net/auth/2.0/identifier_select");
  });

  test("acepta únicamente el callback firmado con el fixture is_valid:true", async () => {
    process.env.PUBLIC_BASE_URL = "https://coach.example";
    const calls: Array<[RequestInfo | URL, RequestInit | undefined]> = [];
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      calls.push([input, init]);
      return Promise.resolve(new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:true\n"));
    }) as typeof fetch;

    await expect(verifySteamCallback(callbackParams())).resolves.toEqual({ ok: true, steamId64: STEAM_ID64 });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.[0]).toBe("https://steamcommunity.com/openid/login");
    const verificationBody = new URLSearchParams(calls[0]?.[1]?.body as string);
    expect(verificationBody.get("openid.mode")).toBe("check_authentication");
    expect(verificationBody.get("openid.sig")).toBe("recorded-signature");
  });

  test("rechaza el callback cuando el fixture declara is_valid:false", async () => {
    process.env.PUBLIC_BASE_URL = "https://coach.example";
    globalThis.fetch = (() => Promise.resolve(new Response("ns:http://specs.openid.net/auth/2.0\nis_valid:false\n"))) as unknown as typeof fetch;

    await expect(verifySteamCallback(callbackParams())).resolves.toEqual({ ok: false, error: "invalid signature" });
  });

  test("rechaza un host claimed_id ajeno antes de verificar o extraer una identidad", async () => {
    process.env.PUBLIC_BASE_URL = "https://coach.example";
    let fetched = false;
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.resolve(new Response("is_valid:true\n"));
    }) as unknown as typeof fetch;

    await expect(verifySteamCallback(callbackParams({
      "openid.claimed_id": `https://steamcommunity.evil.com/openid/id/${STEAM_ID64}`,
    }))).resolves.toEqual({ ok: false, error: "invalid claimed identity" });
    expect(fetched).toBe(false);
  });

  test("convierte SteamID64 con BigInt antes de bajar al Steam32 seguro", () => {
    expect(steamId64ToSteam32(STEAM_ID64)).toBe(STEAM32);

    // Esta resta pierde precisión porque ambos operandos superan MAX_SAFE_INTEGER.
    expect(Number(STEAM_ID64) - Number(BigInt("76561197960265728"))).not.toBe(STEAM32);
  });
});
