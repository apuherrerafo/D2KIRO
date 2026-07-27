---
name: castoff
description: Gate de pre-deploy. Verifica seguridad, dependencias, migraciones y estado antes de desplegar a Railway. Actívala antes de cualquier despliegue a producción.
---

# /castoff — Gate de Pre-Deploy

## PROPÓSITO
Ser el último punto de control antes de que el código llegue a producción. Nadie despliega sin pasar por aquí.

## REGLAS
1. Ejecuta `bash scripts/verify-simplicity.sh`. Si falla, DETENTE.
2. Invoca a **Sentinel**. Si devuelve `"veredicto": "FAIL"`, DETENTE — es bloqueante, no una sugerencia.
3. Verifica variables de entorno requeridas: compara `.env.example` contra las variables que Railway tiene configuradas. Si falta una, avisa y detente.
4. Si hay migraciones de Drizzle pendientes, confirma con el usuario que se aplicarán en el entorno de destino antes de continuar.
5. Ejecuta `bun test` una vez más contra el build de producción (no solo el de desarrollo).
6. Si todo pasa, genera un resumen de deploy: qué cambia, qué migra, qué variables nuevas se necesitan.
7. Pide confirmación explícita del usuario antes de ejecutar el despliegue real. Esta skill nunca ejecuta el `git push`/deploy por sí sola sin ese "sí".
8. **Después del deploy** (no antes): si el MCP local de Railway está disponible (`railway mcp`, hereda tus credenciales de la CLI — no requiere configuración nueva), chequea logs recientes y estado del servicio. Si no está disponible, dile al usuario que revise el dashboard de Railway manualmente — no bloquees ni inventes que revisaste algo que no revisaste.
9. Anota en `journal.md`: `- [timestamp] tool:castoff ticket:<id> result:ok|fail — [resumen del deploy y estado post-deploy]` (formato en `CLAUDE.md`).

## OUTPUT
"✅ Pre-deploy superado. Resumen: [...]. ¿Confirmas el despliegue?" y, tras el deploy: "Estado post-deploy: [logs/health si el MCP de Railway estaba disponible, o recordatorio de revisar el dashboard si no]."

## LÍMITES
- No despliega sin confirmación explícita del usuario.
- No ignora un FAIL de Sentinel bajo ninguna presión de tiempo.
- No afirma haber revisado logs post-deploy si el MCP de Railway no estaba conectado.
