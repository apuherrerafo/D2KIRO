import type { DegradationFlag, ScreenState, SignalId, SuggestionConfidence } from "./types";

// img_url de héroe: se valida que el host esté en esta lista antes de renderizar — nunca una
// URL arbitraria tomada directo de la respuesta de la API (.claude/rules/web.md, security.md).
export const ALLOWED_HERO_IMG_HOSTS = ["cdn.cloudflare.steamstatic.com"];

// Espejo a mano de MAX_PICKS_PER_SIDE (apps/engine/src/draft/reducer.ts, TSK-078) — mismo
// criterio que CURRENT_PATCH en live-config.ts: los dos procesos son independientes, sin import
// directo. Usado solo para guardrails de UI (HeroGrid) — la fuente de verdad real es el motor.
export const MAX_PICKS_PER_SIDE = 5;

// Espejo a mano de captainsMode.reserveTimeMs (apps/engine/src/draft/draft-format-turns.json,
// TSK-071/073) — el wire manda reserveRemainingMs (lo que queda), nunca el total; este valor solo
// se usa para dibujar la barra de reserva como porcentaje (TSK-074), no participa de ninguna
// validación real.
export const CAPTAINS_MODE_RESERVE_TIME_MS = 130000;

export const DEGRADATION_LABELS: Record<DegradationFlag, string> = {
  stale_meta: "Los datos de héroes/parche tienen más de 24 horas — puede no reflejar el meta actual.",
  partial_signals: "El cálculo se cortó antes de terminar — algunas señales pueden faltar.",
  unconfirmed_state: "Hay picks o bans sin confirmar en la captura — revisa el tablero.",
  unknown_format: "No se detectó el formato del draft — las sugerencias no ajustan por modo de juego.",
};

export const CONFIDENCE_LABELS: Record<SuggestionConfidence, string> = {
  alta: "Confianza alta",
  media: "Confianza media",
  baja: "Confianza baja",
};

// TSK-077 (spec §1.3, specs/draft-native-experience.md): orden de PRESENTACIÓN en
// SignalBreakdown, no de wire -- `Suggestion.signals` (el array real que manda el motor) no
// cambia de orden. Las 3 señales tácticas (team_synergy/counter/position_fit -- "qué le falta al
// equipo", "contra quién es fuerte", "qué posición cubre") primero; patch_meta/hero_pool_fit
// (winrate/comodidad personal) al final -- para que el desglose se lea como una narrativa
// táctica, no como una tabla de stats en orden de cableado.
export const SIGNAL_DISPLAY_PRIORITY: SignalId[] = ["team_synergy", "counter", "position_fit", "patch_meta", "hero_pool_fit"];

// Qué es este estado y qué puede hacer el usuario ahora -- ninguno de los 6 estados de TSK-012
// se queda sin explicación en lenguaje llano (hallazgo real de TSK-016: el sistema nunca decía
// qué rol jugaba el usuario en la pantalla).
export const SCREEN_STATE_GUIDANCE: Record<ScreenState, string> = {
  desconectado:
    "No hay conexión con el motor de sugerencias en este momento. El último draft conocido sigue visible abajo, atenuado -- no se perdió nada. Si el motor no está corriendo, reconectar no va a funcionar hasta que lo levantes.",
  esperando_draft:
    "Todavía no se detectó ningún draft en curso. Con un capturador automático conectado a una partida real, esto se llena solo. En este ambiente de pruebas, usa \"Simular draft\" para ver picks y sugerencias aparecer en vivo, o \"Entrada manual\" si prefieres marcarlos tú mismo.",
  activo:
    "El draft está en curso. La sugerencia principal y las 2 alternativas se recalculan solas después de cada pick o ban -- no hace falta refrescar la página.",
  degradado:
    "Se sigue sugiriendo, con menos certeza de la habitual -- el aviso de arriba explica por qué (meta desactualizado, alguna señal sin dato, o un pick sin confirmar). Una sugerencia de confianza baja se muestra igual, nunca se calla.",
  completo: "El draft terminó. No van a llegar más sugerencias para esta sesión -- usa \"Simular otro draft\" si quieres ver otro escenario.",
  error: "Algo falló. El mensaje de abajo describe qué, y el botón te deja intentarlo de nuevo sin perder el draft ya capturado.",
};
