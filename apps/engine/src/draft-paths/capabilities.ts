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
 * Héroes jugables del censo activo de Dota 2 (CURATED_HERO_IDS, 127 héroes) cuyas capacidades tácticas
 * permanecen sin curar en capabilities.json (UNCURATED / CAPABILITY_DATA_UNAVAILABLE):
 *
 * - Largo (155): héroe jugable activo en partidas clasificadas. Falta UN campo con fuente: `hasWaveclear` (ninguna guía escrita ni
 *   analista aprobado lo dice; el cargador exige un booleano, así que la ficha entera espera). Los otros siete campos tienen respaldo.
 *
 * Ringmaster (131) y Kez (145) se curaron (2026-11-03) con textos del juego + guías citables, revisadas por el auditor de Dota:
 * Ringmaster `scaling` y Kez `teamfight` salen de UNA guía (confianza media).
 *
 * En el motor de scoring (team_synergy, archetype_fit), la semántica canónica dicta que:
 *   dato desconocido != carencia de capacidad
 * Por tanto, un héroe sin entrada recibe `raw: null` (imputación neutral de stateMean en mixCandidateByState),
 * evitando penalizarlo falsamente con raw: 0 o inventar valoraciones subjetivas no autoritativas.
 */
export const UNCURATED_CAPABILITY_HERO_IDS: ReadonlySet<number> = new Set([155]);

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
