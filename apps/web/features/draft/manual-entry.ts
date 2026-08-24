import type { SimulatorEvent } from "./simulator-scripts";
import type { DraftEvent } from "./types";
import { LOCAL_DRAFT_ENGINE_HTTP_BASE_URL } from "@/lib/engine-url";

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
  const response = await fetch(`${LOCAL_DRAFT_ENGINE_HTTP_BASE_URL}/api/session/manual`, {
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

// TSK-071: única fuente de verdad para traducir un RejectionReason crudo del motor
// (apps/engine/src/draft/reducer.ts) a lenguaje de producto -- vive acá, no en un componente,
// porque los dos puntos de entrada de un pick manual (ManualEntryPanel y el "Pickear" directo de
// SuggestionCard en DraftView.tsx) llaman a postManualEvent desde este mismo archivo y ambos
// necesitan el mismo texto para el mismo motivo de rechazo. Espejado a mano, mismo criterio que
// el resto de los contratos compartidos entre los dos procesos (web.md: SignalId) -- el motor no
// expone estas 5 razones como texto, solo como código.
const REJECTION_MESSAGES: Record<string, string> = {
  hero_already_taken: "Ese héroe ya está baneado o pickeado en este draft.",
  wrong_phase: "El draft todavía no arrancó -- esperá a que esté activo antes de marcar picks o bans.",
  stale_seq: "Esto quedó desactualizado porque el draft avanzó mientras tanto -- volvé a intentarlo.",
  duplicate_event: "Ese cambio ya se había aplicado, no hacía falta reenviarlo.",
  unknown_hero: "Ese héroe no es válido.",
  // RCA post-TSK-076 (reducer.ts, MAX_PICKS_PER_SIDE): este equipo no puede recibir un 6to pick.
  roster_full: "Este equipo ya completó sus 5 picks.",
  // TSK-072 (spec §2.2): solo puede pasar en Captain's Mode, cuando el evento no coincide con el
  // turno esperado (lado o tipo de acción). Nunca aparece en All Pick -- sus bans y picks no
  // tienen tabla de turnos que validar (spec §2.1).
  wrong_turn: "No es el turno de este lado todavía en Captain's Mode.",
};

export function describeRejection(reason: string | undefined): string {
  if (reason === undefined) return "No se pudo aplicar el cambio, por un motivo que el motor no informó.";
  return REJECTION_MESSAGES[reason] ?? `No se pudo aplicar: ${reason}`;
}
