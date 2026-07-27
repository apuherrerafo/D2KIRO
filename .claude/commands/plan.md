---
description: Alias simple. Resuelve a /kickoff, /pre-flight o /blueprint según la fase actual en PROGRESS.md.
---

Antes de responder: lee `docs/agents/PROGRESS.md` para saber en qué fase está el proyecto.

- Si no hay brief/idea organizada todavía: sigue `.claude/skills/kickoff/SKILL.md`.
- Si ya hay brief pero faltan las preguntas de dominio/arquitectura/seguridad: sigue `.claude/skills/pre-flight/SKILL.md`.
- Si ya se respondieron los bloques de `/pre-flight` y toca sintetizar en una arquitectura: sigue `.claude/skills/blueprint/SKILL.md` (recuerda: aquí es donde se evalúa si corresponde usar Opus, ver `CLAUDE.md`).

Si no hay `PROGRESS.md` o no queda claro en qué fase se está, pregúntale directo al usuario antes de asumir.
