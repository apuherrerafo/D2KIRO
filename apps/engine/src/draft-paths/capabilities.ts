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
 * - Ringmaster (131): héroe jugable (introducido en parche 7.37). Excluido en TSK-036 / commit 20e4ca0 por falta de curación táctica confiable.
 * - Kez (145): héroe jugable (introducido en parche 7.37d / Crownfall IV). Excluido por la misma razón.
 * - Largo (155): héroe jugable activo en partidas clasificadas (confirmado en OpenDota y snapshot STRATZ con >2000 partidas Immortal AP).
 *   Excluido por la misma razón: sus capacidades tácticas subjetivas no han sido curadas en capabilities.json.
 *
 * Ninguno de estos héroes es un concepto interno ni carece de estado jugable; son héroes plenamente activos
 * en el ecosistema, con datos empíricos de partidas y presencia en el catálogo, pero cuyas capacidades
 * tácticas multidimensionales (iniciación, waveclear, control, escala) aún no han recibido curación experta
 * en el archivo estático capabilities.json (124/127 curados).
 *
 * En el motor de scoring (team_synergy, archetype_fit), la semántica canónica dicta que:
 *   dato desconocido != carencia de capacidad
 * Por tanto, estos héroes reciben `raw: null` (imputación neutral de stateMean en mixCandidateByState),
 * evitando penalizarlos falsamente con raw: 0 o inventar valoraciones subjetivas no autoritativas.
 */
export const UNCURATED_CAPABILITY_HERO_IDS: ReadonlySet<number> = new Set([131, 145, 155]);

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
