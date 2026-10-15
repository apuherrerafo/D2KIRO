# Contrato base del live (Gate 0)

Siete verdades del draft en vivo que D2KIRO ya rompió una vez. Valen para todo cambio futuro del motor,
el coach o el capturador. Si un cambio choca con una de estas verdades, gana la verdad. Para cambiarla
hace falta una decisión explícita del Product Owner, anotada en `journal.md`.

**Candado mecánico:** `apps/engine/src/live/live-contract.test.ts`.
- Las verdades que el código ya cumple son `test` normales y protegen contra regresiones.
- Las que el código todavía viola son `test.failing`: el candado ya está en rojo.
  - Cuando el paso del roadmap que las arregla aterriza, bun hace fallar ese `test.failing` ("marked as failing but it passed").
  - Eso obliga a convertirlo en `test` normal en el mismo PR.
  - **Nunca** se borra ni se debilita un test de este archivo para que la suite pase.

| # | Verdad | Qué significa en el producto | Estado en `ead1ad7` | Se cumple en |
|---|---|---|---|---|
| 1 | **El pool controla candidatos, no identidad.** | El pool de Pos P es el universo de candidatos de esa posición. Si el jugador puso a Rubick en su pool de carry, Rubick es candidato de carry: `position_fit` puede puntuarlo bajo, pero no expulsarlo. Que un héroe esté en un pool **nunca** dice quién lo pickeó ni en qué posición quedó. | **Violada:** `UNIQUE_POOL` en `live-position-resolver.ts`. El pool es solo un bonus (`hero_pool_fit`). El universo real es `credibleHeroesForPosition`. | Paso 1 |
| 2 | **Un vínculo exacto héroe→posición exige evidencia de identidad.** | Solo `EXPLICIT` (una fuente dijo la posición) o `LOCAL_PLAYER` (héroe local de GSI más la posición personal, si el Paso 1a lo valida). Nunca por pool, credibilidad, popularidad ni deducción. | **Violada:** `JOINT_INFERENCE` (credibilidad y "queda una sola posición"). | Paso 1 |
| 3 | **Desconocido gana a identidad inferida.** | La inferencia nunca produce identidad exacta. Solo puede producir **restricciones de conjunto lógicamente necesarias**. Ejemplo: con Pos1/2/5 explícitas, dos héroes sin identidad ocupan {3,4}, pero no se afirma cuál es cuál. | **Violada** cuando hay pools (restringen el dominio y encadenan vínculos). La restricción de conjunto pura ya se cumple. | Paso 1 |
| 4 | **Un ban no leído queda desconocido, nunca "no baneado".** | "Leímos 0 bans" y "no pudimos leer los bans" son estados distintos y visibles. Ninguna afirmación que dependa de bans ("GRAN OPORTUNIDAD") se hace con bans desconocidos. | **Violada:** el estado solo expone `bans: number`. | Paso 2 |
| 5 | **El ranking puede recalcularse y mantener el mismo orden.** | Recalcular no obliga a mover. Si el cambio del draft es irrelevante para una columna, su orden queda igual, y eso no es un error. | Se cumple. | — |
| 6 | **La decisión de posición y el ranking de héroes son decisiones distintas.** | "¿Qué posición ahora?" lo decide `LivePositionPriority` con evidencia categórica, sin comparar scores de V6 entre columnas. "¿Qué héroe dentro de esa posición?" lo decide el ranking de esa columna. Que la decisión cambie de posición no altera el ranking de las demás. | Se cumple. | — |
| 7 | **`PHASE_FALLBACK` jamás se presenta como ventaja táctica.** | Cuando nada táctico distingue las posiciones, el orden por fase se nombra como tal ("es un orden por fase del draft, no una ventaja"), sin héroe protagonista y nunca con base `STRATEGIC`. | Se cumple (motor y UI: `TeamCoachBoard.test.tsx`). | — |

## Qué no es este contrato

- **No define cómo se arreglan las violaciones.** Eso lo deciden los pasos 1 y 2 del roadmap del motor.
- **No congela nombres de campos.** El test de la verdad 4 usa `banKnowledge: "UNKNOWN"` como contrato provisional. Si el Paso 2 elige otro nombre, el test cambia en ese mismo PR. Lo que no cambia es la verdad.
- **No reemplaza `.claude/rules/invariantes.md`.** Las complementa para el flujo live.
