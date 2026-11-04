# Evaluación del MVP por el Product Owner (`MVP_OWNER_TESTED`)

15 situaciones de draft del **motor actual** (Coach real del simulador), evaluadas **solo por el PO**. No hay terceros ni ZIP.
`MVP_OWNER_TESTED` = "el PO probó el MVP y lo aprobó para una beta cerrada". **No certifica calidad estratégica**: es el juicio de una persona sobre 15 situaciones.

## Cómo evaluar (≈ 45–60 min)
1. Abre `paquete-evaluadores/situaciones.html` en el navegador (sin internet). Contesta las 2 preguntas de comprobación y pulsa **Empezar**.
2. En cada situación juzgas **dos cosas**:
   - **Parte 1 — la posición:** el coach decide primero qué posición mostrar. ¿Acertó? Si no, qué posición habrías mostrado (o "esperar") y por qué.
   - **Parte 2 — los 5 héroes** (todos de esa posición): calidad del pick (bueno / aceptable / malo / error grave), explicación (correcta / dudosa / incorrecta) y etiqueta de posición del héroe. Todo lo que no sea "bueno / correcta / bien" pide una razón con mecánica concreta.
   - Opcional: héroe que faltó y comentario libre. Es donde van tus observaciones.
3. **Descargar mis resultados** → guarda `ff-eval-<tu nombre>.json` en `qa/friends-family/results/` (carpeta no versionada).

## Informe y decisión
```
bun scripts/f-and-f/build-kit.ts --check   # reproducibilidad: el kit versionado se regenera byte a byte y 0 recomendaciones ilegales
bun scripts/f-and-f/consolidate.ts         # lee results/ -> imprime y escribe results/informe-po.{md,json}
```
El informe lista **tus errores identificados** (graves primero), la elección de posición puesta en duda, una tabla por situación y tus observaciones libres.

- **Cada "error grave" se investiga** (reproducirlo en el simulador y decidir) y se registra en `results/investigaciones.json`:
  `[{ "scenarioId": "S04", "rank": 2, "conclusion": "confirmado", "by": "po", "note": "reproducido: …" }]`
  con `conclusion` = `descartado` | `confirmado` | `limitacion_aceptada`.
  - Sin investigar → **REVISAR**. `confirmado` → **BLOQUEA** (se corrige, o se pasa a `limitacion_aceptada` si decides convivir con él).
- **La decisión es tuya y explícita**, en `results/decision-po.json`:
  `{ "decision": "aprobado_para_beta", "by": "po", "note": "…" }` (o `"no_aprobado"` → REVISAR).
  Los hallazgos no graves (picks malos en el top 3, posición dudosa, explicaciones incorrectas) **no bloquean solos**, pero el informe los lista junto al veredicto para que decidas a la vista.
- Estados: `SIN_DATOS` → `PENDIENTE_DECISION_PO` (sin graves abiertos, falta tu decisión) → `MVP_OWNER_TESTED` (graves cerrados + aprobado). `BLOQUEA` / `REVISAR` si no.

## Controles automáticos (no dependen de ti)
- **0 picks ilegales:** al generar el kit, una recomendación con héroe baneado, ya elegido o repetido **aborta la generación**.
- **Reproducibilidad:** `build-kit.ts --check` falla si el motor, el snapshot o la plantilla cambiaron respecto de lo versionado. Cada resultado queda ligado al kit por hash; si regeneras el kit, un resultado viejo se descarta.
- Si regeneras (`bun scripts/f-and-f/build-kit.ts`), `manifest.json` (semillas y etiquetas de sospecha, **no versionado**) se actualiza; el informe lo usa para marcar qué situaciones eran de sospecha (primeros picks de solo supports; carries sin mid).

## Qué NO es
- No mide precisión ni "inteligencia" del coach; 15 situaciones y una sola persona no lo permiten.
- No reemplaza una evaluación con más jugadores si más adelante se hace: el consolidador ya acepta varios evaluadores (con desacuerdo ⇒ REVISAR).
- Estados del simulador (bans y rival simulados; meta 7.41e, snapshot `W5-EMP-001`). Los textos del coach citan fuentes de 7.41d/7.41f: es contenido del producto.
