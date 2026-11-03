// TSK-219 -- the Dota 2 Game State Integration file D2KIRO hands to the Player. Pure.
//
// Dota reads every `gamestate_integration_*.cfg` in `game\dota\cfg\gamestate_integration\` at launch and
// POSTs its state to `uri`, with the `auth` block copied into every request. The uri is ALWAYS https on
// the site's canonical origin (never localhost, never http); the token is this link's own credential,
// not an application secret. Both values are format-checked before they are written into the file, so
// nothing can break out of the quoted strings.

export const GSI_CFG_FILENAME = "gamestate_integration_d2kiro.cfg";
export const GSI_LIVE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const GSI_TOKEN_PATTERN = /^[0-9a-f]{64}$/;

/** `https://<canonical origin>/api/live/gsi/<liveId>`, or null when the origin is not https or the id is malformed. */
export function gsiIngestUri(origin: string | null, liveId: string): string | null {
  if (origin === null || !GSI_LIVE_ID_PATTERN.test(liveId)) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || parsed.username !== "" || parsed.password !== "") return null;
  return `${parsed.origin}/api/live/gsi/${liveId}`;
}

export function buildGsiConfig(uri: string, token: string): string {
  if (!uri.startsWith("https://") || /["\\\r\n]/.test(uri)) throw new Error("invalid GSI uri");
  if (!GSI_TOKEN_PATTERN.test(token)) throw new Error("invalid GSI token");
  // Only the sections the coach uses: the draft (map/player/hero/draft) and match telemetry discovery
  // (items/abilities). Nothing about other players' screens, wearables or the minimap.
  return `"D2KIRO"
{
    "uri"           "${uri}"
    "timeout"       "5.0"
    "buffer"        "0.1"
    "throttle"      "0.1"
    "heartbeat"     "5.0"
    "data"
    {
        "provider"      "1"
        "map"           "1"
        "player"        "1"
        "hero"          "1"
        "draft"         "1"
        "abilities"     "1"
        "items"         "1"
    }
    "auth"
    {
        "token"         "${token}"
    }
}
`;
}
