import type { DraftState, TeamSide } from "./reducer";
import type { CaptainsModeTurnTable } from "./draft-format-turns";

export interface DraftTurn {
  side: TeamSide;
  action: "ban" | "pick";
  // TSK-073 (spec §2.3): presupuesto de tiempo ESTÁNDAR de este turno puntual (15000 en la
  // primera fase de bans de Captain's Mode, 30000 en el resto) -- viaja en el wire para que
  // DraftTimer (TSK-074) sepa contra qué total contar, sin tener que mirror-ear toda la tabla de
  // turnos del lado de apps/web.
  standardTimeMs: number;
}

// Índice de turno = cantidad de acciones ya aplicadas -- nunca un contador separado que pueda
// desincronizarse del estado real (mismo criterio que position-fit.ts/team-synergy.ts, TSK-060).
export function captainsModeTurnIndex(state: DraftState): number {
  return state.banned.length + state.picks.radiant.length + state.picks.dire.length;
}

function otherSide(side: TeamSide): TeamSide {
  return side === "radiant" ? "dire" : "radiant";
}

function relativeToReal(team: "first" | "second", firstPickSide: TeamSide): TeamSide {
  return team === "first" ? firstPickSide : otherSide(firstPickSide);
}

// Turno actualmente esperado -- null si el formato no es captains_mode, no hay tabla, la
// secuencia ya se agotó (un draft con más acciones que las 24 curadas no debería pasar nunca en
// la práctica, pero un archivo corrupto o datos ruidosos no deben tirar el motor), o
// `firstPickSide` todavía no se bootstrapeó (esperando el primer evento con lado real).
export function currentCaptainsModeTurn(state: DraftState, table: CaptainsModeTurnTable | null): DraftTurn | null {
  if (!table || state.format !== "captains_mode" || state.firstPickSide === null) return null;
  const entry = table.turns[captainsModeTurnIndex(state)];
  if (!entry) return null;
  return { side: relativeToReal(entry.team, state.firstPickSide), action: entry.action, standardTimeMs: entry.standardTimeMs };
}

export interface TurnCheckResult {
  rejected?: "wrong_turn";
  // Presente solo cuando este evento resuelve el bootstrap de `firstPickSide` (turno 0, primer
  // evento de la tabla con un lado real) -- el reductor lo persiste en DraftState.firstPickSide.
  bootstrapSide?: TeamSide;
}

// Valida un hero_banned/hero_picked contra la tabla de turnos. Nunca rechaza si no hay
// suficiente dato para confirmar (side:"unknown", tabla ausente, formato distinto,
// firstPickSide sin bootstrapear todavía) -- "no se puede confirmar" no es lo mismo que "está
// mal" (mismo principio que raw:null en las señales del motor: nunca vota neutro/rechaza sin
// evidencia real).
export function checkCaptainsModeTurn(
  state: DraftState,
  table: CaptainsModeTurnTable | null,
  action: "ban" | "pick",
  side: TeamSide | "unknown",
): TurnCheckResult {
  if (!table || state.format !== "captains_mode") return {};
  const entry = table.turns[captainsModeTurnIndex(state)];
  if (!entry) return {}; // secuencia agotada -- sin más validación posible

  // El tipo de acción (ban/pick) nunca es "unknown" -- viene directo del tipo de DraftEvent, no
  // depende de que la captura conozca el lado. Un desajuste acá es wrong_turn siempre, sin
  // importar si `firstPickSide` ya se bootstrapeó -- a diferencia del lado, no hay ningún
  // escenario de "evidencia insuficiente" posible sobre qué tipo de acción es esta.
  if (entry.action !== action) return { rejected: "wrong_turn" };

  if (state.firstPickSide === null) {
    if (side === "unknown") return {}; // acción correcta, pero sin lado todavía no hay con qué bootstrapear
    return { bootstrapSide: entry.team === "first" ? side : otherSide(side) };
  }

  if (side === "unknown") return {}; // acción correcta, lado no confirmable -- no rechaza
  const expected = relativeToReal(entry.team, state.firstPickSide);
  if (side !== expected) return { rejected: "wrong_turn" };
  return {};
}

// Reserva restante de cada lado tras `elapsedMs` transcurridos en el turno de `actingSide` --
// solo se descuenta el EXCEDENTE sobre `standardTimeMs` (el tiempo estándar nunca se acumula ni
// se resta de la reserva si el equipo actuó dentro de plazo).
export function consumeReserveTime(
  reserveRemainingMs: { radiant: number; dire: number },
  actingSide: TeamSide,
  elapsedMs: number,
  standardTimeMs: number,
): { radiant: number; dire: number } {
  const overflowMs = Math.max(0, elapsedMs - standardTimeMs);
  if (overflowMs === 0) return reserveRemainingMs;
  return { ...reserveRemainingMs, [actingSide]: Math.max(0, reserveRemainingMs[actingSide] - overflowMs) };
}
