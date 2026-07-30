import type { HeroId, TeamSide } from "./types";
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

function findLocalSide(script: SimulatorScript): TeamSide | null {
  for (const { event } of script.events) {
    if (event.type === "local_side_identified") return event.side;
  }
  return null;
}

// Todo héroe que el guion ya usa (ban o pick, cualquier lado) -- un héroe del pool que coincida
// nunca se usa como sustituto, repetirlo rompería la validación del reductor (TSK-028).
function collectScriptHeroIds(script: SimulatorScript): Set<HeroId> {
  const ids = new Set<HeroId>();
  for (const { event } of script.events) {
    if (event.type === "hero_banned" || event.type === "hero_picked" || event.type === "pick_reverted") {
      ids.add(event.hero);
    }
  }
  return ids;
}

// TSK-028: en el lado local, sustituye el héroe fijo del guion por el siguiente disponible del
// pool configurado del usuario (en su orden guardado). Sin pool (o agotado) -- 100% guion
// original, regresión cero. `pick_reverted` sigue al `hero_picked` que sustituye, así que se
// registra qué héroe original quedó sustituido para revertir el mismo héroe que en verdad se
// pickeó, no el del guion.
export function buildSimulatorEnvelopes(script: SimulatorScript, poolHeroes: HeroId[] = []): SimulatorEnvelope[] {
  const localSide = findLocalSide(script);
  const reserved = collectScriptHeroIds(script);
  const poolQueue = poolHeroes.filter((hero) => !reserved.has(hero));
  const substitutions = new Map<HeroId, HeroId>();
  let poolCursor = 0;

  return script.events.map((entry, index) => {
    let payload = entry.event;

    if (localSide && payload.type === "hero_picked" && payload.side === localSide) {
      const poolHero = poolQueue[poolCursor];
      if (poolHero !== undefined) {
        poolCursor += 1;
        substitutions.set(payload.hero, poolHero);
        payload = { ...payload, hero: poolHero };
      }
    } else if (localSide && payload.type === "pick_reverted" && payload.side === localSide) {
      const substituted = substitutions.get(payload.hero);
      if (substituted !== undefined) {
        payload = { ...payload, hero: substituted };
      }
    }

    return {
      eventId: crypto.randomUUID(),
      seq: index + 1,
      emittedAt: new Date().toISOString(),
      payload,
      delayMs: entry.delayMs ?? 0,
    };
  });
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
    const delayMs = envelope.payload.type === "hero_banned" ? 0 : envelope.delayMs;
    if (delayMs > 0) await sleep(delayMs / opts.speed);
    if (opts.isCancelled?.()) return;
    await opts.post(opts.sessionId, envelope.seq, envelope.payload);
  }
}
