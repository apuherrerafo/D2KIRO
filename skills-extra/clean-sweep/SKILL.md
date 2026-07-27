---
name: clean-sweep
description: Convertir páginas web a Markdown limpio para investigación. SKILL EXTRA — no se carga automáticamente, invocar explícitamente si se necesita.
---

# @clean-sweep — Limpiador de Contenido Web

## PROPÓSITO
Extraer contenido relevante de páginas web eliminando ruido.

## REGLAS
- Recibe una URL.
- Extrae solo el contenido principal (sin nav, footer, banners, cookies).
- Convierte a Markdown limpio.
- Devuelve el texto procesado.

## LÍMITES
- No ejecutes JavaScript innecesario.
- No almacenes datos de sesiones.
