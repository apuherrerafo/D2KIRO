import type { LiveObservation } from "../../live/live-capture";
import type { LiveCaptureRegistry } from "../../live/live-capture-registry";

// Live Dota capture -- the Player-facing (account-authenticated, proxied by apps/web) half of live mode.
// The capturer half is the token-authenticated `/ingest/draft-event` (app.ts). Both feed the SAME
// LiveCaptureRegistry, so a manual report and a captured one are the same kind of fact.

/** Live session ids are minted locally (scripts/dev-live.ts: a UUID). Anything else never reaches the store. */
const LIVE_SESSION_ID = /^[A-Za-z0-9-]{8,64}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isHeroId(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value < 1000;
}

function isSide(value: unknown): value is "radiant" | "dire" {
  return value === "radiant" || value === "dire";
}

function isPosition(value: unknown): value is 1 | 2 | 3 | 4 | 5 {
  return value === 1 || value === 2 || value === 3 || value === 4 || value === 5;
}

/** External input: the manual-fallback observation body, validated before it can touch the registry. `null` when invalid. */
export function parseLiveObservationBody(value: unknown): LiveObservation | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "ban":
      return isHeroId(value.heroId) ? { type: "ban", heroId: value.heroId } : null;
    case "bans_closed":
      return { type: "bans_closed" };
    case "side":
      return isSide(value.side) ? { type: "side", side: value.side } : null;
    case "draft_started":
      return { type: "draft_started", patch: typeof value.patch === "string" && /^[0-9a-z.]{1,16}$/.test(value.patch) ? value.patch : "" };
    case "pick": {
      if (!isHeroId(value.heroId) || !isSide(value.side)) return null;
      if (value.position !== undefined && value.position !== null && !isPosition(value.position)) return null;
      return { type: "pick", side: value.side, heroId: value.heroId, position: isPosition(value.position) ? value.position : null };
    }
    case "revert":
      return isHeroId(value.heroId) && isSide(value.side) ? { type: "revert", side: value.side, heroId: value.heroId } : null;
    default:
      return null;
  }
}

export interface LiveCaptureRouteDeps {
  registry: LiveCaptureRegistry;
  defaultPatch: string;
}

export function createLiveCaptureRoutes(deps: LiveCaptureRouteDeps) {
  /** Create (or open) a live session and claim it for this account. Idempotent for its owner. */
  async function postLiveSession(request: Request, accountId: number): Promise<Response> {
    const body: unknown = await request.json().catch(() => null);
    const sessionId = isRecord(body) ? body.sessionId : undefined;
    if (typeof sessionId !== "string" || !LIVE_SESSION_ID.test(sessionId)) return Response.json({ error: "invalid_session_id" }, { status: 400 });
    if (!deps.registry.ensureSession(sessionId, accountId)) return Response.json({ error: "live_session_forbidden" }, { status: 403 });
    return Response.json({ sessionId, status: deps.registry.status(sessionId) }, { status: 201 });
  }

  function getLiveStatus(sessionId: string): Response {
    const status = deps.registry.status(sessionId);
    if (!status) return Response.json({ error: "not_found" }, { status: 404 });
    return Response.json(status);
  }

  async function postLiveObservation(request: Request, sessionId: string): Promise<Response> {
    if (!deps.registry.isLive(sessionId)) return Response.json({ error: "not_found" }, { status: 404 });
    const raw: unknown = await request.json().catch(() => null);
    const parsed = parseLiveObservationBody(raw);
    if (!parsed) return Response.json({ error: "invalid_body" }, { status: 400 });
    const observation: LiveObservation = parsed.type === "draft_started" && parsed.patch === "" ? { type: "draft_started", patch: deps.defaultPatch } : parsed;
    const outcome = deps.registry.observe(sessionId, observation);
    if (!outcome.accepted) return Response.json({ error: outcome.reason }, { status: 409 });
    return Response.json({ accepted: true, changed: outcome.changed, ignored: outcome.ignored, status: outcome.status }, { status: 202 });
  }

  return { postLiveSession, getLiveStatus, postLiveObservation };
}
