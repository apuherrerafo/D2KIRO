import type { PartySize } from "./types";

export const PARTY_SIZE_OPTIONS: PartySize[] = [2, 3, 5];
export const DRAFT_PARTY_SIZE_OPTIONS: PartySize[] = [1, 2, 3, 5];
export const MAX_COMPANION_POOL_SIZE = 5;
export const TEAM_GROUP_SAVED_MESSAGE = "Equipo guardado.";
export const REPLACE_MEMBER_HINT = "Cambiar el nombre mantiene a la misma persona y sus héroes. Usa esto si en este lugar juega alguien distinto: empieza sin héroes.";
export const TEAM_GROUP_DELETED_MESSAGE = "Equipo eliminado.";
export const EMPTY_TEAM_GROUP_MESSAGE = "Todavía no guardaste equipos.";

// Terminología consistente con el resto del producto: nunca "Pos 3" a secas sin el nombre al lado.
export const SEAT_LABELS: Readonly<Record<1 | 2 | 3 | 4 | 5, string>> = Object.freeze({
  1: "Pos 1 — Carry",
  2: "Pos 2 — Midlane",
  3: "Pos 3 — Offlane",
  4: "Pos 4 — Support",
  5: "Pos 5 — Hard support",
});
