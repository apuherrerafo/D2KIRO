"""Utilidades compartidas por los hooks PreToolUse (TSK-194, aislamiento entre worktrees).

Los hooks de Claude Code reciben un JSON por stdin con `tool_name`, `tool_input` y `cwd`
(el directorio de trabajo ACTUAL de la sesión). Contrato verificado contra Claude Code
2.1.270 (binario instalado, no la doc):

- Sólo exit 2 bloquea un PreToolUse. Cualquier otro código distinto de 0 (1, 127, ...) es
  "non-blocking": la herramienta se ejecuta igual. Por eso todo error de contexto se traduce
  a `GuardBlocked` -> exit 2 (fallo cerrado), nunca a una excepción sin capturar.
- `onFailure` NO existe para hooks en esta versión (sólo para `policyHelpers` de managed
  settings): el fallo cerrado tiene que vivir en el propio comando.
- `CLAUDE_PROJECT_DIR` es la raíz donde arrancó la sesión y NO sigue al worktree en el que
  se trabaja. Aquí sólo identifica a qué REPOSITORIO pertenece la sesión; el worktree de la
  sesión sale siempre de `payload["cwd"]`.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import tempfile
from dataclasses import dataclass
from pathlib import Path

EDIT_TOOLS = ("Edit", "Write", "MultiEdit", "NotebookEdit")


class GuardBlocked(Exception):
    """El guard no puede permitir la operación. El mensaje es el motivo legible (stderr)."""


# ---------- payload y rutas ----------

def read_stdin() -> str:
    """stdin del hook como UTF-8 (lo que envía Claude Code), sin depender del locale.

    En Windows el locale de Python es cp1252: un `file_path` con `ñ` o tildes llegaría
    corrompido y el guard evaluaría OTRA ruta. stderr también pasa a UTF-8 para el motivo.
    """
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    try:
        return sys.stdin.buffer.read().decode("utf-8")
    except UnicodeDecodeError:
        raise GuardBlocked("el payload del hook no es UTF-8 válido") from None


def parse_payload(stdin_text: str) -> dict:
    """El payload del hook como dict. Ilegible -> no se puede validar nada -> bloquea."""
    try:
        payload = json.loads(stdin_text)
    except Exception:
        raise GuardBlocked("el payload del hook no es JSON válido") from None
    if not isinstance(payload, dict):
        raise GuardBlocked("el payload del hook no es un objeto JSON")
    return payload


def native_path(raw: str, base: Path | None = None, msys: bool = False) -> Path:
    """Ruta absoluta y real (symlinks/junctions resueltos) tal como la interpretaría el SO.

    `msys=True` sólo para rutas escritas dentro de un comando de Git Bash (`cd /d/x`), donde
    el shell sí traduce `/d/...` a `D:/...`. Para `file_path` de Edit/Write NO se traduce:
    la herramienta lo resolvería como `<unidad actual>:\\d\\...`, y adivinar lo contrario
    abriría un hueco (el guard aprobaría una ruta y la escritura caería en otra).
    """
    text = raw.replace("\\", "/")
    if msys and os.name == "nt" and text.startswith("/") and not text.startswith("//"):
        m = re.match(r"^/([A-Za-z])(/.*)?$", text)
        if m:
            text = f"{m.group(1).upper()}:{m.group(2) or '/'}"
        else:  # /tmp, /usr, ... sólo cygpath sabe a dónde apuntan
            text = _cygpath(text)
    if text == "~" or text.startswith("~/"):
        text = str(Path.home()) + text[1:]
    path = Path(text)
    if not path.is_absolute():
        if base is None:
            raise GuardBlocked(f"ruta relativa sin directorio base: {raw!r}")
        path = base / path
    return Path(os.path.realpath(path))


def _cygpath(posix: str) -> str:
    try:
        out = subprocess.run(
            ["cygpath", "-m", posix], capture_output=True, encoding="utf-8", timeout=10,
        )
    except (OSError, subprocess.SubprocessError):
        out = None
    if out is None or out.returncode != 0 or not out.stdout.strip():
        raise GuardBlocked(f"no se pudo traducir la ruta MSYS {posix!r}")
    return out.stdout.strip()


def same_path(a: Path, b: Path) -> bool:
    return os.path.normcase(str(a)) == os.path.normcase(str(b))


def relative_inside(child: Path, root: Path) -> str | None:
    """`child` relativo a `root` en formato canónico `/`, o None si queda fuera."""
    try:
        rel = os.path.relpath(child, root)
    except ValueError:  # otra unidad en Windows
        return None
    rel = rel.replace("\\", "/")
    if rel == ".." or rel.startswith("../") or os.path.isabs(rel):
        return None
    return "" if rel == "." else rel


# ---------- git ----------

def _git(args: list[str], cwd: Path) -> subprocess.CompletedProcess[str]:
    # Un GIT_DIR/GIT_WORK_TREE heredado haría que git conteste por OTRO repositorio.
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    try:
        return subprocess.run(
            ["git", *args], cwd=cwd, env=env, capture_output=True, encoding="utf-8", timeout=20,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise GuardBlocked(f"no se pudo ejecutar git para validar el contexto: {exc}") from None


@dataclass(frozen=True)
class Location:
    kind: str  # "worktree" | "git-internal" | "outside"
    root: Path | None = None


def locate(path: Path) -> Location:
    """En qué worktree vive `path` (exista o no todavía): el del ancestro existente más cercano."""
    anc = path
    while not anc.exists():
        if anc.parent == anc:
            return Location("outside")
        anc = anc.parent
    if not anc.is_dir():
        anc = anc.parent
    top = _git(["rev-parse", "--show-toplevel"], anc)
    if top.returncode == 0 and top.stdout.strip():
        return Location("worktree", Path(os.path.realpath(top.stdout.strip())))
    if _git(["rev-parse", "--is-inside-git-dir"], anc).returncode == 0:
        return Location("git-internal")
    return Location("outside")


def common_dir(worktree: Path) -> Path:
    out = _git(["rev-parse", "--path-format=absolute", "--git-common-dir"], worktree)
    if out.returncode != 0 or not out.stdout.strip():
        raise GuardBlocked(f"no se pudo leer el repositorio de {worktree}")
    return Path(os.path.realpath(out.stdout.strip()))


def session_root(payload: dict) -> Path:
    """Toplevel del worktree donde opera la sesión AHORA (`cwd`), validado contra el proyecto.

    Falla cerrado si falta `cwd`, si no es un worktree git, si falta `CLAUDE_PROJECT_DIR`, o si
    el worktree de la sesión no pertenece al mismo repositorio que el proyecto de arranque.
    """
    cwd = payload.get("cwd")
    if not isinstance(cwd, str) or not cwd:
        raise GuardBlocked("el payload no trae 'cwd': no se puede saber en qué worktree opera la sesión")
    cwd_path = native_path(cwd)
    if not cwd_path.is_dir():
        raise GuardBlocked(f"el cwd de la sesión no existe: {cwd}")
    loc = locate(cwd_path)
    if loc.kind != "worktree" or loc.root is None:
        raise GuardBlocked(f"el cwd de la sesión no está dentro de un worktree git: {cwd}")
    project = os.environ.get("CLAUDE_PROJECT_DIR")
    if not project:
        raise GuardBlocked("CLAUDE_PROJECT_DIR no está definido: no se puede validar el repositorio")
    project_loc = locate(native_path(project))
    if project_loc.kind != "worktree" or project_loc.root is None:
        raise GuardBlocked(f"CLAUDE_PROJECT_DIR no es un worktree git: {project}")
    if not same_path(common_dir(loc.root), common_dir(project_loc.root)):
        raise GuardBlocked(
            f"el worktree de la sesión ({loc.root}) no pertenece al repositorio del proyecto ({project_loc.root})"
        )
    return loc.root


# ---------- objetivo de Edit/Write ----------

@dataclass(frozen=True)
class EditTarget:
    session_root: Path
    rel: str  # repo-relative canónico, siempre con `/`
    tasks_dir: Path


def external_write_allowed(target: Path) -> bool:
    """Escrituras FUERA de todo repositorio que la sesión necesita: scratchpad y memoria.

    Sólo se consulta cuando `target` no vive en ningún worktree — un worktree dentro del
    scratchpad sigue siendo un worktree y pasa por la comparación con el de la sesión.
    """
    scratch = Path(os.path.realpath(Path(tempfile.gettempdir()) / "claude"))
    if relative_inside(target, scratch):
        return True
    claude_home = Path(os.path.realpath(Path.home() / ".claude"))
    rel = relative_inside(target, claude_home)
    if not rel:
        return False
    parts = rel.split("/")
    if parts[0] == "plans" and len(parts) >= 2:
        return True
    return parts[0] == "projects" and len(parts) >= 4 and parts[2] == "memory"


def resolve_edit_target(payload: dict) -> EditTarget | None:
    """None = no hay nada que custodiar (no es Edit/Write, o escritura externa permitida).

    Lanza `GuardBlocked` si el archivo cae en otro worktree, en el directorio interno de git,
    fuera de todo repositorio (y fuera de la lista permitida), o si el contexto no valida.
    """
    tool = payload.get("tool_name") or ""
    if tool not in EDIT_TOOLS:
        return None
    ti = payload.get("tool_input")
    raw = ""
    if isinstance(ti, dict):
        raw = str(ti.get("file_path") or ti.get("notebook_path") or "")
    if not raw:
        raise GuardBlocked(f"{tool} sin file_path: no se puede validar el archivo objetivo")

    cwd = payload.get("cwd")
    base = native_path(cwd) if isinstance(cwd, str) and cwd else None
    target = native_path(raw, base)
    loc = locate(target)
    if loc.kind == "outside":
        if external_write_allowed(target):
            return None
        raise GuardBlocked(f"'{raw}' está fuera de todo worktree del proyecto")
    if loc.kind == "git-internal" or loc.root is None:
        raise GuardBlocked(f"'{raw}' está dentro del directorio interno de git")

    root = session_root(payload)
    if not same_path(loc.root, root):
        raise GuardBlocked(
            f"'{raw}' pertenece a otro worktree ({loc.root}); la sesión opera en {root}. "
            "Trabaja ese cambio desde una sesión abierta en ese worktree"
        )
    rel = relative_inside(target, root)
    if not rel or rel == ".git" or rel.startswith(".git/"):
        raise GuardBlocked(f"'{raw}' no es un archivo editable del worktree")
    tasks_dir = Path(os.environ.get("D2K_TASKS_DIR") or (root / "docs" / "agents" / "tasks"))
    return EditTarget(root, rel, tasks_dir)


# ---------- normalización (CP6) ----------

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


# ---------- tickets ----------

def _ticket_text(ticket: Path) -> str:
    try:
        return ticket.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise GuardBlocked(f"no se pudo leer el ticket {ticket.name}: {exc}") from None


def claude_doing_tickets(tasks_dir: Path) -> list[Path]:
    """Tickets en `state: doing` que gobiernan a ESTA sesión, leídos del worktree de la sesión.

    Un ticket con `assigned_tool` de otra herramienta (codex, kiro-nativo, hermes-vps) no
    encierra a Claude Code: WIP=1 es por herramienta. Sin `assigned_tool` -> aplica.
    """
    hits = []
    for p in sorted(tasks_dir.glob("TSK-*.md")):
        text = _ticket_text(p)
        if not re.search(r"^state:\s*doing\s*$", text, re.M):
            continue
        tool = re.search(r"^assigned_tool:\s*(.*)$", text, re.M)
        if tool and tool.group(1).strip().strip("'\"") not in ("", "claude-code"):
            continue
        hits.append(p)
    return hits


def read_frontmatter_field(ticket: Path, field: str) -> str:
    m = re.search(rf"^{re.escape(field)}:\s*(.*)$", _ticket_text(ticket), re.M)
    return m.group(1).strip() if m else ""
