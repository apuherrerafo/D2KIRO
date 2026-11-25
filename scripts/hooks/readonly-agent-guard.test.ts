import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READ_ONLY_AGENTS } from "../agents/contracts";
import { HOOKS_DIR } from "./hook-test-utils";

// TSK-261 — warden, sentinel y tracer no tienen Bash en su `tools:` (control real, ver contracts.test.ts). Este hook
// es la defensa adicional por si esa lista se reabre (`--agents`, edición del frontmatter): bloquea TODO Bash/PowerShell
// de esas identidades, sin interpretar el comando. Antes (TSK-257) intentaba distinguir lecturas y falló 5 revisiones.
// Se ejercita por spawn, igual que lo invoca Claude Code: payload JSON por stdin, exit 0 = permitir, 2 = bloquear.

const GUARD = join(HOOKS_DIR, "readonly-agent-guard.py");
const CHAIN = join(HOOKS_DIR, "pretooluse-guard.sh");

async function run(script: string[], payload: unknown): Promise<{ code: number; stderr: string }> {
  const proc = Bun.spawn(script, {
    stdin: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, D2K_HOOK_BASH: "bash" },
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

const guard = (payload: unknown) => run(["python3", GUARD], payload);
const bash = (command: string, agentType: string | undefined, tool = "Bash") => ({
  hook_event_name: "PreToolUse",
  tool_name: tool,
  tool_input: { command },
  cwd: process.cwd(),
  ...(agentType === undefined ? {} : { agent_type: agentType, agent_id: "a1b2c3" }),
});

describe("agentes de solo lectura: ningún comando de shell, ni siquiera uno de lectura", () => {
  const comandos = [
    // lecturas que el guard anterior permitía
    "git status", "git diff HEAD~1", "cat package.json", "ls", "rg -n foo scripts", "gh pr view 1 --json title",
    // ejecución de código del repo que el guard anterior permitía (y por la que un revisor podía escribir)
    "bun run test", "bun test scripts/hooks", "bunx tsc --noEmit", "bash scripts/verify-simplicity.sh",
    // escrituras y evasiones históricas
    "echo x > f", "sed -i s/a/b/ README.md", "git checkout -- .", "true #'\ntouch PWNED #'", "",
  ];
  for (const agent of ["warden", "sentinel", "tracer"]) {
    for (const tool of ["Bash", "PowerShell"]) {
      for (const command of comandos) {
        test(`${agent} ${tool}: ${JSON.stringify(command)}`, async () => {
          const res = await guard(bash(command, agent, tool));
          expect(res.code).toBe(2);
          expect(res.stderr).toContain("evidencia");
        });
      }
    }
  }
  test("agent_type con espacio de nombres, sufijo o mayúsculas no esquiva la regla", async () => {
    for (const agent of ["plugin:warden", "warden:untrusted", " Warden ", "SENTINEL"]) {
      expect((await guard(bash("git status", agent))).code).toBe(2);
    }
  });
  test("las herramientas que no son de shell no las decide este hook", async () => {
    expect((await guard({ tool_name: "Read", tool_input: { file_path: "x" }, agent_type: "warden" })).code).toBe(0);
  });
});

describe("el guard no estorba a quien no es de solo lectura", () => {
  test("hilo principal (sin agent_type) puede escribir", async () => {
    expect((await guard(bash("echo x > f", undefined))).code).toBe(0);
  });
  test("subagente de otro tipo (artisan) puede escribir", async () => {
    expect((await guard(bash("echo x > f", "artisan"))).code).toBe(0);
  });
  test("un nombre que CONTIENE un agente de lectura se restringe (fail-safe, aunque sea de más)", async () => {
    expect((await guard(bash("echo x > f", "wardenclyffe"))).code).toBe(2);
  });
});

describe("fallo cerrado", () => {
  test("payload que no es JSON -> bloquea", async () => {
    expect((await guard("no-json")).code).toBe(2);
  });
  test("payload que no es un objeto -> bloquea", async () => {
    expect((await guard("[1]")).code).toBe(2);
  });
  test("agente de lectura sin tool_input -> bloquea igual", async () => {
    const res = await guard({ hook_event_name: "PreToolUse", tool_name: "Bash", agent_type: "warden" });
    expect(res.code).toBe(2);
  });
  test("subagente (agent_id) sin agent_type -> bloquea: no se sabe si es de solo lectura", async () => {
    const res = await guard({ tool_name: "Bash", tool_input: { command: "git status" }, agent_id: "a1" });
    expect(res.code).toBe(2);
  });
  test("agent_type que no es texto -> bloquea (no se puede saber quién llama)", async () => {
    const res = await guard({ tool_name: "Bash", tool_input: { command: "echo x > f" }, agent_type: 7 });
    expect(res.code).toBe(2);
  });
});

describe("cableado: la cadena real de Bash aplica el guard", () => {
  test("pretooluse-guard.sh bloquea una escritura de warden", async () => {
    const res = await run(["bash", CHAIN], bash("echo x > f", "warden"));
    expect(res.code).toBe(2);
  }, 30_000);
  test("pretooluse-guard.sh bloquea también una lectura de warden", async () => {
    const res = await run(["bash", CHAIN], bash("git status", "warden"));
    expect(res.code).toBe(2);
  }, 30_000);
  test("pretooluse-guard.sh no cambia el comportamiento del hilo principal", async () => {
    const res = await run(["bash", CHAIN], bash("echo x > f", undefined));
    expect(res.code).toBe(0);
  }, 30_000);
});

describe("una sola fuente de verdad para quién es de solo lectura", () => {
  test("la lista del guard coincide con READ_ONLY_AGENTS de los contratos", () => {
    const src = readFileSync(GUARD, "utf8");
    const m = /^READ_ONLY_AGENTS\s*=\s*\(([^)]*)\)/m.exec(src);
    expect(m).not.toBeNull();
    const inGuard = [...(m?.[1] ?? "").matchAll(/"([^"]+)"/g)].map((x) => x[1]).sort();
    expect(inGuard).toEqual([...READ_ONLY_AGENTS].sort());
  });
});
