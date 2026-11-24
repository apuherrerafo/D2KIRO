#!/usr/bin/env bash
# Claude Code con SÓLO las fuentes de configuración del proyecto (project + local): excluye
# ~/.claude (user), así los skills de usuario con el mismo nombre no sombrean a los del repo.
# `--setting-sources` está documentado sólo para settings; que además excluya ~/.claude/skills se
# comprobó con el binario real (ver docs/agents/repo-only-ecosystem.md).
# CLAUDE_BIN permite sustituir el binario (así se prueba sin red).
exec "${CLAUDE_BIN:-claude}" --setting-sources project,local "$@"
