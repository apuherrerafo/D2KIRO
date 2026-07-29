import type { ManualEventResult } from "./manual-entry";
import type { SimulatorEvent, SimulatorScript } from "./simulator-scripts";

// Espejo mínimo de buildEnvelopes (apps/engine/src/simulator/player.ts) -- construye toda la
// secuencia por adelantado, igual que el simulador real, en vez de generarla evento a evento.
// eventId/emittedAt se generan aquí, nunca en el guion.
export interface SimulatorEnvelope {
  eventId: string;
  seq: number;
  emittedAt: string;
  payload: SimulatorEvent;
  delayMs: number;
}

export function buildSimulatorEnvelopes(script: SimulatorScript): SimulatorEnvelope[] {
  return script.events.map((entry, index) => ({
    eventId: crypto.randomUUID(),
    seq: index + 1,
    emittedAt: new Date().toISOString(),
    payload: entry.event,
    delayMs: entry.delayMs ?? 0,
  }));
}

export type PostSimulatorEvent = (sessionId: string, seq: number, payload: SimulatorEvent) => Promise<ManualEventResult>;

export interface RunSimulatorPlaybackOptions {
  sessionId: string;
  // Multiplicador sobre delayMs (2 = el doble de rápido) -- deliberadamente sin modo "instant":
  // el punto de este driver es que el draft se vea pasar (TSK-016), no reproducirlo de golpe.
  speed: number;
  post: PostSimulatorEvent;
  sleep?: (ms: number) => Promise<void>;
  isCancelled?: () => boolean;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Reproduce en el navegador, a ritmo visible, contra el motor real -- mismo POST/api/session/manual
// que ya usa la entrada manual (manual-entry.ts), source:'simulator', sin endpoint nuevo en el
// motor (regla dura del ticket). Cancelable a mitad de camino (el usuario cierra el panel o
// arranca otro escenario).
export async function runSimulatorPlayback(envelopes: SimulatorEnvelope[], opts: RunSimulatorPlaybackOptions): Promise<void> {
  const sleep = opts.sleep ?? defaultSleep;

  for (const envelope of envelopes) {
    if (opts.isCancelled?.()) return;
    if (envelope.delayMs > 0) await sleep(envelope.delayMs / opts.speed);
    if (opts.isCancelled?.()) return;
    await opts.post(opts.sessionId, envelope.seq, envelope.payload);
  }
}
