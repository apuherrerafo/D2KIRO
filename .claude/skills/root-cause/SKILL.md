---
name: root-cause
description: Cirugía de bugs con descartes explícitos. No parches, soluciones.
allowed-tools: "Read Grep Edit Bash(bun test:*)"
---

# @root-cause — Diagnóstico de Bugs

## PROPÓSITO
Encontrar y reparar bugs con precisión quirúrgica.

## REGLAS
- **Si el ticket tiene `tool: codex`**: antes de diagnosticar, pide el contexto real de lo que Codex intentó (comandos ejecutados, mensajes de error exactos) — no adivines qué pensó Codex a partir del diff solo. Diagnosticar sin eso es depurar a ciegas el trabajo de alguien que no puede explicarse.
- **Regla dura, sin excepción**: antes de tocar una sola línea de código, produce un comando ejecutable y determinista que reproduzca el bug (idealmente en menos de 2 segundos). Si no puedes reproducirlo de forma determinista, no tienes un diagnóstico — tienes una teoría. No se parchea sobre una teoría.
- Reproduce el fallo mentalmente después de tener el comando, no antes.
- Localiza el componente culpable.
- Descarta explícitamente otros componentes: "Descarto X porque no participa en este flujo."
- Propón opción A (parche quirúrgico, 1 archivo máximo).
- Propón opción B (punto medio, solo si es inevitable, pide permiso).
- Anota en `journal.md`: `- [timestamp] tool:root-cause ticket:<id> result:ok|fail — [causa encontrada o por qué no]` (formato en `CLAUDE.md`).
- Incrementa `attempts` en el frontmatter del ticket cada vez que un intento no resuelve el bug.

## LÍMITES
- Prohibido refactorizar archivos no implicados.
- Máximo 1 archivo modificado para la opción A.
