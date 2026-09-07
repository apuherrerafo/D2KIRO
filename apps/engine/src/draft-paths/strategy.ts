import type { DraftPathArchetype, HeroCapabilities } from "./types";
import type { HeroId } from "../draft/reducer";

// R0.3 / Task 15 (design §4.3 Data Models (d), requisito 3.5, CP9 / Property 9): un héroe sin
// entrada en `capabilities.json` NO tiene una estrategia de apertura medible -> se devuelve `null`
// ("sin dato, nunca un valor"), nunca el `"scaling"` fabricado de antes. `null` aquí significa "no
// hay observación", distinto de una entrada real cuyas capacidades son todas bajas (ésa deriva
// `"scaling"` legítimamente, abajo). Los consumidores del camino de apertura (`team-opener.ts`,
// `run-pipeline.ts`) ya aplican su propio default local para el desempate por diversidad -- eso es
// imputación interna de score, no responsabilidad de esta función.
export function openingStrategy(hero: HeroId, capabilities: HeroCapabilities[]): DraftPathArchetype | null {
  const capability = capabilities.find((entry) => entry.hero === hero);
  if (!capability) return null;
  if (capability.structuralDamage === "high") return "push";
  if (capability.teamfight === "high") return "teamfight";
  if (capability.hasInitiation && capability.hasCatch) return "pickoff";
  return "scaling";
}
