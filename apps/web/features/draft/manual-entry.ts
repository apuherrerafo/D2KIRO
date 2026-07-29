import type { SimulatorEvent } from "./simulator-scripts";
import type { DraftEvent } from "./types";

const ENGINE_HTTP_URL = process.env.NEXT_PUBLIC_ENGINE_HTTP_URL ?? "http://127.0.0.1:4000";

export interface ManualEventResult {
  accepted: boolean;
  rejected?: string;
}

type CaptureSource = "manual" | "simulator";

// Núcleo compartido: cualquier evento que apps/web construya localmente -- entrada manual real o
// guion de simulador reproducido en el navegador (TSK-016) -- llega al motor por el mismo
// POST /api/session/manual (sin token, ya habilitado por CORS), nunca un endpoint nuevo. Solo
// cambia `source`, para que el draft se pueda auditar después sabiendo de dónde vino cada evento.
async function postEvent(
  sessionId: string,
  seq: number,
  payload: DraftEvent | SimulatorEvent,
  source: CaptureSource,
): Promise<ManualEventResult> {
  const response = await fetch(`${ENGINE_HTTP_URL}/api/session/manual`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      schema: "draft-event/v1",
      eventId: crypto.randomUUID(),
      sessionId,
      seq,
      emittedAt: new Date().toISOString(),
      source,
      confidence: 1,
      payload,
    }),
  });
  return (await response.json()) as ManualEventResult;
}

// La entrada manual usa el mismo POST /api/session/manual y el mismo DraftEventEnvelope que
// cualquier otro capturador -- nunca reinicia la sesión, se integra al DraftState ya existente
// (regla dura del ticket). confidence: 1.0 -- el usuario confirmó el dato con la mano.
export async function postManualEvent(sessionId: string, lastSeq: number, payload: DraftEvent): Promise<ManualEventResult> {
  return postEvent(sessionId, lastSeq + 1, payload, "manual");
}

// Mismo endpoint, source:'simulator' -- el driver del panel de configuración (TSK-016) ya conoce
// el seq exacto de cada evento del guion, no necesita lastSeq.
export async function postSimulatorEvent(sessionId: string, seq: number, payload: SimulatorEvent): Promise<ManualEventResult> {
  return postEvent(sessionId, seq, payload, "simulator");
}
