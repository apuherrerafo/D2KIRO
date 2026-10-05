import { GSI_LIVE_ID_PATTERN } from "@/lib/gsi-config";

// TSK-219 -- the ONE public door of live capture: Dota 2 (Game State Integration) POSTs here over HTTPS.
// Dota has no D2KIRO session cookie, so this path is public in proxy.ts; it authenticates with the
// link's own token instead, which the ENGINE checks (hash-only storage, constant time, fail closed).
// This relay only bounds the request and forwards it to the engine on 127.0.0.1 -- apps/engine is
// never exposed. It never logs, parses, stores or echoes the body.

export const dynamic = "force-dynamic";

/** Same cap as the engine (routes/live-gsi.ts): a full GSI update is a few KB. */
export const GSI_RELAY_MAX_BYTES = 256 * 1024;
const ENGINE_TIMEOUT_MS = 5_000;
/** A GSI update is a few KB sent at once: a body still arriving after this is a slow-trickle client, not Dota. */
export const GSI_RELAY_READ_DEADLINE_MS = 10_000;
const FORWARDED_STATUSES = new Set([200, 400, 401, 409, 413, 429]);

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
/** All the relay reads from a request: its headers and its body stream. */
export type RelayRequest = Pick<Request, "headers" | "body">;

export interface GsiRelayDependencies {
  engineUrl: () => string;
  /** Engine path prefix the liveId is appended to. Default: the GSI ingest. The visual relay reuses this handler. */
  enginePath?: string;
  /** Body cap in bytes. Default: GSI_RELAY_MAX_BYTES. */
  maxBytes?: number;
  fetch: FetchLike;
  readDeadlineMs?: number;
}

function empty(status: number): Response {
  return new Response(null, { status, headers: { "cache-control": "no-store" } });
}

const DEADLINE = Symbol("deadline");

function deadlineAfter(ms: number): { promise: Promise<typeof DEADLINE>; clear(): void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const promise = new Promise<typeof DEADLINE>(function waitDeadline(resolve) {
    timer = setTimeout(resolve, ms, DEADLINE);
  });
  return {
    promise,
    clear() {
      clearTimeout(timer);
    },
  };
}

async function readBounded(request: RelayRequest, deadlineMs: number, maxBytes: number): Promise<Uint8Array<ArrayBuffer> | 400 | 408 | 413> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return 413;
  if (!request.body) return 400;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = deadlineAfter(deadlineMs);
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline.promise]);
      if (chunk === DEADLINE) {
        // Fire and forget: a stalled socket must not hold the 408 back.
        void reader.cancel().catch(() => undefined);
        return 408;
      }
      const { done, value } = chunk;
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel().catch(() => undefined);
        return 413;
      }
      chunks.push(value);
    }
  } catch {
    // The client went away mid-body: nothing to forward, nothing to log.
    return 400;
  } finally {
    deadline.clear();
  }
  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export function createGsiRelayHandler(dependencies: GsiRelayDependencies) {
  return async (request: RelayRequest, liveId: string): Promise<Response> => {
    if (!GSI_LIVE_ID_PATTERN.test(liveId)) return empty(401);
    const body = await readBounded(request, dependencies.readDeadlineMs ?? GSI_RELAY_READ_DEADLINE_MS, dependencies.maxBytes ?? GSI_RELAY_MAX_BYTES);
    if (body === 400 || body === 408 || body === 413) return empty(body);
    try {
      const engineResponse = await dependencies.fetch(`${dependencies.engineUrl()}${dependencies.enginePath ?? "/api/live/gsi/"}${liveId}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body,
        cache: "no-store",
        signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS),
      });
      // Status only: whatever the engine answered stays inside the container.
      return empty(FORWARDED_STATUSES.has(engineResponse.status) ? engineResponse.status : 502);
    } catch {
      return empty(503);
    }
  };
}

const relay = createGsiRelayHandler({
  engineUrl: () => process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000",
  fetch: (input, init) => fetch(input, init),
});

export async function POST(request: Request, context: { params: Promise<{ liveId: string }> }) {
  const { liveId } = await context.params;
  return relay(request, liveId);
}
