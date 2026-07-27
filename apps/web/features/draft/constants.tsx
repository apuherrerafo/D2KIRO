import type { DegradationFlag, SuggestionConfidence } from "./types";

// img_url de héroe: se valida que el host esté en esta lista antes de renderizar — nunca una
// URL arbitraria tomada directo de la respuesta de la API (.claude/rules/web.md, security.md).
export const ALLOWED_HERO_IMG_HOSTS = ["cdn.cloudflare.steamstatic.com"];

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
