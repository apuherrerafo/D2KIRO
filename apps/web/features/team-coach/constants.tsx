import type { TeamPosition } from "./types";

// Terminología de posiciones consistente con el resto de la app (web.md): número + nombre, nunca el número solo.
export const TEAM_POSITION_LABELS: Readonly<Record<TeamPosition, string>> = Object.freeze({
  1: "Carry",
  2: "Mid",
  3: "Offlane",
  4: "Support",
  5: "Hard Support",
});

export function teamPositionTitle(position: TeamPosition): string {
  return `POS${position} ${TEAM_POSITION_LABELS[position].toUpperCase()}`;
}

export function teamPositionName(position: TeamPosition): string {
  return `Pos${position} ${TEAM_POSITION_LABELS[position]}`;
}

export const PICK_NOW_LABEL = "★ PICK NOW";
export const ADVISORY_NOTE = "Es una sugerencia: podés elegir cualquier posición abierta y cualquier héroe legal, en el orden que quieras.";
export const DETERMINISTIC_DEFAULT_NOTE = "No hay una prioridad estratégica clara entre tus posiciones: este orden es una vista inicial, no una ventaja.";
export const CAPTURE_NOT_ENABLED = "DOTA_CAPTURE_NOT_ENABLED";
export const DOTA_NOT_RUNNING = "DOTA_NOT_RUNNING";
/** How often the live view asks the engine for capture status (cheap; the board is refetched only on change). */
export const LIVE_POLL_MS = 1_000;
/** Engine capture detail (live-capture-registry.ts): Dota sends no draft block -- only our side and hero. */
export const GSI_DRAFT_PARTIAL = "GSI_DRAFT_PARTIAL";

// TSK-219 -- conectar Dota (Game State Integration) desde el sitio, sin terminal. Texto para jugadores:
// nada de herramientas de desarrollo, puertos ni procesos.
export const GSI_CONFIG_DOWNLOAD_ACTION = "/api/live/gsi-config";
export const GSI_CFG_FOLDER = "game\\dota\\cfg\\gamestate_integration";
export const GSI_CFG_EXAMPLE_PATHS = [
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\",
  "D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\",
] as const;
export const GSI_LAUNCH_OPTION = "-gamestateintegration";
export const GSI_INSTALL_ONCE = "Instala este archivo una sola vez y reinicia Dota 2.";
/** How often /live-draft re-reads the account's Dota link while waiting for a download to land. */
export const GSI_LINK_POLL_MS = 2_000;
/** ?setup=<code> after a failed download (app/api/live/gsi-config). */
export const GSI_SETUP_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  session: "Tu sesión venció. Volvé a iniciar sesión con Steam y descargá la configuración otra vez.",
  origin: "No se pudo generar la configuración desde esta página. Recargá y probá de nuevo.",
  unavailable: "No se pudo generar la configuración en este momento. Probá de nuevo en unos segundos.",
});
