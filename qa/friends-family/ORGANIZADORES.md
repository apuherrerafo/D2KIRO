# Kit de evaluación humana — FRIENDS_FAMILY_READY (guía para organizadores)

> **Solo organizadores.** Este archivo describe las sospechas y los criterios de bloqueo; no se entrega a los evaluadores. A ellos se les da **únicamente** la carpeta `paquete-evaluadores/` (`situaciones.html` + `LEEME.md`), por ejemplo en un zip, **no el enlace al repositorio** (es público y trae este archivo y los resultados del consolidador).

15 situaciones de draft del **motor actual** (Coach real del simulador) para que **3 evaluadores independientes, incluido el Product Owner**, las juzguen cada uno por su lado. No usa el Golden antiguo ni sus etiquetas.

## Cómo se evalúa (dos preguntas distintas)
El Coach decide **primero qué posición mostrar** (su "consejo principal") y **luego** propone 5 héroes **de esa única posición**. Cada evaluador califica:
1. **Parte 1 — la posición elegida:** bien / dudosa / mala, y si no es "bien", qué posición habría mostrado (1–5, "esperar" o "sin opinión") con razón.
2. **Parte 2 — cada uno de los 5 héroes:** calidad del pick (bueno / aceptable / malo / error grave), explicación (correcta / dudosa / incorrecta) y etiqueta de posición del héroe (bien / dudosa / mala); razón obligatoria si algo no es "bueno / correcta / bien".

El propio HTML trae la guía, la rúbrica y una **comprobación de comprensión obligatoria** (los 5 héroes son de una sola posición; además de los héroes se juzga la posición elegida). Sin contestarla bien no se puede empezar, y el archivo de resultados lo registra.

## Flujo
```
bun scripts/f-and-f/build-kit.ts     # regenera el kit (determinista: mismo motor + snapshot => mismos archivos)
                                     #   -> qa/friends-family/situaciones.json, manifest.json (NO versionado: semillas/sospechas)
                                     #   -> qa/friends-family/paquete-evaluadores/situaciones.html
bun scripts/f-and-f/consolidate.ts   # lee qa/friends-family/results/ff-eval-*.json
```
1. Entrega `paquete-evaluadores/` a los 3 evaluadores. **Un navegador o perfil por persona**; si comparten equipo, el HTML avisa y ofrece borrar lo anterior.
2. Cada evaluador devuelve **un** `ff-eval-<nombre>.json`. Guárdalos en `results/` (carpeta no versionada).
3. Corre el consolidador. Descarta, avisando por qué: otra versión del kit (hash), esquema viejo, comprensión no superada, ítems que no coinciden con el kit, faltantes, razones ausentes, o nombre repetido. Si dos archivos tienen **contenido idéntico** bajo nombres distintos, **avisa** (puede ser una copia) sin descartar a nadie: confírmalo con las personas. Nunca aborta por un archivo malo.
4. **Cada error grave que marque cualquier evaluador se investiga** (reproducir en el simulador y decidir) y se registra en `results/investigaciones.json`:
   ```json
   [{ "scenarioId": "S04", "rank": 2, "conclusion": "confirmado", "by": "po", "note": "reproducido: con Axe+Lion revelados pierde la línea" }]
   ```
   `conclusion`: `descartado` (no era un error), `confirmado` (error real) o `limitacion_aceptada` (el PO decide convivir con él).

## Veredicto propuesto (umbrales provisionales de la prueba cerrada)
- **Picks ilegales: 0.** Se comprueba por máquina al generar el kit: una recomendación con héroe baneado, ya elegido o repetido **aborta la generación**. No es trabajo de los evaluadores.
- **Errores graves sin investigar: 0.** Un "error grave" de **un solo** evaluador ya exige investigación (aunque los otros dos lo vean bien). Sin ella: **REVISAR**.
- **BLOQUEA:** hay un error grave investigado y `confirmado` (y no aceptado como limitación). Se corrige o se decide convivir con él antes de invitar.
- **REVISAR:**
  - menos de 3 evaluadores;
  - **desacuerdo entre evaluadores** sobre un pick (uno lo ve bueno/aceptable y otro malo/grave) o sobre la posición elegida (uno "bien", otro "mala"). **No se asume que la opinión más dura es la correcta**: la mayoría estricta fija el consenso y el desacuerdo se discute con la mecánica sobre la mesa;
  - un pick del top 3 "malo" por consenso, una posición "dudosa/mala" por consenso, o una explicación "incorrecta" (afirma algo falso) por consenso.
- **PASS:** 3 evaluadores, ningún hallazgo de los anteriores. Significa "no hay nada que investigar en estas 15 situaciones", **no** "el coach es bueno".
- **El informe no calcula ningún porcentaje de acierto.** 15 situaciones no permiten declarar una precisión global; sirven para encontrar errores graves y patrones. Las reglas viven en `consolidate.ts` (`MIN_EVALUATORS` y `consolidate()`).

## Qué cubre (cobertura y semillas exactas en `manifest.json`, que se regenera con `build-kit.ts`)
Primeros picks (3), respuesta a counters (3), necesidades de composición (2), rol faltante (3) y late draft (4). Incluye a propósito situaciones donde sospechamos problemas: **primeros picks de solo supports** y **varios carries cuando falta mid**. Los evaluadores no ven esas etiquetas ni la cobertura; el orden de presentación está barajado.

## Límites
- Estados del simulador (bans y rival simulados; meta 7.41e con el snapshot congelado `W5-EMP-001`). Los textos del coach citan fuentes de 7.41d/7.41f: es contenido del producto, no un error del kit.
- El hash del kit (`scenariosSha256`) liga cada resultado a **esta** versión: si regeneras el kit con otro motor, los resultados viejos dejan de valer.
- Los datos de este directorio no contienen veredictos humanos hasta que alguien los llene y los entregue.
- Riesgo residual: el repositorio es público. Si un evaluador entra a él puede leer este archivo; por eso solo se le da el paquete.
