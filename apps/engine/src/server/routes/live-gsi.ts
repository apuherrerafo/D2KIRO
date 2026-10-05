import { GSI_LIVE_ID, type GsiLink, type GsiLinkStore, type IssuedGsiLink } from "../../live/gsi-links";
import { normalizeGsi } from "../../live/gsi-normalize";
import type { LiveCaptureRegistry } from "../../live/live-capture-registry";
import type { DraftEventEnvelope } from "../../draft/reducer";
import { isValidDraftEventEnvelope } from "../edge";
import type { HeroId } from "../../draft-protocol/types";
import type { Position } from "../../draft-protocol/roles/role-belief";

// TSK-219 -- Dota GSI over the Internet. Two halves:
//
// 1. INGEST (`POST /api/live/gsi/<liveId>`): reached ONLY through apps/web's single public relay route
//    (the engine stays on 127.0.0.1). Every update is authenticated by the link's own token (cfg
//    `auth.token`), fails closed, is size-capped, rate-limited, and normalized through an allowlist.
//    Nothing from the body is ever logged or echoed; identity fields in the body are never read.
// 2. LINK MANAGEMENT (account-authenticated): issue (= rotate) is called only by apps/web's server-side
//    cfg download; the browser can read the link's state and revoke it, never obtain its token.

export const GSI_MAX_BODY_BYTES = 256 * 1024;
/** A visual capture fact is one small envelope (a few hundred bytes): anything bigger is not one. */
export const VISUAL_MAX_BODY_BYTES = 4 * 1024;
/** The only payloads the visual channel accepts; the draft lifecycle and our side stay GSI's. */
const VISUAL_PAYLOAD_TYPES = new Set(["hero_picked", "pick_reverted", "hero_banned", "capture_health"]);
const LINK_RATE_WINDOW_MS = 1_000;
/** Dota throttles to one update per `throttle` (cfg: 0.1 s) plus heartbeats: 20/s leaves headroom. */
const MAX_UPDATES_PER_LINK_WINDOW = 20;
const AUTH_FAILURE_WINDOW_MS = 60_000;
/**
 * Above this many refused credentials per minute, refusals answer 429 instead of 401. A valid credential
 * is ALWAYS verified and served: checking it is one primary-key lookup -- as cheap as refusing it -- so a
 * flood of bad requests can never lock a real player out (@redteam TSK-219, finding 1).
 */
const MAX_AUTH_FAILURES_PER_WINDOW = 120;
const MAX_TRACKED_LINKS = 1_000;

/** The account's OWN team preset, as the route needs it. `accountId` scoping is the loader's job (never trust the id alone). */
export type LoadOwnTeamGroup = (teamGroupId: number, accountId: number) => { partySize: number; members: { slot: number; heroPool: readonly number[] }[] } | null;

export interface LiveGsiRouteDeps {
  links: GsiLinkStore;
  registry: LiveCaptureRegistry;
  loadTeamGroup?: LoadOwnTeamGroup;
  now?: () => number;
}

const MAX_TEAM_GROUP_BODY_BYTES = 1024;
export type LiveTeamGroupRefusal = "not_found" | "not_party5" | "no_pools" | "unsupported";

function parseTeamGroupId(raw: unknown): number | null | undefined {
  if (typeof raw !== "object" || raw === null || !("teamGroupId" in raw)) return undefined;
  const id = (raw as { teamGroupId: unknown }).teamGroupId;
  if (id === null) return null;
  return typeof id === "number" && Number.isSafeInteger(id) && id > 0 ? id : undefined;
}

/** slot N -> Pos N, only for slots that actually hold a pool. Pools are a soft signal downstream, never a whitelist. */
function poolsBySlot(members: { slot: number; heroPool: readonly number[] }[]): Partial<Record<Position, readonly HeroId[]>> {
  const pools: Partial<Record<Position, readonly HeroId[]>> = {};
  for (const member of members) {
    if (!Number.isInteger(member.slot) || member.slot < 1 || member.slot > 5) continue;
    const heroes = member.heroPool.filter((id) => Number.isInteger(id) && id > 0);
    if (heroes.length > 0) pools[member.slot as Position] = heroes;
  }
  return pools;
}

export type CappedBody = { ok: true; text: string } | { ok: false; status: 400 | 413 };

/** Reads at most `maxBytes`, whatever Content-Length claims. Never buffers an oversized body whole. */
export async function readCappedBody(request: Request, maxBytes: number): Promise<CappedBody> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, status: 413 };
  if (!request.body) return { ok: false, status: 400 };
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return { ok: false, status: 413 };
    }
    chunks.push(value);
  }
  try {
    return { ok: true, text: new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks)) };
  } catch {
    return { ok: false, status: 400 };
  }
}

function tokenOf(payload: unknown): string | null {
  if (typeof payload !== "object" || payload === null) return null;
  const auth = (payload as { auth?: unknown }).auth;
  if (typeof auth !== "object" || auth === null) return null;
  const token = (auth as { token?: unknown }).token;
  return typeof token === "string" ? token : null;
}

function noStore(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

/** The browser's view of a link: which live session to watch and until when. Never the liveId or token. */
export function linkView(link: GsiLink | null) {
  if (link === null) return { schema: "live-gsi-link/v1", link: null };
  return {
    schema: "live-gsi-link/v1",
    link: { sessionId: link.sessionId, createdAt: new Date(link.createdAt).toISOString(), expiresAt: new Date(link.expiresAt).toISOString() },
  };
}

export function createLiveGsiRoutes(deps: LiveGsiRouteDeps) {
  const now = deps.now ?? Date.now;
  const linkHits = new Map<string, number[]>();
  // Fixed window, O(1) per request and constant memory whatever the flood rate (Sentinel TSK-219, finding 1).
  let failureWindowStart = Number.NEGATIVE_INFINITY;
  let failuresInWindow = 0;

  function refuse(at: number): Response {
    if (at - failureWindowStart >= AUTH_FAILURE_WINDOW_MS) {
      failureWindowStart = at;
      failuresInWindow = 0;
    }
    failuresInWindow += 1;
    if (failuresInWindow > MAX_AUTH_FAILURES_PER_WINDOW) return noStore({ error: "rate_limited" }, 429);
    // One answer for every refused credential (unknown id, wrong token, revoked, expired): no oracle.
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }

  /**
   * Storage failures answer a bare 503 and are NEVER rethrown: the runtime's default error handler would
   * print the database error, whose message carries the query parameters (@redteam TSK-219, finding 2).
   */
  function unavailable(): Response {
    return noStore({ error: "live_unavailable" }, 503);
  }

  function allowLink(liveId: string, at: number): boolean {
    const recent = (linkHits.get(liveId) ?? []).filter((t) => at - t < LINK_RATE_WINDOW_MS);
    const allowed = recent.length < MAX_UPDATES_PER_LINK_WINDOW;
    if (allowed) recent.push(at);
    linkHits.set(liveId, recent);
    // Only authenticated links ever get here; drop the idle ones so the map stays at the active links.
    if (linkHits.size > MAX_TRACKED_LINKS) for (const [id, hits] of linkHits) if (hits.every((t) => at - t >= LINK_RATE_WINDOW_MS)) linkHits.delete(id);
    return allowed;
  }

  async function postIngest(request: Request, liveId: string): Promise<Response> {
    const at = now();
    if (!GSI_LIVE_ID.test(liveId)) return refuse(at);
    const body = await readCappedBody(request, GSI_MAX_BODY_BYTES);
    if (!body.ok) return new Response(null, { status: body.status });
    let payload: unknown;
    try {
      payload = JSON.parse(body.text);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return new Response(null, { status: 400 });
    const token = tokenOf(payload);
    let link: GsiLink | null;
    try {
      link = token === null ? null : deps.links.verify(liveId, token, at);
    } catch {
      return unavailable();
    }
    if (link === null) return refuse(at);
    if (!allowLink(liveId, at)) return noStore({ error: "rate_limited" }, 429);
    // The session belongs to the link's account -- decided when the link was issued, never by the body.
    if (!deps.registry.ensureSession(link.sessionId, link.accountId)) return noStore({ error: "live_session_unavailable" }, 409);
    const outcome = deps.registry.ingestGsi(link.sessionId, normalizeGsi(payload));
    return outcome.accepted ? new Response(null, { status: 200 }) : noStore({ error: "live_session_unavailable" }, 409);
  }

  /**
   * POST /api/live/visual/<liveId> -- the local visual capturer (Dota window -> hero portraits, computed on the
   * Player's PC). Same door and same credential as GSI: the link token authenticates, the link decides the
   * session and its owner (the body can never name either), refusals are indistinguishable, and nothing from the
   * body is logged or echoed. Body: { auth: { token }, envelope: draft-event/v1 with source "ocr" }.
   * Only picks / reverts / bans / its own health are accepted -- never a frame, text, or a lifecycle event.
   */
  async function postVisual(request: Request, liveId: string): Promise<Response> {
    const at = now();
    if (!GSI_LIVE_ID.test(liveId)) return refuse(at);
    const body = await readCappedBody(request, VISUAL_MAX_BODY_BYTES);
    if (!body.ok) return new Response(null, { status: body.status });
    let payload: unknown;
    try {
      payload = JSON.parse(body.text);
    } catch {
      return new Response(null, { status: 400 });
    }
    if (typeof payload !== "object" || payload === null || Array.isArray(payload)) return new Response(null, { status: 400 });
    const token = tokenOf(payload);
    let link: GsiLink | null;
    try {
      link = token === null ? null : deps.links.verify(liveId, token, at);
    } catch {
      return unavailable();
    }
    if (link === null) return refuse(at);
    if (!allowLink(`visual:${liveId}`, at)) return noStore({ error: "rate_limited" }, 429);
    const envelope = (payload as { envelope?: unknown }).envelope;
    if (!isValidDraftEventEnvelope(envelope) || envelope.source !== "ocr" || !VISUAL_PAYLOAD_TYPES.has(envelope.payload.type)) return new Response(null, { status: 400 });
    if (!deps.registry.ensureSession(link.sessionId, link.accountId)) return noStore({ error: "live_session_unavailable" }, 409);
    // The session is the link's, whatever the envelope claims.
    const owned: DraftEventEnvelope = { ...envelope, sessionId: link.sessionId };
    const outcome = deps.registry.ingestEnvelope(owned);
    return outcome.accepted ? new Response(null, { status: 200 }) : noStore({ error: "live_session_unavailable" }, 409);
  }

  /** apps/web's cfg download ONLY (not in the browser proxy allowlist): the one response that carries a token. */
  function postIssue(accountId: number): Response {
    let issued: IssuedGsiLink;
    try {
      const previous = deps.links.active(accountId, now());
      issued = deps.links.issue(accountId, now());
      if (previous !== null) deps.registry.forget(previous.sessionId);
    } catch {
      return unavailable();
    }
    if (!deps.registry.ensureSession(issued.sessionId, accountId)) return noStore({ error: "live_session_unavailable" }, 409);
    return noStore({ schema: "live-gsi-issued/v1", liveId: issued.liveId, token: issued.token, sessionId: issued.sessionId, expiresAt: new Date(issued.expiresAt).toISOString() }, 201);
  }

  function getLink(accountId: number): Response {
    let link: GsiLink | null;
    try {
      link = deps.links.active(accountId, now());
    } catch {
      return unavailable();
    }
    // Re-open the live session after an engine restart, so the board is there before Dota speaks again.
    if (link !== null) deps.registry.ensureSession(link.sessionId, accountId);
    return noStore(linkView(link), 200);
  }

  function deleteLink(accountId: number): Response {
    try {
      const previous = deps.links.active(accountId, now());
      deps.links.revoke(accountId);
      if (previous !== null) deps.registry.forget(previous.sessionId);
    } catch {
      return unavailable();
    }
    return noStore(linkView(null), 200);
  }

  /**
   * `PUT /api/live/team-group` (account-authenticated). Selects (or clears with null) the Party 5 preset of the
   * account's live session. The pools are loaded HERE from the account's own team group by id -- a body can only
   * name a preset, never carry pools -- so another account's preset can never be applied. A missing / foreign /
   * non-Party-5 preset answers 200 `applied:false` and leaves the session WITHOUT a preset (never a stale one).
   */
  async function putTeamGroup(request: Request, accountId: number): Promise<Response> {
    const body = await readCappedBody(request, MAX_TEAM_GROUP_BODY_BYTES);
    if (!body.ok) return new Response(null, { status: body.status });
    let teamGroupId: number | null | undefined;
    try {
      teamGroupId = parseTeamGroupId(JSON.parse(body.text));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (teamGroupId === undefined) return noStore({ error: "invalid_body" }, 400);
    try {
      const link = deps.links.active(accountId, now());
      if (link === null) return noStore({ error: "live_not_linked" }, 409);
      if (!deps.registry.ensureSession(link.sessionId, accountId)) return noStore({ error: "live_session_unavailable" }, 409);
      let refusal: LiveTeamGroupRefusal | null = null;
      let applied: { teamGroupId: number; playerPoolsByPosition: Partial<Record<Position, readonly HeroId[]>> } | null = null;
      if (teamGroupId !== null) {
        const group = deps.loadTeamGroup ? deps.loadTeamGroup(teamGroupId, accountId) : null;
        if (!deps.loadTeamGroup) refusal = "unsupported";
        else if (group === null) refusal = "not_found";
        else if (group.partySize !== 5) refusal = "not_party5";
        else {
          const pools = poolsBySlot(group.members);
          if (Object.keys(pools).length === 0) refusal = "no_pools";
          else applied = { teamGroupId, playerPoolsByPosition: pools };
        }
      }
      if (!deps.registry.setTeamContext(link.sessionId, accountId, applied)) return noStore({ error: "live_session_unavailable" }, 409);
      const teamContext = deps.registry.status(link.sessionId)?.teamContext ?? null;
      return noStore({ schema: "live-team-group/v1", applied: applied !== null, reason: refusal, teamContext }, 200);
    } catch {
      return unavailable();
    }
  }

  return { postIngest, postVisual, postIssue, getLink, deleteLink, putTeamGroup };
}
