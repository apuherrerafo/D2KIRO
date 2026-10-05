import type { DraftEvent, DraftEventEnvelope } from "../../draft/reducer";
import { CAPTURE_ID, CAPTURE_TOKEN, normalizeCaptureCode, type CapturePairingStore } from "../../live/capture-pairing";
import type { GsiLinkStore } from "../../live/gsi-links";
import type { LiveCaptureRegistry, OverwolfPresence } from "../../live/live-capture-registry";
import { isValidDraftEventEnvelope } from "../edge";
import { readCappedBody } from "./live-gsi";

// Overwolf live capture over the Internet. The local adapter (scripts/live/overwolf-capture) runs on the
// Player's PC; the engine stays on 127.0.0.1 and is reached ONLY through apps/web's relay routes
// (app/api/live/overwolf/*). Three trust levels, three credentials:
//
//   account session (browser)   POST/GET/DELETE /api/live/capture-pairing   -> ask for a one-time code, see state, unpair
//   one-time code (adapter)     POST /api/live/overwolf/pair                -> exchanged for a scoped capture credential
//   capture credential (adapter) POST /api/live/overwolf/<captureId>        -> submit draft facts to THAT session only
//                                GET  /api/live/overwolf/<captureId>/heroes -> the public hero catalog (name -> id)
//
// The credential names no session and no account: both come from the server-side row it was issued for, so
// no body can aim it elsewhere. A batch carries ALLOWLISTED draft facts only (hero ids, sides, positions,
// lifecycle) -- the adapter never sends identity, and this boundary rebuilds every payload field by field,
// so even a hostile body cannot smuggle an arbitrary value into the registry, the status or a log.

export const OVERWOLF_MAX_BODY_BYTES = 64 * 1024;
export const OVERWOLF_MAX_EVENTS_PER_BATCH = 64;
const PAIR_MAX_BODY_BYTES = 1024;
const RATE_WINDOW_MS = 1_000;
/** The adapter batches (<= a few per second plus a 5 s heartbeat): 10/s leaves ample headroom. */
const MAX_BATCHES_PER_WINDOW = 10;
const FAILURE_WINDOW_MS = 60_000;
/** Above this many refused credentials/codes per minute refusals answer 429; a VALID credential is always served. */
const MAX_FAILURES_PER_WINDOW = 60;
const MAX_TRACKED_CREDENTIALS = 1_000;
const EVENT_ID = /^[A-Za-z0-9_-]{1,64}$/;
const PATCH = /^[0-9a-z.]{1,16}$/;
const HEALTH_DETAIL = /^[A-Z][A-Z_]{0,47}$/;

export interface LiveOverwolfRouteDeps {
  pairing: CapturePairingStore;
  links: GsiLinkStore;
  registry: LiveCaptureRegistry;
  /** The public hero catalog (rows with id / name / localizedName); only those three fields are served. */
  listHeroes(): Promise<unknown>;
  now?: () => number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function noStore(body: unknown, status: number): Response {
  return Response.json(body, { status, headers: { "cache-control": "no-store" } });
}

function parsePresence(value: unknown): OverwolfPresence | null {
  if (!isRecord(value)) return null;
  const { roster, bans, draft, players } = value;
  if (typeof roster !== "boolean" || typeof bans !== "boolean" || typeof draft !== "boolean" || typeof players !== "boolean") return null;
  return { roster, bans, draft, players };
}

/** Rebuilds a payload from its known fields only. `null` for an unknown type or a shape the kernel would not read. */
function cleanPayload(value: unknown): DraftEvent | null {
  if (!isRecord(value) || typeof value.type !== "string") return null;
  switch (value.type) {
    case "session_started":
      if (value.format !== "all_pick" || typeof value.patch !== "string" || !PATCH.test(value.patch)) return null;
      return { type: "session_started", format: "all_pick", patch: value.patch };
    case "local_side_identified":
      return value.side === "radiant" || value.side === "dire" ? { type: "local_side_identified", side: value.side } : null;
    case "hero_banned":
      if (typeof value.hero !== "number" || !Number.isInteger(value.hero)) return null;
      return { type: "hero_banned", hero: value.hero, side: value.side === "radiant" || value.side === "dire" ? value.side : "unknown" };
    case "hero_picked": {
      if (typeof value.hero !== "number" || !Number.isInteger(value.hero) || (value.side !== "radiant" && value.side !== "dire")) return null;
      const picked: DraftEvent & { position?: number } = { type: "hero_picked", hero: value.hero, side: value.side };
      if (value.position !== undefined) {
        if (![1, 2, 3, 4, 5].includes(value.position as number)) return null;
        picked.position = value.position as number;
      }
      return picked;
    }
    case "pick_reverted":
      return typeof value.hero === "number" && Number.isInteger(value.hero) && (value.side === "radiant" || value.side === "dire") ? { type: "pick_reverted", hero: value.hero, side: value.side } : null;
    case "session_ended":
      return value.reason === "completed" || value.reason === "aborted" || value.reason === "lost_capture" ? { type: "session_ended", reason: value.reason } : null;
    case "capture_health": {
      if (value.status !== "ok" && value.status !== "degraded" && value.status !== "lost") return null;
      if (value.detail !== undefined && !(typeof value.detail === "string" && HEALTH_DETAIL.test(value.detail))) return null;
      return value.detail === undefined ? { type: "capture_health", status: value.status } : { type: "capture_health", status: value.status, detail: value.detail };
    }
    default:
      return null;
  }
}

export interface ParsedCaptureBatch {
  events: DraftEventEnvelope[];
  presence: OverwolfPresence;
}

/** External input. `null` when any part is malformed: a batch is all-or-nothing, never half applied. */
export function parseCaptureBatch(value: unknown): ParsedCaptureBatch | null {
  if (!isRecord(value) || value.schema !== "overwolf-capture/v1") return null;
  const presence = parsePresence(value.presence);
  if (presence === null || !Array.isArray(value.events) || value.events.length > OVERWOLF_MAX_EVENTS_PER_BATCH) return null;
  const events: DraftEventEnvelope[] = [];
  for (const raw of value.events) {
    if (!isRecord(raw) || typeof raw.eventId !== "string" || !EVENT_ID.test(raw.eventId) || typeof raw.seq !== "number" || !Number.isFinite(raw.seq)) return null;
    const payload = cleanPayload(raw.payload);
    if (payload === null) return null;
    const envelope = { schema: "draft-event/v1", eventId: raw.eventId, sessionId: "pending", seq: raw.seq, emittedAt: typeof raw.emittedAt === "string" ? raw.emittedAt.slice(0, 40) : "", source: "overwolf", confidence: 1, payload } as const;
    if (!isValidDraftEventEnvelope(envelope)) return null;
    events.push(envelope);
  }
  return { events, presence };
}

export function createLiveOverwolfRoutes(deps: LiveOverwolfRouteDeps) {
  const now = deps.now ?? Date.now;
  const batchHits = new Map<string, number[]>();
  let failureWindowStart = Number.NEGATIVE_INFINITY;
  let failuresInWindow = 0;

  function refuse(at: number): Response {
    if (at - failureWindowStart >= FAILURE_WINDOW_MS) {
      failureWindowStart = at;
      failuresInWindow = 0;
    }
    failuresInWindow += 1;
    if (failuresInWindow > MAX_FAILURES_PER_WINDOW) return noStore({ error: "rate_limited" }, 429);
    // One answer for every refusal (unknown / wrong / expired / revoked / used): no oracle.
    return new Response(null, { status: 401, headers: { "cache-control": "no-store" } });
  }

  function unavailable(): Response {
    return noStore({ error: "live_unavailable" }, 503);
  }

  function allowBatch(captureId: string, at: number): boolean {
    const recent = (batchHits.get(captureId) ?? []).filter((t) => at - t < RATE_WINDOW_MS);
    const allowed = recent.length < MAX_BATCHES_PER_WINDOW;
    if (allowed) recent.push(at);
    batchHits.set(captureId, recent);
    if (batchHits.size > MAX_TRACKED_CREDENTIALS) for (const [id, hits] of batchHits) if (hits.every((t) => at - t >= RATE_WINDOW_MS)) batchHits.delete(id);
    return allowed;
  }

  function verified(request: Request, captureId: string, at: number) {
    const token = request.headers.get("x-capture-credential");
    if (!CAPTURE_ID.test(captureId) || token === null || !CAPTURE_TOKEN.test(token)) return null;
    const credential = deps.pairing.verify(captureId, token, at);
    if (credential === null) return null;
    // The credential rides the account's CURRENT live session: a rotated or revoked Dota link (new session)
    // strands it -- it fails closed instead of feeding a session nobody is watching.
    const link = deps.links.active(credential.accountId, at);
    return link !== null && link.sessionId === credential.sessionId ? credential : null;
  }

  /** Account-authenticated: a one-time code for the account's live session (the one its Dota link points at). */
  function postPairingCode(accountId: number): Response {
    try {
      const link = deps.links.active(accountId, now());
      if (link === null) return noStore({ error: "live_not_linked" }, 409);
      if (!deps.registry.ensureSession(link.sessionId, accountId)) return noStore({ error: "live_session_unavailable" }, 409);
      const issued = deps.pairing.issueCode(accountId, link.sessionId, now());
      return noStore({ schema: "live-capture-pairing/v1", code: issued.code, expiresAt: new Date(issued.expiresAt).toISOString() }, 201);
    } catch {
      return unavailable();
    }
  }

  /** Account-authenticated: is an adapter paired (never its credential), and is it talking right now. */
  function getPairing(accountId: number): Response {
    try {
      const credential = deps.pairing.active(accountId, now());
      const link = deps.links.active(accountId, now());
      const status = link === null ? null : deps.registry.status(link.sessionId);
      return noStore({
        schema: "live-capture-pairing-state/v1",
        paired: credential !== null,
        expiresAt: credential === null ? null : new Date(credential.expiresAt).toISOString(),
        overwolf: credential === null ? null : (status?.overwolf ?? null),
      }, 200);
    } catch {
      return unavailable();
    }
  }

  function deletePairing(accountId: number): Response {
    try {
      deps.pairing.revoke(accountId);
    } catch {
      return unavailable();
    }
    return noStore({ schema: "live-capture-pairing-state/v1", paired: false, expiresAt: null, overwolf: null }, 200);
  }

  /** Public (through the relay): a code becomes a scoped credential. */
  async function postPair(request: Request): Promise<Response> {
    const at = now();
    const body = await readCappedBody(request, PAIR_MAX_BODY_BYTES);
    if (!body.ok) return new Response(null, { status: body.status });
    let code: string | null;
    try {
      const payload: unknown = JSON.parse(body.text);
      code = isRecord(payload) ? normalizeCaptureCode(payload.code) : null;
    } catch {
      return new Response(null, { status: 400 });
    }
    if (code === null) return refuse(at);
    let issued;
    try {
      issued = deps.pairing.redeem(code, at);
    } catch {
      return unavailable();
    }
    if (issued === null) return refuse(at);
    // The session may have been dropped (engine restart): reopen it for its owner before the adapter speaks.
    if (!deps.registry.ensureSession(issued.sessionId, issued.accountId)) return noStore({ error: "live_session_unavailable" }, 409);
    return noStore({ schema: "live-capture-credential/v1", captureId: issued.captureId, token: issued.token, expiresAt: new Date(issued.expiresAt).toISOString() }, 200);
  }

  async function postBatch(request: Request, captureId: string): Promise<Response> {
    const at = now();
    let credential;
    try {
      credential = verified(request, captureId, at);
    } catch {
      return unavailable();
    }
    if (credential === null) return refuse(at);
    if (!allowBatch(captureId, at)) return noStore({ error: "rate_limited" }, 429);
    const body = await readCappedBody(request, OVERWOLF_MAX_BODY_BYTES);
    if (!body.ok) return new Response(null, { status: body.status });
    let parsed: ParsedCaptureBatch | null;
    try {
      parsed = parseCaptureBatch(JSON.parse(body.text));
    } catch {
      return new Response(null, { status: 400 });
    }
    if (parsed === null) return noStore({ error: "invalid_batch" }, 400);
    const outcome = deps.registry.ingestOverwolf(credential.sessionId, credential.accountId, parsed.events, parsed.presence);
    return outcome.accepted ? noStore({ accepted: true, changed: outcome.changed }, 200) : noStore({ error: "live_session_unavailable" }, 409);
  }

  /** Public hero catalog for name -> id (credential-scoped, so only a paired adapter reads it). Three fields per hero, nothing else. */
  async function getHeroes(request: Request, captureId: string): Promise<Response> {
    const at = now();
    let credential;
    try {
      credential = verified(request, captureId, at);
    } catch {
      return unavailable();
    }
    if (credential === null) return refuse(at);
    try {
      const rows = await deps.listHeroes();
      const heroes = (Array.isArray(rows) ? rows : []).flatMap((row: unknown) => {
        if (!isRecord(row) || typeof row.id !== "number" || typeof row.name !== "string" || typeof row.localizedName !== "string") return [];
        return [{ id: row.id, name: row.name, localizedName: row.localizedName }];
      });
      return noStore(heroes, 200);
    } catch {
      return unavailable();
    }
  }

  return { postPairingCode, getPairing, deletePairing, postPair, postBatch, getHeroes };
}
