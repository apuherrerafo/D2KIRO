"""PreToolUse (Edit|Write): protege `data/curated/` de ediciones no declaradas (ADR-003).

`data/curated/` es curación humana revisada. Un proceso de generación (o un ticket cuyo
trabajo es estadística/evaluación) no debe pisarlo en silencio.

Contrato (SPEC.md §15.4.7, ADR-003, TSK-194):
- Edit/Write sobre `data/curated/**` se **bloquea** salvo que el ticket en `state: doing`
  declare explícitamente un glob que cubra `data/curated/` en su `write_scope`.
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
    find_doing_ticket,
    is_repo_relative_posix,
    matches_any,
    parse_scope_list,
    read_frontmatter_field,
    read_target_path,
    to_repo_relative,
)

CURATED_PREFIX = "data/curated/"


def main() -> int:
    repo_root = Path(__file__).resolve().parents[2]
    target = read_target_path(sys.stdin.read())
    if not target:
        return 0

    rel = to_repo_relative(target, repo_root)

    # Fail-closed ante ambigüedad de normalización (requisito 1.3 c3, diseño §4.1 nota
    # de fail-safe): si `rel` no quedó en formato canónico repo-relative y el input
    # PODRÍA apuntar a `data/curated/`, se bloquea — nunca se deja pasar por no
    # reconocer el prefijo. No se amplía el bloqueo a rutas ambiguas ajenas a
    # `data/curated/`: esas siguen devolviendo 0 (no convertir cualquier error en DENY).
    if not is_repo_relative_posix(rel):
        if CURATED_PREFIX in target.replace("\\", "/"):
            sys.stderr.write(
                f"Bloqueado por data-boundary-guard (fail-closed): '{target}' no pudo "
                f"normalizarse a una ruta repo-relative inequívoca y referencia "
                f"'{CURATED_PREFIX}'. Ante la duda sobre un dato curado se deniega (ADR-003).\n"
            )
            return 2
        return 0  # ambigua pero sin relación con data/curated/

    if not rel.startswith(CURATED_PREFIX):
        return 0  # sólo nos importa data/curated/

    if os.environ.get("D2K_CURATE") == "1":
        return 0  # override humano explícito

    tasks_dir = Path(os.environ.get("D2K_TASKS_DIR") or (repo_root / "docs" / "agents" / "tasks"))
    ticket = find_doing_ticket(tasks_dir)
    if ticket is not None:
        globs = parse_scope_list(read_frontmatter_field(ticket, "write_scope"))
        curated_globs = [g for g in globs if g.startswith(CURATED_PREFIX) or g.startswith("data/curated")]
        if curated_globs and matches_any(rel, curated_globs):
            return 0  # el ticket lo autoriza explícitamente

    tid = ticket.stem if ticket is not None else "(ninguno)"
    sys.stderr.write(
        f"Bloqueado por data-boundary-guard: '{rel}' es curación humana (data/curated/, ADR-003).\n"
        f"  Ticket en doing: {tid}. Ningún write_scope declara data/curated/ para este cambio.\n"
        f"  Curar un dato es deliberado: hazlo desde un ticket que liste data/curated/... en write_scope,\n"
        f"  o exporta D2K_CURATE=1 si estás curando a mano fuera del flujo de tickets.\n"
    )
    return 2


if __name__ == "__main__":
    sys.exit(main())
