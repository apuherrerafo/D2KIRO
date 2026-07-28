import type { DraftEvent } from "./types";

const ENGINE_HTTP_URL = process.env.NEXT_PUBLIC_ENGINE_HTTP_URL ?? "http://127.0.0.1:4000";

export interface ManualEventResult {
  accepted: boolean;
  rejected?: string;
}

// La entrada manual usa el mismo POST /api/session/manual y el mismo DraftEventEnvelope que
// cualquier otro capturador -- nunca reinicia la sesión, se integra al DraftState ya existente
// (regla dura del ticket). confidence: 1.0 -- el usuario confirmó el dato con la mano.
export async function postManualEvent(sessionId: string, lastSeq: number, payload: DraftEvent): Promise<ManualEventResult> {
  const response = await fetch(`${ENGINE_HTTP_URL}/api/session/manual`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "draft-event/v1",
      eventId: crypto.randomUUID(),
      sessionId,
      seq: lastSeq + 1,
      emittedAt: new Date().toISOString(),
      source: "manual",
      confidence: 1,
      payload,
    }),
  });
  return (await response.json()) as ManualEventResult;
}
