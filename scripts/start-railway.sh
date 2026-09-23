#!/usr/bin/env bash
set -eu

cd "$(dirname "$0")/.."

: "${PORT:=3000}"
: "${ENGINE_PORT:=4000}"

# La identidad es un límite de confianza del despliegue: sin una de estas variables, el proxy no
# puede autenticar ni acuñar el token interno. El contenedor no inicia en modo fail-open.
for required_var in SESSION_SECRET INTERNAL_AUTH_SECRET PUBLIC_BASE_URL; do
  if [ -z "${!required_var:-}" ]; then
    echo "Falta una variable obligatoria de autenticacion para arrancar el contenedor." >&2
    exit 1
  fi
done

cd apps/engine
bun run db:migrate

# Run Bun itself, rather than a package-manager wrapper, so ENGINE_PID is the process that owns
# the listening socket. The same applies to Next below: direct ownership lets this script reliably
# terminate the sibling when either service exits.
bun src/index.ts &
ENGINE_PID="$!"
cd ../..

terminate_child() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  kill -TERM "$pid" 2>/dev/null || true
}

reap_child() {
  local pid="$1"
  [ -n "$pid" ] || return 0
  wait "$pid" 2>/dev/null || true
}

cleanup() {
  trap - EXIT INT TERM
  # Both PIDs are direct server processes. Terminate first, then reap, so the caller does not
  # return while either listening socket is still owned by a child.
  terminate_child "${ENGINE_PID:-}"
  terminate_child "${WEB_PID:-}"
  reap_child "${ENGINE_PID:-}"
  reap_child "${WEB_PID:-}"
}

on_signal() {
  exit "$1"
}

trap 'on_signal 130' INT
trap 'on_signal 143' TERM
trap cleanup EXIT

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
# npm would leave WEB_PID pointing at its wrapper. Invoke the CLI installed by npm ci directly so
# WEB_PID is the long-lived Node/Next process that owns PORT.
node ./node_modules/next/dist/bin/next start -H :: -p "$PORT" &
WEB_PID="$!"
cd ../..

# Sin exec: el trap de arriba necesita que el proceso de este script siga vivo para poder matar
# engine y web juntos si Railway manda SIGTERM (redeploy/restart) o si cualquiera de los dos
# procesos termina primero -- exec habría reemplazado este proceso y descartado el trap.
set +e
wait -n "$ENGINE_PID" "$WEB_PID"
CHILD_STATUS="$?"
set -e
exit "$CHILD_STATUS"
