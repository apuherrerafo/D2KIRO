# Evaluación de comportamiento — ciclo de coordinación (dispatch + helm + compass)

Base: `d86b8131` (`agent-ecosystem/phase1`). Fecha: 2026-11-23.

> **Unidad A (división de PR #171).** Registro de la rama original. `contracts.test.ts` y la sección «CICLO DE
> COORDINACIÓN» que se citan abajo llegan con la unidad B, apilada sobre la A.

**Alcance honesto.** `dispatch`, `helm` y `compass` son instrucciones en Markdown que sigue un
modelo; no hay un programa "dispatch" que ejecutar. Lo que sí se ejecuta de verdad, y lo que esta
evaluación mide, son los mecanismos que hacen cumplir el ciclo: el hook de escritura
(`pretooluse-edit-guard.sh` → `write-scope-guard.py`), el tablero (`scripts/hub.ts`) y el gate
(`scripts/verify-simplicity.sh`). Todos corren reales sobre fixtures en directorios temporales.
El juicio de un modelo (clasificar una petición ambigua, invocar a Tracer) **no** se mide aquí.

## Reproducir

```
bun test scripts/agents/orchestration-behavior.test.ts
```

## Matriz

| ID | Caso | Esperado | Resultado | Mecanismo real ejecutado |
|---|---|---|---|---|
| OB-1 | Tarea válida | Escribe dentro del `write_scope` y en su propio ticket; un ticket `codex` en `doing` no la encierra | PASS | hook de escritura |
| OB-2 | Tarea ambigua (2 tickets `claude-code` en `doing`) | Bloquea (exit 2) y nombra a ambos tickets | PASS | hook de escritura |
| OB-3 | Acción prohibida | Fuera del `write_scope` y fuera del worktree → exit 2 | PASS | hook de escritura |
| OB-4a | Gate en rojo | 2 `claude-code` en `doing` → `verify-simplicity.sh` sale 1 y nombra la herramienta | PASS | gate real |
| OB-4b | Gate en verde | 1 `claude-code` + 1 `codex` → exit 0 (no declara rojo de más) | PASS | gate real |
| OB-4c | Ticket `blocked`/`attempts: 3` | El tablero lo marca "necesita tu decisión" y muestra `intentos: 3`; una tarea sana no | PASS | `hub.ts` real |
| OB-5 | Defecto: WIP global | `claude-code` + `codex` en `doing` no genera alerta de WIP; dos de la misma herramienta sí | FAIL → corregido → PASS | `hub.ts` real |
| NT-1 | Petición ambigua → el modelo pregunta "¿Qué quieres hacer exactamente?" | — | NOT_TESTED (juicio del modelo) | — |
| NT-2 | `attempts: 3` → se invoca a Tracer con resumen sintético | — | NOT_TESTED (nada lo automatiza; el tablero sólo lo marca) | — |
| NT-3 | `@redteam` se detiene tras 3 rondas | — | NOT_TESTED | — |
| NT-4 | Sin merge/deploy sin autorización explícita | — | NOT_TESTED aquí (política de texto, ver `contracts.test.ts`) | — |
| NT-5 | `helm` regenera `plan.md`/`MEMORY.md`; `compass` actualiza `PROGRESS.md` | — | NOT_TESTED | — |

## Defecto encontrado (OB-5)

`scripts/hub.ts` contaba las tareas en `doing` de **todas** las herramientas juntas y mostraba
"WIP=N, debería ser máximo 1". La regla vigente (CLAUDE.md, `write-scope-guard`,
`verify-simplicity.sh` §3) es WIP=1 **por herramienta**. Con `claude-code` + `codex` en `doing`
(legal) el tablero avisaba en rojo de una violación inexistente.

- Reproducción: fixture con dos tickets `doing` (`claude-code`, `codex`) → `bun scripts/hub.ts` →
  `wip-alert: WIP=2, debería ser máximo 1`.
- Rojo → corrección → verde: la prueba OB-5 «no alerta con claude-code + codex» (la diferencial) falló antes del cambio (8 pass / 1 fail) y pasa después
  (9 pass / 0 fail). Es permanente.
- Corrección mínima: `hub.ts` cuenta `doing` por herramienta y nombra la que excede.

## Auto-corrección de la propia evaluación

La primera versión de OB-4c pasaba en vacío: buscaba `card-warn`/`card-needs-human`, nombres de
clase que salen siempre en el `<style>` de la página. Se reescribió contra el marcado de la tarjeta
(`🟡 necesita tu decisión`, `intentos: 3`) y se añadió un control negativo.

## Revisión independiente (`warden`, actor distinto del autor)

Veredicto inicial CHANGES, dos hallazgos aceptados y corregidos:
1. La aserción «sí alerta y nombra cuál» pasaba también con el hub viejo (vacía). Ahora exige el texto `WIP=2 en claude-code`, que el hub viejo no emite.
2. Sin `assigned_tool` el hub agrupaba por `preferred_tool` y el hook lo trata como `claude-code`. El hub ahora usa la regla del hook (prueba nueva). **Pendiente conocido, no tocado:** `verify-simplicity.sh` §3 sólo cuenta tickets con `assigned_tool` explícito, así que no ve ese caso.

## Ejecución real del flujo (TSK-252)

- `dispatch`, `helm` y `compass` se invocaron con la herramienta `Skill`: **cargaron instrucciones**, no ejecutaron nada por sí mismas; las decisiones las tomó la sesión siguiéndolas. Las skills cargadas son las de usuario (`~/.claude/skills`), que **no** traen la sección «CICLO DE COORDINACIÓN» de la copia del repo.
- `helm`: se leyó el estado de tickets (0 en `doing`, WIP libre). No se regeneró `plan.md` ni se corrió `hub.ts` como checkpoint. `compass`: se leyó `PROGRESS.md`; no se actualizó (no hubo interacción con el usuario que confirmara el avance de fase).
- Tarea elegida y cerrada: TSK-252 — el gate §3 de `verify-simplicity.sh` no veía tickets sin `assigned_tool` (pendiente de la sección anterior). Pruebas OB-6.
