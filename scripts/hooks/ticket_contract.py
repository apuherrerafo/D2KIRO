"""Puerta del contrato de ficha (`_hook_lib`) para quien no es Python (TSK-263).

  ticket_contract.py check <tasks_dir>  fichas inválidas y WIP=1 por herramienta: una línea por violación, exit 1.
  ticket_contract.py list <tasks_dir>   JSON con todas las fichas (lo consume el tablero, scripts/hub.ts).
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _hook_lib import GuardBlocked, load_tickets  # noqa: E402


def main(argv: list[str]) -> int:
    if len(argv) != 2 or argv[0] not in ("check", "list"):
        sys.stderr.write("uso: ticket_contract.py check|list <tasks_dir>\n")
        return 2
    sys.stdout.reconfigure(encoding="utf-8", newline="\n")
    command, tasks_dir = argv[0], Path(argv[1])
    try:
        tickets = load_tickets(tasks_dir)
    except GuardBlocked as exc:
        # `check` lo cuenta como violación; `list` no debe devolver un tablero vacío creíble.
        print(exc, file=sys.stdout if command == "check" else sys.stderr)
        return 1
    name = lambda t: t.path.relative_to(tasks_dir).as_posix()  # noqa: E731
    if command == "list":
        print(json.dumps([
            {"file": name(t), "state": t.state, "wipTool": t.tool, "problem": t.problem, "fields": t.fields}
            for t in tickets
        ]))
        return 0
    errors = [f"{name(t)}: ficha inválida: {t.problem}" for t in tickets if t.problem]
    doing: dict[str, list[str]] = {}
    for t in tickets:
        if t.state == "doing":
            doing.setdefault(t.tool, []).append(name(t))
    errors += [
        f"{len(files)} tareas en 'doing' asignadas a '{tool}' ({', '.join(files)}). "
        "Máximo permitido: 1 por herramienta (regla WIP=1 por ejecutor)."
        for tool, files in sorted(doing.items()) if len(files) > 1
    ]
    for error in errors:
        print(error)
    return 1 if errors else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
