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

## `write_scope`

Lista de globs. Declara **qué archivos puede tocar** el ticket mientras está en `doing`.

- **Ausente** → sin restricción (retrocompatible con los tickets previos a Fase 9).
- **Presente** → el hook `PreToolUse` (`scripts/hooks/pretooluse-edit-guard.sh`) rechaza cualquier
  `Edit`/`Write` fuera de esos globs. Siempre permitidos sin declararlos: `docs/agents/journal.md`,
  `docs/agents/PROGRESS.md`, `docs/agents/hub.html`, `docs/agents/ledger.md` y el propio
  `docs/agents/tasks/TSK-NNN.md`.
- Sintaxis de glob: `*` no cruza `/`, `**` sí. `a/**` cubre `a/x` y `a/x/y`.
- `data/curated/**` sólo se puede tocar si el `write_scope` lo lista **explícitamente** (ADR-003).
  Curación a mano fuera de un ticket: `D2K_CURATE=1` en el entorno.

Si un cambio legítimo cae fuera del scope, se **amplía el `write_scope` del ticket** y se reintenta
— nunca se saltea el hook.

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
