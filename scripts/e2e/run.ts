import { randomBytes } from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { createWriteStream } from "node:fs";
import { rm } from "node:fs/promises";
import { createServer } from "node:net";
import { resolve } from "node:path";
import { runtimeForCurrentProcess, prepareLocalRuntime } from "../../e2e/runtime";

const root = resolve(import.meta.dir, "../..");
const runtime = runtimeForCurrentProcess();
const logs = createWriteStream(resolve(runtime.dir, "runtime.log"), { flags: "a" });
interface ManagedChild {
  child: ChildProcess;
  done: Promise<number>;
  exited: boolean;
}

const children: ManagedChild[] = [];

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

function reservePort(): Promise<number> {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return reject(new Error("could not reserve a local QA port"));
      server.close((error) => error ? reject(error) : resolvePort(address.port));
    });
  });
}

function start(command: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ManagedChild {
  const child = spawn(command, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout?.pipe(logs, { end: false });
  child.stderr?.pipe(logs, { end: false });
  const managed: ManagedChild = { child, exited: false, done: Promise.resolve(1) };
  managed.done = new Promise((resolveExit, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => {
      managed.exited = true;
      resolveExit(code ?? 1);
    });
  });
  children.push(managed);
  return managed;
}

async function waitForExit(managed: ManagedChild, label: string): Promise<void> {
  const code = await managed.done;
  if (code !== 0) throw new Error(`${label} exited with code ${code}; diagnostics: ${runtime.dir}`);
}

async function waitForHttp(url: string, label: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastError = "not reachable";
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
      lastError = `HTTP ${response.status}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await delay(200);
  }
  throw new Error(`${label} did not become ready: ${lastError}; diagnostics: ${runtime.dir}`);
}

async function terminate(managed: ManagedChild, label: string): Promise<void> {
  const { child } = managed;
  if (managed.exited || child.pid === undefined) return;
  child.kill("SIGTERM");
  const graceful = await Promise.race([managed.done.then(() => true), delay(10_000).then(() => false)]);
  if (graceful) return;
  // Windows has no process-group SIGTERM.  This only runs after the bounded graceful wait and
  // includes descendants, so Next/Bun cannot retain the SQLite runtime after the parent exits.
  const kill = spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { windowsHide: true });
  if (kill.status !== 0) throw new Error(`could not terminate ${label} (PID ${child.pid}): ${kill.stderr.toString()}`);
  const forced = await Promise.race([managed.done.then(() => true), delay(10_000).then(() => false)]);
  if (!forced) throw new Error(`${label} (PID ${child.pid}) did not exit after taskkill`);
}

async function cleanRuntime(): Promise<void> {
  let error: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await rm(runtime.dir, { recursive: true, force: true, maxRetries: 0 });
      return;
    } catch (caught) {
      error = caught;
      const code = (caught as NodeJS.ErrnoException).code;
      if (code !== "EPERM" && code !== "EBUSY") throw caught;
      // This is a cleanup-only bounded retry after every owned child exited, never a test retry.
      await delay(100);
    }
  }
  throw new Error(`runtime cleanup remained locked after child termination: ${String(error)}; preserved at ${runtime.dir}`);
}

async function main(): Promise<number> {
  prepareLocalRuntime(runtime);
  const [enginePort, webPort] = await Promise.all([reservePort(), reservePort()]);
  const sessionSecret = randomBytes(32).toString("hex");
  const internalAuthSecret = randomBytes(32).toString("hex");
  const sha = spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, windowsHide: true }).stdout.toString().trim();
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    E2E_MANAGED_RUNTIME: "1",
    E2E_RUNTIME_READY: "1",
    E2E_RUNTIME_DIR: runtime.dir,
    E2E_DB_PATH: runtime.dbPath,
    E2E_SESSION_SECRET: sessionSecret,
    E2E_INTERNAL_AUTH_SECRET: internalAuthSecret,
    E2E_ACCOUNT_ID: "999000001",
    E2E_ENGINE_PORT: String(enginePort),
    E2E_WEB_PORT: String(webPort),
    E2E_BASE_URL: `http://127.0.0.1:${webPort}`,
    E2E_COMMIT_SHA: sha,
  };

  const engine = start(process.execPath, ["run", "src/index.e2e.ts"], resolve(root, "apps/engine"), {
    ...env,
    ENGINE_PORT: String(enginePort),
    ENGINE_DB_PATH: runtime.dbPath,
    INTERNAL_AUTH_SECRET: internalAuthSecret,
    CM_ELIGIBILITY_ARTIFACT_PATH: runtime.eligibilityPath,
  });
  await waitForHttp(`http://127.0.0.1:${enginePort}/health`, "E2E engine", 120_000);

  const nextCli = resolve(root, "apps/web/node_modules/next/dist/bin/next");
  const build = start(process.execPath, [nextCli, "build"], resolve(root, "apps/web"), {
    ...env,
    ENGINE_INTERNAL_URL: `http://127.0.0.1:${enginePort}`,
    SESSION_SECRET: sessionSecret,
    INTERNAL_AUTH_SECRET: internalAuthSecret,
    NEXT_DIST_DIR: ".next-e2e",
  });
  await waitForExit(build, "E2E web build");

  const web = start(process.execPath, [nextCli, "start", "-p", String(webPort)], resolve(root, "apps/web"), {
    ...env,
    ENGINE_INTERNAL_URL: `http://127.0.0.1:${enginePort}`,
    SESSION_SECRET: sessionSecret,
    INTERNAL_AUTH_SECRET: internalAuthSecret,
    NEXT_DIST_DIR: ".next-e2e",
  });
  // `/simulator` is session-gated and correctly returns 503 before Playwright installs the
  // sealed fixture cookie.  `/healthz` establishes server readiness without bypassing that gate.
  await waitForHttp(`http://127.0.0.1:${webPort}/healthz`, "E2E web", 120_000);

  const playwright = start(process.execPath, ["x", "playwright", "test", ...process.argv.slice(2)], root, env);
  return await playwright.done;
}

let testCode = 1;
let lifecycleFailure: unknown;
try {
  testCode = await main();
} catch (error) {
  lifecycleFailure = error;
  console.error(error);
} finally {
  for (const child of [...children].reverse()) {
    try {
      await terminate(child, child.child.spawnargs.join(" "));
    } catch (error) {
      lifecycleFailure ??= error;
      console.error(error);
    }
  }
  await new Promise<void>((resolveLogs) => logs.end(resolveLogs));
  if (testCode === 0 && !lifecycleFailure) {
    try {
      await cleanRuntime();
    } catch (error) {
      lifecycleFailure = error;
      console.error(error);
    }
  } else {
    console.error(`E2E diagnostics preserved at ${runtime.dir}`);
  }
}

process.exitCode = lifecycleFailure ? 1 : testCode;
