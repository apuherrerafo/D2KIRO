---
name: gear-up
description: Elegir stack mínimo verificando vigencia con Context7.
---

# /gear-up — Stack Mínimo

## PROPÓSITO
Definir el stack tecnológico del proyecto con verificación de vigencia.

## REGLAS
- Prioriza el stack por defecto: Bun + HTMX + SQLite + Drizzle.
- Pregunta: "¿Interfaz web o solo lógica?"
- Solo si el proyecto lo justifica, evalúa alternativas consultando `docs/guides/frameworks.md`.
- Verifica la vigencia de cada dependencia con Context7 MCP.
- Propón máximo 2 opciones (A: mínima, B: alternativa justificada).
- Toda dependencia nueva pasa después por `@depcheck` antes de instalarse.

## OUTPUT
Stack definido y documentado en `CONTEXT.md`.

## LÍMITES
- Prohibido sugerir más de 2 frameworks nuevos.
- Prohibido instalar dependencias sin confirmación del usuario.
