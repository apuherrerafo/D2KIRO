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
import { config, proxy } from "./proxy";

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

// Las rutas reales usan los límites reales: cada petición llega desde su propia dirección.
let visitors = 0;
function jsonPost(path: string, body: unknown) {
  visitors += 1;
  return new Request(`${ORIGIN}${path}`, { method: "POST", headers: { origin: ORIGIN, "content-type": "application/json", "x-real-ip": `198.51.${visitors}.1` }, body: JSON.stringify(body) });
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

// Next copia en memoria (hasta 10 MB) el cuerpo de toda petición que pasa por el proxy, y no la entrega a la ruta hasta recibirlo
// entero: el tope de 8 KB del handler solo vale si sus dos rutas quedan fuera del matcher.
// El compilador de matchers de Next corre en un proceso aparte: importarlo aquí deja sin AsyncLocalStorage al resto de la corrida.
const MATCH_SCRIPT = `
require("next/dist/server/node-environment-baseline");
const { unstable_doesMiddlewareMatch } = require("next/experimental/testing/server");
const [matcher, urls] = JSON.parse(process.argv[1]);
console.log(JSON.stringify(urls.map((url) => unstable_doesMiddlewareMatch({ config: { matcher }, url }))));
`;

function proxyRunsFor(paths: string[]): Array<[string, boolean]> {
  const input = JSON.stringify([config.matcher, paths.map((path) => `${ORIGIN}${path}`)]);
  const child = Bun.spawnSync([process.execPath, "-e", MATCH_SCRIPT, input], { cwd: import.meta.dir });
  if (child.exitCode !== 0) throw new Error(child.stderr.toString());
  const results = JSON.parse(child.stdout.toString()) as boolean[];
  return paths.map((path, index) => [path, results[index]]);
}

describe("qué pasa por el proxy", () => {
  test("las dos rutas que reciben el cuerpo de la waitlist quedan fuera, también con parámetros", () => {
    const paths = ["/api/waitlist", "/api/waitlist/confirm", "/api/waitlist?x=1", "/api/waitlist/confirm?x=1"];
    expect(proxyRunsFor(paths)).toEqual(paths.map((path) => [path, false]));
  });

  test("la exclusión es exacta: todo lo cerrado sigue pasando por el proxy", () => {
    const paths = [
      ...COACH_PATHS,
      "/api/waitlistx", "/api/waitlist-admin", "/api/waitlist/confirmx", "/api/waitlist/confirm-all", "/api/waitlist/export/confirm",
      "/api/waitlist.json", "/api/waitlist/confirm.json", "/api/waitlist.rsc", "/api/waitlist/%63onfirm", "/API/WAITLIST", "/x/api/waitlist",
      "/engine/api/waitlist", "/api/Waitlist/confirm",
    ];
    expect(proxyRunsFor(paths)).toEqual(paths.map((path) => [path, true]));
  });

  test("las rutas con cuerpos grandes y el corte de /_next/image siguen pasando por el proxy", () => {
    const paths = ["/api/feedback", "/api/feedback-admin/export", "/api/live/gsi/abc", "/api/live/visual/abc", "/api/auth/access-request", "/api/beta-admin", "/waitlist", "/waitlist/confirm", "/", "/_next/image"];
    expect(proxyRunsFor(paths)).toEqual(paths.map((path) => [path, true]));
  });
});
