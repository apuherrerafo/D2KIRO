---
name: foundation-check
description: Detecta focos de deuda técnica (hot spots) vía historial de Git y evalúa si un módulo es genuinamente profundo o solo un passthrough. Usar cuando el usuario pregunta "cómo está la arquitectura", "dónde hay deuda técnica", o antes de una refactorización grande.
allowed-tools: "Read Bash(git log:*) Bash(bash scripts/analisis-arquitectura.sh)"
compatibility: Requiere Git y un historial de commits no vacío. Sin este historial, la skill no puede funcionar — no hay fallback significativo.
---

# /foundation-check — Auditoría de Arquitectura

## PROPÓSITO
Evaluar la salud estructural del repositorio sin generar reportes HTML ni dependencias nuevas — solo texto y criterio de ingeniería.

## REGLAS
1. Ejecuta: `bash scripts/analisis-arquitectura.sh` para obtener los 10 archivos más modificados del historial (hot spots) **y** los archivos con más de 8 imports internos (nudos de acoplamiento — frecuente en handlers de HTMX que mezclan lógica de negocio con renderizado).
2. Para cada hot spot, aplica la **prueba de eliminación**: si borraras la interfaz pública de este módulo, ¿cuánta funcionalidad real desaparece detrás de ella?
   - Mucha funcionalidad oculta detrás de una interfaz simple → módulo profundo, saludable.
   - Poca o ninguna → passthrough superficial, candidato a eliminar o fusionar.
3. Para cada nudo de acoplamiento (>8 imports): pregúntate si ese archivo está haciendo más de un trabajo (ej. un handler que valida, consulta la DB, Y arma el HTML de respuesta). Un hot spot es frecuencia; un nudo de acoplamiento es estructura — son señales distintas y ninguna sustituye a la otra.
3. No generes HTML, Mermaid, ni abras nada en el navegador. El resultado es texto y va directo al `journal.md`.
4. Anota los hallazgos en `journal.md` como entrada de la tarea, no en un archivo nuevo.
5. Si detectas un hot spot con más de 5 modificaciones y sin tests asociados, márcalo como riesgo alto.

## OUTPUT
Lista de hot spots + veredicto profundo/superficial por cada uno, anotada en `journal.md`.

## ESCALADA OPCIONAL: cuándo SÍ considerar un grafo de código externo (Graphify + CRG)
Por defecto, esta skill usa solo `git log` — nada de grafos externos. Pero si en repetidas corridas de `/foundation-check` el repo sigue creciendo en hot spots y ya no es "10-15 archivos que Claude puede leer directo", es una señal legítima de que un grafo de código (ej. Graphify + code-review-graph, ambos locales y gratuitos) empieza a pagar su costo. Antes de instalarlo:
- Confirma con el usuario explícitamente — no lo instales solo porque detectaste crecimiento.
- Si se instala, acota las herramientas MCP que expone (la doc de esa herramienta menciona una variable `CRG_TOOLS` para dejar activas solo 5-8, no las ~25 por defecto) — si no se acota, vuelve a caer en el mismo problema de "impuesto de contexto" que evitamos con Sequential Thinking MCP.
- Revisa qué hooks escribe el instalador en la configuración de Claude Code antes de aceptarlos — algunos instaladores de este tipo modifican `.mcp.json`/hooks automáticamente.
- El etiquetado semántico con LLM (para nombrar comunidades del grafo) es opcional y tiene costo de tokens propio — déjalo apagado salvo que el usuario lo pida explícitamente.

## LÍMITES
- No modifica código. Solo diagnostica.
- No crea archivos nuevos aparte de la entrada en `journal.md`.
