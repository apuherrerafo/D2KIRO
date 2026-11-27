import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import {
  type HookOptions,
  type RepoFamily,
  clearTickets,
  bodyEditPayload,
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
  return (await runHook(GUARD, bodyEditPayload(file, opts.cwd, tool), opts)).code;
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

// ---------- excepción "la ficha en doing puede editarse a sí misma": ruta completa, no nombre (TSK-264) ----------

// Distintas formas de escribir la misma ruta dentro de `main`. `\` también se colapsa en Linux (native_path).
const SPELLINGS: Array<[string, (parts: string[]) => string]> = [
  ["absoluta", (parts) => join(fam.main, ...parts)],
  ["relativa", (parts) => parts.join("/")],
  ["con barras invertidas", (parts) => parts.join("\\")],
  ["con '..'", (parts) => ["apps", "..", ...parts].join("/")],
];

function subfolderTicket(): void {
  mkdirSync(join(fam.main, "docs", "agents", "tasks", "sub"), { recursive: true });
  ticket(fam.main, "sub/TSK-963.md", { id: "TSK-963", state: "doing", write_scope: '["eval/**"]' });
}

for (const [label, spell] of SPELLINGS) {
  const at = (...parts: string[]): Promise<number> =>
    edit(spell(["docs", "agents", "tasks", ...parts]), session(fam.main));

  test(`ficha en subcarpeta (ruta ${label}): se edita a sí misma`, async () => {
    subfolderTicket();
    expect(await at("sub", "TSK-963.md")).toBe(0);
  });

  test(`ficha en subcarpeta (ruta ${label}): no habilita a sus homónimas`, async () => {
    subfolderTicket();
    expect(await at("TSK-963.md")).toBe(2);
    expect(await at("otra", "TSK-963.md")).toBe(2);
    expect(await at("sub", "..", "TSK-963.md")).toBe(2);
  });
}

test("ficha en la raíz de tasks/: se edita a sí misma y una homónima en subcarpeta no pasa", async () => {
  ticket(fam.main, "TSK-964.md", { id: "TSK-964", state: "doing", write_scope: '["eval/**"]' });
  const tasks = join(fam.main, "docs", "agents", "tasks");
  expect(await edit(join(tasks, "TSK-964.md"), session(fam.main))).toBe(0);
  expect(await edit(join(tasks, "sub", "TSK-964.md"), session(fam.main))).toBe(2);
});

// ---------- write_scope falla cerrado (TSK-265): toda declaración se cumple o invalida la ficha ----------

function scopedTicket(header: string[], eol = "\n"): void {
  const dir = join(fam.main, "docs", "agents", "tasks");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "TSK-980.md"), ["---", "id: TSK-980", "state: doing", ...header, "---", "", "cuerpo", ""].join(eol));
}

const verdicts = async (): Promise<{ inside: number; outside: number; self: number }> => ({
  inside: await edit(join(fam.main, "eval", "x.json"), session(fam.main)),
  outside: await edit(join(fam.main, "apps", "x.ts"), session(fam.main)),
  self: await edit(join(fam.main, "docs", "agents", "tasks", "TSK-980.md"), session(fam.main)),
});

const VALID_SCOPE: Array<[string, string[], string?]> = [
  ["canónica", ['write_scope: ["eval/**"]']],
  ["clave entre comillas dobles", ['"write_scope": ["eval/**"]']],
  ["clave entre comillas simples", ["'write_scope': [\"eval/**\"]"]],
  ["espacio antes de ':'", ['write_scope : ["eval/**"]']],
  ["sin espacio tras ':'", ['write_scope:["eval/**"]']],
  ["globs entre comillas simples", ["write_scope: ['eval/**', 'docs/x.md']"]],
  ["comentario al final", ['write_scope: ["eval/**"] # sólo eval']],
  ["CRLF", ['write_scope: ["eval/**"]'], "\r\n"],
];

for (const [label, header, eol] of VALID_SCOPE) {
  test(`write_scope ${label}: se cumple (dentro pasa, fuera se bloquea)`, async () => {
    scopedTicket(header, eol);
    expect(await verdicts()).toEqual({ inside: 0, outside: 2, self: 0 });
  });
}

const INVALID_SCOPE: Array<[string, string[]]> = [
  ["repetida", ['write_scope: ["eval/**"]', 'write_scope: ["apps/**"]']],
  ["repetida con otra grafía", ['write_scope: ["eval/**"]', '"write_scope": ["apps/**"]']],
  ["en varias líneas", ["write_scope:", '  - "eval/**"']],
  ["lista partida", ['write_scope: ["eval/**",', '  "apps/**"]']],
  ["lista en columna 0", ["write_scope:", '- "eval/**"']],
  ["vacía", ["write_scope:"]],
  ["lista vacía", ["write_scope: []"]],
  ["null", ["write_scope: null"]],
  ["texto suelto", ["write_scope: eval/**"]],
  ["globs sin comillas", ["write_scope: [eval/**]"]],
  ["lista sin cerrar", ['write_scope: ["eval/**"']],
  ["coma sobrante", ['write_scope: ["eval/**",]']],
  ["texto tras la lista", ['write_scope: ["eval/**"] "apps/**"']],
  ["elemento no texto", ["write_scope: [1]"]],
  ["glob en blanco", ['write_scope: ["eval/**", " "]']],
  ["indentada bajo otra clave", ["meta:", '  write_scope: ["eval/**"]']],
  ["mayúsculas", ['Write_Scope: ["eval/**"]']],
  ["con guion", ['write-scope: ["eval/**"]']],
  ["sin separador", ['writescope: ["eval/**"]']],
  ["en plural", ['write_scopes: ["eval/**"]']],
];

for (const [label, header] of INVALID_SCOPE) {
  test(`write_scope ${label}: ficha inválida, no se escribe ni dentro ni fuera (sólo reparar)`, async () => {
    scopedTicket(header);
    expect(await verdicts()).toEqual({ inside: 2, outside: 2, self: 0 });
  });
}

test("write_scope ausente sigue sin restringir (retrocompatible)", async () => {
  scopedTicket(['title: "habla de write_scope: sólo en el título"']);
  expect(await verdicts()).toEqual({ inside: 0, outside: 0, self: 0 });
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
