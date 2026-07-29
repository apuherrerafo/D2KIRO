import type { SignalId } from "./types";

// V1 queda congelado a propósito en sus 4 señales originales de fase 1 -- nunca gana
// `hero_pool_fit` ni `role_safety` (cada extensión de `SignalId` agrega su propio nombre a
// excluir aquí, nunca se editan los valores ni la prueba de V1).
type SignalIdV1 = Exclude<SignalId, "hero_pool_fit" | "role_safety">;

// Versionado por nombre (engine.md): cambiar la calidad de las sugerencias es editar estos 4
// números, no reescribir el motor. Una prueba unitaria (mix.test.ts) verifica que suman 1.0.
export const SCORING_WEIGHTS_V1: Record<SignalIdV1, number> = {
  counter: 0.4,
  patch_meta: 0.25,
  team_synergy: 0.2,
  role_gap: 0.15,
};

// V2 queda congelado igual que V1 en sus 5 señales originales de fase 1b -- nunca gana
// `role_safety` (TSK-027 extendió `SignalId` de nuevo; mismo patrón exacto que V1 arriba).
type SignalIdV2 = Exclude<SignalId, "role_safety">;

// TSK-023 (fase 1b, SPEC.md §9.3, D8): reducción proporcional -- los 4 pesos de V1 se escalan por
// 0.80 y hero_pool_fit recibe el 0.20 restante. No es arbitrario: cuando hero_pool_fit no aplica
// (pool sin configurar), la redistribución proporcional de mix.ts sobre los otros 4 devuelve
// exactamente los pesos de V1 (0.32/0.80=0.40, 0.20/0.80=0.25, 0.16/0.80=0.20, 0.12/0.80=0.15) --
// la regresión cero es demostrable por una prueba, no solo declarada (candado en mix.test.ts).
export const SCORING_WEIGHTS_V2: Record<SignalIdV2, number> = {
  counter: 0.32,
  patch_meta: 0.2,
  team_synergy: 0.16,
  role_gap: 0.12,
  hero_pool_fit: 0.2,
};

// TSK-027 (feedback real de producto): mismo criterio verificable que D8 usó para V2 -- los 5
// pesos de V2 se escalan por 0.90, role_safety recibe el 0.10 restante (más bajo que
// hero_pool_fit porque su ventana de relevancia es mucho más angosta: solo los primeros 2 picks
// propios de un draft típico de ~5). Con role_safety no aplicable (fuera de ventana) Y
// hero_pool_fit no aplicable (pool sin configurar) -- el caso más común -- la redistribución
// proporcional sobre los 4 originales reproduce exactamente V1: 0.288/0.72=0.40, 0.18/0.72=0.25,
// 0.144/0.72=0.20, 0.108/0.72=0.15. Candado doble, verificado por prueba en mix.test.ts.
export const SCORING_WEIGHTS_V3: Record<SignalId, number> = {
  counter: 0.288,
  patch_meta: 0.18,
  team_synergy: 0.144,
  role_gap: 0.108,
  hero_pool_fit: 0.18,
  role_safety: 0.1,
};
