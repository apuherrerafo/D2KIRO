#!/bin/bash
# Hot spots: los 10 archivos con más cambios en el historial de Git.
# <40 líneas, cero dependencias, solo Git nativo.
set -euo pipefail

if ! git rev-parse --git-dir > /dev/null 2>&1; then
  echo "❌ No es un repositorio Git."
  exit 1
fi

echo "🔥 Top 10 archivos más modificados (hot spots):"
git log --format=format: --name-only 2>/dev/null \
  | egrep -v '^$' \
  | sort | uniq -c | sort -rn | head -10

echo ""
echo "🪢 Archivos con más de 8 imports internos (posible nudo de acoplamiento):"
for f in $(git ls-files | grep -E '\.(ts|js)$' 2>/dev/null); do
  count=$(grep -cE '^import' "$f" 2>/dev/null || echo 0)
  if [ "$count" -gt 8 ]; then
    echo "  $f: $count imports"
  fi
done
