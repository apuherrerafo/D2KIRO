// Overwolf automatic capture -- the public doors of apps/web for the LOCAL capture adapter (no D2KIRO session
// cookie: it is an app on the Player's PC). They are public in proxy.ts and authenticate inside the engine:
//
//   POST /api/live/overwolf/pair               one-time pairing code            -> scoped capture credential
//   POST /api/live/overwolf/<captureId>        batch of draft facts, header x-capture-credential
//   GET  /api/live/overwolf/<captureId>/heroes the public hero catalog (name -> id), same header
//
// This relay only BOUNDS the request (size, read deadline, shape of the ids/credential) and forwards it to
// the engine on 127.0.0.1 -- apps/engine is never exposed. It never logs, parses, stores or echoes a body. The
// engine's answer is forwarded by status only, except the two responses the adapter needs the body of (the
// credential it is being handed, and the public hero catalog).

export const OVERWOLF_RELAY_MAX_BYTES = 64 * 1024;
export const OVERWOLF_RELAY_READ_DEADLINE_MS = 10_000;
const ENGINE_TIMEOUT_MS = 5_000;
const CAPTURE_ID = /^[A-Za-z0-9_-]{43}$/;
const CAPTURE_TOKEN = /^[0-9a-f]{64}$/;
const FORWARDED_STATUSES = new Set([200, 400, 401, 409, 413, 429]);

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
/** All the relay reads from a request: its headers and its body stream. */
export type RelayRequest = Pick<Request, "headers" | "body">;

export interface OverwolfRelayDependencies {
  engineUrl: () => string;
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

async function readBounded(request: RelayRequest, deadlineMs: number): Promise<Uint8Array<ArrayBuffer> | 400 | 408 | 413> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > OVERWOLF_RELAY_MAX_BYTES) return 413;
  if (!request.body) return 400;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = deadlineAfter(deadlineMs);
  try {
    for (;;) {
      const chunk = await Promise.race([reader.read(), deadline.promise]);
      if (chunk === DEADLINE) {
        void reader.cancel().catch(() => undefined);
        return 408;
      }
      const { done, value } = chunk;
      if (done) break;
      total += value.byteLength;
      if (total > OVERWOLF_RELAY_MAX_BYTES) {
        await reader.cancel().catch(() => undefined);
        return 413;
      }
      chunks.push(value);
    }
  } catch {
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

function credentialOf(request: RelayRequest): string | null {
  const token = request.headers.get("x-capture-credential");
  return token !== null && CAPTURE_TOKEN.test(token) ? token : null;
}

export function createOverwolfRelay(dependencies: OverwolfRelayDependencies) {
  const deadlineMs = dependencies.readDeadlineMs ?? OVERWOLF_RELAY_READ_DEADLINE_MS;

  async function forward(path: string, init: RequestInit, passBody: boolean): Promise<Response> {
    try {
      const engineResponse = await dependencies.fetch(`${dependencies.engineUrl()}${path}`, { ...init, cache: "no-store", signal: AbortSignal.timeout(ENGINE_TIMEOUT_MS) });
      if (!FORWARDED_STATUSES.has(engineResponse.status)) return empty(502);
      if (passBody && engineResponse.status === 200) {
        return new Response(await engineResponse.text(), { status: 200, headers: { "content-type": "application/json", "cache-control": "no-store" } });
      }
      return empty(engineResponse.status);
    } catch {
      return empty(503);
    }
  }

  async function pair(request: RelayRequest): Promise<Response> {
    const body = await readBounded(request, deadlineMs);
    if (body === 400 || body === 408 || body === 413) return empty(body);
    return forward("/api/live/overwolf/pair", { method: "POST", headers: { "content-type": "application/json" }, body }, true);
  }

  async function batch(request: RelayRequest, captureId: string): Promise<Response> {
    const token = credentialOf(request);
    if (!CAPTURE_ID.test(captureId) || token === null) return empty(401);
    const body = await readBounded(request, deadlineMs);
    if (body === 400 || body === 408 || body === 413) return empty(body);
    return forward(`/api/live/overwolf/${captureId}`, { method: "POST", headers: { "content-type": "application/json", "x-capture-credential": token }, body }, false);
  }

  async function heroes(request: RelayRequest, captureId: string): Promise<Response> {
    const token = credentialOf(request);
    if (!CAPTURE_ID.test(captureId) || token === null) return empty(401);
    return forward(`/api/live/overwolf/${captureId}/heroes`, { method: "GET", headers: { "x-capture-credential": token } }, true);
  }

  return { pair, batch, heroes };
}

export const overwolfRelay = createOverwolfRelay({
  engineUrl: () => process.env.ENGINE_INTERNAL_URL ?? "http://127.0.0.1:4000",
  fetch: (input, init) => fetch(input, init),
});
