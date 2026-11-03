import { buildAnalysis } from "./analysis";
import { toJsonSafe } from "./sanitize";
import { FLIGHT_RECORDER_SCHEMA, type FlightEntry, type FlightEntryKind, type FlightExport, type FlightExportBuild } from "./types";

// El buffer. Desarmado por defecto: `record()` es un no-op hasta `arm()`, así que ninguna llamada de la
// instrumentación cuesta nada ni guarda nada fuera de preview/debug.

const DEFAULT_MAX_ENTRIES = 2000;

export interface FlightRecorderOptions {
  /** Reloj inyectado (pruebas deterministas). */
  now?: () => Date;
  maxEntries?: number;
}

export interface FlightRecorder {
  arm(): void;
  disarm(): void;
  isArmed(): boolean;
  /** Devuelve la entrada grabada, o `null` si la grabadora está desarmada. */
  record(kind: FlightEntryKind, data: Record<string, unknown>): FlightEntry | null;
  /** `seq` de la última transición del draft grabada (0 si ninguna): las respuestas del motor la citan. */
  lastTransitionSeq(): number;
  entries(): readonly FlightEntry[];
  count(): number;
  /** Cambia en cada grabación/reset: para `useSyncExternalStore`. */
  version(): number;
  subscribe(listener: () => void): () => void;
  reset(): void;
  buildExport(build: FlightExportBuild): FlightExport;
}

export function createFlightRecorder(options: FlightRecorderOptions = {}): FlightRecorder {
  const now = options.now ?? (() => new Date());
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES;
  let armed = false;
  let startedAtMs = 0;
  let nextSeq = 1;
  let dropped = 0;
  let transitionSeq = 0;
  let version = 0;
  let buffer: FlightEntry[] = [];
  const listeners = new Set<() => void>();

  function notify(): void {
    version += 1;
    for (const listener of listeners) listener();
  }

  function begin(): void {
    startedAtMs = now().getTime();
    nextSeq = 1;
    dropped = 0;
    transitionSeq = 0;
    buffer = [];
  }

  return {
    arm() {
      if (armed) return;
      armed = true;
      begin();
      notify();
    },
    disarm() {
      if (!armed) return;
      armed = false;
      notify();
    },
    isArmed: () => armed,
    record(kind, data) {
      if (!armed) return null;
      const at = now();
      const safe = toJsonSafe(data);
      const entry: FlightEntry = {
        seq: nextSeq,
        at: at.toISOString(),
        elapsedMs: at.getTime() - startedAtMs,
        kind,
        data: safe !== null && typeof safe === "object" && !Array.isArray(safe) ? (safe as Record<string, unknown>) : {},
      };
      nextSeq += 1;
      if (kind === "transition") transitionSeq = entry.seq;
      buffer.push(entry);
      if (buffer.length > maxEntries) {
        buffer.shift();
        dropped += 1;
      }
      notify();
      return entry;
    },
    lastTransitionSeq: () => transitionSeq,
    entries: () => buffer,
    count: () => buffer.length,
    version: () => version,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    reset() {
      begin();
      notify();
    },
    buildExport(build) {
      return {
        schema: FLIGHT_RECORDER_SCHEMA,
        exportedAt: now().toISOString(),
        build,
        entryCount: buffer.length,
        droppedEntries: dropped,
        analysis: buildAnalysis(buffer),
        entries: [...buffer],
      };
    },
  };
}

/** La grabadora de la página. Desarmada hasta que `FlightRecorderPanel` la arme (build habilitado + `?flightRecorder=1`). */
export const flightRecorder: FlightRecorder = createFlightRecorder();
