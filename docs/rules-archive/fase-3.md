## REGLAS DE FASE 3 (posiciones reales) — desde `docs/specs/SPEC.md` §10
Generadas por `/rulebook`, tercera ejecución del proyecto. Detalle completo de `web.md`/
`security.md`/`testing-seams.md` sigue en `.claude/rules/` (secciones "Fase 3"); el de `engine.md`
se movió íntegro a este mismo archivo (R0.4 Task 24, ver más abajo) — esta sección son los puntos
que no se pueden violar sin romper el contrato, resumidos:

- **`roles[]` de OpenDota NO son posiciones.** 57% de los héroes están etiquetados `"Carry"`
  (Zeus, Axe, Tidehunter incluidos), 38% `"Support"`. Prohibido usarlos para razonar sobre
  posición, cobertura de rol o solapamiento de farm — para eso existe `hero-positions.json`.
  Este error, no detectado durante 3 fases, es exactamente lo que originó esta fase.
- **`role_gap` y `role_safety` dejan de existir**, fusionadas en `position_fit`. La intención de
  producto de `role_safety` (support primero, revelar el core después) se conserva completa; lo
  que se descarta es su implementación sobre etiquetas y su ventana dura de 2 picks.
- **`SCORING_WEIGHTS_V5` es la activa; V1/V2/V3/V4 quedan congeladas por nombre.** V4 fue la que
  introdujo `position_fit` en esta fase (reemplaza dos señales por una, no hay estado "sin
  configurar" que reproducir, así que el candado de regresión cero de V2/V3 **no aplica** a
  ninguna de las dos). V5 (auditoría 2026-08-22, TSK-065) no agrega ni quita señales sobre V4 —
  recalibra `RAW_RANGE.counter` (nunca medido contra datos reales) y sube `position_fit` de 0.25 a
  0.38 tras confirmar que un hard counter real casi empataba con un core que repite rol ya
  cubierto. Prueba unitaria obligatoria en toda versión: los 5 pesos suman `1.0`.
- **`position_fit` es señal ponderada, nunca filtro duro.** Un héroe que repite rol puntúa
  `raw: 0`; no se elimina de `candidatePool`, que solo descarta por hechos binarios.
- **El contrato `SignalScorer.score()` no se modifica** — el dato entra por fábrica y por
  `BuildSuggestionsOptions.heroPositions?`, mismo patrón que `now?`/`metaIsStale?`.
- **`hero-positions.json` se valida en el borde al cargarlo.** Umbral de 200 partidas por
  posición, no negociable en silencio. Archivo corrupto → "sin datos", nunca tira el motor.
- **El motor nunca llama a la red por este dato.** El script de regeneración corre a mano, fuera
  de `apps/engine`. Cero dependencias nuevas: el navegador headless vive fuera del `package.json`.
- **`SignalId` está espejado a mano en `apps/web`** — cambiar el set de señales del motor sin
  mover ese espejo en el mismo cambio rompe el tipado.


---

## Detalle histórico completo (movido desde `.claude/rules/engine.md` — R0.4 Task 24)

## Fase 3 — `position_fit` (S3 + S10) — SPEC.md §10

- **`roles[]` de OpenDota NO son posiciones.** Es la regla que originó toda esta fase: 57% de los
  héroes están etiquetados `"Carry"` (Zeus, Axe, Tidehunter incluidos) y 38% `"Support"`. Son
  etiquetas temáticas, no roles de línea. **Prohibido usar `roles[]` para razonar sobre posición,
  cobertura de rol o solapamiento de farm** — para eso existe `hero-positions.json`. `roles[]`
  sigue siendo válido para lo que sí describe (`team-synergy.ts` lo usa como heurística de
  capacidades, eso no cambia).
- **`role_gap` y `role_safety` dejan de existir.** Se fusionan en `position_fit` — las dos
  respondían la misma pregunta de fondo ("qué posición me falta y es buen momento de revelarla") y
  separadas competían entre sí dentro del mismo score. La intención de producto de `role_safety`
  (support primero, revelar el core después, TSK-027) **se conserva completa** dentro de la señal
  nueva; lo que se descarta es su implementación sobre etiquetas y su ventana dura de 2 picks.
- **`SCORING_WEIGHTS_V4` es la constante activa.** V1/V2/V3 quedan congeladas por nombre, nunca se
  editan ni se borran (mismo patrón de siempre). Prueba unitaria obligatoria: los 5 pesos suman
  exactamente `1.0`. **El candado de regresión cero de V2/V3 no aplica acá** — V4 reemplaza dos
  señales por una en vez de agregar una sexta, no existe un estado "sin configurar" que reproducir.
  Si alguien lo busca y no lo encuentra, es deliberado, no un olvido.
- **`position_fit` es señal ponderada, nunca filtro duro.** El único filtro duro del motor
  (`candidatePool`) descarta por hechos binarios (baneado/pickeado), jamás por juicio de calidad.
  Un héroe que repite rol puntúa `raw: 0`, **no** se elimina de la lista de candidatos.
- **El contrato `SignalScorer.score(state, candidate, meta)` no se modifica.** El dato de posición
  entra por fábrica (`createPositionFitScorer(positions)`) y por `BuildSuggestionsOptions
  .heroPositions?` (ausente → carga el archivo real). Mismo patrón que `now?`/`metaIsStale?` ya
  usan ahí — los llamadores existentes no cambian.
- **Los dos únicos casos de `raw: null`**: candidato sin entrada en `hero-positions.json` (hoy:
  Chen), y `state.localSide === "unknown"`. Este segundo es un **cambio de comportamiento
  deliberado** respecto a `role_gap`/`role_safety`, que lo trataban como "sin picks propios" y
  afirmaban implícitamente "te falta todo" sin base para hacerlo.
- **Nunca `applicable: false` en `position_fit`.** Ese campo significa "función que el usuario no
  configuró" (solo `hero_pool_fit` lo usa). Un héroe sin dato de posición es un hueco de datos:
  `raw: null`.
- `hero-positions.json` vive en `apps/engine/src/signals/`, archivo estático versionado en el
  repo, **no en SQLite** — mismo criterio que `capabilities.json`. Se valida en el borde al
  cargarlo (`loadHeroPositions()`): descarta entradas malformadas, `position` fuera de `1..5`,
  `matches` no entero o `< 200`, y héroes duplicados. **Un archivo corrupto degrada a "sin datos
  de posición" (todos `raw: null`), nunca tira el motor.**
- **El umbral de 200 partidas no es negociable en silencio.** Sin él, héroes con presencia
  marginal aparecen en las 5 posiciones (caso real verificado: Windranger). Si se cambia, se
  cambia acá y en `SPEC.md` §10.1 P4, nunca solo en el código.
- **El motor nunca llama a la red por este dato.** El script que regenera el archivo corre a mano,
  fuera de `apps/engine`, nunca programado. La regla de cero red en el camino caliente queda
  intacta — esta fase ni siquiera abre una excepción "de configuración" como sí hizo
  `POST /api/hero-pool/calculate` en 1b.

