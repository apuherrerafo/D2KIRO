#!/usr/bin/env bash
# Gate de release: el cuerpo del PR hacia release/mvp-beta debe DECLARAR dos revisiones independientes.
#
# Qué es y qué NO es (dicho sin adornos): es una atestación mecánica, no una firma. GitHub no puede obligar a que
# el revisor sea "independiente" cuando el repositorio tiene un solo mantenedor; lo que sí hace este gate es
# impedir que un PR entre sin que alguien haya escrito, revisor por revisor, quién revisó, con qué veredicto y
# qué quedó abierto. Si hay un segundo colaborador, se suma la aprobación nativa de GitHub (ver docs/release-protection.md).
#
# Formato exigido en el cuerpo del PR (una línea por revisor, mínimo dos con identificadores DISTINTOS):
#   - [x] Revision independiente 1 (Codex GPT-5): APROBADO | APROBADO CON OBSERVACIONES -- <resumen de lo que revisó>
#   - [x] Revision independiente 2 (Claude subagente): APROBADO ... -- <resumen>
# Bloquea además: cualquier línea "BLOQUEANTE ABIERTO" y cualquier casilla de revisión sin marcar.
#
# Entrada: PR_BODY (variable de entorno). Pura: no toca la red ni el repo.
set -uo pipefail

body="${PR_BODY:-}"
if [ -z "${body//[[:space:]]/}" ]; then
  echo "FAIL: el PR no tiene descripcion; debe registrar las dos revisiones independientes." >&2
  exit 1
fi

# Normaliza acentos usuales y CRLF para no depender de como lo escribio quien abrio el PR.
normalized="$(printf '%s' "$body" | tr -d '\r' | sed -e 's/\xc2\xa0/ /g' | sed -e 's/ó/o/g' -e 's/Ó/O/g' -e 's/—/--/g' -e 's/–/--/g')"

pattern='^[[:space:]]*-[[:space:]]\[[xX]\][[:space:]]+Revision independiente[[:space:]]+[12][[:space:]]+\(([^)]+)\):[[:space:]]+([Aa][Pp][Rr][Oo][Bb][Aa][Dd][Oo] [Cc][Oo][Nn] [Oo][Bb][Ss][Ee][Rr][Vv][Aa][Cc][Ii][Oo][Nn][Ee][Ss]|[Aa][Pp][Rr][Oo][Bb][Aa][Dd][Oo])[[:space:]]+--[[:space:]]+[^[:space:]].{9,}$'

reviewers=()
while IFS= read -r line; do
  if [[ "$line" =~ $pattern ]]; then
    reviewers+=("$(printf '%s' "${BASH_REMATCH[1]}" | tr '[:upper:]' '[:lower:]' | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')")
  fi
done <<< "$normalized"

unchecked="$(printf '%s\n' "$normalized" | grep -ciE '^[[:space:]]*-[[:space:]]\[[[:space:]]\][[:space:]]+Revision independiente' || true)"
if [ "${unchecked:-0}" -gt 0 ]; then
  echo "FAIL: hay ${unchecked} casilla(s) de revision independiente sin marcar." >&2
  exit 1
fi

if printf '%s\n' "$normalized" | grep -qiE 'BLOQUEANTE[^[:alnum:]]*ABIERTO'; then
  echo "FAIL: el PR declara un hallazgo BLOQUEANTE ABIERTO." >&2
  exit 1
fi

if [ "${#reviewers[@]}" -lt 2 ]; then
  echo "FAIL: se encontraron ${#reviewers[@]} revision(es) valida(s); se exigen 2." >&2
  echo "Formato: '- [x] Revision independiente 1 (<revisor>): APROBADO -- <que reviso>'" >&2
  exit 1
fi

unique="$(printf '%s\n' "${reviewers[@]}" | sort -u | wc -l | tr -d ' ')"
if [ "$unique" -lt 2 ]; then
  echo "FAIL: los dos revisores declarados son el mismo ('${reviewers[0]}'); deben ser distintos." >&2
  exit 1
fi

echo "OK: ${#reviewers[@]} revisiones independientes declaradas por ${unique} revisores distintos."
