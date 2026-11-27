#!/usr/bin/env python3
"""Guard PreToolUse (Bash|PowerShell) — TSK-261. `warden`, `sentinel` y `tracer` no ejecutan comandos.

El control principal es su frontmatter (`tools: Read, Glob, Grep`; ver `checkReadOnlyAgent` en
scripts/agents/contracts.ts). Esto es defensa adicional por si esa lista se reabre: cualquier Bash/PowerShell
de esas identidades se bloquea SIN leer el comando. No hay lista de comandos permitidos a propósito: el
intérprete anterior (TSK-257) falló cinco revisiones seguidas (docs/agents/readonly-guard-hardening.md).

No es un sandbox: no gobierna Write/Edit, MCP ni la herramienta Read.
Contrato de salida (Claude Code 2.1.x): sólo exit 2 bloquea. Cualquier error interno -> exit 2 (fallo cerrado).
"""
from __future__ import annotations

import sys

from _hook_lib import GuardBlocked, parse_payload, read_stdin

# Fuente de verdad: READ_ONLY_AGENTS en scripts/agents/contracts.ts (una prueba verifica que coincidan).
READ_ONLY_AGENTS = ("sentinel", "tracer", "warden")


def agent_name(payload: dict) -> str | None:
    """Nombre normalizado del agente que llama, o None si es el hilo principal. Bloquea si no se puede saber."""
    raw = payload.get("agent_type")
    if raw is None:
        if payload.get("agent_id") is not None:
            raise GuardBlocked("subagente sin `agent_type`: no se puede saber si es de sólo lectura")
        return None
    if not isinstance(raw, str):
        raise GuardBlocked("`agent_type` no es texto: no se puede saber quién llama")
    name = raw.strip().lower()
    if not name and payload.get("agent_id") is not None:
        raise GuardBlocked("subagente con `agent_type` vacío: no se puede saber si es de sólo lectura")
    return name or None


def main() -> int:
    try:
        payload = parse_payload(read_stdin())
        agent = agent_name(payload)
        # Cualquier nombre que CONTENGA un revisor (`plugin:warden`, `x.warden`) queda restringido: de más, nunca de menos.
        if agent is None or not any(name in agent for name in READ_ONLY_AGENTS):
            return 0
        if payload.get("tool_name") not in ("Bash", "PowerShell"):
            return 0
        sys.stderr.write(
            f"BLOQUEADO ({agent} es de solo lectura): no ejecuta comandos. "
            "Pide la evidencia al coordinador o declara BLOCKED.\n"
        )
        return 2
    except GuardBlocked as exc:
        sys.stderr.write(f"BLOQUEADO (readonly-agent-guard): {exc}\n")
        return 2
    except Exception as exc:  # fallo cerrado
        sys.stderr.write(f"BLOQUEADO (readonly-agent-guard, error interno): {exc!r}\n")
        return 2


if __name__ == "__main__":
    sys.exit(main())
