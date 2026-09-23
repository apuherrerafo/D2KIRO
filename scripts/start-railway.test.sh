#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
SOURCE_SCRIPT="$ROOT_DIR/scripts/start-railway.sh"
TEST_DIR="$(mktemp -d)"

cleanup_test() {
  if [ -n "${SUPERVISOR_PID:-}" ]; then
    kill "$SUPERVISOR_PID" 2>/dev/null || true
    wait "$SUPERVISOR_PID" 2>/dev/null || true
  fi
  rm -rf "$TEST_DIR"
}
trap cleanup_test EXIT

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

assert_dead() {
  local pid="$1"
  for _ in $(seq 1 100); do
    if ! kill -0 "$pid" 2>/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  fail "process $pid is still alive"
}

assert_port_free() {
  local port="$1"
  node -e '
    const net = require("net");
    const port = Number(process.argv[1]);
    const server = net.createServer();
    server.once("error", (error) => { console.error(error.message); process.exit(1); });
    server.listen({ host: "127.0.0.1", port }, () => server.close(() => process.exit(0)));
  ' "$port" || fail "port $port is still bound"
}

wait_for_file() {
  local file="$1"
  for _ in $(seq 1 100); do
    [ -s "$file" ] && return 0
    sleep 0.05
  done
  fail "timed out waiting for $file"
}

wait_for_http() {
  local port="$1"
  for _ in $(seq 1 100); do
    if curl -fsS "http://127.0.0.1:${port}/" >/dev/null; then
      return 0
    fi
    sleep 0.05
  done
  fail "timed out waiting for HTTP port $port"
}

make_fixture() {
  mkdir -p "$TEST_DIR/app/scripts" "$TEST_DIR/app/apps/engine" "$TEST_DIR/app/apps/web/node_modules/next/dist/bin" "$TEST_DIR/bin"
  cp "$SOURCE_SCRIPT" "$TEST_DIR/app/scripts/start-railway.sh"

  cat > "$TEST_DIR/fake-server.js" <<'EOF'
const http = require("http");
const port = Number(process.argv[2]);
const role = process.env.TEST_ROLE;
const pidFile = `${process.env.SUPERVISION_TEST_DIR}/${role}.pid`;
const exitCode = Number(process.env[`TEST_${role.toUpperCase()}_EXIT_CODE`] || 0);
const exitDelay = Number(process.env[`TEST_${role.toUpperCase()}_EXIT_DELAY_MS`] || 0);
const server = http.createServer((request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ok");
});
const shutdown = () => server.close(() => process.exit(0));
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
server.listen(port, "127.0.0.1", () => {
  require("fs").writeFileSync(pidFile, String(process.pid));
  if (exitDelay > 0) setTimeout(() => process.exit(exitCode), exitDelay);
});
EOF

  cat > "$TEST_DIR/bin/bun" <<'EOF'
#!/usr/bin/env bash
set -euo pipefail
if [ "$1" = "run" ] && [ "$2" = "db:migrate" ]; then exit 0; fi
if [ "$1" = "src/index.ts" ]; then
  TEST_ROLE=engine exec node "$SUPERVISION_TEST_DIR/fake-server.js" "$ENGINE_PORT"
fi
exit 64
EOF
  chmod +x "$TEST_DIR/bin/bun"

  cat > "$TEST_DIR/app/apps/web/node_modules/next/dist/bin/next" <<'EOF'
const portIndex = process.argv.indexOf("-p") + 1;
process.env.TEST_ROLE = "web";
process.argv[2] = process.argv[portIndex];
require(process.env.SUPERVISION_TEST_DIR + "/fake-server.js");
EOF
}

start_supervisor() {
  local engine_port="$1"
  local web_port="$2"
  shift 2
  rm -f "$TEST_DIR/engine.pid" "$TEST_DIR/web.pid"
  SUPERVISION_TEST_DIR="$TEST_DIR" PATH="$TEST_DIR/bin:$PATH" ENGINE_PORT="$engine_port" PORT="$web_port" \
    SESSION_SECRET=test-session-secret INTERNAL_AUTH_SECRET=test-internal-secret PUBLIC_BASE_URL=http://example.test \
    "$@" bash "$TEST_DIR/app/scripts/start-railway.sh" &
  SUPERVISOR_PID="$!"
  wait_for_file "$TEST_DIR/engine.pid"
  wait_for_file "$TEST_DIR/web.pid"
  wait_for_http "$engine_port"
  wait_for_http "$web_port"
}

wait_for_supervisor_status() {
  local expected="$1"
  set +e
  wait "$SUPERVISOR_PID"
  local actual="$?"
  set -e
  SUPERVISOR_PID=""
  [ "$actual" -eq "$expected" ] || fail "supervisor exit status was $actual, expected $expected"
}

grep -Fq 'bun src/index.ts &' "$SOURCE_SCRIPT" || fail "engine must be launched directly"
grep -Fq 'node ./node_modules/next/dist/bin/next start -H :: -p "$PORT" &' "$SOURCE_SCRIPT" || fail "web must be launched through the installed Next CLI"

if [ "$(uname -s)" != "Linux" ]; then
  echo "start-railway supervision: SKIP (requires Linux PID semantics)"
  exit 0
fi

make_fixture

BASE_PORT=$((42000 + ($$ % 1000) * 10))

# Normal startup, engine crash cleanup, released public port, then an immediate same-port restart.
start_supervisor "$((BASE_PORT + 1))" "$((BASE_PORT + 2))"
ENGINE_PID="$(<"$TEST_DIR/engine.pid")"
WEB_PID="$(<"$TEST_DIR/web.pid")"
kill -TERM "$ENGINE_PID"
wait_for_supervisor_status 0
assert_dead "$WEB_PID"
assert_port_free "$((BASE_PORT + 1))"
assert_port_free "$((BASE_PORT + 2))"
start_supervisor "$((BASE_PORT + 1))" "$((BASE_PORT + 2))"
kill -TERM "$SUPERVISOR_PID"
wait_for_supervisor_status 143

# Web crash cleanup releases the engine port too.
start_supervisor "$((BASE_PORT + 3))" "$((BASE_PORT + 4))"
ENGINE_PID="$(<"$TEST_DIR/engine.pid")"
WEB_PID="$(<"$TEST_DIR/web.pid")"
kill -TERM "$WEB_PID"
wait_for_supervisor_status 0
assert_dead "$ENGINE_PID"
assert_port_free "$((BASE_PORT + 3))"
assert_port_free "$((BASE_PORT + 4))"

# A normal non-zero child exit is preserved for Railway's ON_FAILURE restart policy.
start_supervisor "$((BASE_PORT + 5))" "$((BASE_PORT + 6))" env TEST_WEB_EXIT_CODE=7 TEST_WEB_EXIT_DELAY_MS=200
ENGINE_PID="$(<"$TEST_DIR/engine.pid")"
wait_for_supervisor_status 7
assert_dead "$ENGINE_PID"
assert_port_free "$((BASE_PORT + 5))"
assert_port_free "$((BASE_PORT + 6))"

echo "start-railway supervision: PASS"
