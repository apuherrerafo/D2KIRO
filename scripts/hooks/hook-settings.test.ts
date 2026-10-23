import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { slash } from "./hook-test-utils";

// Los hooks tal como están CONFIGURADOS en .claude/settings.json, ejecutados como los ejecuta
// Claude Code 2.1.270 (verificado en el binario instalado, no en la doc): el comando corre en un
// shell (Git Bash en Windows) con cwd = el directorio ACTUAL de la sesión, CLAUDE_PROJECT_DIR =
// raíz de arranque con barras '/', y SÓLO exit 2 bloquea — 1/127 son "non-blocking" y la
// herramienta se ejecuta igual. `onFailure` no existe para hooks en esa versión.

const REPO = realpathSync.native(join(import.meta.dir, "..", ".."));
const SUBDIR = join(REPO, "scripts", "hooks");

interface HookEntry {
  matcher: string;
  hooks: { type: string; command: string; timeout?: number }[];
}

const settings = JSON.parse(await Bun.file(join(REPO, ".claude", "settings.json")).text()) as {
  hooks: { PreToolUse: HookEntry[] } & Record<string, unknown>;
};

function commandFor(tool: string): string {
  const entry = settings.hooks.PreToolUse.find((e) => e.matcher.split("|").includes(tool));
  if (!entry) throw new Error(`ningún PreToolUse cubre ${tool}`);
  return entry.hooks[0].command;
}

let tasks: string;
let outside: string;

async function runConfigured(
  command: string,
  payload: Record<string, unknown>,
  projectDir: string,
  cwd = SUBDIR,
): Promise<number> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v !== undefined && !k.startsWith("GIT_") && !k.startsWith("D2K_")) env[k] = v;
  }
  const proc = Bun.spawn(["bash", "-c", command], {
    cwd,
    stdin: Buffer.from(JSON.stringify({ ...payload, cwd })),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...env, CLAUDE_PROJECT_DIR: slash(projectDir), D2K_TASKS_DIR: tasks },
  });
  return await proc.exited;
}

beforeAll(() => {
  tasks = mkdtempSync(join(tmpdir(), "d2k-settings-tasks-"));
  outside = mkdtempSync(join(tmpdir(), "d2k-settings-outside-"));
});
afterAll(() => {
  rmSync(tasks, { recursive: true, force: true });
  rmSync(outside, { recursive: true, force: true });
});

test("todo PreToolUse protector se ancla en $CLAUDE_PROJECT_DIR y convierte cualquier fallo en exit 2", () => {
  for (const entry of settings.hooks.PreToolUse) {
    for (const hook of entry.hooks) {
      expect(hook.command).toContain('"$CLAUDE_PROJECT_DIR/scripts/hooks/');
      expect(hook.command.trim().endsWith("|| exit 2")).toBe(true);
      expect(typeof hook.timeout).toBe("number");
    }
  }
});

test("cubre Bash y PowerShell (commit gate) y Edit/Write/MultiEdit/NotebookEdit (escrituras)", () => {
  expect(commandFor("Bash")).toContain("pretooluse-guard.sh");
  expect(commandFor("PowerShell")).toContain("pretooluse-guard.sh");
  for (const tool of ["Edit", "Write", "MultiEdit", "NotebookEdit"]) {
    expect(commandFor(tool)).toContain("pretooluse-edit-guard.sh");
  }
});

test("sin hooks por-edición que corran verify-simplicity (6fcf955: lentos y non-blocking)", () => {
  expect(settings.hooks.PostToolUse).toBeUndefined();
  expect(settings.hooks.SubagentStop).toBeUndefined();
});

test("desde un subdirectorio de la sesión, el comando configurado SÍ ejecuta el guard", async () => {
  const bash = commandFor("Bash");
  const edit = commandFor("Edit");
  expect(await runConfigured(bash, { tool_name: "Bash", tool_input: { command: "ls" } }, REPO)).toBe(0);
  const inside = { tool_name: "Edit", tool_input: { file_path: join(REPO, "apps", "no-existe.ts") } };
  expect(await runConfigured(edit, inside, REPO)).toBe(0);
  // Prueba de que el guard corrió de verdad (y no un exit 0 por no encontrarse nada):
  const out = { tool_name: "Edit", tool_input: { file_path: join(outside, "x.txt") } };
  expect(await runConfigured(edit, out, REPO)).toBe(2);
});

test("candado: la forma relativa anterior, desde un subdirectorio, daba 127 = non-blocking (falla abierta)", async () => {
  const legacy = "bash scripts/hooks/pretooluse-edit-guard.sh";
  const out = { tool_name: "Edit", tool_input: { file_path: join(outside, "x.txt") } };
  const code = await runConfigured(legacy, out, REPO);
  expect(code).not.toBe(0);
  expect(code).not.toBe(2);
});

test("fail-closed: CLAUDE_PROJECT_DIR sin los scripts -> exit 2 para todo, nunca 127", async () => {
  const empty = join(outside, "empty-project");
  mkdirSync(empty, { recursive: true });
  const ls = { tool_name: "Bash", tool_input: { command: "ls" } };
  expect(await runConfigured(commandFor("Bash"), ls, empty)).toBe(2);
  const inside = { tool_name: "Write", tool_input: { file_path: join(REPO, "x.ts") } };
  expect(await runConfigured(commandFor("Write"), inside, empty)).toBe(2);
});
