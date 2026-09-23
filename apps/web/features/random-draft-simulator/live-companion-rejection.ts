// MVP P0.1 (Live Companion) -- espejo a mano de RejectionReasonV2
// (apps/engine/src/draft-protocol/types.ts), sólo los motivos que este modo puede realmente
// disparar (never turn-order/eligibility ones -- Captain's Mode/CM eligibility are out of scope
// here). Mismo criterio que describeRejection en features/draft/manual-entry.ts: el motor no
// expone estas razones como texto, sólo como código -- un motivo nunca traducido cae al genérico,
// nunca se calla.
const REJECTION_MESSAGES: Record<string, string> = {
  HERO_ALREADY_TAKEN: "Ese héroe ya está baneado o pickeado en este draft.",
  DUPLICATE_HERO_IN_ROUND: "Ese héroe ya fue baneado o ya está sellado por este mismo lado en esta ronda.",
  SLOT_NOT_OPEN: "Ese asiento ya no está abierto -- refrescá antes de reintentar.",
  WRONG_PHASE: "El draft no está en la fase esperada para esta acción.",
  INVALID_HERO_ID: "Ese héroe no es válido.",
  COLLISION_ORDER_UNAVAILABLE: "Hay una colisión pendiente de resolución en esta ronda -- no se puede sellar otro héroe todavía.",
  ALREADY_RESOLVED: "Los bans de esta sesión ya se habían confirmado.",
};

export function describeLiveCompanionRejection(reason: string | undefined): string {
  if (reason === undefined) return "No se pudo aplicar el cambio, por un motivo que el motor no informó.";
  return REJECTION_MESSAGES[reason] ?? `No se pudo aplicar: ${reason}`;
}
