---
name: onboarding
description: Integra el ecosistema Caveman a un repositorio que YA EXISTE (no greenfield). Detecta stack, gestores de dependencias y documentación previa antes de imponer nada. Usar cuando el usuario dice "instala esto en mi proyecto existente" o "quiero usar Caveman aquí" sobre un repo con código ya escrito.
---

# /onboarding — Integración a Repositorio Existente

## PROPÓSITO
`/launchpad` asume proyecto nuevo o ya gestionado por este ecosistema. Esta skill cubre el caso real más común y menos atendido: un repo que ya existe, con su propio historial, su propio stack, y sin `journal.md`.

## REGLAS
1. Inspecciona el repo antes de proponer nada: lenguaje principal, gestor de dependencias (`package.json`, `pnpm-workspace.yaml`, `requirements.txt`, etc.), presencia de tests, presencia de documentación técnica previa (`docs/`, `ADR/`, `README`).
2. No impongas el stack por defecto (Bun+HTMX+SQLite) si el repo ya tiene uno funcionando. Este ecosistema se adapta al proyecto, no al revés.
3. Si ya existe un `CLAUDE.md` o `AGENTS.md`, no lo sobrescribas — anexa una sección nueva con las reglas de este ecosistema y pide confirmación antes de fusionar.
4. Crea `docs/agents/journal.md` vacío y escribe una primera entrada: fecha, resumen de lo que se detectó, y qué se decidió NO tocar.
5. Mapea las convenciones de tareas existentes (issues de GitHub, tickets de Linear) al esquema de frontmatter de `docs/agents/tasks/` — no dupliques el sistema de tickets que ya tenían, referencia el ID externo en el frontmatter.
6. Límite: menos de 60 líneas de instrucciones nuevas en `CLAUDE.md` en esta primera pasada. Lo demás se descubre con el tiempo, no se impone de golpe.

## OUTPUT
`CLAUDE.md` actualizado (no reemplazado) + `journal.md` inicializado con contexto real del repo.

## LÍMITES
- No reescribe stack, tests, ni configuración existente.
- No borra documentación previa del proyecto.
