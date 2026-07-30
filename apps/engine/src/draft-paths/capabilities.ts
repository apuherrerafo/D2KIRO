import rawCapabilities from "./capabilities.json";
import type { CapabilityLevel, DamageType, HeroCapabilities } from "./types";

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
