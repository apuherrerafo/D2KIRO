---
name: shipcheck
description: Script verificador + code review + commit + traducción a producto.
allowed-tools: "Read Bash(bash scripts/verify-simplicity.sh) Bash(bun scripts/hub.ts)"
---

# @shipcheck — Verificación y Cierre

## PROPÓSITO
Validar que el código cumple todas las reglas antes de cerrar la tarea.

## REGLAS
- Ejecuta `bash scripts/verify-simplicity.sh`. Incluye ahora: archivos, líneas, dependencias, secretos y WIP=1.
- Revisa: ¿funciones innecesarias? ¿dependencias sin permiso?
- **Auditoría de impacto de documentación (obligatoria, no opcional)**: genera esta tabla en la entrada del `journal.md` correspondiente a la tarea. Si hay una fila con la columna "Documento Técnico" vacía, la tarea NO se cierra hasta llenarla.

  | Componente de Código | Concepto de Negocio Afectado | Documento Técnico Actualizado |
  |---|---|---|
  | `src/archivo.ts` | [qué decisión de negocio toca] | `CLAUDE.md § ...` / `SPEC.md § ...` |

- Regenera el tablero: `bun scripts/hub.ts`.
- Genera mensaje de commit descriptivo.
- Traduce el cambio a lenguaje producto.
- Anota en `journal.md`: `- [timestamp] tool:shipcheck ticket:<id> result:ok` (formato en `CLAUDE.md`), para que el HUB cuente esta tarea como cerrada de verdad.
- Si pasó por `@redteam`, incluye: "✅ Revisión crítica superada en [N] rondas (Standards + Spec). Gate de seguridad: PASS."

## OUTPUT
"✅ Tarea TSK-XXX verificada y lista para commit."

## LÍMITES
- Si el script falla, NO cierres la tarea.
