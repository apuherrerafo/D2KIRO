import type { Provenance, ProvenanceSource } from "./types";

// V7 PR-1 (TSK-248): identidad canónica de una partida. Funciones puras, sin I/O. Este módulo NO
// deduplica nada a escala ni ingesta: sólo fija (a) qué es un `match_id` bien formado y (b) la llave
// estable `matchKey` que una ingesta futura usará para reconocer "la misma partida". Lo único que
// la usa hoy es el dedupe intra-contenedor del cargador.

// Entero decimal positivo, sin signo, sin ceros a la izquierda, sin separadores/exponente/espacios.
// 16 dígitos es el techo textual; `Number.isSafeInteger` (<= 2^53 - 1) lo recorta exacto.
const CANONICAL_MATCH_ID = /^[1-9][0-9]{0,15}$/;

/**
 * Devuelve `value` si ya es un `match_id` canónico, o `null`. Sólo acepta `string`: un `number`
 * (`8e9`, `7.0`, `NaN`, `-1`, `0`) es ambiguo (el JSON no distingue 7 de 7.0 y un float grande
 * pierde precisión sin avisar), así que se rechaza en vez de "arreglarse". Nunca lanza, nunca
 * normaliza ("007" no se convierte en "7": un id con ceros a la izquierda es otra cadena).
 */
export function canonicalMatchId(value: unknown): string | null {
  if (typeof value !== "string" || !CANONICAL_MATCH_ID.test(value)) return null;
  return Number.isSafeInteger(Number(value)) ? value : null;
}

// Id propio de un caso `manual_curated`: empieza con letra, así que NUNCA es un `match_id` canónico
// (que sólo tiene dígitos). Los dos espacios de identidad no pueden confundirse ni por accidente.
const MANUAL_ID = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/;

/** Devuelve `value` si es un id propio válido de `manual_curated`, o `null`. Nunca lanza. */
export function canonicalManualId(value: unknown): string | null {
  return typeof value === "string" && MANUAL_ID.test(value) ? value : null;
}

/**
 * Valida `sourceMatchId` contra el espacio de su fuente: `match_id` de Valve para `opendota_*`, id
 * propio para `manual_curated`. Un id numérico en `manual_curated` se rechaza (parecería una partida
 * real de Valve); uno con letras en `opendota_*` también.
 */
export function canonicalSourceMatchId(source: ProvenanceSource, value: unknown): string | null {
  return source === "manual_curated" ? canonicalManualId(value) : canonicalMatchId(value);
}

/**
 * Llave estable de identidad de partida. Las dos fuentes de OpenDota (`opendota_match`,
 * `opendota_league`) llevan el `match_id` de Valve y comparten el MISMO espacio (`valve:`) -> una
 * misma partida llegada por las dos vías es la misma llave. `manual_curated` es su propio espacio
 * (`manual:`): nunca colisiona con un `match_id`, y nunca se asume que corresponda a una partida real.
 * (Reconocer que un caso manual describe una partida de Valve ya ingerida es deduplicación entre
 * fuentes: pendiente, fuera de PR-1.)
 */
export function matchKey(provenance: Pick<Provenance, "source" | "sourceMatchId">): string {
  const space = provenance.source === "manual_curated" ? "manual" : "valve";
  return `${space}:${provenance.sourceMatchId}`;
}
