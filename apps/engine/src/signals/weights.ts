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

// TSK-023 (fase 1b, SPEC.md §9.3, D8): reducción proporcional -- los 4 pesos de V1 se escalan por
// 0.80 y hero_pool_fit recibe el 0.20 restante. No es arbitrario: cuando hero_pool_fit no aplica
// (pool sin configurar), la redistribución proporcional de mix.ts sobre los otros 4 devuelve
// exactamente los pesos de V1 (0.32/0.80=0.40, 0.20/0.80=0.25, 0.16/0.80=0.20, 0.12/0.80=0.15) --
// la regresión cero es demostrable por una prueba, no solo declarada (candado en mix.test.ts).
export const SCORING_WEIGHTS_V2: Record<SignalId, number> = {
  counter: 0.32,
  patch_meta: 0.2,
  team_synergy: 0.16,
  role_gap: 0.12,
  hero_pool_fit: 0.2,
};
