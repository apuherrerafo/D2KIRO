import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { READ_ONLY_AGENTS } from "../agents/contracts";
import { HOOKS_DIR } from "./hook-test-utils";

// TSK-257 — warden, sentinel y tracer son agentes de SOLO LECTURA. Quitar Write/Edit de su `tools:` no basta:
// con `Bash` pueden escribir igual (`echo x > f`, `sed -i`, `git checkout`, `python -c`). Claude Code incluye
// `agent_type` (y `agent_id` si es un subagente) en el payload de todo hook PreToolUse (verificado en el
// binario 2.1.329), así que el guard decide por identidad del agente, no por el texto de su Markdown.
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

describe("agentes de solo lectura: lo que SÍ pueden hacer (sin falsos positivos)", () => {
  const permitidos = [
    "git status",
    "git status --short",
    "git diff HEAD~1",
    "git diff origin/master...HEAD --stat",
    "git log --oneline -5",
    "git show HEAD:package.json",
    "git ls-files scripts/hooks",
    "git rev-parse --short HEAD",
    "git branch --show-current",
    "git worktree list",
    "git grep -n readonly -- scripts",
    "ls -la scripts/hooks",
    "cat package.json | head -20",
    'grep -rn "write_scope" scripts/',
    'rg -n "agent_type" scripts/hooks',
    "wc -l scripts/hooks/_hook_lib.py",
    "find scripts -name '*.ts' -newer package.json",
    "bun test scripts/hooks",
    "cd apps/web && bun run lint",
    "bunx tsc --noEmit --incremental false -p qa/tsconfig.json",
    "bun test scripts/hooks --bail --timeout 30000",
    'bun test -t "readonly" scripts/hooks',
    "bun run test",
    "bunx tsc --noEmit --incremental false",
    "bash scripts/verify-simplicity.sh",
    "gh pr view 170 --json state",
    "gh pr checks 170",
    "gh api repos/o/r/branches/main/protection",
    "git status && git diff --stat",
    "git log --oneline | head -3",
    'grep -c "a > b" docs/agents/x.md',
  ];
  for (const command of permitidos) {
    for (const agent of ["warden", "sentinel", "tracer"]) {
      test(`${agent}: ${command}`, async () => {
        const res = await guard(bash(command, agent));
        expect(res.stderr).toBe("");
        expect(res.code).toBe(0);
      });
    }
  }
});

describe("agentes de solo lectura: toda vía de escritura se bloquea", () => {
  const prohibidos: Array<[string, string]> = [
    ["redirección >", "echo x > f.txt"],
    ["redirección >>", "echo x >> f.txt"],
    ["redirección sin espacio", "cat a>b"],
    ["heredoc", "cat <<EOF\nx\nEOF"],
    ["tee", "cat a | tee b"],
    ["rm", "rm -rf apps"],
    ["mv", "mv a b"],
    ["cp", "cp a b"],
    ["touch", "touch f"],
    ["mkdir", "mkdir d"],
    ["sed -i", "sed -i s/a/b/ f"],
    ["git commit", "git commit -m x"],
    ["git add", "git add -A"],
    ["git checkout", "git checkout -- ."],
    ["git restore", "git restore ."],
    ["git reset", "git reset --hard"],
    ["git stash", "git stash"],
    ["git push", "git push origin HEAD"],
    ["git apply", "git apply p.diff"],
    ["git clean", "git clean -fd"],
    ["git config (escribe)", "git config user.name x"],
    ["git diff --output", "git diff --output=out.txt"],
    ["git log --output", "git log --output=out.txt"],
    ["git con opción global", "git -c core.pager=x status"],
    ["git branch -D", "git branch -D feat"],
    ["git branch crea", "git branch nueva"],
    ["git worktree add", "git worktree add ../x"],
    ["git remote add", "git remote add x u"],
    ["interprete python", 'python3 -c "open(\'f\',\'w\').write(\'x\')"'],
    ["interprete node", "node -e 1"],
    ["interprete bun -e", "bun -e 1"],
    ["bash -c", 'bash -c "touch f"'],
    ["sh -c", 'sh -c "touch f"'],
    ["bash script arbitrario", "bash scripts/hub.ts"],
    ["bun run script arbitrario", "bun run build"],
    ["bun script directo", "bun scripts/hub.ts"],
    ["bun install", "bun install"],
    ["bun test con actualización", "bun test --update-snapshots"],
    ["bun test ruta absoluta", "bun test /tmp/attacker.test.ts"],
    ["bun test ruta con ..", "bun test ../attacker.test.ts"],
    ["bun test ruta UNC", "bun test //server/share/attacker.test.ts"],
    ["bun test ruta con unidad", "bun test C:/x/attacker.test.ts"],
    ["bun test --preload", "bun test --preload 'data:text/javascript,console.log(1)'"],
    ["bun test --require", "bun test --require x.js"],
    ["bun test --import", "bun test --import x.js"],
    ["bun test opción no revisada", "bun test --coverage-reporter=lcov"],
    ["git show --textconv", "git show --textconv HEAD:package.json"],
    ["git diff --textconv", "git diff --textconv"],
    ["git cat-file --filters", "git cat-file --filters HEAD:package.json"],
    ["git grep -O adjunto", "git grep -O\"sh -c 'touch x'\" needle"],
    ["git grep -Opager", "git grep -Osh needle"],
    ["cd al directorio padre", "cd .. && bun test"],
    ["cd absoluto", "cd /tmp && bash scripts/verify-simplicity.sh"],
    ["cd home", "cd ~ && ls"],
    ["cd sin destino", "cd"],
    ["tsc sin --incremental false", "bunx tsc --noEmit --project apps/web/tsconfig.json"],
    ["tsc con --incremental true", "bunx tsc --noEmit --incremental true"],
    ["tsc con --incremental repetido", "bunx tsc --noEmit --incremental false --incremental"],
    ["tsc con --noEmit repetido y valor", "bunx tsc --noEmit --incremental false --noEmit false"],
    ["tsc --init", "bunx tsc --noEmit --incremental false --init"],
    ["tsc --project fuera", "bunx tsc --noEmit --incremental false -p ../x/tsconfig.json"],
    ["file -C escribe magic.mgc", "file -C"],
    ["uniq escribe el 2º archivo", "uniq in.txt out.txt"],
    ["tsc con --noEmit false", "bunx tsc --noEmit false"],
    ["tsc con --noEmit=false", "bunx tsc --noEmit=false"],
    ["sort --compress-program", "sort --compress-program=touch"],
    ["sort -T", "sort -T /tmp x"],
    ["git log --show-signature", "git log --show-signature -1"],
    ["gh pr view --web=true", "gh pr view 1 --web=true"],
    ["gh issue view -w=true", "gh issue view 1 -w=true"],
    ["gh pr view --web", "gh pr view 1 --web"],
    ["gh api --cache", "gh api repos/o/r --cache 1h"],
    ["sustitución $()", "cat $(touch f)"],
    ["sustitución backtick", "cat `touch f`"],
    ["sustitución dentro de comillas", 'cat "$(touch f)"'],
    ["encadenar con ;", "cat a; rm b"],
    ["encadenar con &&", "git status && rm b"],
    ["encadenar con ||", "git status || rm b"],
    ["encadenar con &", "sleep 1 & rm b"],
    ["salto de línea", "git status\nrm b"],
    ["subshell", "(rm b)"],
    ["variable de entorno previa", "FOO=1 git status"],
    ["env", "env rm b"],
    ["xargs", "git ls-files | xargs rm"],
    ["find -delete", "find . -delete"],
    ["find -exec", "find . -exec rm {} +"],
    ["find -fprint", "find . -fprint out.txt"],
    ["rg --pre", "rg --pre ./x foo"],
    ["sort -o", "sort -o out.txt in.txt"],
    ["curl", "curl -o f http://x"],
    ["gh api escritura", "gh api -X POST repos/o/r/issues"],
    ["gh api con campos", "gh api repos/o/r/issues -f title=x"],
    ["gh pr merge", "gh pr merge 1"],
    ["gh pr comment", "gh pr comment 1 -b x"],
    ["comando desconocido", "frobnicate --now"],
    ["comando vacío", ""],
    ["ruta absoluta a binario", "/bin/rm f"],
  ];
  for (const [name, command] of prohibidos) {
    for (const agent of ["warden", "sentinel", "tracer"]) {
      test(`${agent}: ${name}`, async () => {
        const res = await guard(bash(command, agent));
        expect(res.code).toBe(2);
        expect(res.stderr).toContain(agent);
      });
    }
  }

  test("PowerShell queda prohibido para estos agentes", async () => {
    const res = await guard(bash("Get-Content package.json", "warden", "PowerShell"));
    expect(res.code).toBe(2);
  });

  test("agent_type con espacio de nombres (plugin:warden) también cae bajo la regla", async () => {
    expect((await guard(bash("echo x > f", "plugin:warden"))).code).toBe(2);
  });

  test("espacio de nombres con sufijo (warden:untrusted) tampoco la esquiva", async () => {
    expect((await guard(bash("echo x > f", "warden:untrusted"))).code).toBe(2);
    expect((await guard(bash("echo x > f", "x/warden/y"))).code).toBe(2);
    expect((await guard(bash("echo x > f", "warden,untrusted"))).code).toBe(2);
    expect((await guard(bash("echo x > f", "plugin.warden"))).code).toBe(2);
  });

  test("mayúsculas no la esquivan", async () => {
    expect((await guard(bash("echo x > f", "Warden"))).code).toBe(2);
  });
});

describe("cd y symlinks", () => {
  test("cd a un symlink que apunta fuera de la sesión se bloquea; a una subcarpeta real se permite", async () => {
    const { mkdtempSync, mkdirSync, symlinkSync, realpathSync, rmSync } = await import("node:fs");
    const { tmpdir } = await import("node:os");
    const base = realpathSync(mkdtempSync(join(tmpdir(), "d2k-ro-")));
    try {
      const root = join(base, "root");
      mkdirSync(join(root, "sub"), { recursive: true });
      mkdirSync(join(base, "afuera"));
      symlinkSync(join(base, "afuera"), join(root, "escape"), "junction");
      const payload = (cmd: string) => ({ ...bash(cmd, "warden"), cwd: root });
      expect((await guard(payload("cd escape && ls"))).code).toBe(2);
      expect((await guard(payload("cd sub && cd ../.. && ls"))).code).toBe(2);
      expect((await guard(payload("cd sub && cd .. && ls"))).code).toBe(0);
      expect((await guard(payload("cd sub && ls"))).code).toBe(0);
      expect((await guard({ ...bash("cd sub", "warden"), cwd: undefined })).code).toBe(2);
      expect((await guard(payload("bun test escape/x.test.ts"))).code).toBe(2);
      expect((await guard(payload("bun test sub/x.test.ts"))).code).toBe(0);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
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
  test("agente de lectura sin tool_input.command -> bloquea", async () => {
    const res = await guard({ hook_event_name: "PreToolUse", tool_name: "Bash", tool_input: {}, agent_type: "warden" });
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
  test("pretooluse-guard.sh deja pasar una lectura de warden", async () => {
    const res = await run(["bash", CHAIN], bash("git status", "warden"));
    expect(res.code).toBe(0);
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
