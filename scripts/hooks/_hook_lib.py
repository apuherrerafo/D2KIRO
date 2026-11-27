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
# CONTRATO ÚNICO de ficha (TSK-263). Lo usan el hook (importando este módulo), el gate y el tablero
# (a través de `ticket_contract.py`): si el contrato cambia, cambia aquí. (`scripts/sync-context.ts` mira
# fichas por su cuenta sólo para avisar; no decide permisos, WIP ni tablero.)
#
# - Cabecera: la primera línea (tras un BOM opcional) es `---` y la cierra la primera línea `---` siguiente.
# - Cada línea de la cabecera es `clave:` (columna 0) o una continuación indentada de la anterior. Sin líneas
#   en blanco, comentarios sueltos ni texto: así una ficha sin cierre no toma una raya `---` del cuerpo.
# - `state`: exactamente una clave, en la cabecera, con su valor en la misma línea y dentro de `STATES`.
#   El cuerpo nunca aporta estado ni permisos.
# - Claves: sólo las de `TICKET_KEYS`. Una continuación indentada sólo vale como texto de un bloque (`>`, `|`) o como
#   elemento escalar de una lista bajo una clave sin valor. Clave desconocida o continuación de otra forma: INVÁLIDA.
# - Una línea del cuerpo en la columna 0 que declare `write_scope`: INVÁLIDA (no concede ni se ignora en silencio).
# - Todo esto es un control preventivo contra errores, no una frontera frente a un proceso malicioso
#   (límites en `docs/agents/CONTRIBUTING-tickets.md`).
# - Cabecera ausente, vacía, sin cierre o con otra línea, `state` ausente, repetido, multilínea o desconocido: ficha
#   INVÁLIDA. No se adivina qué quiso decir; cada consumidor la rechaza.
# - `write_scope`: ausente, o UNA declaración en una línea con una lista no vacía de globs entre comillas. La clave
#   admite comillas y espacio antes de `:` (como `state`). Repetido, multilínea, vacío, otra forma de valor o una clave
#   parecida mal escrita o indentada: ficha INVÁLIDA. Nunca se interpreta como "sin alcance".
# - `assigned_tool`: ambiguo (ausente, repetido, en bloque) o no reconocido = claude-code. Un valor en línea seguido
#   de una continuación suelta invalida la ficha (TSK-268).
# - Carpeta de fichas inexistente o que no se puede recorrer entera: `GuardBlocked` (nunca "cero fichas").

STATES = ("backlog", "ready", "doing", "review", "blocked", "done")
_BOM = chr(0xFEFF)  # BOM de editor: se tolera al inicio de la ficha
# Herramientas que NO son Claude Code. Lista cerrada: lo que no esté aquí gobierna a Claude (TSK-256).
OTHER_TOOLS = frozenset({"codex", "kiro-nativo", "hermes-vps"})
_DELIMITER = re.compile(r"---[ \t]*")
_KEY_LINE = re.compile(r"""(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1[ \t]*:(.*)""")
# Lista cerrada: las claves que usan las fichas reales. Una clave nueva se añade aquí, a propósito.
TICKET_KEYS = frozenset({
    "id", "title", "state", "moscow", "attempts", "preferred_tool", "assigned_tool", "created_at", "write_scope",
    "blocked_by", "implements", "spec", "spec_section", "simplicity_exception", "exception_reason",
})
_BLOCK_SCALAR = re.compile(r"[>|][+-]?[0-9]?[+-]?(?:[ \t]+#.*)?")
_LIST_ITEM = re.compile(r"[ \t]+-[ \t]+(?!.*:(?:[ \t]|$)).*")  # elemento escalar: sin `clave:` dentro
_BODY_SCOPE = re.compile(r"""["']?write[-_]?scopes?["']?[ \t]*:""", re.IGNORECASE)


# Cualquier línea que pretenda declarar `write_scope`, esté bien escrita o no.
_SCOPE_LOOKALIKE = re.compile(r"""[ \t]*(?:-[ \t]+)?["']?write[-_]?scopes?["']?[ \t]*:""", re.IGNORECASE)


@dataclass(frozen=True)
class Ticket:
    path: Path
    fields: dict  # claves de primer nivel de la cabecera, valor sin comillas (para mostrar)
    state: str  # uno de STATES; "" si la ficha es inválida
    tool: str  # "claude-code" o una de OTHER_TOOLS
    problem: str  # "" si la ficha es válida
    scope: tuple[str, ...] = ()  # globs de `write_scope`; vacío = no declara


def frontmatter_lines(text: str) -> list[str] | None:
    """Líneas de la cabecera, o None si no abre en la primera línea o no cierra."""
    lines = [line.rstrip("\r") for line in text.lstrip(_BOM).split("\n")]
    if not _DELIMITER.fullmatch(lines[0]):
        return None
    for i in range(1, len(lines)):
        if _DELIMITER.fullmatch(lines[i]):
            return lines[1:i]
    return None


def _unquote(value: str) -> str:
    if len(value) >= 2 and value[0] == value[-1] and value[0] in "'\"":
        return value[1:-1]
    return value


def _key_values(lines: list[str], key: str) -> list[tuple[str, bool]]:
    """(valor crudo, ¿continúa en la línea siguiente?) por cada aparición de `key` en la columna 0."""
    pattern = re.compile(rf"""(?:{key}|"{key}"|'{key}')[ \t]*:(.*)""")
    found = []
    for i, line in enumerate(lines):
        match = pattern.fullmatch(line)
        if not match:
            continue
        continues = i + 1 < len(lines) and lines[i + 1].startswith((" ", "\t"))
        found.append((match.group(1).strip(), continues))
    return found


def _parse_write_scope(lines: list[str]) -> tuple[tuple[str, ...], str]:
    """(globs, problema). Sin declaración -> ((), "")."""
    found = _key_values(lines, "write_scope")
    if sum(1 for line in lines if _SCOPE_LOOKALIKE.match(line)) != len(found):
        return (), "clave parecida a 'write_scope' mal escrita o indentada"
    if not found:
        return (), ""
    if len(found) > 1:
        return (), "'write_scope' repetido"
    raw, continues = found[0]
    if continues:
        return (), "'write_scope' ocupa más de una línea"
    for candidate in (raw, raw.replace("'", '"')):  # se toleran globs entre comillas simples
        try:
            value, end = json.JSONDecoder().raw_decode(candidate)
        except ValueError:
            continue
        if (
            re.fullmatch(r"(?:[ \t]+#.*)?", candidate[end:])
            and isinstance(value, list)
            and value
            and all(isinstance(glob, str) and glob.strip() for glob in value)
        ):
            return tuple(value), ""
        break
    return (), f"'write_scope' no es una lista no vacía de globs en una línea: {raw!r}"


def _key_problem(lines: list[str]) -> str:
    """Primera clave desconocida o continuación no admitida, o "". `lines` ya pasó el chequeo estructural."""
    block = ""  # qué continuación admite la clave abierta: "text", "list" o ninguna
    for i, line in enumerate(lines):
        if line.startswith((" ", "\t")):
            if block == "text" or (block == "list" and _LIST_ITEM.fullmatch(line)):
                continue
            return f"la línea {i + 2} es una continuación no admitida (¿clave indentada?)"
        match = _KEY_LINE.fullmatch(line)
        key, value = match.group(2), match.group(3).strip()
        if key not in TICKET_KEYS:
            return f"clave desconocida en la cabecera: {key!r}"
        if _BLOCK_SCALAR.fullmatch(value):
            block = "text"
        else:
            block = "list" if not value or value.startswith("#") else ""
    return ""


def _universal_newlines(text: str) -> str:
    """CRLF y CR aislado -> LF, igual que `read_text`: lo que se predice se lee como lo que quedará en disco."""
    return text.replace("\r\n", "\n").replace("\r", "\n")


def parse_ticket_text(path: Path, text: str) -> Ticket:
    def invalid(problem: str, fields: dict | None = None) -> Ticket:
        return Ticket(path, fields or {}, "", "claude-code", problem)

    text = _universal_newlines(text)
    lines = frontmatter_lines(text)
    if lines is None:
        return invalid("sin cabecera '---' en la primera línea o sin cierre")
    for i, line in enumerate(lines):
        indented = i > 0 and line.startswith((" ", "\t")) and line.strip()
        if not indented and not _KEY_LINE.fullmatch(line):
            return invalid(f"la línea {i + 2} no es 'clave:' ni continuación indentada (¿falta el cierre de la cabecera?)")
    fields = {}
    for line in lines:
        # Misma forma de clave que gobierna (`_KEY_LINE`, columna 0): el tablero muestra lo que decide el alcance.
        match = None if line.startswith((" ", "\t")) else _KEY_LINE.fullmatch(line)
        if match:
            fields[match.group(2)] = _unquote(match.group(3).strip())

    tools = _key_values(lines, "assigned_tool")
    tool = ""
    if len(tools) == 1 and not tools[0][1]:
        tool = _unquote(tools[0][0])
    tool = tool if tool in OTHER_TOOLS else "claude-code"

    states = _key_values(lines, "state")
    if len(states) != 1:
        return invalid("falta 'state' en la cabecera" if not states else "'state' repetido", fields)
    raw, continues = states[0]
    if continues:
        return invalid("'state' ocupa más de una línea", fields)
    state = _unquote(re.sub(r"[ \t]+#.*$", "", raw))
    if state not in STATES:
        return invalid(f"'state' con valor no admitido: {raw!r}", fields)
    scope, problem = _parse_write_scope(lines)
    problem = problem or _key_problem(lines)
    body = text.lstrip(_BOM).split("\n")[len(lines) + 2:]
    if not problem and any(_BODY_SCOPE.match(line) for line in body):
        problem = "'write_scope' declarado en el cuerpo; sólo vale en la cabecera"
    if problem:
        return invalid(problem, fields)
    return Ticket(path, fields, state, tool, "", scope)


# ---------- gobierno de la ficha en doing ----------

def _edited_texts(text: str, tool: str, tool_input: dict) -> list[str] | None:
    """Contenidos que podrían quedar tras la herramienta, o None si no se puede saber."""

    lf = _universal_newlines

    if tool == "Write":
        content = tool_input.get("content")
        return [lf(content)] if isinstance(content, str) else None
    if tool == "Edit":
        edits = [tool_input]
    elif tool == "MultiEdit":
        edits = tool_input.get("edits")
    else:
        return None
    if not isinstance(edits, list) or not edits:
        return None
    # `Edit` conserva un CR suelto y el parser lo lee como salto: sobre un texto así (en disco o dejado por un paso
    # anterior de MultiEdit) no se sabe dónde sustituirá la herramienta, así que no se predice.
    lone_cr = "\r" in text.replace("\r\n", "\n")
    results = [lf(text)]
    for edit in edits:
        if lone_cr or not isinstance(edit, dict):
            return None
        old, new = edit.get("old_string"), edit.get("new_string")
        if not isinstance(old, str) or not isinstance(new, str) or not old:
            return None
        lone_cr = "\r" in new.replace("\r\n", "\n")
        old, new = lf(old), lf(new)
        following = []
        for current in results:
            count = current.count(old)
            if count == 0 or (count > 1 and edit.get("replace_all") is not True):
                return None
            following.append(current.replace(old, new))
            # Al borrar, `Edit` puede llevarse también el salto de línea siguiente: se evalúan las dos formas.
            if not new and not old.endswith("\n") and old + "\n" in current:
                following.append(current.replace(old + "\n", ""))
        if len(following) > 64:
            return None
        results = following
    return results


def governance_problem(ticket: Ticket, tool: str, tool_input: dict) -> str:
    """Por qué esta edición de una ficha en `doing` no se admite, o "" si conserva su gobierno.

    No se puede cambiar `write_scope`; con alcance declarado, tampoco sacarla de `doing` ni cambiar de herramienta.
    Cualquier resultado que no se pueda reconstruir o que sea inválido se rechaza.
    """
    try:
        text = ticket.path.read_bytes().decode("utf-8")  # sin traducir saltos: hay que ver un CR suelto
    except (OSError, UnicodeDecodeError) as exc:
        raise GuardBlocked(f"no se pudo leer el ticket {ticket.path.name}: {exc}") from None
    results = _edited_texts(text, tool, tool_input)
    if results is None:
        return "no se puede reconstruir el resultado de la edición (usa Edit con texto exacto o Write; con CR suelto, Write)"
    for result in results:
        after = parse_ticket_text(ticket.path, result)
        if after.problem:
            return f"la ficha quedaría inválida: {after.problem}"
        if after.scope != ticket.scope:
            return "cambia 'write_scope'"
        if ticket.scope and (after.state != "doing" or after.tool != "claude-code"):
            return "cambia 'state' o 'assigned_tool' y dejaría sin efecto el alcance"
    return ""


def _ticket_paths(tasks_dir: Path) -> list[Path]:
    """Los `.md` bajo `tasks_dir`. Si la carpeta falta o no se puede recorrer ENTERA, bloquea.

    "No veo ninguna ficha" no es "no hay restricciones". Una carpeta vacía sí es válida.
    """

    def fail(reason: object) -> None:
        raise GuardBlocked(f"carpeta de fichas no utilizable ({tasks_dir}): {reason}") from None

    found: list[Path] = []
    try:
        if not tasks_dir.is_dir():
            fail("no existe o no es una carpeta; restáurala desde git")
        for folder, subfolders, files in os.walk(tasks_dir, onerror=fail):
            for name in subfolders:
                if os.path.islink(os.path.join(folder, name)):  # os.walk no la recorrería
                    fail(f"subcarpeta enlazada sin recorrer: {name}")
            found += [Path(folder) / name for name in files if Path(name).suffix.lower() == ".md"]
    except OSError as exc:
        fail(exc)
    return sorted(found)


def load_tickets(tasks_dir: Path) -> list[Ticket]:
    """Todas las fichas: cualquier `.md` bajo `tasks_dir`, también en subcarpetas."""
    tickets = []
    for path in _ticket_paths(tasks_dir):
        try:
            text = path.read_text(encoding="utf-8")
        except (OSError, UnicodeDecodeError) as exc:
            tickets.append(Ticket(path, {}, "", "claude-code", f"ilegible: {exc}"))
            continue
        tickets.append(parse_ticket_text(path, text))
    return tickets


def claude_doing_tickets(tasks_dir: Path) -> list[Path]:
    """Fichas válidas en `doing` que gobiernan a ESTA sesión, leídas del worktree de la sesión.

    WIP=1 es por herramienta: sólo `OTHER_TOOLS` exactas dejan de encerrar a Claude Code. Las fichas
    inválidas no salen de aquí; `write-scope-guard` las rechaza aparte (`invalid_tickets`).
    """
    return [t.path for t in load_tickets(tasks_dir) if t.state == "doing" and t.tool == "claude-code"]


def invalid_tickets(tasks_dir: Path) -> list[Ticket]:
    return [t for t in load_tickets(tasks_dir) if t.problem]


def read_write_scope(ticket: Path) -> list[str]:
    """Globs de la ficha según el contrato único; [] = no declara. Ilegible o inválida -> bloquea."""
    try:
        content = ticket.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        raise GuardBlocked(f"no se pudo leer el ticket {ticket.name}: {exc}") from None
    parsed = parse_ticket_text(ticket, content)
    if parsed.problem:
        raise GuardBlocked(f"ficha inválida {ticket.name}: {parsed.problem}")
    return list(parsed.scope)
