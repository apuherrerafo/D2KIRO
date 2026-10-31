import rawCapabilities from "./capabilities.json";
import type {
  CapabilityAvailability,
  CapabilityCoverageSemantic,
  CapabilityLevel,
  DamageType,
  HeroCapabilities,
} from "./types";

/**
 * Constantes semánticas de cobertura de capacidades tácticas.
 * Describen héroes jugables cuyos datos de capacidades no están curados (UNCURATED / CAPABILITY_DATA_UNAVAILABLE).
 */
export const CAPABILITY_DATA_UNAVAILABLE = "CAPABILITY_DATA_UNAVAILABLE" as const;
export const CAPABILITY_DATA_AVAILABLE = "CAPABILITY_DATA_AVAILABLE" as const;

/**
 * Héroes del censo activo (CURATED_HERO_IDS, 127 héroes) cuyas capacidades tácticas siguen SIN curar en capabilities.json
 * (UNCURATED / CAPABILITY_DATA_UNAVAILABLE).
 *
 * Hoy está vacío: Ringmaster (131), Kez (145) y Largo (155), que estaban excluidos desde TSK-036 por falta de curación táctica
 * confiable, se curaron el 2026-10-31 a partir del texto de sus habilidades en el Dota instalado (build del 27-oct-2026) y se
 * calibraron contra héroes parecidos ya curados. Son valoraciones tácticas, no medidas: se revisan por separado como cualquier
 * otra entrada de este archivo (127/127 curados).
 *
 * Si en el futuro sale un héroe nuevo sin ficha, se agrega aquí su id: en el motor de scoring (team_synergy, archetype_fit)
 * la semántica canónica sigue siendo
 *   dato desconocido != carencia de capacidad
 * así que ese héroe recibe `raw: null` (imputación neutral de stateMean en mixCandidateByState), nunca raw: 0.
 */
export const UNCURATED_CAPABILITY_HERO_IDS: ReadonlySet<number> = new Set<number>();

/** Alias de compatibilidad con código existente */
export const UNKNOWN_CAPABILITY_HERO_IDS: ReadonlySet<number> = UNCURATED_CAPABILITY_HERO_IDS;

export function getCapabilityAvailability(
  heroId: number,
  capabilities: HeroCapabilities[] = loadHeroCapabilities(),
): CapabilityAvailability {
  return capabilities.some((c) => c.hero === heroId) ? "available" : "unavailable";
}

export function getCapabilityCoverageSemantic(
  heroId: number,
  capabilities: HeroCapabilities[] = loadHeroCapabilities(),
): CapabilityCoverageSemantic {
  return capabilities.some((c) => c.hero === heroId) ? "CURATED" : CAPABILITY_DATA_UNAVAILABLE;
}

const DAMAGE_TYPES: DamageType[] = ["physical", "magical", "pure", "mixed"];
const LEVELS: CapabilityLevel[] = ["low", "medium", "high"];

function isDamageType(value: unknown): value is DamageType {
  return DAMAGE_TYPES.includes(value as DamageType);
}

function isCapabilityLevel(value: unknown): value is CapabilityLevel {
  return LEVELS.includes(value as CapabilityLevel);
}

export function isHeroCapabilities(value: unknown): value is HeroCapabilities {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    Number.isInteger(entry.hero) &&
    (entry.hero as number) > 0 &&
    isDamageType(entry.damageType) &&
    typeof entry.hasInitiation === "boolean" &&
    typeof entry.hasCatch === "boolean" &&
    typeof entry.hasWaveclear === "boolean" &&
    isCapabilityLevel(entry.structuralDamage) &&
    isCapabilityLevel(entry.teamfight) &&
    isCapabilityLevel(entry.scaling)
  );
}

export function loadHeroCapabilities(): HeroCapabilities[] {
  if (!Array.isArray(rawCapabilities)) return [];
  const valid = rawCapabilities.filter(isHeroCapabilities);
  const seen = new Set<number>();
  return valid.filter((entry) => {
    if (seen.has(entry.hero)) return false;
    seen.add(entry.hero);
    return true;
  });
}
