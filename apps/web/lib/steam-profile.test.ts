import { describe, expect, test } from "bun:test";
import { getSteamPlayerProfile, parseCommunityProfile } from "./steam-profile";

const ACCOUNT_ID = 35488109;
const STEAM_ID64 = BigInt("76561197995753837");
const API_KEY = ["steam", "web", "api", "key", "for", "test", "only", "123"].join("-");

function communityXml(overrides: { id?: string; name?: string; avatar?: string } = {}): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?><profile><steamID64>${overrides.id ?? STEAM_ID64.toString()}</steamID64><steamID><![CDATA[${overrides.name ?? "Kiro"}]]></steamID><avatarFull><![CDATA[${overrides.avatar ?? "https://avatars.fastly.steamstatic.com/abc_full.jpg"}]]></avatarFull></profile>`;
}

describe("GetPlayerSummaries (con clave)", () => {
  test("devuelve personaName y avatarfull válidos desde Steam", async () => {
    let requestedUrl = "";
    const profile = await getSteamPlayerProfile({
      accountId: ACCOUNT_ID,
      steamId64: STEAM_ID64,
      apiKey: API_KEY,
      fetchImpl: async (input) => {
        requestedUrl = String(input);
        return new Response(JSON.stringify({ response: { players: [{ personaname: "Kiro", avatarfull: "https://avatars.steamstatic.com/avatar.jpg" }] } }));
      },
    });

    expect(new URL(requestedUrl).pathname).toBe("/ISteamUser/GetPlayerSummaries/v0002/");
    expect(new URL(requestedUrl).searchParams.get("steamids")).toBe(STEAM_ID64.toString());
    expect(profile).toEqual({ personaName: "Kiro", avatarUrl: "https://avatars.steamstatic.com/avatar.jpg", available: true });
  });

  test("avatar de un host no permitido: se conserva el nombre real y no se usa ese avatar", async () => {
    const profile = await getSteamPlayerProfile({
      accountId: ACCOUNT_ID,
      steamId64: STEAM_ID64,
      apiKey: API_KEY,
      fetchImpl: async () => new Response(JSON.stringify({ response: { players: [{ personaname: "Kiro", avatarfull: "https://evil.example/avatar.jpg" }] } })),
    });

    expect(profile).toEqual({ personaName: "Kiro", avatarUrl: null, available: true });
  });

  test("si la API oficial falla, cae al perfil público de la comunidad", async () => {
    const hosts: string[] = [];
    const profile = await getSteamPlayerProfile({
      accountId: ACCOUNT_ID,
      steamId64: STEAM_ID64,
      apiKey: API_KEY,
      fetchImpl: async (input) => {
        hosts.push(new URL(String(input)).hostname);
        if (hosts.length === 1) return new Response("denied", { status: 403 });
        return new Response(communityXml());
      },
    });

    expect(hosts).toEqual(["api.steampowered.com", "steamcommunity.com"]);
    expect(profile).toEqual({ personaName: "Kiro", avatarUrl: "https://avatars.fastly.steamstatic.com/abc_full.jpg", available: true });
  });
});

describe("perfil público de la comunidad (sin clave)", () => {
  test("sin API key lee nombre y avatar reales del perfil público, sin enviar ninguna clave", async () => {
    let requested: URL | null = null;
    const profile = await getSteamPlayerProfile({
      accountId: ACCOUNT_ID,
      steamId64: STEAM_ID64,
      apiKey: undefined,
      fetchImpl: async (input) => {
        requested = new URL(String(input));
        return new Response(communityXml());
      },
    });

    expect(requested!.hostname).toBe("steamcommunity.com");
    expect(requested!.pathname).toBe(`/profiles/${STEAM_ID64.toString()}/`);
    expect(requested!.searchParams.has("key")).toBe(false);
    expect(profile).toEqual({ personaName: "Kiro", avatarUrl: "https://avatars.fastly.steamstatic.com/abc_full.jpg", available: true });
  });

  test("la respuesta de otro SteamID, sin nombre o con error NO es el perfil de esta cuenta", () => {
    expect(parseCommunityProfile(communityXml({ id: "76561197960265729" }), STEAM_ID64)).toBeNull();
    expect(parseCommunityProfile("<response><error><![CDATA[The specified profile could not be found.]]></error></response>", STEAM_ID64)).toBeNull();
    expect(parseCommunityProfile(communityXml({ name: "   " }), STEAM_ID64)).toBeNull();
  });

  test("nombre con caracteres de control o demasiado largo se limpia o se rechaza; avatar de otro host se descarta", () => {
    expect(parseCommunityProfile(communityXml({ name: "Ki\u0007ro" }), STEAM_ID64)?.personaName).toBe("Kiro");
    expect(parseCommunityProfile(communityXml({ name: "x".repeat(101) }), STEAM_ID64)).toBeNull();
    expect(parseCommunityProfile(communityXml({ avatar: "https://evil.example/a.jpg" }), STEAM_ID64)).toEqual({ personaName: "Kiro", avatarUrl: null, available: true });
    expect(parseCommunityProfile(communityXml({ avatar: "http://avatars.steamstatic.com/a.jpg" }), STEAM_ID64)?.avatarUrl).toBeNull();
  });

  test("sin red o respuesta fallida: perfil NO disponible (nombre neutro, sin avatar), nunca una excepción", async () => {
    const offline = await getSteamPlayerProfile({ accountId: ACCOUNT_ID, steamId64: STEAM_ID64, apiKey: undefined, fetchImpl: async () => { throw new Error("offline"); } });
    const broken = await getSteamPlayerProfile({ accountId: ACCOUNT_ID, steamId64: STEAM_ID64, apiKey: undefined, fetchImpl: async () => new Response("x", { status: 500 }) });
    expect(offline).toEqual({ personaName: "Jugador de Steam", avatarUrl: null, available: false });
    expect(broken).toEqual({ personaName: "Jugador de Steam", avatarUrl: null, available: false });
  });
});

describe("origen del perfil configurable (costura de pruebas)", () => {
  test("con un origen propio no se consulta steamcommunity.com", async () => {
    let host = "";
    await getSteamPlayerProfile({ accountId: ACCOUNT_ID, steamId64: STEAM_ID64, apiKey: undefined, communityOrigin: "http://127.0.0.1:9", fetchImpl: async (input) => { host = new URL(String(input)).host; throw new Error("sin servicio"); } });
    expect(host).toBe("127.0.0.1:9");
  });
});

describe("nombres que imitan a otra persona", () => {
  test("se quitan los caracteres invisibles y de dirección", () => {
    expect(parseCommunityProfile(communityXml({ name: "Ki​ro‮" }), STEAM_ID64)?.personaName).toBe("Kiro");
  });
});
