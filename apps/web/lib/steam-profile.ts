const PLAYER_SUMMARIES_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";
const ALLOWED_AVATAR_HOSTS = new Set(["avatars.steamstatic.com", "avatars.akamai.steamstatic.com", "steamcdn-a.akamaihd.net"]);

export interface SteamPlayerProfile {
  personaName: string;
  avatarUrl: string | null;
}

type FetchPlayerProfile = (input: URL, init?: RequestInit) => Promise<Response>;

interface SteamProfileRequest {
  accountId: number;
  steamId64: bigint;
  apiKey: string | undefined;
  fetchImpl?: FetchPlayerProfile;
}

function fallbackProfile(accountId: number): SteamPlayerProfile {
  return { personaName: `Steam ${accountId}`, avatarUrl: null };
}

function isAllowedAvatarUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && ALLOWED_AVATAR_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

function parseProfile(payload: unknown): SteamPlayerProfile | null {
  if (typeof payload !== "object" || payload === null || !("response" in payload)) return null;
  const response = payload.response;
  if (typeof response !== "object" || response === null || !("players" in response) || !Array.isArray(response.players)) return null;
  const player = response.players[0];
  if (typeof player !== "object" || player === null || !("personaname" in player) || !("avatarfull" in player)) return null;
  const personaName = player.personaname;
  const avatarUrl = player.avatarfull;
  if (typeof personaName !== "string" || personaName.trim().length === 0 || personaName.length > 100 || !isAllowedAvatarUrl(avatarUrl)) return null;
  return { personaName: personaName.trim(), avatarUrl };
}

// Único cliente de ISteamUser: la key entra solo desde una ruta server-side y nunca se devuelve,
// registra ni incorpora a la sesión. Cualquier fallo es no fatal para OpenID: la identidad ya fue
// verificada antes y el perfil es únicamente presentación.
export async function getSteamPlayerProfile({ accountId, steamId64, apiKey, fetchImpl = fetch }: SteamProfileRequest): Promise<SteamPlayerProfile> {
  if (!apiKey) return fallbackProfile(accountId);

  try {
    const url = new URL(PLAYER_SUMMARIES_URL);
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", steamId64.toString());
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
    if (!response.ok) return fallbackProfile(accountId);
    return parseProfile(await response.json()) ?? fallbackProfile(accountId);
  } catch {
    return fallbackProfile(accountId);
  }
}
