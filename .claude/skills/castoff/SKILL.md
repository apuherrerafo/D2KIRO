---
name: castoff
description: Gate de pre-deploy. Verifica seguridad, dependencias, migraciones y estado antes de desplegar a Railway. Actívala antes de cualquier despliegue a producción.
---

# /castoff — Gate de Pre-Deploy

## PROPÓSITO
Ser el último punto de control antes de que el código llegue a producción. Nadie despliega sin pasar por aquí.

## REGLAS
1. Invoca a **Sentinel** una sola vez, con el paquete de evidencia de `/dispatch` (no ejecuta nada por su cuenta). Si su veredicto es distinto de `"PASS"` (`FAIL`, `BLOCKED` o `NOT_VERIFIED`), DETENTE — es bloqueante, no una sugerencia. Si pidió evidencia, prodúcela y vuelve a invocarlo. Es un revisor **consultivo**: puede frenar el deploy, pero su `PASS` no certifica quién revisó ni cuánto leyó, y no habilita nada por sí mismo.
2. **Decide con el decisor, no a ojo**: con todo confirmado y tras `git fetch`, corre en Git Bash `bun scripts/agents/delivery-verdict.ts "$(git rev-parse HEAD)"` (tarda varios minutos). Ejecuta él mismo `test`, los dos `tsc`, `lint` y `simplicity`, y exige árbol limpio antes y después, que el HEAD contenga la punta publicada de `release/mvp-beta` y que el cambio no toque la definición de esas comprobaciones (el decisor, `scripts/verify-*.sh`, `package.json`, `tsconfig*.json`, ESLint, `bunfig.toml`). Si no, el resultado es `NOT_READY` aunque Sentinel haya dado `PASS`: DETENTE y repórtalo con sus motivos; nunca escribas «listo» sin que devuelva `READY` (código de salida 0).
   - `READY` es una comprobación **local**: no autoriza merge ni deploy. La integración la autorizan los checks de CI y la revisión independiente (`independent-review`) de la rama base.
   - Un cambio que toca la definición de las comprobaciones siempre da `NOT_READY` aquí: se informa tal cual y decide el propietario con CI y la revisión independiente. No lo rodees ni lo presentes como listo.
3. Verifica variables de entorno requeridas: compara `.env.example` contra las variables que Railway tiene configuradas. Si falta una, avisa y detente.
4. Si hay migraciones de Drizzle pendientes, confirma con el usuario que se aplicarán en el entorno de destino antes de continuar.
5. Si todo pasa, genera un resumen de deploy: qué cambia, qué migra, qué variables nuevas se necesitan.
6. Pide confirmación explícita del usuario antes de ejecutar el despliegue real. Esta skill nunca ejecuta el `git push`/deploy por sí sola sin ese "sí".
7. **Después del deploy** (no antes): si el MCP local de Railway está disponible (`railway mcp`, hereda tus credenciales de la CLI — no requiere configuración nueva), chequea logs recientes y estado del servicio. Si no está disponible, dile al usuario que revise el dashboard de Railway manualmente — no bloquees ni inventes que revisaste algo que no revisaste.
8. Anota en `journal.md`: `- [timestamp] tool:castoff ticket:<id> result:ok|fail — [resumen del deploy y estado post-deploy]` (formato en `CLAUDE.md`).

## OUTPUT
"✅ Pre-deploy superado. Resumen: [...]. ¿Confirmas el despliegue?" y, tras el deploy: "Estado post-deploy: [logs/health si el MCP de Railway estaba disponible, o recordatorio de revisar el dashboard si no]."

## LÍMITES
- No despliega sin confirmación explícita del usuario.
- No ignora un veredicto de Sentinel distinto de PASS bajo ninguna presión de tiempo.
- No afirma haber revisado logs post-deploy si el MCP de Railway no estaba conectado.
