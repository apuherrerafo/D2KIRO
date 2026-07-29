import type { SignalId } from "./types";

// V1 queda congelado a propósito en sus 4 señales originales de fase 1 -- nunca gana
// `hero_pool_fit` (TSK-022 extendió `SignalId` a 5 valores; este alias local excluye el nuevo
// para que V1 siga siendo exactamente lo que era, sin tocar sus valores ni su prueba). V2 (con
// las 5 señales) es responsabilidad de TSK-023, en este mismo archivo, sin editar esta constante.
type SignalIdV1 = Exclude<SignalId, "hero_pool_fit">;

// Versionado por nombre (engine.md): cambiar la calidad de las sugerencias es editar estos 4
// números, no reescribir el motor. Una prueba unitaria (mix.test.ts) verifica que suman 1.0.
export const SCORING_WEIGHTS_V1: Record<SignalIdV1, number> = {
  counter: 0.4,
  patch_meta: 0.25,
  team_synergy: 0.2,
  role_gap: 0.15,
};
