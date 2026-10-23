"""PreToolUse (Edit|Write): protege `data/curated/` de ediciones no declaradas (ADR-003).

`data/curated/` es curación humana revisada. Un proceso de generación (o un ticket cuyo
trabajo es estadística/evaluación) no debe pisarlo en silencio.

Contrato (SPEC.md §15.4.7, ADR-003, TSK-194):
- La ruta se resuelve contra el worktree de la SESIÓN (`payload["cwd"]`), no contra la
  ubicación de este script. Una ruta de otro worktree, fuera de todo repo o ambigua se
  bloquea antes de llegar aquí (`resolve_edit_target`), haga o no referencia a data/curated/.
- Edit/Write sobre `data/curated/**` se **bloquea** salvo que el único ticket de Claude Code en
  `state: doing` de ese worktree declare explícitamente un glob que cubra `data/curated/`.
- Sin ticket en `doing`, o ticket sin `write_scope`: se bloquea igual (curar un dato es
  un acto deliberado, tiene que pasar por un ticket que lo diga).
- Escape para el humano fuera del flujo de tickets: `D2K_CURATE=1` en el entorno.
- Determinista, sin heurística de contenido. Exit 0 = permitir, Exit 2 = bloquear.
"""
from __future__ import annotations

import os
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

CURATED_PREFIX = "data/curated/"


def check(target: EditTarget) -> str | None:
    rel = target.rel
    if not rel.startswith(CURATED_PREFIX):
        return None  # sólo nos importa data/curated/

    if os.environ.get("D2K_CURATE") == "1":
        return None  # override humano explícito

    tickets = claude_doing_tickets(target.tasks_dir)
    if len(tickets) == 1:
        globs = parse_scope_list(read_frontmatter_field(tickets[0], "write_scope"))
        curated_globs = [g for g in globs if g.startswith(CURATED_PREFIX) or g.startswith("data/curated")]
        if curated_globs and matches_any(rel, curated_globs):
            return None  # el ticket lo autoriza explícitamente

    tid = ", ".join(t.stem for t in tickets) or "(ninguno)"
    return (
        f"Bloqueado por data-boundary-guard: '{rel}' es curación humana (data/curated/, ADR-003).\n"
        f"  Ticket en doing: {tid}. Ningún write_scope declara data/curated/ para este cambio.\n"
        f"  Curar un dato es deliberado: hazlo desde un ticket que liste data/curated/... en write_scope,\n"
        f"  o exporta D2K_CURATE=1 si estás curando a mano fuera del flujo de tickets.\n"
    )


def main() -> int:
    try:
        target = resolve_edit_target(parse_payload(read_stdin()))
        reason = check(target) if target is not None else None
    except GuardBlocked as exc:
        reason = f"Bloqueado por data-boundary-guard (fail-closed): {exc}.\n"
    if reason:
        sys.stderr.write(reason)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
