#!/usr/bin/env bun
// `bun run dev:live` -- local runner for a REAL Dota 2 match (Overwolf capture -> engine -> /live-draft).
//
// Unlike dev:mvp it starts the PRODUCTION engine entrypoint (apps/engine/src/index.ts, no test-only
// capability) bound to 127.0.0.1:4000, and the web on http://127.0.0.1:3000 with the live draft enabled.
// It mints a session id + capture token per run and writes them ONLY to the gitignored local config the
// Overwolf capturer reads (replaced every run, removed on exit). Child output goes to .local/dev-live.log;
// the console shows only the ready banner. Nothing here is deployed or sent anywhere but 127.0.0.1.

import { randomBytes, randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, openSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  LIVE_ENGINE_ENTRYPOINT,
  LIVE_ENGINE_HOST,
  LIVE_ENGINE_URL,
  LIVE_WEB_PORT,
  LIVE_WEB_URL,
  buildLiveCaptureConfig,
  engineEnv,
  liveCaptureConfigPaths,
  readyBanner,
  webEnv,
} from "./dev-live-config";
import { resolveMvpDatabasePath } from "./dev-mvp-config";
import { ensureManualMvpDatabase } from "./dev-mvp-db";

const ROOT = resolve(import.meta.dir, "..");
const READY_TIMEOUT_MS = 180_000;

const sessionId = randomUUID();
const secrets = {
  captureToken: randomBytes(32).toString("hex"),
  sessionSecret: randomBytes(32).toString("hex"),
  internalAuthSecret: randomBytes(32).toString("hex"),
};
const configPaths = liveCaptureConfigPaths(ROOT);
const children: ChildProcess[] = [];
let shuttingDown = false;

function removeCaptureConfig(): void {
  for (const path of configPaths) rmSync(path, { force: true });
}

function writeCaptureConfig(): void {
  removeCaptureConfig();
  const body = `${JSON.stringify(buildLiveCaptureConfig(sessionId, secrets.captureToken), null, 2)}\n`;
  for (const path of configPaths) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, body, { mode: 0o600 });
  }
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) if (!child.killed) child.kill();
  removeCaptureConfig();
  process.exit(code);
}

function startProcess(name: string, args: string[], cwd: string, env: Record<string, string>, logFd: number): void {
  const child = spawn("bun", args, { cwd, env: { ...process.env, ...env }, stdio: ["ignore", logFd, logFd] });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`[dev:live] "${name}" se detuvo (código ${code}). Ver .local/dev-live.log`);
    shutdown(1);
  });
  children.push(child);
}

async function waitFor(url: string): Promise<boolean> {
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.status < 500) return true;
    } catch {
      // not up yet
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 1_000));
  }
  return false;
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

const databasePath = resolveMvpDatabasePath(ROOT, process.env.ENGINE_DB_PATH);
try {
  ensureManualMvpDatabase(databasePath);
} catch {
  console.error("[dev:live] No se pudo preparar la SQLite local con las migraciones reales.");
  process.exit(1);
}

mkdirSync(resolve(ROOT, ".local"), { recursive: true });
const logFd = openSync(resolve(ROOT, ".local/dev-live.log"), "w");
writeCaptureConfig();

startProcess("apps/engine", ["run", LIVE_ENGINE_ENTRYPOINT], resolve(ROOT, "apps/engine"), engineEnv(secrets, databasePath), logFd);
startProcess("apps/web", ["run", "dev", "--", "-p", String(LIVE_WEB_PORT), "-H", LIVE_ENGINE_HOST], resolve(ROOT, "apps/web"), webEnv(secrets), logFd);

const ready = (await waitFor(`${LIVE_ENGINE_URL}/api/health`)) && (await waitFor(`${LIVE_WEB_URL}/login`));
if (!ready) {
  console.error("[dev:live] El motor o la web no respondieron a tiempo. Ver .local/dev-live.log");
  shutdown(1);
}
for (const line of readyBanner(sessionId)) console.log(line);
