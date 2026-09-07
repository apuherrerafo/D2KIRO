"""Utilidades compartidas por los hooks PreToolUse de Fase 9 (TSK-194).

Los hooks de Claude Code reciben un JSON por stdin con `tool_name` y `tool_input`.
Para Edit/Write, `tool_input.file_path` es el archivo objetivo. Estas funciones no
tienen efectos: parsean y deciden. El .sh que las llama traduce el retorno a exit code.
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path


def read_target_path(stdin_text: str) -> str:
    """Devuelve el file_path del tool_input, o "" si no aplica (no es Edit/Write)."""
    try:
        payload = json.loads(stdin_text)
    except Exception:
        return ""
    tool = payload.get("tool_name") or payload.get("tool") or ""
    if tool not in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        return ""
    ti = payload.get("tool_input") or {}
    return str(ti.get("file_path") or ti.get("notebook_path") or "")


def to_repo_relative(abs_or_rel: str, repo_root: Path) -> str:
    """Normaliza a una ruta relativa al repo con separador ``/``, idéntica en todo SO (CP6).

    Acepta rutas absolutas o relativas, con separador ``/`` o ``\\``. El resultado usa
    SIEMPRE ``/`` (formato canónico) y no depende del sistema operativo donde corre el
    hook: ``to_repo_relative(win_path) == to_repo_relative(posix_path)`` para el mismo
    input lógico.

    Si el input resuelve FUERA del repo (o no puede resolverse contra ``repo_root``),
    devuelve la mejor normalización POSIX posible pero NO garantiza que sea
    repo-relative. Los guards que necesitan un veredicto seguro deben comprobarlo con
    :func:`is_repo_relative_posix` y fallar cerrado ante la ambigüedad.
    """
    # Colapsar el separador de Windows ANTES de que pathlib lo interprete según el SO.
    normalized = abs_or_rel.replace("\\", "/")
    root = repo_root.resolve()
    candidate = Path(normalized)
    try:
        if not candidate.is_absolute():
            candidate = root / candidate
        # ``as_posix`` es el único stringificador independiente del SO: garantiza ``/``.
        return candidate.resolve().relative_to(root).as_posix()
    except Exception:
        # Fuera del repo o irresoluble. El separador ya viene colapsado a ``/``; sólo
        # quitamos el ``./`` inicial. No es repo-relative garantizado: es señal de
        # ambigüedad para el llamador.
        out = normalized
        while out.startswith("./"):
            out = out[2:]
        return out


def is_repo_relative_posix(path: str) -> bool:
    """``True`` sólo si ``path`` YA es una ruta canónica relativa al repo.

    Canónica = separador ``/``, sin componente ``..``, sin prefijo absoluto (``/`` o
    unidad ``C:``). Es el predicado con el que un guard decide si la normalización de
    :func:`to_repo_relative` fue inequívoca (CP6 / postura fail-closed, requisito 1.3).
    """
    if not path or "\\" in path or path.startswith("/"):
        return False
    if re.match(r"^[A-Za-z]:", path):
        return False
    return ".." not in path.split("/")


def glob_to_regex(glob: str) -> re.Pattern[str]:
    """Traduce un glob estilo .gitignore/tsconfig a regex anclado.

    `**` cruza directorios, `*` no cruza `/`. `a/**` matchea `a/x` y `a/x/y`.
    """
    g = glob.strip().strip("'\"")
    out = "^"
    i = 0
    while i < len(g):
        c = g[i]
        if g[i:i + 3] == "**/":
            out += "(?:.*/)?"
            i += 3
        elif g[i:i + 2] == "**":
            out += ".*"
            i += 2
        elif c == "*":
            out += "[^/]*"
            i += 1
        elif c == "?":
            out += "[^/]"
            i += 1
        elif c in ".()+|^$[]{}\\":
            out += "\\" + c
            i += 1
        else:
            out += c
            i += 1
    # `a/**` también debe matchear el propio `a`
    if g.endswith("/**"):
        base = glob_to_regex(g[:-3]).pattern[1:-1]
        return re.compile(f"(?:{out}$)|(?:^{base}$)")
    return re.compile(out + "$")


def parse_scope_list(raw: str) -> list[str]:
    """`write_scope: ["a/**", "b.ts"]` -> ['a/**', 'b.ts']. Tolera comillas simples."""
    raw = raw.strip()
    if not raw:
        return []
    try:
        val = json.loads(raw.replace("'", '"'))
        if isinstance(val, list):
            return [str(x) for x in val]
    except Exception:
        pass
    inner = raw.strip("[]")
    return [x.strip().strip("'\"") for x in inner.split(",") if x.strip()]


def matches_any(rel_path: str, globs: list[str]) -> bool:
    # Candado OS-independiente (CP6): `matches_any` opera SIEMPRE sobre el formato
    # canónico con `/`. Un separador de Windows aquí significa que la normalización
    # aguas arriba (`to_repo_relative`) falló — no comparamos en silencio contra un
    # resultado que en Ubuntu daría distinto.
    if "\\" in rel_path:
        raise ValueError(
            f"matches_any recibió una ruta sin normalizar (contiene '\\'): {rel_path!r}. "
            "Pasa el resultado de to_repo_relative, nunca una ruta cruda."
        )
    return any(glob_to_regex(g).match(rel_path) for g in globs)


def find_doing_ticket(tasks_dir: Path) -> Path | None:
    """El único ticket con `state: doing`. None si hay 0 o >1 (WIP=1 es otro gate)."""
    hits = [
        p for p in sorted(tasks_dir.glob("TSK-*.md"))
        if re.search(r"^state:\s*doing\s*$", p.read_text(encoding="utf-8"), re.M)
    ]
    return hits[0] if len(hits) == 1 else None


def read_frontmatter_field(ticket: Path, field: str) -> str:
    m = re.search(rf"^{re.escape(field)}:\s*(.*)$", ticket.read_text(encoding="utf-8"), re.M)
    return m.group(1).strip() if m else ""
