const PLAYER_SUMMARIES_URL = "https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v0002/";
const DEFAULT_COMMUNITY_ORIGIN = "https://steamcommunity.com";
// Avatares públicos de Steam: `avatars.steamstatic.com` y sus espejos (`avatars.<cdn>.steamstatic.com`) más el host histórico.
const AVATAR_HOST = /^avatars\.([a-z]+\.)?steamstatic\.com$/;
const LEGACY_AVATAR_HOSTS = new Set(["steamcdn-a.akamaihd.net"]);
const MAX_PERSONA_NAME = 100;

export interface SteamPlayerProfile {
  personaName: string;
  avatarUrl: string | null;
  /** `true` = nombre y avatar se leyeron del perfil público; `false` = perfil no disponible (la autenticación con Steam ya fue correcta). */
  available: boolean;
}

type FetchPlayerProfile = (input: URL, init?: RequestInit) => Promise<Response>;

interface SteamProfileRequest {
  accountId: number;
  steamId64: bigint;
  /** Opcional. Con clave se usa la API oficial; sin ella (o si falla) se usa el perfil público de la comunidad de Steam. */
  apiKey: string | undefined;
  fetchImpl?: FetchPlayerProfile;
  /** Costura de pruebas: origen del perfil público (por defecto, steamcommunity.com). Solo lo fija el operador por entorno. */
  communityOrigin?: string;
}

// Sin perfil público de Steam el jugador se muestra con un nombre neutro: el identificador interno nunca llega a la pantalla.
export const ANONYMOUS_PERSONA_NAME = "Jugador de Steam";

function fallbackProfile(): SteamPlayerProfile {
  return { personaName: ANONYMOUS_PERSONA_NAME, avatarUrl: null, available: false };
}

function isAllowedAvatarUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && (AVATAR_HOST.test(url.hostname) || LEGACY_AVATAR_HOSTS.has(url.hostname));
  } catch {
    return false;
  }
}

// El nombre es texto no confiable que viene de un tercero: sin caracteres de control, recortado y acotado. React lo escapa al pintarlo.
function cleanPersonaName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  // También se quitan los caracteres invisibles y de dirección (ancho cero, bidi): con ellos se imitaría el nombre de otra persona.
  const name = value.replace(/[\u0000-\u001f\u007f​-‏‪-‮⁦-⁩]/g, "").trim();
  if (name.length === 0 || name.length > MAX_PERSONA_NAME) return null;
  return name;
}

function parseApiProfile(payload: unknown): SteamPlayerProfile | null {
  if (typeof payload !== "object" || payload === null || !("response" in payload)) return null;
  const response = payload.response;
  if (typeof response !== "object" || response === null || !("players" in response) || !Array.isArray(response.players)) return null;
  const player = response.players[0];
  if (typeof player !== "object" || player === null || !("personaname" in player)) return null;
  const personaName = cleanPersonaName(player.personaname);
  if (personaName === null) return null;
  const avatar = "avatarfull" in player ? player.avatarfull : null;
  return { personaName, avatarUrl: isAllowedAvatarUrl(avatar) ? avatar : null, available: true };
}

function xmlField(xml: string, tag: string): string | null {
  const match = new RegExp(`<${tag}>\\s*(?:<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>|([^<]*))\\s*</${tag}>`).exec(xml);
  return match === null ? null : (match[1] ?? match[2] ?? null);
}

/** Perfil público de la comunidad de Steam (`?xml=1`): no necesita clave y expone nombre y avatar aun con el perfil en privado. */
export function parseCommunityProfile(xml: string, steamId64: bigint): SteamPlayerProfile | null {
  if (xmlField(xml, "steamID64") !== steamId64.toString()) return null;
  const personaName = cleanPersonaName(xmlField(xml, "steamID"));
  if (personaName === null) return null;
  const avatar = xmlField(xml, "avatarFull");
  return { personaName, avatarUrl: isAllowedAvatarUrl(avatar) ? avatar : null, available: true };
}

async function fromApi(steamId64: bigint, apiKey: string, fetchImpl: FetchPlayerProfile): Promise<SteamPlayerProfile | null> {
  const url = new URL(PLAYER_SUMMARIES_URL);
  url.searchParams.set("key", apiKey);
  url.searchParams.set("steamids", steamId64.toString());
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000) });
  if (!response.ok) return null;
  return parseApiProfile(await response.json());
}

async function fromCommunity(steamId64: bigint, fetchImpl: FetchPlayerProfile, origin: string): Promise<SteamPlayerProfile | null> {
  const url = new URL(`/profiles/${steamId64.toString()}/`, origin);
  url.searchParams.set("xml", "1");
  const response = await fetchImpl(url, { signal: AbortSignal.timeout(5_000), headers: { accept: "text/xml" } });
  if (!response.ok) return null;
  return parseCommunityProfile(await response.text(), steamId64);
}

// Único cliente de perfiles de Steam: la key (si existe) entra solo desde una ruta server-side y nunca se devuelve, registra ni incorpora a
// la sesión. Cualquier fallo es no fatal: la identidad ya fue verificada por OpenID y el perfil es únicamente presentación.
export async function getSteamPlayerProfile({ steamId64, apiKey, fetchImpl = fetch, communityOrigin }: SteamProfileRequest): Promise<SteamPlayerProfile> {
  if (apiKey) {
    try {
      const profile = await fromApi(steamId64, apiKey, fetchImpl);
      if (profile !== null) return profile;
    } catch {
      // la API oficial no respondió: se intenta el perfil público
    }
  }
  try {
    return (await fromCommunity(steamId64, fetchImpl, communityOrigin || DEFAULT_COMMUNITY_ORIGIN)) ?? fallbackProfile();
  } catch {
    return fallbackProfile();
  }
}
