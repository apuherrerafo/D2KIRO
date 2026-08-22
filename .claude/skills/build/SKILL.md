---
name: build
description: Implementación mínima de features. Código limpio, conciso y seguro por defecto.
allowed-tools: "Read Write Edit Glob Grep"
---

# @build — Implementación Mínima

## PROPÓSITO
Escribir el código mínimo necesario para una funcionalidad, con seguridad incorporada desde la primera línea.

## REGLAS
- **Disciplina TDD**: si la tarea tiene un criterio de éxito verificable, escribe primero el test que falla (rojo), confírmalo fallando, y solo entonces escribe el código mínimo para que pase (verde). No escribas implementación antes que su test cuando el test es viable.
  - Nota de alcance: esto es sobre corrección, no sobre optimización. Si lo que necesitas es mejorar una métrica (velocidad, tamaño) sobre código ya correcto, eso es `@loop`, no esto — no mezcles ambos procesos en la misma tarea.
- Crea EXACTAMENTE 1 archivo si es posible (excepción: migraciones de Drizzle, ver `CLAUDE.md`).
- Cero dependencias nuevas sin permiso.
- **Límite de 200 líneas nuevas (ver `scripts/verify-simplicity.sh`)**: si a mitad de tarea ves que el alcance real va a superar el límite, no te detengas a la mitad de la unidad lógica (un corte forzado deja código inconsistente) — pero SÍ avisá con `AskUserQuestion` en cuanto lo notes, antes de seguir. El historial real (TSK-003/004/009/010/012/013/014) muestra que la respuesta ha sido consistentemente "completo, pido la excepción al cerrar" — pero `docs/agents/MEMORY.md` es explícito: **"nunca asumir la respuesta de antemano"**. Conocer el patrón te dice qué esperar, no te autoriza a saltarte la pregunta. Al cerrar, si terminaste superando el límite, la excepción documentada (`simplicity_exception: true` + `exception_reason` en el frontmatter del ticket) tiene que quedar declarada antes de que `@shipcheck` intente cerrar la tarea.
- Todo input externo (formulario, query param, body de API) se valida antes de usarse.
- Ningún secreto se escribe literal: siempre `process.env.*`.
- Toda query a la base de datos usa Drizzle parametrizado, nunca strings concatenados.
- Al terminar, genera un checklist de 3-5 casos de prueba visuales.
- Anota en `journal.md`: `- [timestamp] tool:build ticket:<id> result:ok — [qué se implementó]` (formato en `CLAUDE.md`).

## OUTPUT
Código implementado + checklist de pruebas.

## LÍMITES
- No refactorices archivos no relacionados.
- No optimices prematuramente.
