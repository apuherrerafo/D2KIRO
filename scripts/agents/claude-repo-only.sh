#!/usr/bin/env bash
# Claude Code con SÓLO las fuentes de configuración del proyecto (project + local): excluye
# ~/.claude (user), así los skills de usuario con el mismo nombre no sombrean a los del repo.
# `--setting-sources` está documentado sólo para settings; que además excluya ~/.claude/skills se
# comprobó con el binario real (ver docs/agents/repo-only-ecosystem.md).
# Excluir la configuración personal también apagaría tus permisos, hooks y reglas: si hay algo así, NO lanza (exit 3).
# CLAUDE_BIN permite sustituir el binario (así se prueba sin red).
# Un --setting-sources pasado por el invocador podría reabrir ~/.claude: se rechaza en vez de suponer cuál gana.
for a in "$@"; do
  case "$a" in --setting-sources*) echo "claude-repo-only: no se admite --setting-sources (el lanzador lo fija)" >&2; exit 2 ;; esac
done
# La comprobación corre desde el directorio del script y sin .env: nada del directorio actual puede desviarla.
# El resto de argumentos pasa tal cual: lanzar Claude con opciones que relajen permisos o hooks es decisión de quien las escribe.
(unset CDPATH; cd -- "$(dirname -- "$0")" &&bun --no-env-file ./shadowing.ts --protections) || { echo "claude-repo-only: no se lanza Claude (no se puede aislar de forma segura)" >&2; exit 3; }
exec "${CLAUDE_BIN:-claude}" --setting-sources project,local "$@"
