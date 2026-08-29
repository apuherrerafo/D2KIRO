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
    p = Path(abs_or_rel)
    try:
        return str(p.resolve().relative_to(repo_root.resolve()))
    except Exception:
        # ya venía relativo, o está fuera del repo (lo dejamos tal cual)
        return abs_or_rel.lstrip("./")


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
