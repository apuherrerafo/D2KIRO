import type { SignalId } from "./types";

// V1/V2/V3 quedan congeladas por nombre -- nunca se editan sus valores. TSK-045 (SPEC.md §10.0
// punto 3) las tipa con sus propios literales HISTÓRICOS en vez de derivarlos de `SignalId` (como
// hacían antes con `Exclude<SignalId, ...>`): `SignalId` real ya NO incluye `role_gap` ni
// `role_safety` (fusionadas en `position_fit`, ver abajo), y una versión congelada representa una
// configuración pasada del motor -- no tiene por qué seguir acoplada a qué señales existen hoy.
// Los valores no cambian una coma; solo cambia el mecanismo de tipado.
type SignalIdV1 = "counter" | "patch_meta" | "team_synergy" | "role_gap";

// Versionado por nombre (engine.md): cambiar la calidad de las sugerencias es editar estos 4
// números, no reescribir el motor. Una prueba unitaria (mix.test.ts) verifica que suman 1.0.
export const SCORING_WEIGHTS_V1: Record<SignalIdV1, number> = {
  counter: 0.4,
  patch_meta: 0.25,
  team_synergy: 0.2,
  role_gap: 0.15,
};

type SignalIdV2 = SignalIdV1 | "hero_pool_fit";

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

type SignalIdV3 = SignalIdV2 | "role_safety";

// TSK-027 (feedback real de producto): mismo criterio verificable que D8 usó para V2 -- los 5
// pesos de V2 se escalan por 0.90, role_safety recibe el 0.10 restante (más bajo que
// hero_pool_fit porque su ventana de relevancia es mucho más angosta: solo los primeros 2 picks
// propios de un draft típico de ~5). Con role_safety no aplicable (fuera de ventana) Y
// hero_pool_fit no aplicable (pool sin configurar) -- el caso más común -- la redistribución
// proporcional sobre los 4 originales reproduce exactamente V1: 0.288/0.72=0.40, 0.18/0.72=0.25,
// 0.144/0.72=0.20, 0.108/0.72=0.15. Candado doble, verificado por prueba en mix.test.ts.
export const SCORING_WEIGHTS_V3: Record<SignalIdV3, number> = {
  counter: 0.288,
  patch_meta: 0.18,
  team_synergy: 0.144,
  role_gap: 0.108,
  hero_pool_fit: 0.18,
  role_safety: 0.1,
};

// TSK-045 (Fase 3, SPEC.md §10.3): `role_gap` y `role_safety` se fusionan en `position_fit` --
// la constante activa a partir de acá. **El candado de regresión cero de V2/V3 NO se hereda**:
// esas versiones *agregaban* una señal y escalaban proporcionalmente, de modo que con la señal
// nueva inaplicable se reproducían los pesos anteriores. V4 *reemplaza* dos señales por una, no
// existe un estado "position_fit sin configurar" que reproducir (SPEC.md §10.0 punto 4) -- si se
// busca ese candado acá y no está, es deliberado, no un olvido.
//
// 0.25 y no 0.108+0.10=0.208 (la suma de las dos señales que reemplaza): el problema real que
// disparó esta fase no era que `role_gap` calculara mal, era que pesaba tan poco que perdía
// siempre contra `counter`. Los 4 pesos supervivientes conservan el orden y la proporción
// relativa de V3 (counter > patch_meta = hero_pool_fit > team_synergy).
export const SCORING_WEIGHTS_V4: Record<SignalId, number> = {
  position_fit: 0.25,
  counter: 0.27,
  patch_meta: 0.17,
  team_synergy: 0.14,
  hero_pool_fit: 0.17,
};
