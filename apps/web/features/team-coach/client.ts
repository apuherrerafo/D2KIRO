import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";
import type { GsiLinkView, LiveCaptureStatus, LiveObservationInput, TeamCoachBoardData } from "./types";
import { parseGsiLink, parseLiveCaptureStatus, parseTeamCoachBoard } from "./validation";

// Únicos call sites del navegador para el Team Coach Board y el draft en vivo. Siempre por el proxy
// `/engine` (allowlist en next.config.ts) -- nunca un loopback directo.

function sessionPath(sessionId: string, suffix: string): string {
  return `${ENGINE_HTTP_BASE_URL}/api/session/protocol/${encodeURIComponent(sessionId)}/${suffix}`;
}

/** One board for every human-controlled position, ranked against one snapshot. Read-only: it never changes the draft. */
export async function fetchTeamBoard(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<TeamCoachBoardData> {
  const response = await fetchImpl(sessionPath(sessionId, "team-recommendations"));
  if (!response.ok) throw new Error(`team board request failed (${response.status})`);
  const board = parseTeamCoachBoard(await response.json());
  if (!board) throw new Error("invalid team board response");
  return board;
}

/** Creates (or opens) the live session and claims it for the signed-in account. */
export async function openLiveSession(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/session/protocol/live`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sessionId }),
  });
  if (!response.ok) throw new Error(`live session request failed (${response.status})`);
}

export async function fetchLiveStatus(sessionId: string, fetchImpl: typeof fetch = fetch): Promise<LiveCaptureStatus> {
  const response = await fetchImpl(sessionPath(sessionId, "live-status"));
  if (!response.ok) throw new Error(`live status request failed (${response.status})`);
  const status = parseLiveCaptureStatus(await response.json());
  if (!status) throw new Error("invalid live status response");
  return status;
}

/** Manual fallback: report what the Player sees in the real draft. Same facts as the capturer sends. */
export async function postLiveObservation(sessionId: string, observation: LiveObservationInput, fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(sessionPath(sessionId, "live-observation"), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(observation),
  });
  if (!response.ok) throw new Error(`live observation rejected (${response.status})`);
}

// TSK-219 -- the account's Dota GSI link. The browser only reads and revokes it: the cfg (with its token)
// comes from the server-side download route, never through these calls.
const GSI_LINK_PATH = `${ENGINE_HTTP_BASE_URL}/api/live/gsi-link`;

/** The active link (which live session to watch), or null when Dota is not connected to this account. */
export async function fetchGsiLink(fetchImpl: typeof fetch = fetch): Promise<GsiLinkView | null> {
  const response = await fetchImpl(GSI_LINK_PATH, { cache: "no-store" });
  if (!response.ok) throw new Error(`gsi link request failed (${response.status})`);
  const link = parseGsiLink(await response.json());
  if (link === undefined) throw new Error("invalid gsi link response");
  return link;
}

/** "Desconectar Dota": the installed cfg stops working at once. */
export async function revokeGsiLink(fetchImpl: typeof fetch = fetch): Promise<void> {
  const response = await fetchImpl(GSI_LINK_PATH, { method: "DELETE" });
  if (!response.ok) throw new Error(`gsi link revoke failed (${response.status})`);
}
