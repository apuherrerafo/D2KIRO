#!/usr/bin/env sh
# Bootstrap del PRE-PUSH gate LOCAL — R0.1 / Task 5.
#
# Cablea git al directorio de hooks versionado `.husky/` con un solo `git config` REPO-LOCAL
# (escribe en .git/config, NUNCA en la config global ni del sistema). Es el equivalente
# husky-independiente de lo que `husky` hace en `prepare`: no necesita `node_modules/husky`
# ni un `bun install` en la raíz.
#
# Correr UNA vez por clon del repo (Windows Git Bash o Linux):
#     sh scripts/install-git-hooks.sh
#
# A partir de ahí, un `git push` normal desde cualquier terminal dispara `.husky/pre-push`
# (bun run test + tsc sanity) y bloquea el push si algo está en rojo — sin Claude Code, sin CI.
set -e

REPO_ROOT=$(git rev-parse --show-toplevel)
cd "$REPO_ROOT"

git config --local core.hooksPath .husky

# Bit +x en el working tree (en el índice ya son 100755). En repos con core.filemode=false
# Git para Windows igual ejecuta el hook por el shebang; en Linux/CI el +x es necesario.
chmod +x .husky/pre-push .husky/pre-commit 2>/dev/null || true

ACTUAL=$(git config --get core.hooksPath || true)
if [ "$ACTUAL" != ".husky" ]; then
  echo "FALLO: core.hooksPath quedó en '${ACTUAL:-<vacío>}', se esperaba '.husky'." >&2
  exit 1
fi

echo "OK — core.hooksPath = .husky (repo-local)."
echo "     Hooks activos: .husky/pre-commit, .husky/pre-push"
echo "     Verificá con:  git config --get core.hooksPath"
