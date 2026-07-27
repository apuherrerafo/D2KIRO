---
name: blueprint
description: Convierte las decisiones de /pre-flight en una especificación formal.
---

# /blueprint — Especificación Formal

## NOTA DE MODELO
Esta es la ÚNICA llamada cara de todo el ecosistema — no la tercera. `/kickoff` y `/pre-flight` corren en Sonnet porque solo recolectan información; aquí, y solo aquí, se sintetiza todo eso en una arquitectura coherente de una sola vez. Antes de empezar, confirma con el usuario: "Ya tengo todo lo necesario (brief + respuestas de /pre-flight) — este es el momento de cambiar a Opus, una sola vez, y no lo volveremos a usar después de esta fase." Todo lo que siga (`/rulebook` en adelante) corre en Sonnet sin excepción.

## PROPÓSITO
Transformar `architecture.md` en una especificación detallada que sirva como contrato para el desarrollo.

## REGLAS
- Lee `docs/agents/architecture.md`.
- Para cada componente, define: comportamiento esperado, entradas y salidas, estados y transiciones, manejo de errores.
- **Define las costuras (seams) antes que el comportamiento**: ¿en qué punto exacto se va a probar este componente? ¿qué se mockea y qué es real? Si no puedes señalar la costura, la interfaz del componente probablemente está mal definida — arréglala antes de seguir documentando.
- Documenta las APIs y contratos de datos.
- Especifica restricciones de rendimiento y seguridad (hereda el Bloque 4 de `/pre-flight`: límites de confianza, validación de inputs, sanitización, gestión de secretos).

Al generar `architecture.md`/`SPEC.md`, invoca `/compass` para registrar que la fase cara de Opus ya terminó y el siguiente paso es Sonnet — no lo escribas tú mismo.

## OUTPUT
Genera `docs/specs/SPEC.md`.

## LÍMITES
- Solo documenta lo acordado. No añadas funcionalidades no solicitadas.
- Si hay ambigüedad, pregunta antes de documentar.
