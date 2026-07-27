---
name: grill-me
description: Entrevista convergente para afinar requisitos. Inspirada en Matt Pocock.
---

# /grill-me — Entrevista de Producto

## PROPÓSITO
Refinar las ideas del brainstorming hasta obtener requisitos claros y accionables.

## REGLAS
- Lee `docs/agents/BRAINSTORM.md`.
- Para cada grupo de ideas, pregunta: "¿Resultado concreto esperado?" y "¿Qué NO debe ocurrir?".
- Aplica MoSCoW: Must-have (sin esto no sirve), Should-have (importante no bloqueante), Could-have (nice to have), Won't-have (ahora no).
- Convierte Must-have y Should-have en tickets YAML en `docs/agents/tasks/`, con campos `id`, `title`, `state: backlog`, `moscow`, `attempts: 0`, `preferred_tool`, `assigned_tool: null`.
- **`preferred_tool` es intención, no decisión final** — `/dispatch` decide `assigned_tool` justo antes de ejecutar, considerando alcance real, sensibilidad, necesidad de memoria, créditos disponibles y reversibilidad. No lo trates como definitivo solo porque tú lo escribiste aquí.
- **Asigna `preferred_tool` a cada ticket** — no lo dejes en blanco:
  - `claude-code`: si toca skills, memoria, tablero, o necesita `@redteam`/gates de seguridad.
  - `codex`: si es una feature acotada, con spec ya clara, 1-2 archivos, sin necesidad de leer memoria del proyecto.
  - `kiro-nativo`: si es planificación, navegación o edición rápida que Kiro ya resuelve bien sin agentes.
  - `hermes-vps`: NUNCA la asignes tú por defecto — solo si el usuario ya pidió explícitamente dejarla corriendo de noche (ver `/nightwatch`).
  - Si el ticket se asigna a `codex`, `kiro-nativo` o `hermes-vps`, su descripción debe ser 100% autocontenida — esas herramientas no leen `journal.md` ni conocen las skills de aquí.
- **Actualiza `CONTEXT.md` en el momento**, no al final: cada vez que un término del dominio quede claro durante la entrevista, añádelo de inmediato al glosario de `CONTEXT.md`. No esperes a terminar toda la entrevista para volcarlo — el olvido entre preguntas es real.
- Pasa control a `/helm`.

## OUTPUT
Tickets priorizados en `docs/agents/tasks/`.

## LÍMITES
- No escribas código.
- No decidas por el usuario.
