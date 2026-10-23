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
- Siempre permitido, aunque el ticket no lo liste: journal.md, PROGRESS.md, hub.html,
  ledger.md y el propio archivo del ticket (todo @build los toca).
- Exit 0 = permitir. Exit 2 = bloquear (con motivo en stderr).
"""
from __future__ import annotations

import sys
from pathlib import Path

_LIB = Path(__file__).parent
sys.path.insert(0, str(_LIB))
from _hook_lib import (  # noqa: E402
    EditTarget,
    GuardBlocked,
    claude_doing_tickets,
    matches_any,
    parse_payload,
    parse_scope_list,
    read_frontmatter_field,
    read_stdin,
    resolve_edit_target,
)

ALWAYS_ALLOWED = {
    "docs/agents/journal.md",
    "docs/agents/PROGRESS.md",
    "docs/agents/hub.html",
    "docs/agents/ledger.md",
}


def check(target: EditTarget) -> str | None:
    """Motivo de bloqueo, o None si el archivo está dentro del alcance autorizado."""
    rel = target.rel
    if rel in ALWAYS_ALLOWED:
        return None

    tickets = claude_doing_tickets(target.tasks_dir)
    if not tickets:
        return None
    if rel in {f"docs/agents/tasks/{t.name}" for t in tickets}:
        return None

    scoped = [(t, read_frontmatter_field(t, "write_scope")) for t in tickets]
    scoped = [(t, raw) for t, raw in scoped if parse_scope_list(raw)]
    if not scoped:
        return None  # ningún ticket declara write_scope

    if len(tickets) > 1:
        ids = ", ".join(t.stem for t in tickets)
        return (
            f"Bloqueado por write-scope-guard: hay {len(tickets)} tickets de Claude Code en doing ({ids}) "
            f"y al menos uno declara write_scope; no se puede saber cuál autoriza '{rel}'.\n"
            f"  Deja un solo ticket en doing en este worktree (WIP=1) y vuelve a intentar.\n"
        )

    ticket, raw_scope = scoped[0]
    if matches_any(rel, parse_scope_list(raw_scope)):
        return None
    return (
        f"Bloqueado por write-scope-guard: '{rel}' está fuera del write_scope de {ticket.stem}.\n"
        f"  write_scope: {raw_scope}\n"
        f"  Si el cambio es legítimo, amplía write_scope en {ticket.name} y vuelve a intentar.\n"
    )


def main() -> int:
    try:
        target = resolve_edit_target(parse_payload(read_stdin()))
        reason = check(target) if target is not None else None
    except GuardBlocked as exc:
        reason = f"Bloqueado por write-scope-guard (fail-closed): {exc}.\n"
    if reason:
        sys.stderr.write(reason)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
