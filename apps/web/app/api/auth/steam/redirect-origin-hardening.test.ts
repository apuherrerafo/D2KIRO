import { afterEach, describe, expect, test } from "bun:test";
import { getCanonicalOrigin } from "@/lib/canonical-origin";
import { createCallbackHandler } from "./callback/route";
import { createLoginHandler } from "./login/route";
import { createLogoutHandler } from "../logout/route";

// Candado de regresión del defecto de despliegue: producción arranca con
// `next start -H :: -p "$PORT"` (scripts/start-railway.sh), y en ese modo
// `request.url` dentro de un Route Handler refleja la dirección de bind
// (`http://[::]:PORT`), no el origen público real. Estas pruebas reproducen
// exactamente esa forma envenenada de `request.url`, más `Host`/
// `X-Forwarded-Host` fabricados por un cliente arbitrario, y confirman que
// ninguno de los tres puede llegar al `Location` de un redirect de auth.

const ORIGINAL_BASE_URL = process.env.PUBLIC_BASE_URL;
const ORIGINAL_NODE_ENV = process.env.NODE_ENV;
const NONCE = "0123456789abcdef0123456789abcdef";
// `NODE_ENV` es de sólo lectura en los tipos de Node/Bun; en runtime sí es mutable
// y es la única forma de reproducir el modo de arranque de producción en la prueba.
const env = process.env as Record<string, string | undefined>;

function setProductionBaseUrl(value: string) {
  env.NODE_ENV = "production";
  process.env.PUBLIC_BASE_URL = value;
}

afterEach(() => {
  process.env.PUBLIC_BASE_URL = ORIGINAL_BASE_URL;
  env.NODE_ENV = ORIGINAL_NODE_ENV;
});

describe("dureza del origen canónico ante request.url/Host envenenados", () => {
  test("callback exitoso: el bind IPv6 de next start -H :: nunca llega al Location", async () => {
    setProductionBaseUrl("https://coach.example.com");
    const publicOrigin = getCanonicalOrigin();

    const handler = createCallbackHandler({
      publicOrigin,
      readNonce: () => NONCE,
      clearNonce: () => undefined,
      verify: async () => ({ ok: true as const, steamId64: BigInt("76561197995753837") }),
      createAccount: async () => true,
      getProfile: async () => ({ personaName: "Kiro", avatarUrl: null }),
      startSession: async () => undefined,
      createToken: () => "unused",
    });

    const attackerRequest = new Request(`http://[::]:3000/api/auth/steam/callback?state=${NONCE}`, {
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
    });

    const response = await handler(attackerRequest);

    expect(response.headers.get("location")).toBe("https://coach.example.com/");
  });

  test("callback fallido: mismo bind IPv6 nunca llega al Location de error", async () => {
    setProductionBaseUrl("https://coach.example.com");
    const publicOrigin = getCanonicalOrigin();

    const handler = createCallbackHandler({
      publicOrigin,
      readNonce: () => undefined,
      clearNonce: () => undefined,
      verify: async () => ({ ok: false as const, error: "invalid signature" }),
      createAccount: async () => true,
      getProfile: async () => ({ personaName: "unused", avatarUrl: null }),
      startSession: async () => undefined,
      createToken: () => "unused",
    });

    const attackerRequest = new Request(`http://[::]:3000/api/auth/steam/callback?state=${NONCE}`, {
      headers: { host: "attacker.example", "x-forwarded-host": "attacker.example" },
    });

    const response = await handler(attackerRequest);

    expect(response.headers.get("location")).toBe("https://coach.example.com/login?error=auth_failed");
  });

  test("un origen de request.url en 127.0.0.1 nunca pisa el PUBLIC_BASE_URL de producción configurado", async () => {
    setProductionBaseUrl("https://coach.example.com");
    const publicOrigin = getCanonicalOrigin();

    const handler = createCallbackHandler({
      publicOrigin,
      readNonce: () => NONCE,
      clearNonce: () => undefined,
      verify: async () => ({ ok: true as const, steamId64: BigInt("76561197995753837") }),
      createAccount: async () => true,
      getProfile: async () => ({ personaName: "Kiro", avatarUrl: null }),
      startSession: async () => undefined,
      createToken: () => "unused",
    });

    const loopbackRequest = new Request(`http://127.0.0.1:3000/api/auth/steam/callback?state=${NONCE}`);
    const response = await handler(loopbackRequest);

    expect(response.headers.get("location")).toBe("https://coach.example.com/");
    expect(response.headers.get("location")).not.toContain("127.0.0.1");
  });

  test("inyección de Host y X-Forwarded-Host no cambia el origen de redirect de /access-denied", async () => {
    setProductionBaseUrl("https://coach.example.com");
    const publicOrigin = getCanonicalOrigin();

    const handler = createCallbackHandler({
      publicOrigin,
      readNonce: () => NONCE,
      clearNonce: () => undefined,
      verify: async () => ({ ok: true as const, steamId64: BigInt("76561197995753837") }),
      isAccountAllowed: () => false,
      createAccount: async () => true,
      getProfile: async () => ({ personaName: "unused", avatarUrl: null }),
      startSession: async () => undefined,
      createToken: () => "unused",
    });

    const spoofedRequest = new Request(`http://[::]:3000/api/auth/steam/callback?state=${NONCE}`, {
      headers: { host: "evil.attacker.net", "x-forwarded-host": "evil.attacker.net" },
    });

    const response = await handler(spoofedRequest);

    expect(response.headers.get("location")).toBe("https://coach.example.com/access-denied");
  });

  test("logout: el redirect a /login sigue el origen canónico, nunca request.url", async () => {
    setProductionBaseUrl("https://coach.example.com");

    const response = await createLogoutHandler(async () => undefined, getCanonicalOrigin())();

    expect(response.headers.get("location")).toBe("https://coach.example.com/login");
  });

  test("un PUBLIC_BASE_URL inválido en producción falla seguro: 503, sin Location adivinado", async () => {
    setProductionBaseUrl("not-a-valid-url");
    const publicOrigin = getCanonicalOrigin();
    expect(publicOrigin).toBeNull();

    const callbackHandler = createCallbackHandler({
      publicOrigin,
      readNonce: () => undefined,
      clearNonce: () => undefined,
      verify: async () => ({ ok: false as const, error: "invalid signature" }),
      createAccount: async () => true,
      getProfile: async () => ({ personaName: "unused", avatarUrl: null }),
      startSession: async () => undefined,
      createToken: () => "unused",
    });
    const response = await callbackHandler(new Request(`http://[::]:3000/api/auth/steam/callback?state=${NONCE}`));

    expect(response.status).toBe(503);
    expect(response.headers.get("location")).toBeNull();
  });

  test("fallback de desarrollo sigue siendo utilizable: sin PUBLIC_BASE_URL fuera de producción resuelve a localhost", async () => {
    env.NODE_ENV = "test";
    delete process.env.PUBLIC_BASE_URL;
    const publicOrigin = getCanonicalOrigin();
    expect(publicOrigin).toBe("http://localhost:3000");

    const loginHandler = createLoginHandler({
      publicBaseUrl: publicOrigin!,
      createNonce: () => NONCE,
      saveNonce: () => undefined,
    });
    const response = await loginHandler();

    const redirect = new URL(response.headers.get("location")!);
    expect(redirect.searchParams.get("openid.return_to")).toBe(`http://localhost:3000/api/auth/steam/callback?state=${NONCE}`);
  });
});
