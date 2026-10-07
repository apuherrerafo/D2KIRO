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
export const ADVISORY_NOTE = "Es una sugerencia: puedes elegir cualquier posición abierta y cualquier héroe legal, en el orden que quieras.";
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
/** Windows: removes only D2KIRO's file from Dota; no credential inside (app/api/live/gsi-uninstaller). */
export const GSI_UNINSTALLER_URL = "/api/live/gsi-uninstaller";
export const GSI_CFG_FOLDER = "game\\dota\\cfg\\gamestate_integration";
export const GSI_CFG_EXAMPLE_PATHS = [
  "C:\\Program Files (x86)\\Steam\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\",
  "D:\\SteamLibrary\\steamapps\\common\\dota 2 beta\\game\\dota\\cfg\\gamestate_integration\\",
] as const;
export const GSI_LAUNCH_OPTION = "-gamestateintegration";
export const GSI_INSTALL_ONCE = "Instala este archivo una sola vez y reinicia Dota 2.";
/** D2KIRO Companion (Windows): the one-time installer that keeps Dota connected forever (app/api/live/companion-installer). */
export const COMPANION_INSTALLER_DOWNLOAD_ACTION = "/api/live/companion-installer";
export const COMPANION_ONCE = "Instálalo una sola vez. Después solo abre D2KIRO, abre Dota 2 y juega.";
export const COMPANION_SCOPE =
  "Corre en segundo plano y arranca solo con Windows (solo tu usuario, sin permisos de administrador). Deja Dota 2 conectado a D2KIRO, se reconecta solo si reinicias Dota, el navegador o internet, y guarda diagnósticos solo en tu PC. No pide tu cuenta de Steam. Se desinstala desde Configuración de Windows → Aplicaciones.";
/** Lifecycle phase labels for the live status bar (Companion phase or GSI phase). */
export const LIVE_PHASE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  MENU: "Menú",
  LOADING: "Cargando partida",
  HERO_SELECTION: "Hero Selection",
  STRATEGY_TIME: "Strategy Time",
  MATCH: "Partida en curso",
  POST_GAME: "Fin de partida",
  OTHER: "—",
});
/** How often /live-draft re-reads the account's Dota link while waiting for a download to land. */
export const GSI_LINK_POLL_MS = 2_000;
/** ?setup=<code> after a failed download (app/api/live/gsi-config). */
export const GSI_SETUP_ERRORS: Readonly<Record<string, string>> = Object.freeze({
  session: "Tu sesión venció. Vuelve a iniciar sesión con Steam y descarga la configuración otra vez.",
  origin: "No se pudo generar la configuración desde esta página. Recarga la página e inténtalo de nuevo.",
  unavailable: "No se pudo generar la configuración en este momento. Prueba de nuevo en unos segundos.",
});

// Live Dota + Party 5 -- preset de equipo del draft en vivo.
export const LIVE_PRESET_STORAGE_KEY = "d2k.live.partyPreset";
export const LIVE_PRESET_REFUSALS: Readonly<Record<string, string>> = Object.freeze({
  not_found: "Ese preset ya no existe o no es de tu cuenta. El Team Coach sigue sin pools de equipo.",
  not_party5: "Sólo se pueden usar presets de Party 5 en el draft en vivo.",
  no_pools: "Ese preset no tiene héroes cargados en ninguna posición. Complétalo en Equipos y vuelve a elegirlo.",
  unsupported: "Este servidor todavía no admite presets en el draft en vivo.",
});
export const LIVE_PRESET_APPLY_FAILED = "No se pudo aplicar el preset ahora. Se reintentará al volver a conectar.";
export const LIVE_DRAFT_ENDED_TITLE = "DRAFT TERMINADO";
export const LIVE_DRAFT_ENDED_NOTE = "La selección de héroes ya cerró: no hay un pick para hacer ahora. Abajo queda la última lectura del Team Coach, sólo como referencia.";
