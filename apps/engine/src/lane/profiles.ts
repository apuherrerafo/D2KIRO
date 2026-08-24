import rawProfiles from "./hero-line-profiles.json";
import type { HeroId } from "../draft/reducer";

// Fase 6 (pro-drafter-spec-v1.md §2.2): perfil 5D de héroe, dato curado a mano -- mismo patrón
// exacto que capabilities.json/hero-positions.json (S9/S10): archivo estático versionado,
// validado al cargar, nunca SQLite ni red.
//
// [SUPUESTO, ver plan Fase 5-8]: el doc no da una fuente de datos para este perfil -- se resuelve
// acá igual que el corpus del KNN (5.1): un seed pequeño e incompleto a propósito (15 héroes de
// 126), marcado como tal. Completarlo con curación real por héroe es trabajo aparte, no de esta
// tarea.

export interface HeroLineProfile {
  readonly heroId: HeroId;
  readonly sustain: number;
  readonly killPressure: number;
  readonly harassRange: number;
  readonly dispelSave: number;
  readonly creepControl: number;
}

export const LANE_DIMENSIONS = [
  "sustain",
  "killPressure",
  "harassRange",
  "dispelSave",
  "creepControl",
] as const;

export type LaneDimension = (typeof LANE_DIMENSIONS)[number];

function isValidHeroId(value: unknown): value is HeroId {
  return Number.isInteger(value) && (value as number) > 0;
}

function isUnitInterval(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 1;
}

function isValidProfile(value: unknown): value is HeroLineProfile {
  if (typeof value !== "object" || value === null) return false;
  const p = value as Record<string, unknown>;
  if (!isValidHeroId(p.heroId)) return false;
  return LANE_DIMENSIONS.every((dimension) => isUnitInterval(p[dimension]));
}

// Una entrada malformada (dimensión fuera de [0,1], no numérica, faltante, heroId inválido) se
// descarta -- nunca tira el motor. Exportada por separado de `loadHeroLineProfiles` para probarla
// con fixtures sintéticos, nunca contra el archivo real (mismo criterio S9/S10): el archivo se
// amplía con curación manual, un test atado a su contenido se rompería en silencio al crecer.
export function parseHeroLineProfiles(raw: unknown): Map<HeroId, HeroLineProfile> {
  const result = new Map<HeroId, HeroLineProfile>();
  if (!Array.isArray(raw)) return result;

  for (const entry of raw) {
    if (!isValidProfile(entry)) continue;
    if (result.has(entry.heroId)) continue; // duplicado -- conserva la primera aparición
    result.set(entry.heroId, entry);
  }

  return result;
}

export function loadHeroLineProfiles(): Map<HeroId, HeroLineProfile> {
  return parseHeroLineProfiles(rawProfiles);
}
