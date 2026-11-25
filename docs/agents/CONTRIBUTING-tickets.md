# Cómo se escribe un ticket (frontmatter + `write_scope` + paralelismo)

Fuente: `SPEC.md` §15.4.7–§15.4.8, ADR-003. Aplica a todo ticket creado desde Fase 9.

## Frontmatter

```yaml
---
id: TSK-NNN
title: "..."
state: backlog          # backlog | ready | doing | blocked | done
moscow: must            # must | should | could
attempts: 0
preferred_tool: claude-code   # intención al crearlo (/grill-me, /rulebook)
assigned_tool: null           # decisión real (/dispatch) — null hasta que se despache
created_at: YYYY-MM-DD
write_scope: ["glob/**", "archivo.ts"]   # opcional; ver abajo
blocked_by: ["TSK-XXX"]                    # opcional
implements: ["R1-2", "R3-13"]              # opcional; IDs de docs/research/ que este ticket entrega
---
```

**Claves admitidas:** las del ejemplo más `spec`, `spec_section`, `simplicity_exception` y `exception_reason`
(`TICKET_KEYS` en `scripts/hooks/_hook_lib.py`). Cualquier otra clave, o una línea indentada que no sea texto de un
bloque (`>`, `|`) ni un elemento simple de lista, invalida la ficha. Añadir una clave es un cambio de ese archivo.

Si `docs/agents/tasks/` falta o no se puede recorrer entera, el hook y el gate bloquean (vacía es válida). Se
restaura desde git; el hook no permite recrearla con `Edit`/`Write`.

## `write_scope`

Lista de globs. Declara **qué archivos puede tocar** el ticket mientras está en `doing`.

- **Ausente** → sin restricción (retrocompatible con los tickets previos a Fase 9).
- **Presente** → el hook `PreToolUse` (`scripts/hooks/pretooluse-edit-guard.sh`) rechaza cualquier
  `Edit`/`Write` fuera de esos globs. Siempre permitidos sin declararlos: `docs/agents/journal.md`,
  `docs/agents/PROGRESS.md`, `docs/agents/hub.html` y `docs/agents/ledger.md`.
- **Ficha en `doing`**: su cuerpo (`## Estado`) se puede editar con `Edit`/`Write`, pero no su `write_scope`. Si
  declara alcance, tampoco su `state` ni su `assigned_tool`: ampliar, cerrar o bloquear esa ficha lo hace el
  **propietario a mano, fuera de Claude Code**.
- **Forma**: una sola declaración, en una línea de la cabecera, con una lista no vacía de globs entre comillas.
  Repetida, en varias líneas, vacía, mal escrita, indentada o escrita en la columna 0 del cuerpo → la ficha es
  inválida y el hook bloquea hasta que se repare.
- Sintaxis de glob: `*` no cruza `/`, `**` sí. `a/**` cubre `a/x` y `a/x/y`.
- `data/curated/**` sólo se puede tocar si el `write_scope` lo lista **explícitamente** (ADR-003).
  Curación a mano fuera de un ticket: `D2K_CURATE=1` en el entorno.

Si un cambio legítimo cae fuera del scope, **el propietario amplía el `write_scope` del ticket** y se
reintenta — nunca se saltea el hook.

### Qué es y qué no es (decisión del propietario, TSK-268)

`write_scope` es un **control preventivo contra errores accidentales**. **No es una frontera de seguridad** frente a
un proceso malicioso o un agente que decida rodearlo.

**Impide**, en una sesión de Claude Code que cargue este hook, que `Edit`/`Write`/`MultiEdit`/`NotebookEdit`:
escriban fuera del alcance de la ficha en `doing`, en otro worktree o en `.git`; trabajen con fichas inválidas
(salvo repararlas); o cambien el gobierno de la ficha en `doing`.

**No impide:**

- escrituras por `Bash`/`PowerShell` (incluida la propia ficha), herramientas MCP, ni procesos que lancen tests o
  scripts;
- nada de lo que hagan otras herramientas, un editor o una sesión sin este hook. El hook se carga desde la carpeta
  del proyecto de la sesión: un checkout viejo aplica la versión vieja;
- nada cuando no hay ficha en `doing` o la ficha no declara alcance (salvo darse alcance a sí misma). Se puede crear
  o activar otra ficha con cualquier alcance, incluido `data/curated/**`;
- reescribir con cualquier alcance una ficha que **ya** está inválida (la reparación no tiene valor anterior fiable);
- desactivar el propio control si el alcance incluye `scripts/hooks/**` o `.claude/settings*.json`, o si la sesión se
  lanza con `D2K_TASKS_DIR` o `D2K_CURATE` definidos.

## Paralelismo y `isolation: worktree`

Dos tickets se pueden ejecutar **en paralelo** si y sólo si:

1. `writeScope(A) ∩ writeScope(B) = ∅` (ningún glob de A se solapa con uno de B), **y**
2. ninguno declara al otro (ni transitivamente) en `blocked_by`.

El ticket que se ejecuta en paralelo con otro corre con `isolation: worktree` (árbol de trabajo
propio). Un ticket que corre solo no lo necesita — el worktree es la respuesta a la concurrencia,
no una ceremonia por defecto.

**WIP=1 por `assigned_tool` sigue vigente** y no se relaja: el worktree habilita paralelismo entre
herramientas distintas (p. ej. Claude Code + Codex a la vez), nunca dos tareas simultáneas de la
misma herramienta.

## Ejemplo real (Fase 9.0, bloque B)

`TSK-197` (`scripts/eval/replay.ts`), `TSK-198` (`scripts/eval/metrics.ts`) y `TSK-199`
(`scripts/eval/golden.ts`) tienen `write_scope` disjuntos y ningún `blocked_by` entre sí → los tres
son paralelizables, cada uno en su worktree.
