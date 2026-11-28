import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { createEngineTokenHandler } from "./app/api/auth/engine-token/route";
import { createCallbackHandler } from "./app/api/auth/steam/callback/route";
import { POST as confirmRoute } from "./app/api/waitlist/confirm/route";
import { POST as signupRoute } from "./app/api/waitlist/route";
import { isAccountAllowedNow, isSessionStillAllowed } from "./lib/beta-access";
import { getSession, renewSessionIfNeeded, sessionOptions } from "./lib/session";
import { proxy } from "./proxy";

// Estar en la waitlist (verificado o no) no da acceso al coach: se prueba contra el proxy, el token del motor y el login de Steam.

const SESSION_KEY = "test-session-" + "credential-with-at-least-thirty-two-characters";
const INTERNAL_KEY = "test-internal-" + "credential-with-at-least-thirty-two-characters";
const ORIGIN = "https://beta.example";
const OWNER = 1001;
const WAITLISTED_ACCOUNT = 3003;
const KEYS = ["SESSION_SECRET", "INTERNAL_AUTH_SECRET", "PUBLIC_BASE_URL", "BETA_ALLOWED_STEAM_IDS", "BETA_ADMIN_STEAM_IDS", "BETA_ACCESS_FILE", "WAITLIST_FILE", "RESEND_API_KEY", "WAITLIST_EMAIL_FROM"] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
const originalFetch = globalThis.fetch;
const COACH_PATHS = [
  "/simulator", "/live-draft", "/draft", "/random-draft", "/hero-pool", "/heroes", "/meta", "/settings", "/team-groups", "/admin/invitaciones",
  "/engine/api/session/protocol", "/engine/api/session/protocol/abc/recommendations", "/engine/api/suggestions/preview", "/engine/api/hero-pool",
  "/api/live/gsi-config", "/api/live/companion-installer", "/api/feedback",
  // La lista pública es exacta: nada colgado debajo de la waitlist queda abierto.
  "/waitlist/admin", "/api/waitlist/export", "/api/waitlist/confirm/extra", "/waitlistx",
];
let dir = "";

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-waitlist-access-"));
  process.env.SESSION_SECRET = SESSION_KEY;
  process.env.INTERNAL_AUTH_SECRET = INTERNAL_KEY;
  process.env.PUBLIC_BASE_URL = ORIGIN;
  process.env.BETA_ALLOWED_STEAM_IDS = String(OWNER);
  process.env.BETA_ADMIN_STEAM_IDS = String(OWNER);
  process.env.BETA_ACCESS_FILE = join(dir, "beta-access.json");
  process.env.WAITLIST_FILE = join(dir, "waitlist.json");
  process.env.RESEND_API_KEY = "test-" + "provider-credential";
  process.env.WAITLIST_EMAIL_FROM = "D2KIRO <hello@example.com>";
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

function jsonPost(path: string, body: unknown) {
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json" }, body: JSON.stringify(body) });
}

/** Recorre registro y confirmación con las rutas reales; el único doble es el proveedor de correo. */
async function becomeWaitlisted(email: string): Promise<Response[]> {
  const bodies: string[] = [];
  globalThis.fetch = (async (_url: unknown, init?: { body?: string }) => {
    bodies.push(String(init?.body));
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
  const signedUp = await signupRoute(jsonPost("/api/waitlist", { email }));
  const token = /token=([A-Za-z0-9_-]{43})/.exec(bodies[0] ?? "")?.[1];
  const confirmed = await confirmRoute(jsonPost("/api/waitlist/confirm", { token }));
  expect([signedUp.status, confirmed.status]).toEqual([202, 200]);
  return [signedUp, confirmed];
}

describe("la waitlist no concede acceso", () => {
  test("las pantallas y rutas de la waitlist son públicas", async () => {
    for (const path of ["/waitlist", "/waitlist/confirm", "/api/waitlist", "/api/waitlist/confirm"]) {
      expect((await proxy(new NextRequest(`${ORIGIN}${path}`))).headers.get("location")).toBeNull();
    }
  });

  test("registrarse y confirmar por las rutas reales no entrega cookie, sesión ni token; el coach sigue cerrado", async () => {
    const responses = await becomeWaitlisted("fan@example.com");
    expect(responses.map((response) => response.status)).toEqual([202, 200]);
    for (const response of responses) expect(response.headers.get("set-cookie")).toBeNull();
    expect(await responses[1].json()).toEqual({ status: "waitlisted", welcomeEmail: "sent" });
    for (const path of COACH_PATHS) {
      const response = await proxy(new NextRequest(`${ORIGIN}${path}`));
      expect([path, response.status, response.headers.get("location")]).toEqual([path, 307, `${ORIGIN}/login`]);
      expect(response.headers.get("x-middleware-request-x-account-token")).toBeNull();
    }
  });

  test("una cookie inventada de «verificado» no sirve", async () => {
    for (const cookie of ["d2k_waitlist=verified", "d2k_session=waitlisted", "d2k_access_request=waitlisted"]) {
      const response = await proxy(new NextRequest(`${ORIGIN}/simulator`, { headers: { cookie } }));
      expect(response.headers.get("location")).toBe(`${ORIGIN}/login`);
    }
  });

  test("una persona en la waitlist que entra con Steam sin estar admitida no obtiene sesión", async () => {
    await becomeWaitlisted("fan@example.com");
    let sessions = 0;
    const callback = createCallbackHandler({
      publicOrigin: ORIGIN,
      readNonce: () => "nonce",
      clearNonce: () => {},
      verify: async () => ({ ok: true, steamId64: BigInt("76561197960265728") + BigInt(WAITLISTED_ACCOUNT) }),
      createAccount: async () => true,
      getProfile: async () => ({ personaName: "Fan", avatarUrl: null, available: true }),
      startSession: async () => {
        sessions += 1;
      },
      createToken: () => "unused",
      isAccountAllowed: (accountId) => isAccountAllowedNow(accountId),
    });
    const response = await callback(new Request(`${ORIGIN}/api/auth/steam/callback?state=nonce`));
    expect(response.headers.get("location")).toBe(`${ORIGIN}/access-denied`);
    expect(sessions).toBe(0);
  });

  test("ni una sesión vieja de una cuenta no admitida llega al coach ni recibe token del motor", async () => {
    await becomeWaitlisted("fan@example.com");
    const now = Date.now();
    const sealed = await sealData({ accountId: WAITLISTED_ACCOUNT, issuedAt: now, firstLoginAt: now }, sessionOptions());
    for (const path of ["/simulator", "/engine/api/session/protocol"]) {
      const response = await proxy(new NextRequest(`${ORIGIN}${path}`, { headers: { cookie: `d2k_session=${sealed}` } }));
      expect(response.headers.get("location")).toBe(`${ORIGIN}/access-denied`);
    }
    const engineToken = createEngineTokenHandler({
      getSession: () => getSession({ get: () => ({ name: "d2k_session", value: sealed }), set: () => {} }),
      renewSession: renewSessionIfNeeded,
      mint: () => "never",
      now: Date.now,
      secret: () => INTERNAL_KEY,
      isAllowed: (accountId) => isSessionStillAllowed(accountId),
    });
    expect((await engineToken()).status).toBe(403);
  });
});
