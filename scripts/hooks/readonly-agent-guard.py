#!/usr/bin/env python3
"""Guard PreToolUse (Bash|PowerShell) — TSK-257. Los agentes de SOLO LECTURA no escriben por Bash.

`warden`, `sentinel` y `tracer` declaran `tools: Read, Glob, Grep, Bash`. Quitarles Write/Edit no basta: con
Bash pueden escribir igual (`echo x > f`, `sed -i`, `git checkout -- .`, `python -c`). Claude Code incluye en el
payload de todo hook PreToolUse `agent_type` (y `agent_id` si la llamada viene de un subagente); este guard decide
por esa identidad, no por lo que diga el Markdown del agente.

Política: LISTA BLANCA, no lista negra. Un comando se permite sólo si todo él es una cadena de comandos simples
(separados por `|`, `&&`, `||`) cuyo programa y opciones están en la lista de abajo. Todo lo demás —redirecciones,
sustituciones, `;`, `&`, subshells, intérpretes, programas desconocidos— se bloquea. Un comando legítimo que no
esté en la lista se bloquea con un mensaje claro: se agrega a la lista con su prueba, no se afloja el guard.

Límite honesto: esto restringe Bash. No es un sandbox del sistema operativo: `bun test` ejecuta código del repo (que
un agente de lectura no puede modificar), y un binario de la lista con un efecto lateral no previsto lo escaparía.
Por eso la lista es corta y cada entrada tiene prueba en `readonly-agent-guard.test.ts`.

Contrato de salida (Claude Code 2.1.x): sólo exit 2 bloquea. Cualquier error interno -> exit 2 (fallo cerrado).
"""
from __future__ import annotations

import os
import sys

from _hook_lib import GuardBlocked, parse_payload, read_stdin

# Fuente de verdad: READ_ONLY_AGENTS en scripts/agents/contracts.ts (una prueba verifica que coincidan).
READ_ONLY_AGENTS = ("sentinel", "tracer", "warden")

# Programas de sólo lectura sin opciones peligrosas (las que las tienen, abajo).
SIMPLE_READERS = frozenset({
    "cat", "ls", "head", "tail", "wc", "grep", "rg", "echo", "pwd", "diff", "uniq", "stat", "du",
    "true", "which", "basename", "dirname", "realpath", "nl", "cut", "tr", "sort", "find",
})

FIND_WRITE_OPTS = frozenset({"-exec", "-execdir", "-ok", "-okdir", "-delete", "-fprint", "-fprint0", "-fprintf", "-fls"})

# Subcomandos de git que sólo leen. Sin opciones globales (`git -c ...`, `git -C ...`): argv[1] es el subcomando.
GIT_READ = frozenset({
    "status", "diff", "log", "show", "ls-files", "ls-tree", "rev-parse", "rev-list", "blame", "grep", "cat-file",
    "merge-base", "describe", "shortlog", "name-rev", "diff-tree", "show-ref", "for-each-ref",
})
GIT_FORBIDDEN_ARG_PREFIXES = ("--output", "--ext-diff", "--show-signature", "--textconv", "--filters", "--open-files-in-pager")
GIT_BRANCH_FLAGS = frozenset({
    "--show-current", "-a", "-r", "-v", "-vv", "--list", "-l", "--contains", "--merged", "--no-merged", "--points-at",
})
GIT_BRANCH_LIST_MODE = frozenset({"--list", "-l", "--contains", "--merged", "--no-merged", "--points-at"})
GIT_CONFIG_READ = frozenset({"--get", "--get-all", "--get-regexp", "--list", "-l"})

BUN_SCRIPTS = frozenset({"test", "lint", "typecheck"})
# `bun test` ejecuta código del repo; lista blanca de opciones (nada de --preload/--require/--import/--coverage/-u).
BUN_TEST_FLAGS = frozenset({"--bail", "--timeout", "-t", "--test-name-pattern", "--only", "--rerun-each"})
TSC_FLAGS = frozenset({"--pretty", "--skipLibCheck"})

GH_READ = {
    "pr": frozenset({"view", "diff", "checks", "list", "status"}),
    "run": frozenset({"view", "list"}),
    "issue": frozenset({"view", "list", "status"}),
}
GH_API_FORBIDDEN = ("-X", "--method", "-f", "-F", "--field", "--raw-field", "--input", "--cache")
GH_FORBIDDEN_ANY = ("--web", "-w")

FORBIDDEN_UNQUOTED = frozenset("$`><(){};\n\r\\")
FORBIDDEN_DOUBLE_QUOTED = frozenset("$`\\\n\r")


class Blocked(Exception):
    pass


def split_command(command: str) -> list[list[str]]:
    """Parte el comando en segmentos (separados por `|`, `||`, `&&`) y palabras. Bloquea todo lo que no entienda."""
    segments: list[list[str]] = []
    words: list[str] = []
    word: list[str] = []
    in_word = False
    quote: str | None = None
    i, n = 0, len(command)

    def end_word() -> None:
        nonlocal in_word
        if in_word:
            words.append("".join(word))
            word.clear()
            in_word = False

    def end_segment() -> None:
        end_word()
        if not words:
            raise Blocked("segmento vacío (operador sin comando)")
        segments.append(list(words))
        words.clear()

    while i < n:
        ch = command[i]
        if quote == "'":
            if ch == "'":
                quote = None
            else:
                word.append(ch)
        elif quote == '"':
            if ch == '"':
                quote = None
            elif ch in FORBIDDEN_DOUBLE_QUOTED:
                raise Blocked(f"carácter {ch!r} no permitido entre comillas dobles")
            else:
                word.append(ch)
        else:
            if ch in ("'", '"'):
                quote = ch
                in_word = True
            elif ch in " \t":
                end_word()
            elif ch == "|":
                end_segment()
                if i + 1 < n and command[i + 1] == "|":
                    i += 1
            elif ch == "&":
                if i + 1 < n and command[i + 1] == "&":
                    end_segment()
                    i += 1
                else:
                    raise Blocked("`&` suelto (segundo plano) no permitido")
            elif ch in FORBIDDEN_UNQUOTED:
                raise Blocked(f"carácter {ch!r} no permitido (redirección, sustitución, encadenado o subshell)")
            else:
                word.append(ch)
                in_word = True
        i += 1
    if quote is not None:
        raise Blocked("comillas sin cerrar")
    end_segment()
    return segments


def check_git(argv: list[str]) -> None:
    if len(argv) < 2 or argv[1].startswith("-"):
        raise Blocked("git sin subcomando, o con opciones globales (-c/-C/--git-dir)")
    sub, args = argv[1], argv[2:]
    if sub in GIT_READ:
        for arg in args:
            if arg.startswith(GIT_FORBIDDEN_ARG_PREFIXES) or arg.startswith(("-O", "-o")):
                raise Blocked(f"git {sub} {arg}: escribe en disco o ejecuta un programa")
        return
    if sub == "branch":
        has_list_mode = any(a in GIT_BRANCH_LIST_MODE for a in args)
        for arg in args:
            if arg.startswith("-"):
                if arg not in GIT_BRANCH_FLAGS:
                    raise Blocked(f"git branch {arg}: puede crear, mover o borrar ramas")
            elif not has_list_mode:
                raise Blocked("git branch <nombre>: crearía una rama")
        return
    if sub == "worktree" and args == ["list"]:
        return
    if sub == "remote" and args in ([], ["-v"]):
        return
    if sub == "stash" and args == ["list"]:
        return
    if sub == "config" and args and args[0] in GIT_CONFIG_READ:
        return
    if sub == "tag" and (not args or args[0] in ("-l", "--list")):
        return
    raise Blocked(f"git {sub}: no es un subcomando de sólo lectura de la lista")


def inside_root(arg: str, current: str, root: str) -> bool:
    """¿`arg`, como ruta relativa a `current` y con symlinks resueltos, queda dentro de `root`?"""
    if arg.startswith(("/", "\\", "~")) or ":" in arg:
        return False
    target = os.path.realpath(os.path.join(current, arg))
    return target == root or target.startswith(root + os.sep)


def check_bun(argv: list[str], current: str, root: str) -> None:
    if len(argv) >= 2 and argv[1] == "test":
        for arg in argv[2:]:
            if arg.startswith("-"):
                if arg.split("=", 1)[0] not in BUN_TEST_FLAGS:
                    raise Blocked(f"bun test {arg}: opción fuera de la lista (puede cargar código o escribir)")
            elif not inside_root(arg, current, root):
                raise Blocked(f"bun test {arg}: ejecutaría pruebas fuera de la carpeta de la sesión")
        return
    if len(argv) == 3 and argv[1] == "run" and argv[2] in BUN_SCRIPTS:
        return
    raise Blocked("bun: sólo `bun test ...` y `bun run test|lint|typecheck`")


def check_bunx(argv: list[str], current: str, root: str) -> None:
    """`bunx tsc` en modo verificación: lista blanca de opciones. `--noEmit` y UN `--incremental false` (el estado
    incremental escribe .tsbuildinfo aunque haya --noEmit; con repeticiones gana la última)."""
    if len(argv) < 2 or argv[1] != "tsc":
        raise Blocked("bunx: sólo `bunx tsc --noEmit --incremental false ...`")
    args = argv[2:]
    seen_noemit = 0
    incremental: list[str] = []
    k = 0
    while k < len(args):
        arg = args[k]
        if arg == "--noEmit":
            seen_noemit += 1
        elif arg == "--incremental":
            if k + 1 >= len(args):
                raise Blocked("bunx tsc --incremental sin valor")
            incremental.append(args[k + 1])
            k += 1
        elif arg in ("-p", "--project"):
            if k + 1 >= len(args) or not inside_root(args[k + 1], current, root):
                raise Blocked("bunx tsc --project fuera de la carpeta de la sesión")
            k += 1
        elif arg not in TSC_FLAGS:
            raise Blocked(f"bunx tsc {arg}: opción fuera de la lista (puede emitir o escribir)")
        k += 1
    if seen_noemit != 1:
        raise Blocked("bunx tsc exige exactamente un `--noEmit`")
    if incremental != ["false"]:
        raise Blocked("bunx tsc exige exactamente un `--incremental false` (si no, escribe .tsbuildinfo)")


def check_gh(argv: list[str]) -> None:
    if any(a.startswith(GH_FORBIDDEN_ANY) for a in argv[1:]):
        raise Blocked("gh --web: abre un programa externo")
    if len(argv) >= 3 and argv[1] in GH_READ and argv[2] in GH_READ[argv[1]]:
        return
    if len(argv) >= 3 and argv[1] == "api":
        for arg in argv[2:]:
            if arg.startswith(GH_API_FORBIDDEN):
                raise Blocked(f"gh api {arg}: no es una lectura (GET)")
        return
    raise Blocked("gh: sólo `gh pr|run|issue view|list|...` y `gh api` de lectura")


def check_cd(argv: list[str], current: str, root: str) -> str:
    """`cd` sólo a una subcarpeta relativa que, ya con symlinks resueltos, siga dentro de la raíz de la sesión."""
    if len(argv) != 2 or argv[1].startswith(("/", "~", "-")) or ":" in argv[1]:
        raise Blocked("cd sólo a una subcarpeta relativa (sin ruta absoluta, ~ ni unidad)")
    target = os.path.realpath(os.path.join(current, argv[1]))
    if not (target == root or target.startswith(root + os.sep)) or not os.path.isdir(target):
        raise Blocked("cd fuera de la carpeta de la sesión (o no es una carpeta; se resuelven symlinks)")
    return target


def check_segment(argv: list[str], current: str, root: str) -> None:
    name = argv[0]
    if name in SIMPLE_READERS:
        if name == "uniq" and sum(1 for a in argv[1:] if not a.startswith("-")) > 1:
            raise Blocked("uniq <entrada> <salida>: el segundo archivo se escribe")
        if name == "find" and any(a in FIND_WRITE_OPTS for a in argv[1:]):
            raise Blocked("find con -exec/-delete/-fprint: escribe o ejecuta")
        if name == "sort" and any(a.startswith(("-o", "-T", "--output", "--compress", "--temporary")) for a in argv[1:]):
            raise Blocked("sort -o/-T/--compress-program: escribe o ejecuta un programa")
        if name == "rg" and any(a.startswith(("--pre", "-z", "--search-zip")) for a in argv[1:]):
            raise Blocked("rg --pre/-z: ejecuta un programa externo")
        return
    if name == "git":
        return check_git(argv)
    if name == "bun":
        return check_bun(argv, current, root)
    if name == "bunx":
        return check_bunx(argv, current, root)
    if name == "gh":
        return check_gh(argv)
    if argv == ["bash", "scripts/verify-simplicity.sh"]:
        return
    raise Blocked(f"`{name}` no está en la lista de comandos de lectura")


def agent_name(payload: dict) -> str | None:
    """Nombre normalizado del agente que llama, o None si es el hilo principal. Bloquea si no se puede saber."""
    raw = payload.get("agent_type")
    if raw is None:
        if payload.get("agent_id") is not None:
            raise GuardBlocked("subagente sin `agent_type`: no se puede saber si es de sólo lectura")
        return None
    if not isinstance(raw, str):
        raise GuardBlocked("`agent_type` no es texto: no se puede saber quién llama")
    return raw.strip().lower()


def main() -> int:
    agent: str | None = None
    try:
        payload = parse_payload(read_stdin())
        agent = agent_name(payload)
        # Cualquier nombre que CONTENGA un agente de lectura (`plugin:warden`, `warden,x`, `x.warden`) queda restringido:
        # ante la duda sobre el formato de `agent_type`, se restringe de más, nunca de menos.
        if agent is None or not any(name in agent for name in READ_ONLY_AGENTS):
            return 0
        tool = payload.get("tool_name")
        if tool not in ("Bash", "PowerShell"):
            return 0
        if tool == "PowerShell":
            raise Blocked("PowerShell no está permitido")
        tool_input = payload.get("tool_input")
        command = tool_input.get("command") if isinstance(tool_input, dict) else None
        if not isinstance(command, str) or not command.strip():
            raise Blocked("comando ausente o vacío")
        cwd = payload.get("cwd")
        if not isinstance(cwd, str) or not cwd:
            raise Blocked("payload sin `cwd`: no se puede acotar `cd`")
        root = os.path.realpath(cwd)
        current = root
        for argv in split_command(command):
            if argv[0] == "cd":
                current = check_cd(argv, current, root)
            else:
                check_segment(argv, current, root)
        return 0
    except Blocked as exc:
        who = agent if "agent" in locals() and agent else "agente de solo lectura"
        sys.stderr.write(f"BLOQUEADO ({who} es de solo lectura): {exc}\n")
        return 2
    except GuardBlocked as exc:
        sys.stderr.write(f"BLOQUEADO (readonly-agent-guard): {exc}\n")
        return 2
    except Exception as exc:  # fallo cerrado
        sys.stderr.write(f"BLOQUEADO (readonly-agent-guard, error interno): {exc!r}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
