import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// TSK-194 — los dos guardias PreToolUse de Fase 9. Se ejercitan por spawn (payload JSON
// por stdin, exit 0 = permitir, exit 2 = bloquear), igual que los invocaría Claude Code.
// D2K_TASKS_DIR apunta el guardia a un directorio de tickets de fixture: ninguna prueba
// depende del estado real de docs/agents/tasks/.

const REPO = join(import.meta.dir, "..", "..");
let tasksDir: string;

function ticket(name: string, frontmatter: Record<string, string>): void {
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  writeFileSync(join(tasksDir, name), `---\n${fm}\n---\n\ncuerpo\n`);
}

async function runGuard(
  guard: "write-scope-guard" | "data-boundary-guard",
  filePath: string,
  env: Record<string, string> = {},
): Promise<number> {
  const proc = Bun.spawn(["python3", join(REPO, "scripts", "hooks", `${guard}.py`)], {
    stdin: Buffer.from(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: filePath } })),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, D2K_TASKS_DIR: tasksDir, ...env },
  });
  return await proc.exited;
}

beforeAll(() => {
  tasksDir = mkdtempSync(join(tmpdir(), "d2k-hook-"));
});
afterAll(() => {
  rmSync(tasksDir, { recursive: true, force: true });
});

// ---------- write-scope-guard ----------

test("write-scope: sin ticket en doing -> permite todo", async () => {
  ticket("TSK-900.md", { id: "TSK-900", state: "backlog", write_scope: '["eval/**"]' });
  expect(await runGuard("write-scope-guard", join(REPO, "apps/engine/src/mix.ts"))).toBe(0);
});

test("write-scope: ticket en doing con write_scope -> bloquea fuera, permite dentro", async () => {
  rmSync(join(tasksDir, "TSK-900.md"));
  ticket("TSK-901.md", { id: "TSK-901", state: "doing", write_scope: '["eval/**", "scripts/eval/foo.ts"]' });

  expect(await runGuard("write-scope-guard", join(REPO, "apps/engine/src/mix.ts"))).toBe(2);
  expect(await runGuard("write-scope-guard", join(REPO, "eval/golden/x.json"))).toBe(0);
  expect(await runGuard("write-scope-guard", join(REPO, "scripts/eval/foo.ts"))).toBe(0);
});

test("write-scope: journal.md y el propio ticket siempre pasan", async () => {
  expect(await runGuard("write-scope-guard", join(REPO, "docs/agents/journal.md"))).toBe(0);
  expect(await runGuard("write-scope-guard", join(REPO, "docs/agents/tasks/TSK-901.md"))).toBe(0);
});

test("write-scope: ticket en doing SIN write_scope -> no bloquea (retrocompat)", async () => {
  rmSync(join(tasksDir, "TSK-901.md"));
  ticket("TSK-902.md", { id: "TSK-902", state: "doing" });
  expect(await runGuard("write-scope-guard", join(REPO, "apps/engine/src/mix.ts"))).toBe(0);
});

test("write-scope: dos tickets en doing -> el hook no opina (WIP=1 es otro gate)", async () => {
  ticket("TSK-903.md", { id: "TSK-903", state: "doing", write_scope: '["eval/**"]' });
  // TSK-902 (sin scope) + TSK-903 ambos en doing
  expect(await runGuard("write-scope-guard", join(REPO, "apps/engine/src/mix.ts"))).toBe(0);
  rmSync(join(tasksDir, "TSK-902.md"));
  rmSync(join(tasksDir, "TSK-903.md"));
});

// ---------- data-boundary-guard ----------

test("data-boundary: bloquea data/curated/ sin autorización", async () => {
  ticket("TSK-910.md", { id: "TSK-910", state: "doing", write_scope: '["data/generated/**", "scripts/stats/**"]' });
  expect(await runGuard("data-boundary-guard", join(REPO, "data/curated/hero-x.json"))).toBe(2);
});

test("data-boundary: data/generated/ es libre", async () => {
  expect(await runGuard("data-boundary-guard", join(REPO, "data/generated/percentiles.json"))).toBe(0);
});

test("data-boundary: D2K_CURATE=1 permite curar a mano", async () => {
  expect(
    await runGuard("data-boundary-guard", join(REPO, "data/curated/hero-x.json"), { D2K_CURATE: "1" }),
  ).toBe(0);
});

test("data-boundary: un ticket que declara data/curated/ en write_scope sí puede", async () => {
  rmSync(join(tasksDir, "TSK-910.md"));
  ticket("TSK-911.md", { id: "TSK-911", state: "doing", write_scope: '["data/curated/**"]' });
  expect(await runGuard("data-boundary-guard", join(REPO, "data/curated/hero-x.json"))).toBe(0);
  rmSync(join(tasksDir, "TSK-911.md"));
});

test("ambos guardias ignoran tool calls que no son Edit/Write", async () => {
  const proc = Bun.spawn(["python3", join(REPO, "scripts/hooks/write-scope-guard.py")], {
    stdin: Buffer.from(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" } })),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, D2K_TASKS_DIR: tasksDir },
  });
  expect(await proc.exited).toBe(0);
});
