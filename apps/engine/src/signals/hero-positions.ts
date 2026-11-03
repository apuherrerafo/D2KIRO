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
// trata como `raw: null`, igual que cualquier hueco de dato. NO se le inventa una posición a mano.
//
// CERTIFICATION REMEDIATION (Phase A, A2) -- two file shapes, and why:
//   v1 (legacy array `[{hero, positions:[{position, matches}]}]`): the collection step DISCARDED every
//     position below `MIN_POSITION_MATCHES` before saving, so the hero's complete denominator is lost.
//     It is "floor-truncated": listed positions are exact, the unlisted mass is unknown (< floor each).
//   v2 (`hero-position-observations/v1`): retains EVERY observed (position, matches) row, including the
//     ones below the floor. The share denominator is built from ALL of them; the admission floor is
//     applied afterwards, as a separate step. `scripts/positions/import-observations.ts` generates it
//     deterministically from raw page dumps (`scripts/positions/scrape-d2pt.ts`, manual).
// Both parse into the same `HeroPositions` (the ADMITTED view every consumer already uses); only v2 stamps
// `heroTotalMatches`, which is what makes `positionShare()` a true share instead of a share of survivors.

export const HERO_POSITION_OBSERVATIONS_SCHEMA = "hero-position-observations/v1";

export interface HeroPositionShare {
  position: 1 | 2 | 3 | 4 | 5; // carry | mid | offlane | soft support | hard support
  matches: number;
  /**
   * The hero's COMPLETE known denominator: the sum of matches over every position observed for it, including
   * observations below `MIN_POSITION_MATCHES`. Present only when the dataset retained the full raw counts (v2).
   * Absent (legacy v1 / hand-built fixtures) means "the listed positions are the complete set" -- which for v1
   * production data is NOT true (floor-truncated); the dataset's completeness is recorded in its provenance.
   */
  heroTotalMatches?: number;
  totalPopulationMatches?: number;
  totalKnownPositionMatches?: number;
  unassignedMatches?: number;
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

function isObservation(value: unknown): value is { position: 1 | 2 | 3 | 4 | 5; matches: number } {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return VALID_POSITIONS.has(row.position as number) && Number.isInteger(row.matches) && (row.matches as number) >= 0;
}

/**
 * v2 (retained raw observations) -> the admitted `HeroPositions` view. Denominator and admission are two separate
 * steps: `heroTotalMatches` sums EVERY valid observation (sub-floor ones included); only then is the floor applied
 * to decide which positions are listed. A hero with any malformed/duplicated observation row is dropped whole --
 * a partial hero would silently produce a wrong denominator. A hero with no position at/above the floor is left
 * out (evidence unavailable -> `raw: null` downstream); no position is ever invented for it.
 * Never throws; a file of another shape degrades to `{}`.
 */
export function parseHeroPositionObservations(raw: unknown): HeroPositions {
  if (typeof raw !== "object" || raw === null) return {};
  const file = raw as Record<string, unknown>;
  if (file.schema !== HERO_POSITION_OBSERVATIONS_SCHEMA || !Array.isArray(file.heroes)) return {};

  const result: HeroPositions = {};
  for (const entry of file.heroes) {
    if (typeof entry !== "object" || entry === null) continue;
    const { hero, observations } = entry as Record<string, unknown>;
    if (!isValidHeroId(hero) || hero in result) continue;
    if (!Array.isArray(observations) || !observations.every(isObservation)) continue;
    if (new Set(observations.map((row) => row.position)).size !== observations.length) continue;

    const totalKnownPositionMatches = observations.reduce((sum, row) => sum + row.matches, 0);
    const totalPopulationMatches =
      typeof entry.totalPopulationMatches === "number" &&
      Number.isInteger(entry.totalPopulationMatches) &&
      entry.totalPopulationMatches >= 0
        ? entry.totalPopulationMatches
        : totalKnownPositionMatches;
    const unassignedMatches =
      typeof entry.unassignedMatches === "number" &&
      Number.isInteger(entry.unassignedMatches)
        ? entry.unassignedMatches
        : Math.max(0, totalPopulationMatches - totalKnownPositionMatches);

    const heroTotalMatches = totalPopulationMatches;
    const admitted = observations
      .filter((row) => row.matches >= MIN_POSITION_MATCHES)
      .sort((a, b) => b.matches - a.matches || a.position - b.position)
      .map((row) => ({
        position: row.position,
        matches: row.matches,
        heroTotalMatches,
        totalPopulationMatches,
        totalKnownPositionMatches,
        unassignedMatches,
      }));
    if (admitted.length === 0) continue;

    result[hero] = admitted;
  }
  return result;
}

export function loadHeroPositions(): HeroPositions {
  return Array.isArray(rawPositions) ? parseHeroPositions(rawPositions) : parseHeroPositionObservations(rawPositions);
}

/**
 * A position's share of the hero's matches. The denominator is the hero's COMPLETE known total when the dataset
 * retained it (`heroTotalMatches`, v2); otherwise it falls back to the sum of the listed positions -- correct only
 * when the listed set IS the complete set (hand-built fixtures), and an UPPER bound on the true share for
 * floor-truncated v1 data (see the dataset's provenance `completeness`).
 */
export function positionShare(
  hero: HeroId,
  position: 1 | 2 | 3 | 4 | 5,
  positions: HeroPositions,
): number {
  const shares = positions[hero] ?? [];
  const total = shares.find((share) => share.heroTotalMatches !== undefined)?.heroTotalMatches ?? shares.reduce((sum, share) => sum + share.matches, 0);
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

/**
 * Wave 5 Dota-Judge remediation (RB-1/RB-2): "is this hero CREDIBLY played at `targetPosition`?" -- the
 * question the Coach asks when a position is the thing being decided (the Player's personal position, or the
 * position a Primary Action tells the Player to reveal).
 *
 * It applies the SAME approved admission policy that already governs Mid (`isCandidateAdmittedForPosition`)
 * to every position, without adding any number of its own: the position is credible when it is the hero's
 * dominant one (ties included) OR its historical share reaches the already-approved
 * `MID_CANDIDATE_MIN_SHARE`. Mid delegates to the existing predicate untouched (it keeps its absolute
 * evidence floor). The floor is deliberately NOT generalised: it repairs a Mid-specific single-survivor
 * data problem, and applied to Pos1/3/4/5 it would drop genuine carries and supports whose curated counts
 * are simply lower (Medusa, Naga Siren, Alchemist, Pugna, ...).
 *
 * `isCandidateAdmittedForPosition` itself is NOT changed: the Enemy Bot and the legacy V6 target-position
 * path keep their "any curated presence" behaviour, so this fix cannot move anything outside the Coach.
 */
export function isCredibleForPosition(
  hero: HeroId,
  targetPosition: 1 | 2 | 3 | 4 | 5,
  positions: HeroPositions,
): boolean {
  if (targetPosition === 2) return isCandidateAdmittedForPosition(hero, 2, positions);
  const shares = positions[hero] ?? [];
  const target = shares.find((share) => share.position === targetPosition);
  if (!target) return false;
  const dominantMatches = Math.max(...shares.map((share) => share.matches));
  return target.matches === dominantMatches || positionShare(hero, targetPosition, positions) >= MID_CANDIDATE_MIN_SHARE;
}
