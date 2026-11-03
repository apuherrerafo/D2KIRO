import { ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

// MVP P0.1 -- minimal client error relay. Fire-and-forget: a telemetry failure must NEVER affect
// the draft session itself (same "a broken signal never tears down the whole thing" discipline
// the engine already applies to its own scorers). Only the fields the server's allowlist accepts
// are ever sent -- see apps/engine/src/server/routes/telemetry.ts. No Steam name/id, no cookies,
// no tokens, no stack traces: there is no field here for any of those.
export async function reportClientError(
  event: string,
  phase: string,
  message: string,
  sessionId: string | null = null,
  fetchImpl: typeof fetch = fetch,
): Promise<void> {
  try {
    await fetchImpl(`${ENGINE_HTTP_BASE_URL}/api/telemetry/error`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, sessionId, phase, message, clientTimestamp: new Date().toISOString() }),
    });
  } catch {
    // Best-effort only -- see module comment.
  }
}
