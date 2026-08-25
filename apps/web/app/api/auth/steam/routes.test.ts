import { describe, expect, test } from "bun:test";
import { createLoginHandler } from "./login/route";
import { createCallbackHandler, createAccountToken } from "./callback/route";
import { createLogoutHandler } from "../logout/route";

const ACCOUNT_ID = 35488109;
const NOW = 1787500000000;
const NONCE = "0123456789abcdef0123456789abcdef";

describe("rutas de autenticación Steam", () => {
  test("login redirige a Steam y almacena un nonce anti-CSRF de corta duración", async () => {
    let storedNonce: string | undefined;
    const handler = createLoginHandler({
      publicBaseUrl: "https://coach.example",
      createNonce: () => NONCE,
      saveNonce: (nonce) => { storedNonce = nonce; },
    });

    const response = await handler();
    const redirect = new URL(response.headers.get("location")!);

    expect(response.status).toBe(307);
    expect(redirect.origin + redirect.pathname).toBe("https://steamcommunity.com/openid/login");
    expect(redirect.searchParams.get("openid.return_to")).toBe("https://coach.example/api/auth/steam/callback?state=" + NONCE);
    expect(storedNonce).toBe(NONCE);
  });

  test("callback validado confirma la cuenta y abre la sesión cifrada", async () => {
    const createdAccounts: Array<{ accountId: number; token: string }> = [];
    const sessions: Array<{ accountId: number; personaName: string; avatarUrl: string | null }> = [];
    const handler = createCallbackHandler({
      readNonce: () => NONCE,
      clearNonce: () => undefined,
      verify: async () => ({ ok: true as const, steamId64: BigInt("76561197995753837") }),
      createAccount: async (accountId, token) => { createdAccounts.push({ accountId, token }); return true; },
      getProfile: async () => ({ personaName: "Kiro", avatarUrl: "https://avatars.steamstatic.com/avatar.jpg" }),
      startSession: async (accountId, profile) => { sessions.push({ accountId, ...profile }); },
      createToken: (accountId) => createAccountToken(accountId, "d2k-test-vector-key-0123456789ab", NOW, NONCE),
    });

    const response = await handler(new Request(`https://coach.example/api/auth/steam/callback?state=${NONCE}`));

    expect(response.headers.get("location")).toBe("https://coach.example/");
    expect(createdAccounts).toHaveLength(1);
    expect(createdAccounts[0]?.accountId).toBe(ACCOUNT_ID);
    expect(createdAccounts[0]?.token).toBe("35488109.1787500000000.0123456789abcdef0123456789abcdef.00ca79bf7eba2ad5aa0230eb57d2bef050a295f7aae65d7802fce94aa7aaa98a");
    expect(sessions).toEqual([{ accountId: ACCOUNT_ID, personaName: "Kiro", avatarUrl: "https://avatars.steamstatic.com/avatar.jpg" }]);
  });

  test("callback sin nonce coincidente se rechaza antes de verificar OpenID", async () => {
    let verified = false;
    const handler = createCallbackHandler({
      readNonce: () => undefined,
      clearNonce: () => undefined,
      verify: async () => { verified = true; return { ok: false as const, error: "invalid signature" }; },
      createAccount: async () => true,
      getProfile: async () => ({ personaName: "unused", avatarUrl: null }),
      startSession: async () => undefined,
      createToken: () => "unused",
    });

    const response = await handler(new Request(`https://coach.example/api/auth/steam/callback?state=${NONCE}`));

    expect(response.headers.get("location")).toBe("https://coach.example/login?error=auth_failed");
    expect(verified).toBe(false);
  });

  test("callback con firma inválida no crea sesión ni cuenta", async () => {
    let created = false;
    let sessionStarted = false;
    const handler = createCallbackHandler({
      readNonce: () => NONCE,
      clearNonce: () => undefined,
      verify: async () => ({ ok: false as const, error: "invalid signature" }),
      createAccount: async () => { created = true; return true; },
      getProfile: async () => ({ personaName: "unused", avatarUrl: null }),
      startSession: async () => { sessionStarted = true; },
      createToken: () => "unused",
    });

    const response = await handler(new Request(`https://coach.example/api/auth/steam/callback?state=${NONCE}`));

    expect(response.headers.get("location")).toBe("https://coach.example/login?error=auth_failed");
    expect(created).toBe(false);
    expect(sessionStarted).toBe(false);
  });

  test("logout destruye la sesión y devuelve a login", async () => {
    let destroyed = false;
    const response = await createLogoutHandler(async () => { destroyed = true; })();

    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("https://coach.example/login");
    expect(destroyed).toBe(true);
  });
});
