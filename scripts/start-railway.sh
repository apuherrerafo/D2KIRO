#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")/.."

: "${PORT:=3000}"
: "${ENGINE_PORT:=4000}"

# TSK-039 dice literal "es la mitigacion que hace aceptable el resto del deploy -- sin ella, no se
# despliega". proxy.ts deja pasar sin auth cuando faltan estas variables a proposito (regresion
# cero para `bun run dev` local, TSK-039) -- pero ese mismo fail-open en esta imagen (el unico
# punto de entrada real al deploy cloud) dejaria la instancia publica en Railway sin ninguna senal
# si alguien olvida configurarlas. Bloqueo duro aca, donde de verdad importa, sin tocar proxy.ts.
if [ -z "${SITE_ACCESS_USER:-}" ] || [ -z "${SITE_ACCESS_PASSWORD:-}" ]; then
  echo "SITE_ACCESS_USER y SITE_ACCESS_PASSWORD son obligatorias para arrancar este contenedor -- sin ellas la instancia quedaria publica sin autenticacion." >&2
  exit 1
fi

cd apps/engine
bun run db:migrate

bun run start &
ENGINE_PID="$!"
cd ../..

cleanup() {
  [ -n "${ENGINE_PID:-}" ] && { kill "$ENGINE_PID" 2>/dev/null || true; }
  [ -n "${WEB_PID:-}" ] && { kill "$WEB_PID" 2>/dev/null || true; }
  true
}
trap cleanup INT TERM EXIT

for attempt in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${ENGINE_PORT}/api/health" >/dev/null; then
    break
  fi

  if ! kill -0 "$ENGINE_PID" 2>/dev/null; then
    echo "apps/engine exited before becoming healthy" >&2
    exit 1
  fi

  if [ "$attempt" -eq 60 ]; then
    echo "apps/engine did not become healthy after 60 seconds" >&2
    exit 1
  fi

  sleep 1
done

cd apps/web
npm run start -- -H :: -p "$PORT" &
WEB_PID="$!"
cd ../..

# Sin exec: el trap de arriba necesita que el proceso de este script siga vivo para poder matar
# engine y web juntos si Railway manda SIGTERM (redeploy/restart) o si cualquiera de los dos
# procesos termina primero -- exec habría reemplazado este proceso y descartado el trap.
wait -n "$ENGINE_PID" "$WEB_PID"
