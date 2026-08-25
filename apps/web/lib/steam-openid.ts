const STEAM_OPENID_URL = "https://steamcommunity.com/openid/login";
const STEAM_CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/([0-9]{17})$/;
const STEAM_ID64_OFFSET = BigInt("76561197960265728");

type SteamVerification = { ok: true; steamId64: bigint } | { ok: false; error: string };

function expectedReturnTo(state: string): string | null {
  const baseUrl = process.env.PUBLIC_BASE_URL;
  if (!baseUrl) return null;

  try {
    const url = new URL("/api/auth/steam/callback", baseUrl);
    url.searchParams.set("state", state);
    return url.toString();
  } catch {
    return null;
  }
}

export function buildSteamLoginUrl(returnTo: string, nonce: string): string {
  const callback = new URL(returnTo);
  if (callback.searchParams.get("state") !== nonce) {
    throw new Error("Steam OpenID return_to must contain the login nonce");
  }

  const url = new URL(STEAM_OPENID_URL);
  url.searchParams.set("openid.ns", "http://specs.openid.net/auth/2.0");
  url.searchParams.set("openid.mode", "checkid_setup");
  url.searchParams.set("openid.return_to", returnTo);
  url.searchParams.set("openid.realm", callback.origin);
  url.searchParams.set("openid.identity", "http://specs.openid.net/auth/2.0/identifier_select");
  url.searchParams.set("openid.claimed_id", "http://specs.openid.net/auth/2.0/identifier_select");
  return url.toString();
}

export async function verifySteamCallback(params: URLSearchParams): Promise<SteamVerification> {
  if (params.get("openid.mode") !== "id_res") return { ok: false, error: "invalid OpenID mode" };

  const state = params.get("state");
  const returnTo = state === null ? null : expectedReturnTo(state);
  if (returnTo === null || params.get("openid.return_to") !== returnTo) {
    return { ok: false, error: "invalid return_to" };
  }

  const claimedMatch = STEAM_CLAIMED_ID.exec(params.get("openid.claimed_id") ?? "");
  const identityMatch = STEAM_CLAIMED_ID.exec(params.get("openid.identity") ?? "");
  if (claimedMatch === null || identityMatch === null || claimedMatch[1] !== identityMatch[1]) {
    return { ok: false, error: "invalid claimed identity" };
  }

  const body = new URLSearchParams();
  for (const [key, value] of params) {
    if (key.startsWith("openid.")) body.append(key, value);
  }
  body.set("openid.mode", "check_authentication");

  try {
    const response = await fetch(STEAM_OPENID_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      signal: AbortSignal.timeout(5_000),
    });
    const responseText = await response.text();
    if (!response.ok || !responseText.split(/\r?\n/).includes("is_valid:true")) {
      return { ok: false, error: "invalid signature" };
    }
  } catch {
    return { ok: false, error: "verification failed" };
  }

  return { ok: true, steamId64: BigInt(claimedMatch[1]) };
}

export function steamId64ToSteam32(steamId64: bigint): number {
  return Number(steamId64 - STEAM_ID64_OFFSET);
}
