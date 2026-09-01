## REGLAS DE FASE 3 (posiciones reales) — desde `docs/specs/SPEC.md` §10
Generadas por `/rulebook`, tercera ejecución del proyecto. Detalle completo en `.claude/rules/`
(secciones "Fase 3" en `engine.md`, `web.md`, `security.md`, `testing-seams.md`) — esta sección
son los puntos que no se pueden violar sin romper el contrato, resumidos:

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

