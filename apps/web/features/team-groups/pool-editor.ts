import type { HeroId } from "@/features/draft/types";
import type { MemberPositionPool, Seat, TeamMemberEntry } from "./types";

// Pure rules of the per-position pool editor. A pool belongs to one person (member id) at one position: nothing here
// ever looks at a name, a list order or the usual position to decide whose pool is whose.

export interface SaveFailure {
  /** The engine's machine code when it sent one; `null` for a network failure or an unknown answer. */
  code: string | null;
  title: string;
  body: string;
}

const KNOWN_FAILURES: Readonly<Record<string, Omit<SaveFailure, "code">>> = Object.freeze({
  stale_pool: {
    title: "Este pool cambió en otra pestaña",
    body: "Se guardó una versión más nueva mientras editabas. No se sobrescribió nada. Abajo ves lo guardado ahora; tus cambios siguen aquí: guárdalos sobre esa versión o descártalos.",
  },
  use_position_pool_editor: {
    title: "Los héroes se editan por posición",
    body: "Esta pantalla ya no cambia la lista antigua de un jugador guardado. Edita su pool en la posición que corresponde; el equipo no se guardó.",
  },
  positions_required: {
    title: "Esta pestaña está desactualizada",
    body: "El equipo ya tiene posiciones confirmadas y esta pestaña no las conoce. No se guardó nada para no borrarlas. Recarga la lista de equipos y vuelve a editar.",
  },
  member_ids_required: {
    title: "Esta pestaña está desactualizada",
    body: "El equipo ya tiene pools por posición y esta pestaña no sabe quién es quién. No se guardó nada para no perderlos. Recarga la lista de equipos y vuelve a editar.",
  },
});

const UNKNOWN_FAILURE: SaveFailure = {
  code: null,
  title: "No se pudo guardar",
  body: "El motor no respondió o rechazó el cambio. No se guardó nada; tus cambios siguen en pantalla. Intenta de nuevo.",
};

function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const data = (error as { data?: unknown }).data;
  if (typeof data !== "object" || data === null) return null;
  const code = (data as { error?: unknown }).error;
  if (typeof code === "string") return code;
  return null;
}

/** Turns whatever a rejected save carried into something the user can act on. Never throws, never returns "success". */
export function describeSaveFailure(error: unknown): SaveFailure {
  const code = codeOf(error);
  if (code === null) return UNKNOWN_FAILURE;
  const known = KNOWN_FAILURES[code];
  if (known === undefined) return UNKNOWN_FAILURE;
  return { code, ...known };
}

// A stale tab: the only way out is to read the teams again (the draft on screen is never touched by that).
const RELOAD_CODES: ReadonlySet<string> = new Set(["positions_required", "member_ids_required"]);

export function needsReload(failure: Pick<SaveFailure, "code">): boolean {
  return failure.code !== null && RELOAD_CODES.has(failure.code);
}

/** The pool this person has saved for THIS seat, or null. Never borrows another seat's pool. */
export function poolAtSeat(member: Pick<TeamMemberEntry, "positionPools">, seat: Seat): MemberPositionPool | null {
  return member.positionPools.find((pool) => pool.position === seat) ?? null;
}

/**
 * The old single list, while it still waits for the user to say which position it belongs to. It stops being pending as
 * soon as the person has any explicit pool (confirming it, or choosing "no pool" for a seat, are both decisions).
 */
export function pendingLegacyPool(member: Pick<TeamMemberEntry, "heroPool" | "positionPools">): HeroId[] | null {
  if (member.positionPools.length > 0 || member.heroPool.length === 0) return null;
  return member.heroPool;
}

export function sameHeroes(a: readonly HeroId[], b: readonly HeroId[]): boolean {
  return a.length === b.length && a.every((hero, index) => hero === b[index]);
}

/** Key of a local unsaved edit. Person + seat: switching seats or swapping players can never carry an edit to another pool. */
export function editKey(memberId: number, seat: Seat): string {
  return `${memberId}:${seat}`;
}
