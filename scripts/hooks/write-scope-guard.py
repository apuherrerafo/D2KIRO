"""PreToolUse (Edit|Write): rechaza escrituras fuera del worktree de la sesión o del `write_scope`.

Contrato (SPEC.md §15.4.7, TSK-194; aislamiento entre worktrees):
- El worktree de la sesión sale de `payload["cwd"]`; los tickets se leen de ESE worktree. Un
  archivo de otro worktree, fuera de todo repo (salvo scratchpad/memoria) o dentro de `.git`
  se bloquea antes de mirar ningún ticket — nunca se evalúa contra el ticket de otro árbol.
- Contexto que no valida (sin `cwd`, payload ilegible, repo distinto) -> bloquea.
- `write_scope` ausente en el ticket -> no bloquea nada (retrocompatible con los 192
  tickets previos a Fase 9).
- 0 tickets en `doing` de Claude Code -> no bloquea. >1 y alguno declara `write_scope` -> no
  se sabe qué alcance autoriza -> bloquea. Tickets de otra `assigned_tool` no cuentan.
- Alguna ficha inválida (contrato en `_hook_lib`) -> bloquea; sólo se permite repararla (y lo de abajo).
- Siempre permitido, aunque el ticket no lo liste: journal.md, PROGRESS.md, hub.html,
  ledger.md (todo @build los toca).
- La ficha en `doing` se puede editar sin listarla, pero conservando su gobierno (`governance_problem`):
  mismo `write_scope`; si declara alcance, además sigue en `doing` y de Claude Code. Cambiar eso lo hace el
  propietario a mano, fuera de Claude Code.
- Exit 0 = permitir. Exit 2 = bloquear (con motivo en stderr).

Límite: control preventivo contra errores accidentales, NO frontera de seguridad. No ve escrituras por shell,
MCP u otros procesos. Lista completa en `docs/agents/CONTRIBUTING-tickets.md`.
"""
from __future__ import annotations

import sys
from pathlib import Path

_LIB = Path(__file__).parent
sys.path.insert(0, str(_LIB))
from _hook_lib import (  # noqa: E402
    EditTarget,
    GuardBlocked,
    governance_problem,
    invalid_tickets,
    load_tickets,
    matches_any,
    parse_payload,
    read_stdin,
    resolve_edit_target,
)

ALWAYS_ALLOWED = {
    "docs/agents/journal.md",
    "docs/agents/PROGRESS.md",
    "docs/agents/hub.html",
    "docs/agents/ledger.md",
}


def check(target: EditTarget, tool: str, tool_input: dict) -> str | None:
    """Motivo de bloqueo, o None si el archivo está dentro del alcance autorizado."""
    rel = target.rel
    if rel in ALWAYS_ALLOWED:
        return None

    broken = invalid_tickets(target.tasks_dir)
    if broken:
        names = {t.path.relative_to(target.tasks_dir).as_posix(): t.problem for t in broken}
        if rel in {f"docs/agents/tasks/{n}" for n in names}:
            return None  # repararla es la salida
        detail = "".join(f"  {n}: {problem}\n" for n, problem in names.items())
        return (
            f"Bloqueado por write-scope-guard: hay fichas inválidas y no se puede saber qué está en doing; "
            f"no se escribe '{rel}'.\n{detail}  Corrige la cabecera de esas fichas y vuelve a intentar.\n"
        )

    tickets = [t for t in load_tickets(target.tasks_dir) if t.state == "doing" and t.tool == "claude-code"]
    if not tickets:
        return None

    # La ficha propia se reconoce por su ruta completa bajo tasks/ (un homónimo en otra carpeta no lo es) o por ser
    # el mismo archivo (mayúsculas en Windows, enlaces). Va ANTES del alcance: un glob sobre tasks/ no la abre.
    path = target.session_root / rel
    for ticket in tickets:
        if rel == f"docs/agents/tasks/{ticket.path.relative_to(target.tasks_dir).as_posix()}" or (
            path.exists() and path.samefile(ticket.path)
        ):
            problem = governance_problem(ticket, tool, tool_input)
            if not problem:
                return None
            return (
                f"Bloqueado por write-scope-guard: la edición de la ficha en doing {ticket.path.name} "
                f"no se admite: {problem}.\n"
                f"  El cuerpo (## Estado) se puede editar. Cambiar write_scope, state o assigned_tool de una ficha\n"
                f"  con alcance lo hace el propietario a mano, fuera de Claude Code. No lo hagas por shell.\n"
            )

    scoped = [t for t in tickets if t.scope]
    if not scoped:
        return None  # ningún ticket declara write_scope

    if len(tickets) > 1:
        ids = ", ".join(t.path.stem for t in tickets)
        return (
            f"Bloqueado por write-scope-guard: hay {len(tickets)} tickets de Claude Code en doing ({ids}) "
            f"y al menos uno declara write_scope; no se puede saber cuál autoriza '{rel}'.\n"
            f"  Deja un solo ticket en doing en este worktree (WIP=1) y vuelve a intentar.\n"
        )

    ticket = scoped[0]
    if matches_any(rel, list(ticket.scope)):
        return None
    return (
        f"Bloqueado por write-scope-guard: '{rel}' está fuera del write_scope de {ticket.path.stem}.\n"
        f"  write_scope: {', '.join(ticket.scope)}\n"
        f"  Si el cambio es legítimo, pide al propietario que amplíe write_scope en {ticket.path.name}.\n"
    )


def main() -> int:
    try:
        payload = parse_payload(read_stdin())
        target = resolve_edit_target(payload)
        # `resolve_edit_target` sólo devuelve objetivo si es una herramienta de edición con `tool_input` válido.
        reason = check(target, payload["tool_name"], payload["tool_input"]) if target is not None else None
    except GuardBlocked as exc:
        reason = f"Bloqueado por write-scope-guard (fail-closed): {exc}.\n"
    if reason:
        sys.stderr.write(reason)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
