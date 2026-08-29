"""PreToolUse (Edit|Write): rechaza escrituras fuera del `write_scope` del ticket en `doing`.

Contrato (SPEC.md §15.4.7, TSK-194):
- `write_scope` ausente en el ticket -> no bloquea nada (retrocompatible con los 192
  tickets previos a Fase 9).
- 0 o >1 tickets en `state: doing` -> este hook no opina (WIP=1 lo cubre otro gate).
- Siempre permitido, aunque el ticket no lo liste: journal.md, PROGRESS.md, hub.html y
  el propio archivo del ticket (todo @build los toca).
- Exit 0 = permitir. Exit 2 = bloquear (con motivo en stderr).
"""
from __future__ import annotations

import os
import sys
from pathlib import Path

_LIB = Path(__file__).parent
sys.path.insert(0, str(_LIB))
from _hook_lib import (  # noqa: E402
    find_doing_ticket,
    matches_any,
    parse_scope_list,
    read_frontmatter_field,
    read_target_path,
    to_repo_relative,
)

ALWAYS_ALLOWED = {
    "docs/agents/journal.md",
    "docs/agents/PROGRESS.md",
    "docs/agents/hub.html",
    "docs/agents/ledger.md",
}


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    target = read_target_path(sys.stdin.read())
    if not target:
        return 0  # no es Edit/Write

    rel = to_repo_relative(target, repo_root)
    if rel in ALWAYS_ALLOWED:
        return 0

    tasks_dir = Path(os.environ.get("D2K_TASKS_DIR") or (repo_root / "docs" / "agents" / "tasks"))
    ticket = find_doing_ticket(tasks_dir)
    if ticket is None:
        return 0

    if rel == f"docs/agents/tasks/{ticket.name}":
        return 0

    raw_scope = read_frontmatter_field(ticket, "write_scope")
    globs = parse_scope_list(raw_scope)
    if not globs:
        return 0  # ticket sin write_scope declarado

    if matches_any(rel, globs):
        return 0

    tid = ticket.stem
    sys.stderr.write(
        f"Bloqueado por write-scope-guard: '{rel}' está fuera del write_scope de {tid}.\n"
        f"  write_scope: {raw_scope}\n"
        f"  Si el cambio es legítimo, amplía write_scope en {ticket.name} y vuelve a intentar.\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
