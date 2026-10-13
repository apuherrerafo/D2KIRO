// Starts an ISOLATED lab server for the Coach Motion V2 slice: `next start` of this worktree's build, loopback only, own port, own ephemeral secrets.
// usage: node scripts/coach-motion-v2/serve.mjs --port 3162 --state <state.json> [--log <file>] [--dist .next-coach-motion-v2-production]
// The lab stays behind the normal session gate (proxy.ts untouched). The state file holds the secrets + the child PID and is written outside the repo;
// `node scripts/coach-motion-v2/cookie.mjs <state.json>` prints a cookie for a human browser, capture/test scripts read SESSION_SECRET from it.
import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { openSync, writeFileSync } from "node:fs";
import { ROOT } from "./lib.mjs";

const arg = (name, fallback) => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : fallback;
};
const port = Number(arg("port", "3162"));
const state = arg("state");
const dist = arg("dist", ".next-coach-motion-v2-production");
if (!state) throw new Error("--state <file outside the repo> is required");
const secret = randomBytes(32).toString("hex");
const internal = randomBytes(32).toString("hex");
const log = openSync(arg("log", `${state}.log`), "a");
const child = spawn(process.execPath, [`${ROOT}/apps/web/node_modules/next/dist/bin/next`, "start", "-H", "127.0.0.1", "-p", String(port)], {
  cwd: `${ROOT}/apps/web`,
  detached: true,
  stdio: ["ignore", log, log],
  windowsHide: true,
  env: { ...process.env, SESSION_SECRET: secret, INTERNAL_AUTH_SECRET: internal, NEXT_DIST_DIR: dist },
});
child.unref();
writeFileSync(state, JSON.stringify({ pid: child.pid, port, secret, dist, startedAt: new Date().toISOString() }));
console.log(JSON.stringify({ pid: child.pid, port }));
