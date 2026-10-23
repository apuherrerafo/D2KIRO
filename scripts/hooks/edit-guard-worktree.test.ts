import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import {
  type HookOptions,
  type RepoFamily,
  clearTickets,
  editPayload,
  makeRepoFamily,
  removeRepoFamily,
  runHook,
  slash,
  ticket,
} from "./hook-test-utils";

// pretooluse-edit-guard.sh (entrada real de PreToolUse Edit|Write|MultiEdit|NotebookEdit)
// contra worktrees reales. Contrato: el worktree de la sesión sale de payload.cwd — nunca de
// CLAUDE_PROJECT_DIR ni de dónde vive el script —, un archivo de otro worktree o fuera de todo
// repo se BLOQUEA (no se evalúa contra otro ticket), y todo contexto que no valida falla cerrado.

const GUARD = "pretooluse-edit-guard.sh";
let fam: RepoFamily;

function session(cwd: string, projectDir: string | null = fam.main): HookOptions {
  return { cwd, projectDir, fam };
}

async function edit(file: string, opts: HookOptions, tool = "Edit"): Promise<number> {
  return (await runHook(GUARD, editPayload(file, opts.cwd, tool), opts)).code;
}

beforeAll(() => {
  fam = makeRepoFamily();
});
afterAll(() => {
  removeRepoFamily(fam);
});
afterEach(() => {
  clearTickets(fam.main, fam.linked, fam.nested);
});

// ---------- operaciones legítimas ----------

test("legítimo: escribir dentro del worktree de la sesión, sin ticket en doing", async () => {
  expect(await edit(join(fam.main, "apps", "engine", "x.ts"), session(fam.main))).toBe(0);
});

test("legítimo: sesión arrancada en main que entró al worktree hermano escribe en él", async () => {
  // CLAUDE_PROJECT_DIR sigue apuntando a main: no cambia al entrar a otro worktree.
  expect(await edit(join(fam.linked, "apps", "x.ts"), session(fam.linked, fam.main))).toBe(0);
});

test("legítimo: cwd en un subdirectorio del worktree — la sesión es el worktree completo", async () => {
  const sub = join(fam.main, "apps", "engine");
  mkdirSync(sub, { recursive: true });
  expect(await edit(join(fam.main, "docs", "a.md"), session(sub))).toBe(0);
});

test("legítimo: ruta con '..' que vuelve a caer dentro del worktree", async () => {
  expect(await edit(join(fam.main, "apps", "..", "docs", "b.md"), session(fam.main))).toBe(0);
});

test("legítimo: scratchpad de Claude y memoria del proyecto (fuera de todo repo)", async () => {
  const scratch = join(fam.fakeTmp, "claude", "proj", "session", "scratchpad", "notes.txt");
  const memory = join(fam.fakeHome, ".claude", "projects", "proj", "memory", "MEMORY.md");
  expect(await edit(scratch, session(fam.main))).toBe(0);
  expect(await edit(memory, session(fam.main))).toBe(0);
});

test("legítimo: write_scope del ticket en doing del PROPIO worktree se respeta", async () => {
  ticket(fam.linked, "TSK-901.md", { id: "TSK-901", state: "doing", write_scope: '["eval/**"]' });
  expect(await edit(join(fam.linked, "eval", "golden", "x.json"), session(fam.linked))).toBe(0);
  expect(await edit(join(fam.linked, "apps", "engine", "mix.ts"), session(fam.linked))).toBe(2);
});

// ---------- cross-worktree: se bloquea, no se evalúa contra otro ticket ----------

test("bloquea: sesión en main escribe en el worktree hermano (aunque nadie tenga ticket)", async () => {
  const res = await runHook(GUARD, editPayload(join(fam.linked, "a.ts"), fam.main), session(fam.main));
  expect(res.code).toBe(2);
  expect(res.stderr).toContain("otro worktree");
});

test("bloquea: sesión en el hermano escribe en main (CLAUDE_PROJECT_DIR=main no lo habilita)", async () => {
  expect(await edit(join(fam.main, "a.ts"), session(fam.linked, fam.main))).toBe(2);
});

test("bloquea: worktree anidado en .claude/worktrees — dentro de main por ruta, otro worktree para git", async () => {
  expect(await edit(join(fam.nested, "a.ts"), session(fam.main))).toBe(2);
  expect(await edit(join(fam.main, "a.ts"), session(fam.nested))).toBe(2);
  expect(await edit(join(fam.nested, "a.ts"), session(fam.nested))).toBe(0);
});

test("el ticket de main NO decide sobre el hermano: ni lo habilita ni lo bloquea", async () => {
  // main declara un scope que cubre el archivo; el hermano tiene su propio ticket que no.
  ticket(fam.main, "TSK-950.md", { id: "TSK-950", state: "doing", write_scope: '["apps/**"]' });
  ticket(fam.linked, "TSK-951.md", { id: "TSK-951", state: "doing", write_scope: '["eval/**"]' });
  expect(await edit(join(fam.linked, "apps", "x.ts"), session(fam.linked, fam.main))).toBe(2);
  // Y al revés: el scope estrecho de main no bloquea al hermano, que se rige por el suyo.
  clearTickets(fam.main, fam.linked);
  ticket(fam.main, "TSK-952.md", { id: "TSK-952", state: "doing", write_scope: '["eval/**"]' });
  expect(await edit(join(fam.linked, "apps", "x.ts"), session(fam.linked, fam.main))).toBe(0);
});

test("bloquea: ruta relativa con '..' que escapa al worktree hermano", async () => {
  expect(await edit(join("..", "linked", "a.ts"), session(fam.main))).toBe(2);
});

test("bloquea: archivo fuera de todo repositorio y fuera de la lista permitida", async () => {
  expect(await edit(join(fam.outside, "x.txt"), session(fam.main))).toBe(2);
  expect(await edit(join(fam.fakeHome, ".claude", "settings.json"), session(fam.main))).toBe(2);
});

test("bloquea: worktree dentro del scratchpad sigue siendo otro worktree", async () => {
  // La lista permitida sólo aplica fuera de todo repo: un worktree en el scratchpad no se cuela.
  expect(await edit(join(fam.scratchWorktree, "x.ts"), session(fam.main))).toBe(2);
  expect(await edit(join(fam.scratchWorktree, "x.ts"), session(fam.scratchWorktree, fam.main))).toBe(0);
});

test("bloquea: repositorio ajeno al proyecto", async () => {
  expect(await edit(join(fam.foreign, "x.ts"), session(fam.main))).toBe(2);
  // Sesión dentro del repo ajeno: no pertenece al repositorio de CLAUDE_PROJECT_DIR.
  expect(await edit(join(fam.foreign, "x.ts"), session(fam.foreign, fam.main))).toBe(2);
});

test("bloquea: directorio interno de git (.git/hooks, .git de un worktree enlazado)", async () => {
  expect(await edit(join(fam.main, ".git", "hooks", "pre-commit"), session(fam.main))).toBe(2);
  expect(await edit(join(fam.linked, ".git"), session(fam.linked, fam.main))).toBe(2);
});

test("NotebookEdit pasa por el mismo guard", async () => {
  expect(await edit(join(fam.linked, "n.ipynb"), session(fam.main), "NotebookEdit")).toBe(2);
  expect(await edit(join(fam.main, "n.ipynb"), session(fam.main), "NotebookEdit")).toBe(0);
});

// ---------- fallo cerrado ante contexto inválido ----------

test("fail-closed: payload sin cwd", async () => {
  const payload = { tool_name: "Edit", tool_input: { file_path: join(fam.main, "a.ts") } };
  expect((await runHook(GUARD, payload, session(fam.main))).code).toBe(2);
});

test("fail-closed: payload que no es JSON", async () => {
  expect((await runHook(GUARD, "{no es json", session(fam.main))).code).toBe(2);
});

test("fail-closed: CLAUDE_PROJECT_DIR ausente", async () => {
  expect(await edit(join(fam.main, "a.ts"), session(fam.main, null))).toBe(2);
});

test("fail-closed: cwd de la sesión fuera de todo repositorio", async () => {
  expect(await edit(join(fam.main, "a.ts"), session(fam.outside))).toBe(2);
});

test("fail-closed: Edit sin file_path", async () => {
  const payload = { tool_name: "Write", tool_input: {}, cwd: fam.main };
  expect((await runHook(GUARD, payload, session(fam.main))).code).toBe(2);
});

test("fail-closed: dos tickets de Claude en doing y alguno con write_scope (alcance ambiguo)", async () => {
  ticket(fam.main, "TSK-960.md", { id: "TSK-960", state: "doing", write_scope: '["eval/**"]' });
  ticket(fam.main, "TSK-961.md", { id: "TSK-961", state: "doing" });
  expect(await edit(join(fam.main, "eval", "x.json"), session(fam.main))).toBe(2);
});

test("un ticket de otra herramienta (codex) no encierra a Claude Code", async () => {
  ticket(fam.main, "TSK-962.md", {
    id: "TSK-962",
    state: "doing",
    assigned_tool: "codex",
    write_scope: '["eval/**"]',
  });
  expect(await edit(join(fam.main, "apps", "x.ts"), session(fam.main))).toBe(0);
});

test("fail-closed: python3 roto -> el wrapper devuelve 2, nunca 1/127 (non-blocking)", async () => {
  const fakeBin = join(fam.base, "fakebin");
  mkdirSync(fakeBin, { recursive: true });
  await Bun.write(join(fakeBin, "python3"), "#!/bin/sh\nexit 1\n");
  Bun.spawnSync(["chmod", "+x", join(fakeBin, "python3")]);
  const sep = process.platform === "win32" ? ";" : ":";
  const opts = { ...session(fam.main), env: { PATH: `${fakeBin}${sep}${process.env.PATH ?? ""}` } };
  expect(await edit(join(fam.main, "a.ts"), opts)).toBe(2);
});

// ---------- rutas: Windows y no-ASCII ----------

test("rutas con ñ/tildes: el guard evalúa la ruta real, no una corrompida por el locale", async () => {
  ticket(fam.main, "TSK-970.md", { id: "TSK-970", state: "doing", write_scope: '["docs/configuración/**"]' });
  expect(await edit(join(fam.main, "docs", "configuración", "año.md"), session(fam.main))).toBe(0);
  expect(await edit(join(fam.main, "docs", "configuracion", "ano.md"), session(fam.main))).toBe(2);
});

test.skipIf(process.platform !== "win32")("Windows: barras invertidas, barras normales y unidad en minúscula dan el mismo veredicto", async () => {
  const inside = join(fam.main, "apps", "x.ts");
  const crossing = join(fam.linked, "apps", "x.ts");
  const lowerDrive = (p: string): string => p.charAt(0).toLowerCase() + p.slice(1);
  for (const variant of [(p: string) => p, slash, lowerDrive, (p: string) => lowerDrive(slash(p))]) {
    expect(await edit(variant(inside), session(variant(fam.main)))).toBe(0);
    expect(await edit(variant(crossing), session(variant(fam.main)))).toBe(2);
  }
});

test.skipIf(process.platform !== "win32")("Windows: ruta estilo MSYS (/c/...) en file_path no se traduce — falla cerrado", async () => {
  const msys = slash(join(fam.main, "a.ts")).replace(/^([A-Za-z]):/, (_m, d: string) => `/${d.toLowerCase()}`);
  expect(await edit(msys, session(fam.main))).toBe(2);
});
