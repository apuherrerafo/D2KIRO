#!/usr/bin/env bun
// R1 S7 -- MVP startup ergonomics ("bun run dev:mvp"). The project has no root `dev` script: the
// two processes (apps/engine, apps/web) are meant to run separately, but a non-coder owner testing
// the R1 MVP should not have to open two terminals and hand-generate session secrets. This starts
// both with matching env, prints the one URL that matters, and stops both cleanly on Ctrl+C.
//
// Does NOT touch production auth: PUBLIC_BASE_URL/SESSION_SECRET/INTERNAL_AUTH_SECRET are real
// values the running processes actually enforce (same proxy.ts gate as Railway) -- the owner still
// logs in with their own real Steam account. See docs/r1/manual-mvp-test.md.

import { randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildFixtureCmEligibilitySnapshot } from "../e2e/fixtures/cm-eligibility";

const ROOT = resolve(import.meta.dir, "..");
const ENGINE_PORT = process.env.ENGINE_PORT ?? "4000";
const WEB_PORT = process.env.WEB_PORT ?? "3000";
const SESSION_SECRET = process.env.SESSION_SECRET ?? randomBytes(32).toString("hex");
const INTERNAL_AUTH_SECRET = process.env.INTERNAL_AUTH_SECRET ?? randomBytes(32).toString("hex");
const PUBLIC_BASE_URL = process.env.PUBLIC_BASE_URL ?? `http://127.0.0.1:${WEB_PORT}`;

// R1 S7 (Blocker 2, Captain's Mode entry point): sin esto, CM queda fail-closed también en local
// -- no hay depot real de Dota 2 en este entorno para producir el artefacto de elegibilidad real
// (ver apps/engine/src/draft-protocol/trusted-eligibility.ts). Mismo mecanismo que producción
// usaría (CM_ELIGIBILITY_ARTIFACT_PATH), nunca seteado por scripts/start-railway.sh, así que esto
// no cambia el comportamiento de producción. Rango amplio (1..150): cubre el catálogo real que
// `apps/engine` sincroniza de OpenDota al arrancar, sin acoplarse a ningún id específico.
const CM_ELIGIBILITY_PATH = resolve(ROOT, "apps/engine/data/dev-mvp-cm-eligibility.json");
mkdirSync(resolve(ROOT, "apps/engine/data"), { recursive: true });
writeFileSync(
  CM_ELIGIBILITY_PATH,
  JSON.stringify(buildFixtureCmEligibilitySnapshot(Array.from({ length: 150 }, (_, i) => i + 1))),
);

const children: ChildProcess[] = [];
let shuttingDown = false;

function startProcess(name: string, command: string, args: string[], cwd: string, env: Record<string, string>): ChildProcess {
  const child = spawn(command, args, { cwd, env: { ...process.env, ...env }, stdio: "inherit" });
  child.on("exit", (code) => {
    if (shuttingDown) return;
    console.error(`\n[dev:mvp] "${name}" se detuvo solo (código ${code}). Deteniendo el otro proceso.`);
    shutdown(1);
  });
  children.push(child);
  return child;
}

function shutdown(code: number): void {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill();
  }
  process.exit(code);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

console.log("[dev:mvp] Iniciando apps/engine y apps/web...");

startProcess(
  "apps/engine",
  "bun",
  ["run", "--watch", "src/index.ts"],
  resolve(ROOT, "apps/engine"),
  { ENGINE_PORT, INTERNAL_AUTH_SECRET, CM_ELIGIBILITY_ARTIFACT_PATH: CM_ELIGIBILITY_PATH },
);

startProcess(
  "apps/web",
  "bun",
  ["run", "dev", "--", "-p", WEB_PORT],
  resolve(ROOT, "apps/web"),
  {
    ENGINE_INTERNAL_URL: `http://127.0.0.1:${ENGINE_PORT}`,
    SESSION_SECRET,
    INTERNAL_AUTH_SECRET,
    PUBLIC_BASE_URL,
  },
);

setTimeout(() => {
  console.log("\n[dev:mvp] Listo (si ambos procesos arrancaron sin error arriba).");
  console.log(`[dev:mvp] Simulador:      ${PUBLIC_BASE_URL}/simulator`);
  console.log(`[dev:mvp] Motor (salud):  http://127.0.0.1:${ENGINE_PORT}/api/health`);
  console.log("[dev:mvp] Ctrl+C detiene los dos procesos.\n");
}, 3_000);
