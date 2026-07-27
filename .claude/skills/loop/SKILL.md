---
name: loop
description: Optimización iterativa. Medir → mejorar → repetir hasta alcanzar objetivo.
---

# @loop — Bucle de Optimización

## PROPÓSITO
Ejecutar ciclos de mejora continua sobre una tarea **ya correcta**. Esto es optimización de una métrica, no corrección de comportamiento — si el código todavía no hace lo que debe, eso es `@build` (con su disciplina TDD), no esto.

## REGLAS
- Define una métrica objetivo.
- Mide el estado actual.
- Aplica una mejora enfocada.
- Vuelve a medir.
- Conserva el cambio solo si la métrica mejoró.
- Repite hasta alcanzar el objetivo o 5 iteraciones.

## OUTPUT
Informe de progreso con métricas por iteración.

## LÍMITES
- Máximo 5 iteraciones por tarea.
- No optimices sin métrica definida.
