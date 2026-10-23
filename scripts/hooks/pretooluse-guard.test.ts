import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type HookOptions,
  type RepoFamily,
  bashPayload,
  makeRepoFamily,
  removeRepoFamily,
  runHook,
  slash,
} from "./hook-test-utils";

// pretooluse-guard.sh (+ commit-gate.py): gate de git commit/push. Se ejercita por spawn como lo
// invoca Claude Code (payload JSON por stdin con `cwd`, exit 0 = permitir, exit 2 = bloquear),
// contra worktrees REALES de un repo temporal cuyo verify-simplicity.sh es un stub que falla si
// existe BROKEN en ese worktree. Ninguna prueba depende del contenido del repo real.
//
// Cambio de contrato respecto de 4404a7c: un commit/push que apunta a OTRO worktree ya no se
// verifica contra ese árbol — se bloquea. Y lo ambiguo ya no "cae al cwd": se bloquea.

const GUARD = "pretooluse-guard.sh";
let fam: RepoFamily;

function session(cwd: string, extra: Partial<HookOptions> = {}): HookOptions {
  return { cwd, projectDir: fam.main, fam, ...extra };
}

async function gate(cwd: string, command: string, extra: Partial<HookOptions> = {}): Promise<number> {
  return (await runHook(GUARD, bashPayload(command, cwd), session(cwd, extra))).code;
}

function breakTree(worktree: string): void {
  writeFileSync(join(worktree, "BROKEN"), "");
}

beforeAll(() => {
  fam = makeRepoFamily();
});
afterAll(() => {
  removeRepoFamily(fam);
});
afterEach(() => {
  for (const wt of [fam.main, fam.linked, fam.nested]) rmSync(join(wt, "BROKEN"), { force: true });
});

// ---------- comportamiento base ----------

test("sin git commit/push no verifica nada, aunque el worktree tenga problemas", async () => {
  breakTree(fam.main);
  expect(await gate(fam.main, "ls -la")).toBe(0);
  expect(await gate(fam.main, "git status && git log --oneline -3")).toBe(0);
});

test("git commit/push del worktree de la sesión corre SU verify", async () => {
  expect(await gate(fam.main, "git commit -m x")).toBe(0);
  breakTree(fam.main);
  expect(await gate(fam.main, "git commit -m x")).toBe(2);
  expect(await gate(fam.main, "git push origin main")).toBe(2);
});

test("sesión que entró al worktree hermano verifica el hermano, no main (CLAUDE_PROJECT_DIR=main)", async () => {
  breakTree(fam.main);
  expect(await gate(fam.linked, "git commit -m x")).toBe(0);
  breakTree(fam.linked);
  expect(await gate(fam.linked, "git commit -m x")).toBe(2);
});

test("cwd en un subdirectorio: verifica el worktree completo", async () => {
  const sub = join(fam.main, "apps", "engine");
  mkdirSync(sub, { recursive: true });
  expect(await gate(sub, "git commit -m x")).toBe(0);
  breakTree(fam.main);
  expect(await gate(sub, "git commit -m x")).toBe(2);
});

test("commit + push en la misma línea, ambos en la sesión -> una verificación", async () => {
  expect(await gate(fam.main, "git add -A && git commit -m x && git push")).toBe(0);
  breakTree(fam.main);
  expect(await gate(fam.main, "git add -A && git commit -m x && git push")).toBe(2);
});

test("cd/-C dentro del propio worktree es legítimo", async () => {
  mkdirSync(join(fam.main, "apps"), { recursive: true });
  expect(await gate(fam.main, "cd apps && git commit -m x")).toBe(0);
  expect(await gate(fam.main, "git -C apps commit -m x")).toBe(0);
  expect(await gate(fam.main, `cd "${fam.main}" && git commit -m x`)).toBe(0);
});

// ---------- defectos del parser anterior (grep sobre el JSON) ----------

test("comillas en el comando ya no esconden el commit", async () => {
  breakTree(fam.main);
  expect(await gate(fam.main, 'git add "a b" && git commit -m "msg"')).toBe(2);
  expect(await gate(fam.main, 'echo "x" && git commit -m y')).toBe(2);
});

test("variantes de invocación de git se detectan", async () => {
  breakTree(fam.main);
  for (const cmd of [
    "git -c user.name=x commit -m y",
    "git --no-pager commit -m y",
    "git  commit -m y",
    "GIT_AUTHOR_NAME=x git commit -m y",
    "command git push",
    "git commit -m a\ngit push",
  ]) {
    expect(await gate(fam.main, cmd)).toBe(2);
  }
});

test("heredoc de mensaje de commit: el cuerpo es dato aunque diga 'git push'", async () => {
  const cmd = "git commit -m \"$(cat <<'EOF'\nfix: don't git push yet\n\nbody\nEOF\n)\"";
  expect(await gate(fam.main, cmd)).toBe(0);
  breakTree(fam.main);
  expect(await gate(fam.main, cmd)).toBe(2);
});

test("mencionar git commit como dato no dispara el gate", async () => {
  breakTree(fam.main);
  expect(await gate(fam.main, 'grep -rn "git commit" docs')).toBe(0);
  expect(await gate(fam.main, "gh pr create --title t --body 'run git push after review'")).toBe(0);
  expect(await gate(fam.main, "echo git commit")).toBe(0);
});

// ---------- cross-worktree: bloquea ----------

test("cd <otro worktree> && git commit -> BLOQUEA aunque ese árbol esté limpio", async () => {
  const res = await runHook(GUARD, bashPayload(`cd "${fam.linked}" && git commit -m x`, fam.main), session(fam.main));
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("fuera del worktree de la sesión");
});

test("git -C <otro worktree> commit/push -> BLOQUEA", async () => {
  expect(await gate(fam.main, `git -C "${fam.linked}" commit -m x`)).toBe(2);
  expect(await gate(fam.main, `git -C '${slash(fam.linked)}' push origin linked`)).toBe(2);
  expect(await gate(fam.linked, `git -C "${fam.main}" commit -m x`)).toBe(2);
});

test("worktree anidado en .claude/worktrees -> otro worktree, BLOQUEA", async () => {
  expect(await gate(fam.main, "cd .claude/worktrees/nested && git commit -m x")).toBe(2);
  expect(await gate(fam.nested, `cd "${fam.main}" && git commit -m x`)).toBe(2);
});

test("repo ajeno o directorio que no es repo -> BLOQUEA", async () => {
  expect(await gate(fam.main, `cd "${fam.foreign}" && git commit -m x`)).toBe(2);
  expect(await gate(fam.main, `cd "${fam.outside}" && git commit -m x`)).toBe(2);
  expect(await gate(fam.main, "cd /no/existe/nada && git commit -m x")).toBe(2);
});

test("subshell: el cd dentro de ( ) no se filtra afuera; fuera de ( ) sí", async () => {
  expect(await gate(fam.main, `(cd "${fam.linked}" && ls) && git commit -m x`)).toBe(0);
  expect(await gate(fam.main, `cd "${fam.linked}"; git commit -m x`)).toBe(2);
  expect(await gate(fam.main, `(cd "${fam.linked}" && git commit -m x)`)).toBe(2);
});

test("bash -c / eval se analizan por dentro", async () => {
  expect(await gate(fam.main, `bash -c "git -C '${slash(fam.linked)}' commit -m x"`)).toBe(2);
  expect(await gate(fam.main, 'eval "git commit -m x"')).toBe(0);
  breakTree(fam.main);
  expect(await gate(fam.main, 'eval "git commit -m x"')).toBe(2);
  expect(await gate(fam.main, "bash -lc 'git commit -m x'")).toBe(2);
});

// ---------- destino indeterminable: fail-closed ----------

test("fail-closed: directorio dinámico o desconocido", async () => {
  for (const cmd of [
    "cd $X && git commit -m x",
    "cd - && git commit -m x",
    "git -C $(pwd) commit -m x",
    "cd `pwd` && git push",
    "popd && git commit -m x",
  ]) {
    expect(await gate(fam.main, cmd)).toBe(2);
  }
});

test("fail-closed: --git-dir / --work-tree / GIT_DIR desvían el destino real", async () => {
  expect(await gate(fam.main, `git --git-dir="${fam.linked}/.git" commit -m x`)).toBe(2);
  expect(await gate(fam.main, "git --work-tree=../linked commit -m x")).toBe(2);
  expect(await gate(fam.main, "GIT_DIR=../linked/.git git commit -m x")).toBe(2);
  expect(await gate(fam.main, "export GIT_WORK_TREE=../linked && git commit -m x")).toBe(2);
});

test("fail-closed: commit/push dentro de algo que no se puede seguir", async () => {
  for (const cmd of [
    "echo $(git commit -m x)",
    "ls | xargs git commit -m x",
    "find . -name x -exec git push \\;",
    "bash <<'EOF'\ngit commit -m x\nEOF",
    "python3 -c \"import os; os.system('git commit -m x')\"",
  ]) {
    expect(await gate(fam.main, cmd)).toBe(2);
  }
});

test("fail-closed: comando sin cerrar que menciona git commit", async () => {
  expect(await gate(fam.main, 'git commit -m "sin cerrar')).toBe(2);
});

test("fail-closed: contexto inválido con git commit (sin cwd, sin CLAUDE_PROJECT_DIR, JSON roto)", async () => {
  const noCwd = { tool_name: "Bash", tool_input: { command: "git commit -m x" } };
  expect((await runHook(GUARD, noCwd, session(fam.main))).code).toBe(2);
  expect(await gate(fam.main, "git commit -m x", { projectDir: null })).toBe(2);
  expect((await runHook(GUARD, "{roto", session(fam.main))).code).toBe(2);
  expect(await gate(fam.outside, "git commit -m x")).toBe(2);
});

test("sin git commit/push, un contexto inválido no bloquea comandos comunes", async () => {
  const noCwd = { tool_name: "Bash", tool_input: { command: "ls -la" } };
  expect((await runHook(GUARD, noCwd, session(fam.main))).code).toBe(0);
  expect(await gate(fam.main, "ls", { projectDir: null })).toBe(0);
});

test("fail-closed: el worktree de la sesión no tiene verify-simplicity.sh", async () => {
  expect(await gate(fam.outside, "ls")).toBe(0);
  const bare = join(fam.nested, "scripts", "verify-simplicity.sh");
  const saved = await Bun.file(bare).text();
  rmSync(bare);
  try {
    expect(await gate(fam.nested, "git commit -m x")).toBe(2);
  } finally {
    writeFileSync(bare, saved);
  }
});

test("fail-closed: verify que no termina antes del deadline del gate -> bloquea", async () => {
  const script = join(fam.nested, "scripts", "verify-simplicity.sh");
  const saved = await Bun.file(script).text();
  writeFileSync(script, "#!/bin/bash\nsleep 20\nexit 0\n");
  try {
    const started = Date.now();
    expect(await gate(fam.nested, "git commit -m x", { env: { D2K_COMMIT_GATE_TIMEOUT_S: "1" } })).toBe(2);
    expect(Date.now() - started).toBeLessThan(15000);
  } finally {
    writeFileSync(script, saved);
  }
});

test("PowerShell: commit/push por esa vía se bloquea; el resto pasa", async () => {
  const ps = (command: string) => runHook(GUARD, bashPayload(command, fam.main, "PowerShell"), session(fam.main));
  expect((await ps("git commit -m x")).code).toBe(2);
  expect((await ps("Get-ChildItem")).code).toBe(0);
});

test("fail-closed: python3 roto -> el wrapper devuelve 2", async () => {
  const fakeBin = join(fam.base, "fakebin-commit");
  mkdirSync(fakeBin, { recursive: true });
  await Bun.write(join(fakeBin, "python3"), "#!/bin/sh\nexit 1\n");
  Bun.spawnSync(["chmod", "+x", join(fakeBin, "python3")]);
  const sep = process.platform === "win32" ? ";" : ":";
  expect(await gate(fam.main, "ls", { env: { PATH: `${fakeBin}${sep}${process.env.PATH ?? ""}` } })).toBe(2);
});

// ---------- rutas Windows dentro del comando Bash ----------

test.skipIf(process.platform !== "win32")("Windows: rutas MSYS (/c/...), con barra invertida entre comillas y unidad en minúscula", async () => {
  const msys = (p: string) => slash(p).replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
  const lower = (p: string) => p.charAt(0).toLowerCase() + p.slice(1);
  expect(await gate(fam.main, `cd ${msys(fam.linked)} && git commit -m x`)).toBe(2);
  expect(await gate(fam.main, `cd ${msys(fam.main)} && git commit -m x`)).toBe(0);
  expect(await gate(fam.main, `git -C "${fam.linked}" commit -m x`)).toBe(2);
  expect(await gate(fam.main, `git -C "${lower(fam.main)}" commit -m x`)).toBe(0);
  expect(await gate(lower(fam.main), "git commit -m x")).toBe(0);
});
