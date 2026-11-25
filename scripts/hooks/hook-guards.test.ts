import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BODY_EDIT } from "./hook-test-utils";

// TSK-194 — los dos guardias PreToolUse de Fase 9. Se ejercitan por spawn (payload JSON
// por stdin, exit 0 = permitir, exit 2 = bloquear), igual que los invocaría Claude Code: con
// `cwd` en el payload (el worktree de la sesión) y CLAUDE_PROJECT_DIR en el entorno.
// D2K_TASKS_DIR apunta el guardia a un directorio de tickets de fixture: ninguna prueba
// depende del estado real de docs/agents/tasks/. El aislamiento entre worktrees se prueba en
// edit-guard-worktree.test.ts.

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
    stdin: Buffer.from(JSON.stringify({ tool_name: "Edit", tool_input: { file_path: filePath, ...BODY_EDIT }, cwd: REPO })),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO, D2K_TASKS_DIR: tasksDir, ...env },
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

test("write-scope: dos tickets en doing y uno con write_scope -> alcance ambiguo, bloquea", async () => {
  // Antes el hook "no opinaba" y dejaba pasar todo: con dos tickets no se sabe qué alcance autoriza.
  ticket("TSK-903.md", { id: "TSK-903", state: "doing", write_scope: '["eval/**"]' });
  // TSK-902 (sin scope) + TSK-903 ambos en doing
  expect(await runGuard("write-scope-guard", join(REPO, "apps/engine/src/mix.ts"))).toBe(2);
  expect(await runGuard("write-scope-guard", join(REPO, "eval/golden/x.json"))).toBe(2);
  rmSync(join(tasksDir, "TSK-902.md"));
  rmSync(join(tasksDir, "TSK-903.md"));
});

test("write-scope: dos tickets en doing, ninguno con write_scope -> no bloquea (retrocompat)", async () => {
  ticket("TSK-904.md", { id: "TSK-904", state: "doing" });
  ticket("TSK-905.md", { id: "TSK-905", state: "doing" });
  expect(await runGuard("write-scope-guard", join(REPO, "apps/engine/src/mix.ts"))).toBe(0);
  rmSync(join(tasksDir, "TSK-904.md"));
  rmSync(join(tasksDir, "TSK-905.md"));
});

// ---------- write-scope-guard: interpretación de assigned_tool (TSK-256) ----------
// Sólo codex / kiro-nativo / hermes-vps EXACTOS sacan a un ticket del gobierno de Claude Code.
// Todo lo demás (null, vacío, desconocido, malformado, otra capitalización, valor en el cuerpo)
// gobierna: un valor no reconocido nunca amplía permisos.

function rawTicket(name: string, raw: string): void {
  writeFileSync(join(tasksDir, name), raw);
}

const OUT_OF_SCOPE = () => join(REPO, "apps/engine/src/mix.ts");

const GOVERNS_CLAUDE: Array<[string, string]> = [
  ["ausente", ""],
  ["null", "assigned_tool: null"],
  ["null entre comillas dobles", 'assigned_tool: "null"'],
  ["null entre comillas simples", "assigned_tool: 'null'"],
  ["~ (null YAML)", "assigned_tool: ~"],
  ["vacío", "assigned_tool:"],
  ["vacío con espacios", "assigned_tool:    "],
  ["comillas vacías", 'assigned_tool: ""'],
  ["claude-code", "assigned_tool: claude-code"],
  ["claude-code entre comillas", 'assigned_tool: "claude-code"'],
  ["desconocido", "assigned_tool: gemini"],
  ["capitalización distinta", "assigned_tool: Codex"],
  ["MAYÚSCULAS", "assigned_tool: CODEX"],
  ["codex con comentario", "assigned_tool: codex # temporal"],
  ["codex con sufijo", "assigned_tool: codex-2"],
  ["lista YAML", "assigned_tool: [codex]"],
  ["comilla sin cerrar", 'assigned_tool: "codex'],
  ["sin espacio tras ':'", "assigned_tool:null"],
];

for (const [label, line] of GOVERNS_CLAUDE) {
  test(`write-scope assigned_tool: ${label} -> el ticket doing gobierna a Claude (bloquea fuera de scope)`, async () => {
    const extra = line ? `${line}
` : "";
    rawTicket("TSK-920.md", `---
id: TSK-920
state: doing
${extra}write_scope: ["eval/**"]
---

cuerpo
`);
    expect(await runGuard("write-scope-guard", OUT_OF_SCOPE())).toBe(2);
    expect(await runGuard("write-scope-guard", join(REPO, "eval/golden/x.json"))).toBe(0);
    rmSync(join(tasksDir, "TSK-920.md"));
  });
}

// TSK-268: una clave desconocida ya no se ignora; la ficha es inválida y bloquea dentro y fuera del alcance.
test("write-scope assigned_tool: clave desconocida con prefijo -> ficha inválida, bloquea todo", async () => {
  rawTicket("TSK-920.md", `---\nid: TSK-920\nstate: doing\nx_assigned_tool: codex\nwrite_scope: ["eval/**"]\n---\n`);
  expect(await runGuard("write-scope-guard", OUT_OF_SCOPE())).toBe(2);
  expect(await runGuard("write-scope-guard", join(REPO, "eval/golden/x.json"))).toBe(2);
  rmSync(join(tasksDir, "TSK-920.md"));
});

const OTHER_TOOLS: Array<[string, string]> = [
  ["codex", "assigned_tool: codex"],
  ["kiro-nativo", "assigned_tool: kiro-nativo"],
  ["hermes-vps", "assigned_tool: hermes-vps"],
  ["codex entre comillas dobles", 'assigned_tool: "codex"'],
  ["codex entre comillas simples", "assigned_tool: 'codex'"],
  ["codex con espacios finales", "assigned_tool: codex   "],
];

for (const [label, line] of OTHER_TOOLS) {
  test(`write-scope assigned_tool: ${label} -> NO gobierna a Claude (WIP por herramienta)`, async () => {
    rawTicket("TSK-921.md", `---
id: TSK-921
state: doing
${line}
write_scope: ["eval/**"]
---

cuerpo
`);
    expect(await runGuard("write-scope-guard", OUT_OF_SCOPE())).toBe(0);
    rmSync(join(tasksDir, "TSK-921.md"));
  });
}

test("write-scope assigned_tool: un 'assigned_tool: codex' en el CUERPO no saca al ticket del gobierno", async () => {
  rawTicket(
    "TSK-922.md",
    `---
id: TSK-922
state: doing
write_scope: ["eval/**"]
---

assigned_tool: codex
`,
  );
  expect(await runGuard("write-scope-guard", OUT_OF_SCOPE())).toBe(2);
  rmSync(join(tasksDir, "TSK-922.md"));
});

test("write-scope assigned_tool: null + ticket de codex en doing -> sólo el null gobierna", async () => {
  rawTicket("TSK-923.md", `---
id: TSK-923
state: doing
assigned_tool: null
write_scope: ["eval/**"]
---
`);
  rawTicket("TSK-924.md", `---
id: TSK-924
state: doing
assigned_tool: codex
write_scope: ["apps/**"]
---
`);
  expect(await runGuard("write-scope-guard", OUT_OF_SCOPE())).toBe(2);
  expect(await runGuard("write-scope-guard", join(REPO, "eval/golden/x.json"))).toBe(0);
  rmSync(join(tasksDir, "TSK-923.md"));
  rmSync(join(tasksDir, "TSK-924.md"));
});

const RAW_CASES: Array<[string, string, number]> = [
  ["clave duplicada (codex primero)", `---\nstate: doing\nassigned_tool: codex\nassigned_tool: claude-code\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["clave duplicada (claude-code primero)", `---\nstate: doing\nassigned_tool: claude-code\nassigned_tool: codex\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["clave duplicada, las dos codex (sigue ambigua)", `---\nstate: doing\nassigned_tool: codex\nassigned_tool: codex\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["CRLF + codex -> otra herramienta", `---\r\nstate: doing\r\nassigned_tool: codex\r\nwrite_scope: ["eval/**"]\r\n---\r\n`, 0],
  ["state con comentario -> el ticket gobierna", `---\nstate: doing # en curso\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["state entre comillas con comentario -> el ticket gobierna", `---\nstate: "doing" # en curso\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["state con tab -> el ticket gobierna", `---\nstate:	doing\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["state sin espacio -> el ticket gobierna", `---\nstate:doing\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["state entre comillas simples -> el ticket gobierna", `---\nstate: 'doing'\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["state typo doingX -> ficha inválida, bloquea", `---\nstate: doingX\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["state typo entre comillas -> ficha inválida, bloquea", `---\nstate: "doingX"\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["BOM inicial + codex -> otra herramienta", `\uFEFF---\nstate: doing\nassigned_tool: codex\nwrite_scope: ["eval/**"]\n---\n`, 0],
  ["BOM inicial + null -> gobierna", `\uFEFF---\nstate: doing\nassigned_tool: null\nwrite_scope: ["eval/**"]\n---\n`, 2],
  ["espacios tras --- + codex -> otra herramienta", `---   \nstate: doing\nassigned_tool: codex\nwrite_scope: ["eval/**"]\n---   \n`, 0],
  ["CRLF + null -> gobierna",`---\r\nstate: doing\r\nassigned_tool: null\r\nwrite_scope: ["eval/**"]\r\n---\r\n`, 2],
  ["sin frontmatter -> ficha inválida, bloquea", `state: doing\nassigned_tool: codex\nwrite_scope: ["eval/**"]\n`, 2],
  ["frontmatter sin cerrar -> ficha inválida, bloquea", `---\nstate: doing\nassigned_tool: codex\nwrite_scope: ["eval/**"]\n`, 2],
  ["'---' dentro del cuerpo no extiende el frontmatter", `---\nstate: doing\nwrite_scope: ["eval/**"]\n---\n\ntexto\n---\nassigned_tool: codex\n`, 2],
];

for (const [label, raw, expected] of RAW_CASES) {
  test(`write-scope assigned_tool (crudo): ${label} -> exit ${expected}`, async () => {
    rawTicket("TSK-925.md", raw);
    expect(await runGuard("write-scope-guard", OUT_OF_SCOPE())).toBe(expected);
    rmSync(join(tasksDir, "TSK-925.md"));
  });
}

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
    stdin: Buffer.from(JSON.stringify({ tool_name: "Bash", tool_input: { command: "ls" }, cwd: REPO })),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, CLAUDE_PROJECT_DIR: REPO, D2K_TASKS_DIR: tasksDir },
  });
  expect(await proc.exited).toBe(0);
});
