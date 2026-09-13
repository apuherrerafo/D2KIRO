import { expect, test } from "bun:test";
import { statSync } from "node:fs";
import { join } from "node:path";

// R0.4/Task 27 (.kiro/specs/r0-engineering-baseline-recovery, requisito 4.5 c1-c3).
// Candado de regresión para la separación "escaneo barato / regenerador / trabajo pesado":
// ejercita el script REAL (spawn, igual que lo invocan PostToolUse/SubagentStop/pretooluse-guard),
// nunca un mock -- lo que se prueba es exactamente el mecanismo que corre en cada sesión real.
//
// No depende de datos curados/mutables: opera sobre el estado de git del propio checkout (igual
// que scripts/hooks/hook-guards.test.ts y hook-path-normalization.test.ts, que también spawnean
// los guardias reales contra el REPO real en vez de un fixture aislado).

const REPO = join(import.meta.dir, "..");
const HUB_HTML = join(REPO, "docs", "agents", "hub.html");

async function runGate(env: Record<string, string> = {}): Promise<{ code: number; stdout: string }> {
  const proc = Bun.spawn(["bash", "scripts/verify-simplicity.sh"], {
    cwd: REPO,
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [stdout, , code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { code, stdout };
}

test("AFTER EDIT: el escaneo barato NO regenera docs/agents/hub.html (sin VERIFY_COMMIT_GATE)", async () => {
  const before = statSync(HUB_HTML).mtimeMs;
  const { code, stdout } = await runGate();
  const after = statSync(HUB_HTML).mtimeMs;

  expect(after).toBe(before);
  // sync-context.ts imprime "sync-context: regenerando tablero..." cuando corre -- su ausencia en
  // stdout confirma que verify-simplicity.sh ya no lo invoca automáticamente (Task 27, c1/c2).
  expect(stdout).not.toContain("sync-context");
  expect(code).toBe(0);
});

test("commit gate PreToolUse (VERIFY_COMMIT_GATE=1) ya NO corre tsc/suites/backtest (c3)", async () => {
  const before = statSync(HUB_HTML).mtimeMs;
  const { code, stdout } = await runGate({ VERIFY_COMMIT_GATE: "1" });
  const after = statSync(HUB_HTML).mtimeMs;

  expect(after).toBe(before);
  expect(stdout).not.toContain("sync-context");
  // El banner del trabajo pesado (tsc + 3 suites + backtest) ya no debe imprimirse -- ese trabajo
  // vive ahora en PRE-PUSH (.husky/pre-push, Task 5) y en CI/INTELLIGENCE CI (Task 10).
  expect(stdout).not.toContain("Gate de commit");
  expect(stdout).not.toContain("gate de evaluación del motor");
  expect(code).toBe(0);
});

test("sync-context.ts sigue existiendo como acción explícita e independiente", async () => {
  const proc = Bun.spawn(["bash", "-lc", "test -f scripts/sync-context.ts"], { cwd: REPO });
  expect(await proc.exited).toBe(0);
});
