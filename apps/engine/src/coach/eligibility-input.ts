import type { HeroCapabilities } from "../draft-paths/types";
import type { HeroId, PerspectiveDraftView } from "../draft-protocol/types";
import type { Position } from "../draft-protocol/roles/role-belief";
import type { CuratedCounter } from "../signals/hero-counters";
import type { HeroPositions } from "../signals/hero-positions";
import type { CuratedSynergy } from "../signals/hero-synergies";
import { deriveCompositionContext } from "./card-critical-gap";
import type { ContextReorderInput } from "./context-reorder";
import { revealedEnemyHeroes } from "./hero-card";
import type { EligibilityInput } from "./recommendation-eligibility";

// El contexto del contrato de elegibilidad (recommendation-eligibility.ts) armado desde la vista de perspectiva: lo que el jugador VE
// (bans, picks propios, rivales revelados) más los datos curados inyectados. Lo usa el Coach v3 (shortlist y vista personal del modo en
// vivo) para decidir con exactamente la misma regla que la decisión V4 y el tablero. Pura: sin I/O.

export interface EligibilityData {
  heroCounters?: ReadonlyMap<HeroId, readonly CuratedCounter[]>;
  heroSynergies?: ReadonlyMap<HeroId, readonly CuratedSynergy[]>;
  heroPositions?: HeroPositions;
  heroCapabilities?: readonly HeroCapabilities[];
}

/** `targetPosition` es la columna que se evalúa (cambia cómo pesa un counter en línea); ausente = todo counter revelado cuenta. */
export function eligibilityInputOf(view: PerspectiveDraftView, data: EligibilityData, targetPosition?: Position): EligibilityInput {
  const context: ContextReorderInput = {
    banned: new Set(view.bannedHeroes),
    ownPicks: new Set(view.ownPicks.flatMap((slot) => (slot.visibility !== "HIDDEN" ? [slot.heroId] : []))),
    revealedEnemies: new Set(revealedEnemyHeroes(view)),
    heroCounters: data.heroCounters,
    heroSynergies: data.heroSynergies,
    heroPositions: data.heroPositions,
    targetPosition,
  };
  return { context, composition: deriveCompositionContext(view, data.heroCapabilities) };
}
