import type { DraftPathArchetype, HeroCapabilities } from "./types";
import type { HeroId } from "../draft/reducer";

export function openingStrategy(hero: HeroId, capabilities: HeroCapabilities[]): DraftPathArchetype {
  const capability = capabilities.find((entry) => entry.hero === hero);
  if (!capability) return "scaling";
  if (capability.structuralDamage === "high") return "push";
  if (capability.teamfight === "high") return "teamfight";
  if (capability.hasInitiation && capability.hasCatch) return "pickoff";
  return "scaling";
}
