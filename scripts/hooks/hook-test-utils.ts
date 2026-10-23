import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// Familia de repos temporales para probar los hooks contra worktrees REALES de git:
//   main     checkout principal (donde "arrancó" la sesión: CLAUDE_PROJECT_DIR)
//   linked   worktree hermano del mismo repo (fuera del árbol de main)
//   nested   worktree del mismo repo DENTRO de main (.claude/worktrees/nested)
//   foreign  otro repositorio
//   outside  directorio sin git
//   scratchWorktree  worktree del mismo repo dentro del scratchpad falso
// Cada worktree trae un verify-simplicity.sh stub que falla si existe el archivo BROKEN.
// HOME/TMP del hook apuntan a directorios falsos dentro de la familia: ni el scratchpad ni
// la memoria reales del usuario pueden volver permisiva una prueba.

export const HOOKS_DIR = import.meta.dir;

export interface RepoFamily {
  base: string;
  main: string;
  linked: string;
  nested: string;
  foreign: string;
  outside: string;
  fakeHome: string;
  fakeTmp: string;
  /** Worktree del mismo repo creado DENTRO del scratchpad falso. */
  scratchWorktree: string;
}

function git(args: string[], cwd?: string): void {
  const res = Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: cleanEnv(),
  });
  if (res.exitCode !== 0) throw new Error(`git ${args.join(" ")} falló: ${res.stderr.toString()}`);
}

function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (v === undefined || k.startsWith("GIT_") || k.startsWith("D2K_") || k === "CLAUDE_PROJECT_DIR") continue;
    env[k] = v;
  }
  return env;
}

function initRepo(dir: string, withVerify: boolean): void {
  mkdirSync(dir, { recursive: true });
  git(["init", "-q", "-b", "main", dir]);
  if (withVerify) {
    mkdirSync(join(dir, "scripts"), { recursive: true });
    writeFileSync(join(dir, "scripts", "verify-simplicity.sh"), "#!/bin/bash\n[ -f BROKEN ] && exit 1\nexit 0\n");
    git(["add", "scripts/verify-simplicity.sh"], dir);
  }
  git(["commit", "-q", "--allow-empty", "-m", "init"], dir);
}

export function makeRepoFamily(): RepoFamily {
  const base = realpathSync.native(mkdtempSync(join(tmpdir(), "d2k-wt-")));
  const main = join(base, "main");
  const linked = join(base, "linked");
  const nested = join(main, ".claude", "worktrees", "nested");
  initRepo(main, true);
  git(["worktree", "add", "-q", "-b", "linked", linked], main);
  git(["worktree", "add", "-q", "-b", "nested", nested], main);
  const foreign = join(base, "foreign");
  initRepo(foreign, true);
  const outside = join(base, "outside");
  const fakeHome = join(base, "home");
  const fakeTmp = join(base, "tmp");
  for (const d of [outside, fakeHome, fakeTmp]) mkdirSync(d, { recursive: true });
  const scratchWorktree = join(fakeTmp, "claude", "proj", "session", "scratchpad", "wt");
  git(["worktree", "add", "-q", "-b", "scratch", scratchWorktree], main);
  return { base, main, linked, nested, foreign, outside, fakeHome, fakeTmp, scratchWorktree };
}

export function removeRepoFamily(fam: RepoFamily): void {
  rmSync(fam.base, { recursive: true, force: true });
}

export function slash(path: string): string {
  return path.replaceAll("\\", "/");
}

export function ticket(worktree: string, name: string, frontmatter: Record<string, string>): string {
  const dir = join(worktree, "docs", "agents", "tasks");
  mkdirSync(dir, { recursive: true });
  const fm = Object.entries(frontmatter)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
  const file = join(dir, name);
  writeFileSync(file, `---\n${fm}\n---\n\ncuerpo\n`);
  return file;
}

export function clearTickets(...worktrees: string[]): void {
  for (const wt of worktrees) rmSync(join(wt, "docs", "agents", "tasks"), { recursive: true, force: true });
}

export interface HookRun {
  code: number;
  stderr: string;
}

export interface HookOptions {
  /** Directorio de la sesión: va en payload.cwd y es el cwd del proceso, como en Claude Code. */
  cwd: string;
  /** Raíz de arranque de la sesión. `null` = variable ausente. */
  projectDir: string | null;
  env?: Record<string, string>;
  fam?: RepoFamily;
}

export function hookEnv(opts: HookOptions): Record<string, string> {
  const env = cleanEnv();
  if (opts.projectDir !== null) env.CLAUDE_PROJECT_DIR = slash(opts.projectDir);
  if (opts.fam) {
    env.HOME = opts.fam.fakeHome;
    env.USERPROFILE = opts.fam.fakeHome;
    env.TMPDIR = opts.fam.fakeTmp;
    env.TEMP = opts.fam.fakeTmp;
    env.TMP = opts.fam.fakeTmp;
  }
  return { ...env, ...opts.env };
}

export async function runHook(script: string, payload: unknown, opts: HookOptions): Promise<HookRun> {
  const proc = Bun.spawn(["bash", join(HOOKS_DIR, script)], {
    cwd: opts.cwd,
    stdin: Buffer.from(typeof payload === "string" ? payload : JSON.stringify(payload)),
    stdout: "pipe",
    stderr: "pipe",
    env: hookEnv(opts),
  });
  const [stderr, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
  return { code, stderr };
}

export function editPayload(filePath: string, cwd: string, tool = "Edit"): Record<string, unknown> {
  const key = tool === "NotebookEdit" ? "notebook_path" : "file_path";
  return { hook_event_name: "PreToolUse", tool_name: tool, tool_input: { [key]: filePath }, cwd };
}

export function bashPayload(command: string, cwd: string, tool = "Bash"): Record<string, unknown> {
  return { hook_event_name: "PreToolUse", tool_name: tool, tool_input: { command }, cwd };
}
