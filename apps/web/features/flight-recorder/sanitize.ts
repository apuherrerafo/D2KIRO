import type { PerspectiveHeroSlot } from "@/features/random-draft-simulator/protocol-client";

// Todo dato pasa por aquí antes de entrar al buffer. Dos reglas no negociables:
//  1. Nunca un secreto: claves con pinta de token/cookie/credencial/cuenta se reemplazan, y los valores con forma de
//     bearer o de hash largo también. (El Steam32/accountId es dato personal -- invariantes.md.)
//  2. Nunca un pick enemigo oculto: una casilla HIDDEN se graba sólo como "HIDDEN", aunque un payload malformado
//     trajera un heroId.

export const REDACTED = "[redacted]";

const SENSITIVE_KEY = /token|cookie|secret|authorization|password|passwd|api[_-]?key|credential|steam|account[_-]?id|x-capture|x-account/i;
const BEARER_VALUE = /bearer\s+[a-z0-9._~+/=-]+/i;
const LONG_HEX_VALUE = /\b[a-f0-9]{40,}\b/i;
const MAX_DEPTH = 14;
const SESSION_ID_KEEP = 8;

function redactString(value: string): string {
  if (BEARER_VALUE.test(value) || LONG_HEX_VALUE.test(value)) return REDACTED;
  return value;
}

/** El id de sesión viaja en las URLs del motor: se deja sólo un prefijo para poder correlacionar sin copiarlo entero. */
export function shortSessionRef(sessionId: string): string {
  return sessionId.length <= SESSION_ID_KEEP ? sessionId : `${sessionId.slice(0, SESSION_ID_KEEP)}…`;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function sanitizeEntries(value: Record<string, unknown>, depth: number): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (SENSITIVE_KEY.test(key)) {
      out[key] = REDACTED;
      continue;
    }
    if (key === "sessionId" && typeof item === "string") {
      out[key] = shortSessionRef(item);
      continue;
    }
    const next = toJsonSafe(item, depth + 1);
    if (next !== undefined) out[key] = next;
  }
  return out;
}

/**
 * Copia profunda JSON-segura y sin secretos. `undefined`/funciones se descartan, números no finitos pasan a `null`,
 * `Set`/`Map` a arreglos. Un valor demasiado profundo se corta: la grabadora nunca puede colgar la UI.
 */
export function toJsonSafe(value: unknown, depth = 0): unknown {
  if (depth > MAX_DEPTH) return undefined;
  if (value === null) return null;
  if (typeof value === "string") return redactString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item, depth + 1) ?? null);
  if (value instanceof Set) return [...value].map((item) => toJsonSafe(item, depth + 1) ?? null);
  if (value instanceof Map) return sanitizeEntries(Object.fromEntries(value as Map<string, unknown>), depth);
  if (isPlainObject(value)) return sanitizeEntries(value, depth);
  return undefined;
}

/** Casillas de picks tal como el motor las expone a esta perspectiva; una HIDDEN nunca lleva héroe. */
export function scrubPerspectiveSlots(slots: readonly PerspectiveHeroSlot[]): Record<string, unknown>[] {
  return slots.map((slot) => (slot.visibility === "HIDDEN" ? { visibility: "HIDDEN" } : { visibility: slot.visibility, heroId: slot.heroId }));
}
