import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// pretooluse-guard.sh decide a QUÉ árbol le aplica verify-simplicity.sh. Se ejercita por spawn
// (payload JSON por stdin, exit 0 = permitir, exit 2 = bloquear), con repos git temporales cuyo
// scripts/verify-simplicity.sh es un stub (exit 0 = limpio, exit 1 = con problemas). Ninguna
// prueba depende del contenido real del repo ni del verify-simplicity.sh real.

const GUARD = join(import.meta.dir, "pretooluse-guard.sh");
let base: string;
let clean: string;
let broken: string;

function slash(path: string): string {
  return path.replaceAll("\\", "/");
}

function makeRepo(name: string, verifyExit: number): string {
  const dir = join(base, name);
  mkdirSync(join(dir, "scripts"), { recursive: true });
  writeFileSync(join(dir, "scripts", "verify-simplicity.sh"), `#!/bin/bash\nexit ${verifyExit}\n`);
  const init = Bun.spawnSync(["git", "init", "-q", dir]);
  if (init.exitCode !== 0) throw new Error("git init falló");
  return slash(dir);
}

async function runGuard(cwd: string, command: string): Promise<number> {
  const proc = Bun.spawn(["bash", GUARD], {
    cwd,
    stdin: Buffer.from(JSON.stringify({ tool_name: "Bash", tool_input: { command } })),
    stdout: "pipe",
    stderr: "pipe",
  });
  return await proc.exited;
}

beforeAll(() => {
  base = mkdtempSync(join(tmpdir(), "d2k-guard-"));
  clean = makeRepo("clean", 0);
  broken = makeRepo("broken", 1);
});
afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

test("sin git commit/push no verifica nada, aunque el cwd tenga problemas", async () => {
  expect(await runGuard(broken, "ls -la")).toBe(0);
});

test("comportamiento original: git commit sin directorio explícito verifica el cwd", async () => {
  expect(await runGuard(broken, "git commit -m x")).toBe(2);
  expect(await runGuard(broken, "git push origin main")).toBe(2);
  expect(await runGuard(clean, "git commit -m x")).toBe(0);
});

test("cd <worktree limpio> && git commit, con el cwd con problemas -> permite", async () => {
  expect(await runGuard(broken, `cd ${clean} && git commit -m x`)).toBe(0);
});

test("git -C <worktree limpio> commit, con el cwd con problemas -> permite", async () => {
  expect(await runGuard(broken, `git -C ${clean} commit -m x`)).toBe(0);
});

test("cd <checkout con problemas> && git commit, con el cwd limpio -> BLOQUEA", async () => {
  expect(await runGuard(clean, `cd ${broken} && git commit -m x`)).toBe(2);
  expect(await runGuard(clean, `git -C ${broken} push origin x`)).toBe(2);
});

test("ambiguo -> cae al cwd (estricto): dos directivas de directorio", async () => {
  expect(await runGuard(broken, `cd ${clean} && cd ${broken} && git commit -m x`)).toBe(2);
  expect(await runGuard(broken, `cd ${clean} && git -C ${broken} commit -m x`)).toBe(2);
});

test("ambiguo -> cae al cwd (estricto): dos operaciones git, una sin directorio", async () => {
  expect(await runGuard(broken, `git -C ${clean} commit -m x && git commit -m y`)).toBe(2);
  expect(await runGuard(broken, `cd ${clean} && git commit -m x && git push`)).toBe(2);
});

test("ambiguo -> cae al cwd (estricto): --git-dir, --work-tree, GIT_DIR", async () => {
  expect(await runGuard(broken, `cd ${clean} && git --git-dir=${broken}/.git commit -m x`)).toBe(2);
  expect(await runGuard(broken, `cd ${clean} && GIT_DIR=${broken}/.git git commit -m x`)).toBe(2);
});

test("directorio inexistente o que no es repo -> cae al cwd (estricto)", async () => {
  expect(await runGuard(broken, "cd /no/existe/nada && git commit -m x")).toBe(2);
  expect(await runGuard(broken, `cd ${slash(base)} && git commit -m x`)).toBe(2);
});

test("el worktree objetivo con problemas bloquea aunque el cwd esté limpio (usa SU verify)", async () => {
  expect(await runGuard(clean, `cd ${broken} && git commit -m x`)).toBe(2);
  expect(await runGuard(clean, `cd ${clean} && git commit -m x`)).toBe(0);
});
