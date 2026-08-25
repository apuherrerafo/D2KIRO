import { describe, expect, test } from "bun:test";
import { getSteamPlayerProfile } from "./steam-profile";

const ACCOUNT_ID = 35488109;
const STEAM_ID64 = BigInt("76561197995753837");
const API_KEY = ["steam", "web", "api", "key", "for", "test", "only", "123"].join("-");

describe("GetPlayerSummaries", () => {
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
    expect(profile).toEqual({ personaName: "Kiro", avatarUrl: "https://avatars.steamstatic.com/avatar.jpg" });
  });

  test("sin API key conserva un fallback seguro sin intentar una llamada de red", async () => {
    let requested = false;
    const profile = await getSteamPlayerProfile({
      accountId: ACCOUNT_ID,
      steamId64: STEAM_ID64,
      apiKey: undefined,
      fetchImpl: async () => { requested = true; return new Response(); },
    });

    expect(requested).toBe(false);
    expect(profile).toEqual({ personaName: `Steam ${ACCOUNT_ID}`, avatarUrl: null });
  });

  test("una respuesta fallida o avatar no permitido cae al fallback sin propagar secretos", async () => {
    const profile = await getSteamPlayerProfile({
      accountId: ACCOUNT_ID,
      steamId64: STEAM_ID64,
      apiKey: API_KEY,
      fetchImpl: async () => new Response(JSON.stringify({ response: { players: [{ personaname: "Kiro", avatarfull: "https://evil.example/avatar.jpg" }] } })),
    });

    expect(profile).toEqual({ personaName: `Steam ${ACCOUNT_ID}`, avatarUrl: null });
  });
});
