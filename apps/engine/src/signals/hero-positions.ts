import rawPositions from "./hero-positions.json";
import type { HeroId } from "../draft/reducer";

// TSK-043 (SPEC.md §10.6): `hero-positions.json` es dato curado, NO en SQLite -- mismo patrón
// exacto que `capabilities.json` (draft-paths/). Recolectado y validado en /pre-flight (Fase 3)
// vía Dota2ProTracker, bracket 7000+ MMR, parche 7.41e -- se regenera a mano, nunca desde
// apps/engine, nunca automático.
//
// CÓMO REGENERAR (tras un parche grande) -- ningún script quedó committeado en el repo (fuera
// de las dependencias del proyecto a propósito), así que el procedimiento real queda anotado
// acá para no perderlo:
//   1. `dota2protracker.com/meta?position=pos+N` (N = 1..5) trae la tabla completa de esa
//      posición. Un fetch HTTP simple (curl, WebFetch) devuelve 403 -- Cloudflare exige un
//      navegador real ejecutando JS.
//   2. Con un navegador real headless (ej. Playwright) SÍ entra, pero bloquea ráfagas rápidas de
//      páginas seguidas -- pedir cada posición con una pausa real entre una y la siguiente
//      (no en un loop apretado) evita el bloqueo.
//   3. El nombre de cada héroe y su número de partidas están en el DOM bajo la clase
//      `.d2-table-sticky-cell` (el nombre) y su fila ascendente `.grid...min-h-[42px]` (el resto
//      de la fila, incluidas las partidas) -- el texto plano de la página pierde los nombres
//      porque son íconos, hay que leer los elementos del DOM, no `innerText` completo.
//   4. Mapear cada nombre contra `GET /api/heroes` (motor real corriendo) para el `heroId` real
//      -- en la recolección de esta sesión los 126 nombres matchearon sin ningún desajuste.
//   5. Filtrar por `MIN_POSITION_MATCHES` (abajo) antes de guardar.
//
// PENDIENTE: Chen es el único héroe sin ninguna posición con >= 200 partidas en la recolección
// de esta sesión (no llegó al umbral en ninguna de las 5). No es un bug -- `position_fit` lo
// trata como `raw: null`, igual que cualquier hueco de dato -- pero si se quiere cerrarlo,
// agregar su entrada a mano en `hero-positions.json` (mismo shape, sin necesidad de rejugar
// todo el proceso de arriba por un solo héroe).

export interface HeroPositionShare {
  position: 1 | 2 | 3 | 4 | 5; // carry | mid | offlane | soft support | hard support
  matches: number;
}

export type HeroPositions = Record<HeroId, HeroPositionShare[]>;

// Umbral mínimo de partidas para que una posición cuente como real (engine.md, security.md):
// sin este umbral, héroes con presencia marginal aparecen en las 5 posiciones (caso real
// verificado durante /pre-flight: Windranger, antes de aplicar el filtro).
export const MIN_POSITION_MATCHES = 200;

// AP Solo Mid recovery policy. This is an admission threshold, not a claim that 25% is an
// eternal Dota truth. It is centralized here so a later expert review can tune one value without
// adding a hero-name whitelist or changing V6's scoring weights.
export const MID_CANDIDATE_MIN_SHARE = 0.25;

// AP Solo Mid data/signal repair (Dota Judge root cause 2, 2026-09): `hero-positions.json` only
// ever records a position once it clears `MIN_POSITION_MATCHES` -- positions below that cut are
// dropped at collection time, never written to the file. That means a hero can survive with a
// SINGLE listed position (e.g. 285 total matches, all at Mid) and trivially win the old
// "dominant surviving position" check, because there is nothing else on record to compare it
// against. The share denominator is the SAME distortion: `positionShare()` divides by the sum of
// whatever survived, not the hero's true total games, so a thin single-survivor case reads as a
// confident 100% share.
//
// `MID_CANDIDATE_MIN_MATCHES` is an absolute evidence floor for the ADMISSION decision, derived
// from the file's own base floor (`MIN_POSITION_MATCHES`, "this position is worth recording at
// all") rather than an invented number: 3x that floor is the difference between "this position
// cleared the minimum to be listed" and "this is substantial, standalone evidence that the hero
// plays this position," which is what admitting a hero as a Mid candidate actually claims. It does
// not, and cannot, fix every boundary case -- `hero-positions.json` never recorded the hero's true
// total games across ALL positions (including the ones that didn't clear 200), so the share for a
// hero split across exactly two well-populated positions (e.g. a hero with thousands of games at
// both Carry and Mid) is already a real, non-inflated number; whether 25% is the right cut for
// those genuine borderline cases is a product-tuning question, not a data-integrity bug, and is
// left untouched here.
export const MID_CANDIDATE_MIN_MATCHES = MIN_POSITION_MATCHES * 3;

const VALID_POSITIONS = new Set([1, 2, 3, 4, 5]);

function isValidShare(value: unknown): value is HeroPositionShare {
  if (typeof value !== "object" || value === null) return false;
  const share = value as Record<string, unknown>;
  return (
    VALID_POSITIONS.has(share.position as number) &&
    Number.isInteger(share.matches) &&
    (share.matches as number) >= MIN_POSITION_MATCHES
  );
}

function isValidHeroId(value: unknown): value is HeroId {
  return Number.isInteger(value) && (value as number) > 0;
}

// Un archivo corrupto (héroe malformado, posición fuera de 1..5, matches no entero o por debajo
// del umbral, héroe duplicado) degrada a "sin datos de posición" para esa entrada -- nunca tira
// el motor. Exportada por separado de `loadHeroPositions` para poder probarla con fixtures
// sintéticos, nunca contra el archivo real (costura S10, testing-seams.md): ese archivo se
// regenera por parche, un test atado a su contenido se rompería en silencio al cambiar el meta.
export function parseHeroPositions(raw: unknown): HeroPositions {
  if (!Array.isArray(raw)) return {};

  const result: HeroPositions = {};

  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { hero, positions } = entry as Record<string, unknown>;

    if (!isValidHeroId(hero)) continue;
    if (hero in result) continue; // duplicado -- conserva la primera aparición
    if (!Array.isArray(positions)) continue;

    const validShares = positions.filter(isValidShare);
    if (validShares.length === 0) continue;

    result[hero] = validShares;
  }

  return result;
}

export function loadHeroPositions(): HeroPositions {
  return parseHeroPositions(rawPositions);
}

export function positionShare(
  hero: HeroId,
  position: 1 | 2 | 3 | 4 | 5,
  positions: HeroPositions,
): number {
  const shares = positions[hero] ?? [];
  const total = shares.reduce((sum, share) => sum + share.matches, 0);
  if (total === 0) return 0;
  return (shares.find((share) => share.position === position)?.matches ?? 0) / total;
}

/**
 * Candidate admission happens before any scorer or final ranking. Mid requires meaningful absolute
 * evidence first (`MID_CANDIDATE_MIN_MATCHES` -- rejects the thin single-survivor cases where
 * "dominant" was vacuously true because nothing else was on record), and is then admitted when
 * Position 2 is dominant (ties included) OR its historical share reaches the audit's initial 25%
 * threshold. Other target positions retain the pre-recovery "any curated presence" behavior.
 */
export function isCandidateAdmittedForPosition(
  hero: HeroId,
  targetPosition: 1 | 2 | 3 | 4 | 5,
  positions: HeroPositions,
): boolean {
  const shares = positions[hero] ?? [];
  const target = shares.find((share) => share.position === targetPosition);
  if (!target) return false;
  if (targetPosition !== 2) return true;
  if (target.matches < MID_CANDIDATE_MIN_MATCHES) return false;
  const dominantMatches = Math.max(...shares.map((share) => share.matches));
  return target.matches === dominantMatches || positionShare(hero, 2, positions) >= MID_CANDIDATE_MIN_SHARE;
}
