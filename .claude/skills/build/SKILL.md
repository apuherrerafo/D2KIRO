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
- **Alcance integral permitido**: modifica todos los archivos y líneas que sean técnicamente necesarios para dejar la tarea o refactorización completa y consistente. No pauses, pidas confirmación ni declares una excepción por el tamaño del cambio.
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
