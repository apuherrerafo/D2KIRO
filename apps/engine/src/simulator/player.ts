import type { DraftEvent, DraftEventEnvelope } from "../draft/reducer";

// R1 S3 LEGACY MARKER: this player feeds the LEGACY reducer (../draft/reducer.ts, itself marked
// non-authoritative for new work as of this wave) via DraftEventEnvelope/`/ingest/draft-event` --
// it has no bot-pick or collision logic of its own, it only replays fixed scripts. For
// kernel-backed scenarios (both AP and CM), use draft-protocol/adapters/cm-simulator.ts (CM) and
// the SIMULATOR_POLICY collision adapter (draft-protocol/adapters/simulator-authority.ts, AP)
// instead -- those drive the real Protocol Kernel, not this legacy path. This file is untouched
// by this wave; it keeps working for whatever still depends on the legacy CM turn-checking path
// (routes/simulator-sessions.ts).

export interface ScriptEntry {
  event: DraftEvent;
  // Tiempo real (ms) a esperar antes de emitir este evento, ignorado en modo 'instant'.
  delayMs?: number;
}

export interface DraftScript {
  schema: "draft-script/v1";
  name: string;
  events: ScriptEntry[];
}

export interface PlaybackClock {
  now: () => number;
  genId: () => string;
}

const realClock: PlaybackClock = {
  now: () => Date.now(),
  genId: () => crypto.randomUUID(),
};

// El simulador reporta confidence:1.0 siempre -- a diferencia de OCR, no hay incertidumbre real
// que inventar (regla dura del ticket). eventId/seq/emittedAt se generan aquí, nunca en el guion.
export function buildEnvelopes(
  script: DraftScript,
  sessionId: string,
  clock: PlaybackClock = realClock,
): DraftEventEnvelope[] {
  return script.events.map((entry, index) => ({
    schema: "draft-event/v1",
    eventId: clock.genId(),
    sessionId,
    seq: index + 1,
    emittedAt: new Date(clock.now()).toISOString(),
    source: "simulator",
    confidence: 1.0,
    payload: entry.event,
  }));
}

export interface StepPlayer {
  hasNext(): boolean;
  remaining(): number;
  next(): DraftEventEnvelope;
}

// Modo paso a paso (TSK-016): mismo buildEnvelopes que runSimulator, pero sin temporizador propio
// -- quien llama decide cuándo pedir el siguiente evento (botón "Siguiente pick/ban" en la UI).
// No toca buildEnvelopes ni el parseo/temporización del guion, solo agrega esta forma de
// consumirlo un evento a la vez.
export function createStepPlayer(script: DraftScript, sessionId: string, clock: PlaybackClock = realClock): StepPlayer {
  const envelopes = buildEnvelopes(script, sessionId, clock);
  let cursor = 0;
  return {
    hasNext: () => cursor < envelopes.length,
    remaining: () => envelopes.length - cursor,
    next: () => {
      if (cursor >= envelopes.length) throw new Error("createStepPlayer: no quedan eventos en el guion");
      return envelopes[cursor++]!;
    },
  };
}

export type EmitFn = (envelope: DraftEventEnvelope) => void | Promise<void>;

export interface PlaybackOptions {
  sessionId: string;
  // Multiplicador sobre delayMs real (2 = el doble de rápido); 'instant' no espera nada.
  speed: "instant" | number;
  emit: EmitFn;
  clock?: PlaybackClock;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

// Reproduce un guion completo, de principio a fin, sin ninguna dependencia de un cliente de
// Dota 2 real -- el guion ya trae todo lo que hace falta (criterio de aceptación 4 del SPEC).
export async function runSimulator(script: DraftScript, opts: PlaybackOptions): Promise<void> {
  const clock = opts.clock ?? realClock;
  const sleep = opts.sleep ?? defaultSleep;
  const envelopes = buildEnvelopes(script, opts.sessionId, clock);

  for (let i = 0; i < envelopes.length; i++) {
    if (opts.speed !== "instant") {
      const entry = script.events[i];
      const delayMs = entry?.event.type === "hero_banned" ? 0 : (entry?.delayMs ?? 0);
      if (delayMs > 0) await sleep(delayMs / opts.speed);
    }
    await opts.emit(envelopes[i]!);
  }
}

// Misma ruta de código que un capturador real: POST /ingest/draft-event con x-capture-token
// (S1) -- no un atajo que salte el contrato. fetchImpl es inyectable para no depender de red
// real en pruebas (testing-seams.md: cero red real en pruebas del motor).
export function httpEmit(baseUrl: string, captureToken: string, fetchImpl: typeof fetch = fetch): EmitFn {
  return async (envelope) => {
    await fetchImpl(`${baseUrl}/ingest/draft-event`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-capture-token": captureToken },
      body: JSON.stringify(envelope),
    });
  };
}
