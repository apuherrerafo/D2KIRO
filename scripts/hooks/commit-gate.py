"""PreToolUse (Bash|PowerShell): gate de `git commit`/`git push` sobre el worktree de la SESIÓN.

Contrato (aislamiento entre worktrees; reemplaza el grep de pretooluse-guard.sh):
- El payload se parsea como JSON real (antes un grep cortaba el comando en la primera comilla
  escapada y `git add "a b" && git commit` pasaba sin verificar).
- Cada `git commit|push` del comando se resuelve a su directorio efectivo, siguiendo `cd`,
  `pushd/popd`, `git -C`, subshells `( ... )` y `bash -c`. Si TODOS caen en el worktree de la
  sesión (`payload["cwd"]`), corre el `scripts/verify-simplicity.sh` de ESE worktree.
- Un commit/push que apunta a OTRO worktree se bloquea — ya no se verifica contra el árbol
  ajeno (4404a7c lo permitía si ese árbol estaba limpio).
- Fallo cerrado: destino no determinable (`cd $X`, `--git-dir`, `GIT_DIR=`, `$(git commit)`,
  `xargs git push`, heredoc a un shell...), contexto que no valida, verify ausente, o verify
  que no termina antes de su deadline -> exit 2.
- Mencionar `git commit` como DATO (argumento de echo/grep/gh, cuerpo de un heredoc a `cat`)
  no dispara nada.
- PowerShell: sólo sabemos analizar sintaxis Bash; un commit/push por esa vía se bloquea.
Exit 0 = permitir. Exit 2 = bloquear (motivo en stderr).
"""
from __future__ import annotations

import os
import re
import shlex
import shutil
import signal
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from _hook_lib import (  # noqa: E402
    GuardBlocked,
    locate,
    native_path,
    parse_payload,
    read_stdin,
    same_path,
    session_root,
)

GATED = ("commit", "push")
# Filtro rápido y amplio: si el texto ni siquiera menciona git + commit/push, no hay nada que
# analizar. El veredicto real lo da `analyze`, nunca este regex.
MENTION = re.compile(r"\bgit(?:\.exe)?\b.*?\b(?:commit|push)\b", re.S)
SHELLS = {"bash", "sh", "zsh", "dash", "ksh"}
# Ejecutan su argumento como código que no podemos seguir: si llevan git commit/push -> bloqueo.
OPAQUE = {
    "xargs", "find", "parallel", "watch", "cmd", "powershell", "pwsh", "python", "python3", "py",
    "node", "bun", "bunx", "npx", "perl", "ruby", "ssh", "wsl", "script", "su", "sudo", "doas",
    "source", ".",
}
PREFIXES = {"command", "builtin", "exec", "nohup", "time", "nice"}
GIT_LOCATION_VARS = {"GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR", "GIT_INDEX_FILE"}
SUBST = "__D2K_SUBST__"
DEFAULT_TIMEOUT_S = 240


class Unresolvable(Exception):
    """No se puede saber con certeza a qué worktree apunta un commit/push del comando."""


@dataclass(frozen=True)
class Invocation:
    op: str
    directory: Path


# ---------- aplanado del comando ----------

class _Scanner:
    """Deja el comando listo para shlex: quita cuerpos de heredoc y comentarios, reemplaza
    `$(...)` y backticks por un marcador (guardando su contenido) y convierte los saltos de
    línea fuera de comillas en `;`. Cualquier construcción sin cerrar -> Unresolvable."""

    def __init__(self, text: str) -> None:
        self.s = text
        self.i = 0
        self.substs: list[str] = []
        self.heredocs: list[tuple[str, str]] = []  # (comando que lo consume, cuerpo)
        self._pending: list[tuple[str, bool, str]] = []

    def run(self) -> str:
        out = self._scan(in_subst=False)
        if self._pending:
            raise Unresolvable("heredoc sin terminador")
        return out

    def _scan(self, in_subst: bool) -> str:
        s, out, depth = self.s, [], 0
        while self.i < len(s):
            c = s[self.i]
            if c == "\\":
                if s[self.i + 1:self.i + 2] == "\n":
                    self.i += 2
                    continue
                out.append(s[self.i:self.i + 2])
                self.i += 2
                continue
            if c == "'":
                end = s.find("'", self.i + 1)
                if end < 0:
                    raise Unresolvable("comilla simple sin cerrar")
                out.append(s[self.i:end + 1])
                self.i = end + 1
                continue
            if c == '"':
                out.append(self._double())
                continue
            if c == "`":
                self._backtick()
                out.append(SUBST)
                continue
            if s.startswith("$(", self.i):
                self.i += 2
                self.substs.append(self._scan(in_subst=True))
                out.append(SUBST)
                continue
            if s.startswith("<<", self.i) and not s.startswith("<<<", self.i):
                self._heredoc_operator("".join(out))
                continue
            if c == "#" and (self.i == 0 or s[self.i - 1] in " \t\n;&|()"):
                while self.i < len(s) and s[self.i] != "\n":
                    self.i += 1
                continue
            if c == "\n":
                out.append(";")
                self.i += 1
                self._heredoc_bodies()
                continue
            if c == "(":
                depth += 1
            elif c == ")":
                if depth == 0 and in_subst:
                    self.i += 1
                    return "".join(out)
                depth = max(0, depth - 1)
            out.append(c)
            self.i += 1
        if in_subst:
            raise Unresolvable("$( sin cerrar")
        return "".join(out)

    def _double(self) -> str:
        s, out = self.s, ['"']
        self.i += 1
        while self.i < len(s):
            c = s[self.i]
            if c == "\\":
                out.append(s[self.i:self.i + 2])
                self.i += 2
            elif c == '"':
                self.i += 1
                out.append('"')
                return "".join(out)
            elif c == "`":
                self._backtick()
                out.append(SUBST)
            elif s.startswith("$(", self.i):
                self.i += 2
                self.substs.append(self._scan(in_subst=True))
                out.append(SUBST)
            else:
                out.append(c)
                self.i += 1
        raise Unresolvable("comilla doble sin cerrar")

    def _backtick(self) -> None:
        s, j = self.s, self.i + 1
        while j < len(s) and s[j] != "`":
            j += 2 if s[j] == "\\" else 1
        if j >= len(s):
            raise Unresolvable("backtick sin cerrar")
        self.substs.append(s[self.i + 1:j])
        self.i = j + 1

    def _heredoc_operator(self, before: str) -> None:
        s = self.s
        self.i += 2
        strip_tabs = s[self.i:self.i + 1] == "-"
        if strip_tabs:
            self.i += 1
        while self.i < len(s) and s[self.i] in " \t":
            self.i += 1
        if s[self.i:self.i + 1] in ("'", '"'):
            q = s[self.i]
            end = s.find(q, self.i + 1)
            if end < 0:
                raise Unresolvable("delimitador de heredoc sin cerrar")
            delim = s[self.i + 1:end]
            self.i = end + 1
        else:
            m = re.match(r"[^\s;&|()<>]+", s[self.i:])
            if not m:
                raise Unresolvable("heredoc sin delimitador")
            delim = m.group(0).replace("\\", "")
            self.i += m.end()
        words = re.split(r"[;&|(]", before)[-1].split()
        words = [w for w in words if not re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", w)]
        self._pending.append((delim, strip_tabs, _name(words[0]) if words else ""))

    def _heredoc_bodies(self) -> None:
        s = self.s
        for delim, strip_tabs, consumer in self._pending:
            body = []
            while True:
                if self.i >= len(s):
                    raise Unresolvable(f"heredoc sin terminador '{delim}'")
                end = s.find("\n", self.i)
                end = len(s) if end < 0 else end
                line = s[self.i:end].rstrip("\r")
                self.i = min(end + 1, len(s))
                if (line.lstrip("\t") if strip_tabs else line) == delim:
                    break
                body.append(line)
            self.heredocs.append((consumer, "\n".join(body)))
        self._pending = []


def _name(token: str) -> str:
    base = token.replace("\\", "/").rsplit("/", 1)[-1].lower()
    return base[:-4] if base.endswith(".exe") else base


def _tokens(flat: str) -> list[str]:
    lex = shlex.shlex(flat, posix=True, punctuation_chars=True)
    lex.whitespace_split = True
    lex.commenters = ""
    try:
        return list(lex)
    except ValueError as exc:
        raise Unresolvable(f"no se pudo tokenizar el comando: {exc}") from None


# ---------- análisis ----------

@dataclass
class _State:
    cwd: Path | None
    tainted: bool = False  # GIT_DIR/GIT_WORK_TREE fijado antes en el mismo comando


def analyze(command: str, cwd: Path | None, depth: int = 0) -> list[Invocation]:
    """Todos los `git commit|push` del comando con su directorio efectivo."""
    if depth > 4:
        raise Unresolvable("demasiados shells anidados")
    sc = _Scanner(command)
    flat = sc.run()
    for body in sc.substs:
        if MENTION.search(body):
            raise Unresolvable("git commit/push dentro de una sustitución $(...) o `...`")
    for consumer, body in sc.heredocs:
        if MENTION.search(body) and (consumer in SHELLS or consumer in OPAQUE or consumer == "eval"):
            raise Unresolvable(f"git commit/push en un heredoc que ejecuta `{consumer}`")

    state = _State(cwd)
    subshells: list[Path | None] = []
    dirstack: list[Path | None] = []
    found: list[Invocation] = []
    argv: list[str] = []
    redirect_target = False
    for tok in _tokens(flat) + [";"]:
        if tok and all(ch in "();<>|&" for ch in tok):
            if "<" in tok or ">" in tok:
                redirect_target = True
                continue
            found += _simple(argv, state, dirstack, depth)
            argv = []
            for ch in tok:
                if ch == "(":
                    subshells.append(state.cwd)
                elif ch == ")" and subshells:
                    state.cwd = subshells.pop()
            continue
        if redirect_target:
            redirect_target = False
            continue
        argv.append(tok)
    return found


def _bare_git_gated(args: list[str]) -> bool:
    for i, a in enumerate(args):
        if _name(a) == "git":
            return any(x in GATED for x in args[i + 1:])
    return False


def _simple(argv: list[str], state: _State, dirstack: list[Path | None], depth: int) -> list[Invocation]:
    local_taint = False
    while argv and re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", argv[0]):
        local_taint |= argv[0].split("=", 1)[0] in GIT_LOCATION_VARS
        argv = argv[1:]
    if not argv:
        state.tainted |= local_taint
        return []
    while argv:
        name = _name(argv[0])
        if name in PREFIXES:
            argv = argv[1:]
            while argv and (argv[0].startswith("-") or argv[0].isdigit()):
                argv = argv[1:]
        elif name == "env":
            argv = argv[1:]
            while argv and (argv[0].startswith("-") or "=" in argv[0]):
                local_taint |= argv[0].split("=", 1)[0] in GIT_LOCATION_VARS
                argv = argv[2:] if argv[0] == "-u" else argv[1:]
        elif name == "timeout":
            argv = argv[1:]
            while argv and argv[0].startswith("-"):
                argv = argv[1:]
            argv = argv[1:]
        else:
            break
    if not argv:
        return []

    name, args = _name(argv[0]), argv[1:]
    if name in ("cd", "pushd"):
        if name == "pushd":
            dirstack.append(state.cwd)
        state.cwd = _directory(args, state.cwd)
        return []
    if name == "popd":
        state.cwd = dirstack.pop() if dirstack else None
        return []
    if name in ("export", "declare", "typeset", "local", "readonly"):
        state.tainted |= any(a.split("=", 1)[0] in GIT_LOCATION_VARS for a in args)
        return []
    if name == "git":
        return _git(args, state, local_taint)
    if SUBST in argv[0] or argv[0].startswith("$"):
        if any(a in GATED for a in args):
            raise Unresolvable("comando dinámico seguido de commit/push")
        return []
    if name in SHELLS:
        script = _shell_script(args)
        if script is None:
            if MENTION.search(" ".join(args)):
                raise Unresolvable(f"git commit/push dentro de `{name}` sin -c")
            return []
        inner = analyze(script, state.cwd, depth + 1)
        if inner and (local_taint or state.tainted):
            raise Unresolvable("GIT_DIR/GIT_WORK_TREE fijado para un shell que hace commit/push")
        return inner
    if name == "eval":
        return analyze(" ".join(args), state.cwd, depth + 1)
    if name in OPAQUE:
        if MENTION.search(" ".join(args)) or _bare_git_gated(args):
            raise Unresolvable(f"git commit/push ejecutado a través de `{name}`")
        return []
    if name not in ("echo", "printf") and _bare_git_gated(args):
        raise Unresolvable(f"git commit/push como argumento de `{name}`")
    return []


def _shell_script(args: list[str]) -> str | None:
    for i, a in enumerate(args):
        if a.startswith("-") and not a.startswith("--") and "c" in a[1:]:
            return args[i + 1] if i + 1 < len(args) else None
        if not a.startswith("-"):
            return None
    return None


def _directory(args: list[str], cwd: Path | None) -> Path | None:
    """Destino de `cd`/`pushd`/`git -C`, o None si no se puede saber estáticamente."""
    args = [a for a in args if a not in ("-P", "-L", "-e", "-@", "--")]
    if not args:
        return Path(os.path.realpath(Path.home()))
    raw = args[0]
    if raw == "-" or SUBST in raw or "$" in raw or any(ch in raw for ch in "*?[{"):
        return None
    try:
        return native_path(raw, cwd, msys=True)
    except GuardBlocked:
        return None


def _git(args: list[str], state: _State, local_taint: bool) -> list[Invocation]:
    dirs: list[str] = []
    location_flag = False
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-C":
            if i + 1 >= len(args):
                raise Unresolvable("git -C sin directorio")
            dirs.append(args[i + 1])
            i += 2
        elif a in ("-c", "--config-env"):
            i += 2
        elif a in ("--git-dir", "--work-tree", "--namespace"):
            location_flag = True
            i += 2
        elif a.startswith(("--git-dir=", "--work-tree=", "--namespace=")):
            location_flag = True
            i += 1
        elif a.startswith("-"):
            i += 1
        else:
            break
    if i >= len(args):
        return []
    sub = args[i]
    if SUBST in sub or sub.startswith("$"):
        raise Unresolvable("subcomando de git dinámico")
    if sub not in GATED:
        return []
    if location_flag or local_taint or state.tainted:
        raise Unresolvable(f"`git {sub}` con --git-dir/--work-tree/GIT_DIR: el destino no es el directorio")
    directory = state.cwd
    for raw in dirs:
        directory = _directory([raw], directory) if raw else None
    if directory is None:
        raise Unresolvable(f"no se puede determinar el directorio de `git {sub}`")
    return [Invocation(sub, directory)]


# ---------- verificación ----------

def _block(reason: str) -> int:
    sys.stderr.write(f"Bloqueado por commit-gate: {reason}\n")
    return 2


def _timeout() -> int:
    raw = os.environ.get("D2K_COMMIT_GATE_TIMEOUT_S", "")
    return int(raw) if raw.isdigit() and int(raw) > 0 else DEFAULT_TIMEOUT_S


def _relay(output: bytes | None) -> None:
    if output:
        sys.stderr.write(output.decode("utf-8", errors="replace"))
        sys.stderr.flush()


def _kill_tree(proc: subprocess.Popen[bytes]) -> None:
    if os.name == "nt":
        subprocess.run(["taskkill", "/T", "/F", "/PID", str(proc.pid)], capture_output=True)
    else:
        try:
            os.killpg(proc.pid, signal.SIGKILL)
        except OSError:
            pass
    try:
        proc.wait(timeout=5)
    except subprocess.TimeoutExpired:
        pass


def verify(root: Path) -> int:
    """Corre el verify-simplicity.sh del worktree de la sesión, con deadline propio.

    El deadline existe porque un hook que excede su `timeout` no bloquea: el gate tiene que
    decidir (y bloquear) antes de que Claude Code lo corte.
    """
    if not (root / "scripts" / "verify-simplicity.sh").is_file():
        return _block(f"no existe scripts/verify-simplicity.sh en {root}; no se puede verificar el commit/push")
    bash = os.environ.get("D2K_HOOK_BASH") or shutil.which("bash")
    if not bash:
        return _block("no se encontró bash para correr verify-simplicity.sh")
    env = {k: v for k, v in os.environ.items() if not k.startswith("GIT_")}
    env["VERIFY_COMMIT_GATE"] = "1"
    group = (
        {"creationflags": subprocess.CREATE_NEW_PROCESS_GROUP} if os.name == "nt" else {"start_new_session": True}
    )
    # La salida va a un pipe PROPIO y se reenvía: si el verify deja nietos vivos tras el
    # deadline (en Git Bash `taskkill /T` no alcanza a los procesos MSYS), ellos retienen ese
    # pipe y no el stderr del hook — Claude Code recibe el exit 2 en el acto.
    try:
        proc = subprocess.Popen(
            [bash, "scripts/verify-simplicity.sh"], cwd=root, env=env,
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, **group,
        )
    except OSError as exc:
        return _block(f"no se pudo ejecutar verify-simplicity.sh: {exc}")
    limit = _timeout()
    try:
        output, _ = proc.communicate(timeout=limit)
    except subprocess.TimeoutExpired as exc:
        _kill_tree(proc)
        _relay(exc.output)
        return _block(f"verify-simplicity.sh no terminó en {limit}s")
    _relay(output)
    if proc.returncode != 0:
        return _block("scripts/verify-simplicity.sh falló. Corrige las violaciones antes de commitear/pushear.")
    return 0


def main() -> int:
    try:
        payload = parse_payload(read_stdin())
    except GuardBlocked as exc:
        return _block(str(exc))
    tool = payload.get("tool_name")
    if tool not in ("Bash", "PowerShell"):
        return 0
    ti = payload.get("tool_input")
    command = ti.get("command") if isinstance(ti, dict) else None
    if not isinstance(command, str):
        return _block(f"{tool} sin comando legible")
    if not MENTION.search(command):
        return 0
    if tool == "PowerShell":
        return _block("git commit/push desde PowerShell: el gate sólo analiza sintaxis Bash; usa la herramienta Bash")
    try:
        root = session_root(payload)
        invocations = analyze(command, native_path(payload["cwd"]))
        for inv in invocations:
            if not inv.directory.is_dir():
                raise Unresolvable(f"el directorio de `git {inv.op}` no existe: {inv.directory}")
            loc = locate(inv.directory)
            if loc.kind != "worktree" or loc.root is None or not same_path(loc.root, root):
                return _block(
                    f"`git {inv.op}` apunta a {loc.root or inv.directory}, fuera del worktree de la sesión "
                    f"({root}). Hazlo desde una sesión abierta en ese worktree."
                )
    except (GuardBlocked, Unresolvable) as exc:
        return _block(f"{exc} (fail-closed)")
    if not invocations:
        return 0  # git commit/push sólo aparece como dato
    return verify(root)


if __name__ == "__main__":
    sys.exit(main())
