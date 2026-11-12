import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sealData } from "iron-session";
import { NextRequest } from "next/server";
import { applyAccessAction, accessRef, recordAccessRequest } from "./lib/beta-access-store";
import { getSessionProfile, sessionOptions } from "./lib/session";
import { proxy } from "./proxy";

const SESSION_KEY = "test-session-" + "credential-with-at-least-thirty-two-characters";
const INTERNAL_KEY = "test-internal-" + "credential-with-at-least-thirty-two-characters";
const OWNER = 1001;
const FRIEND = 2002;
const KEYS = ["SESSION_SECRET", "INTERNAL_AUTH_SECRET", "PUBLIC_BASE_URL", "BETA_ALLOWED_STEAM_IDS", "BETA_ADMIN_STEAM_IDS", "BETA_ACCESS_FILE"] as const;
const original = Object.fromEntries(KEYS.map((key) => [key, process.env[key]]));
let dir = "";
let file = "";

async function requestAs(accountId: number, path = "/hero-pool") {
  const now = Date.now();
  const sealed = await sealData({ accountId, issuedAt: now, firstLoginAt: now }, sessionOptions());
  return new NextRequest(`https://beta.example${path}`, { headers: { cookie: `d2k_session=${sealed}` } });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-proxy-access-"));
  file = join(dir, "beta-access.json");
  process.env.SESSION_SECRET = SESSION_KEY;
  process.env.INTERNAL_AUTH_SECRET = INTERNAL_KEY;
  process.env.PUBLIC_BASE_URL = "https://beta.example";
  process.env.BETA_ALLOWED_STEAM_IDS = String(OWNER);
  process.env.BETA_ADMIN_STEAM_IDS = String(OWNER);
  process.env.BETA_ACCESS_FILE = file;
});

afterEach(() => {
  for (const key of KEYS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
  rmSync(dir, { recursive: true, force: true });
});

describe("el acceso a la beta se hace cumplir en cada petición", () => {
  test("una cuenta que nunca fue admitida con una sesión forjada o vieja es llevada a «acceso pendiente»", async () => {
    const response = await proxy(await requestAs(FRIEND));
    expect(response.status).toBe(307);
    expect(new URL(response.headers.get("location")!).pathname).toBe("/access-denied");
    expect(response.headers.get("set-cookie") ?? "").toMatch(/d2k_session=;|d2k_session=.*Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  test("el propietario y los invitados aprobados pasan; al retirar la invitación, la sesión abierta deja de servir", async () => {
    expect((await proxy(await requestAs(OWNER))).status).toBe(200);
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    applyAccessAction(file, "approve", accessRef(FRIEND, SESSION_KEY), SESSION_KEY, 2);
    expect((await proxy(await requestAs(FRIEND))).status).toBe(200);
    applyAccessAction(file, "revoke", accessRef(FRIEND, SESSION_KEY), SESSION_KEY, 3);
    const after = await proxy(await requestAs(FRIEND));
    expect(after.status).toBe(307);
    expect(new URL(after.headers.get("location")!).pathname).toBe("/access-denied");
  });

  test("un invitado aprobado no es administrador (solo lo es quien figura en BETA_ADMIN_STEAM_IDS)", async () => {
    recordAccessRequest(file, { steam32: FRIEND, personaName: "Amigo", avatarUrl: null, at: 1 });
    applyAccessAction(file, "approve", accessRef(FRIEND, SESSION_KEY), SESSION_KEY, 2);
    expect(process.env.BETA_ADMIN_STEAM_IDS).toBe(String(OWNER));
    expect(getSessionProfile({ accountId: FRIEND, issuedAt: 1, firstLoginAt: 1 }, false).isAdmin).toBe(false);
  });

  test("sin beta configurada (desarrollo/E2E) no se bloquea a nadie", async () => {
    delete process.env.BETA_ALLOWED_STEAM_IDS;
    expect((await proxy(await requestAs(FRIEND))).status).toBe(200);
  });
});

describe("autenticación y perfil son cosas distintas", () => {
  test("con nombre real y perfil leído: ok", () => {
    expect(getSessionProfile({ accountId: OWNER, issuedAt: 1, firstLoginAt: 1, personaName: "Kiro", avatarUrl: "https://avatars.steamstatic.com/a.jpg", profileAvailable: true }).profileStatus).toBe("ok");
  });

  test("sesión válida sin perfil público: sigue autenticada, perfil no disponible y nombre neutro (nunca el ID)", () => {
    const profile = getSessionProfile({ accountId: OWNER, issuedAt: 1, firstLoginAt: 1, personaName: "Jugador de Steam", avatarUrl: null, profileAvailable: false });
    expect(profile.profileStatus).toBe("unavailable");
    expect(profile.personaName).toBe("Jugador de Steam");
    expect(profile.avatarUrl).toBeNull();
  });

  test("sesiones anteriores al campo: con nombre real cuentan como ok, sin nombre como no disponible", () => {
    expect(getSessionProfile({ accountId: OWNER, issuedAt: 1, firstLoginAt: 1, personaName: "Kiro" }).profileStatus).toBe("ok");
    expect(getSessionProfile({ accountId: OWNER, issuedAt: 1, firstLoginAt: 1 }).profileStatus).toBe("unavailable");
    expect(getSessionProfile({ accountId: OWNER, issuedAt: 1, firstLoginAt: 1, personaName: "Steam 35488109" }).profileStatus).toBe("unavailable");
  });
});
