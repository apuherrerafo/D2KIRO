import { afterAll, beforeEach, beforeAll, expect, test } from "bun:test";
import { mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOOKS_DIR, type RepoFamily, editPayload, makeRepoFamily, removeRepoFamily, runHook, ticket } from "./hook-test-utils";

// TSK-266 — "no veo ninguna ficha" no es "no hay restricciones". Sin una carpeta de fichas que se pueda recorrer
// entera, el hook y el gate bloquean; una carpeta vacía es válida.

let fam: RepoFamily;
let tasks: string;

beforeAll(() => {
  fam = makeRepoFamily();
  tasks = join(fam.main, "docs", "agents", "tasks");
});
afterAll(() => {
  removeRepoFamily(fam);
});
beforeEach(() => {
  rmSync(join(fam.main, "docs"), { recursive: true, force: true });
  mkdirSync(join(fam.main, "docs", "agents"), { recursive: true });
});

async function edit(...parts: string[]): Promise<{ code: number; stderr: string }> {
  const payload = editPayload(join(fam.main, ...parts), fam.main);
  return runHook("pretooluse-edit-guard.sh", payload, { cwd: fam.main, projectDir: fam.main, fam });
}

function contract(command: "check" | "list", dir = tasks): { code: number; out: string } {
  const res = Bun.spawnSync(["python3", "-B", join(HOOKS_DIR, "ticket_contract.py"), command, dir]);
  return { code: res.exitCode, out: `${res.stdout.toString()}${res.stderr.toString()}` };
}

const MISSING: Array<[string, () => void]> = [
  ["la carpeta no existe", () => {}],
  ["en su lugar hay un archivo", () => writeFileSync(tasks, "no soy una carpeta\n")],
  ["falta docs/ entero", () => rmSync(join(fam.main, "docs"), { recursive: true, force: true })],
];

for (const [label, prepare] of MISSING) {
  test(`hook: ${label} -> bloquea código, datos curados y fichas nuevas`, async () => {
    prepare();
    const res = await edit("apps", "engine", "x.ts");
    expect(res.code).toBe(2);
    expect(res.stderr).toContain("carpeta de fichas");
    expect((await edit("data", "curated", "x.json")).code).toBe(2);
    expect((await edit("docs", "agents", "tasks", "TSK-1.md")).code).toBe(2);
  });

  test(`gate y tablero: ${label} -> exit distinto de 0 con motivo`, () => {
    prepare();
    for (const command of ["check", "list"] as const) {
      const res = contract(command);
      expect(res.code).toBe(1);
      expect(res.out).toContain("carpeta de fichas");
    }
  });
}

test("carpeta vacía: válida para el hook, el gate y el tablero", async () => {
  mkdirSync(tasks);
  expect((await edit("apps", "x.ts")).code).toBe(0);
  expect(contract("check")).toEqual({ code: 0, out: "" });
  expect(contract("list").out.trim()).toBe("[]");
});

test("estructura malformada (ficha sin cabecera, ficha no UTF-8): sigue bloqueando", async () => {
  for (const content of [Buffer.from("sin cabecera\n"), Buffer.from([0x2d, 0x2d, 0x2d, 0x0a, 0xff, 0xfe, 0x0a])]) {
    mkdirSync(tasks, { recursive: true });
    writeFileSync(join(tasks, "TSK-2.md"), content);
    expect((await edit("apps", "x.ts")).code).toBe(2);
    expect(contract("check").code).toBe(1);
  }
});

test("una subcarpeta enlazada no esconde la ficha en doing", async () => {
  mkdirSync(tasks);
  const elsewhere = join(fam.base, "fichas-enlazadas");
  mkdirSync(join(elsewhere, "docs", "agents", "tasks"), { recursive: true });
  ticket(elsewhere, "TSK-3.md", { id: "TSK-3", state: "doing", write_scope: '["eval/**"]' });
  symlinkSync(join(elsewhere, "docs", "agents", "tasks"), join(tasks, "enlace"), "junction");
  expect((await edit("apps", "x.ts")).code).toBe(2);
});

test("una subcarpeta que no se puede listar no se salta en silencio", () => {
  mkdirSync(join(tasks, "privada"), { recursive: true });
  // Permisos reales no son portables (Windows / root en CI): se hace fallar el listado dentro del proceso.
  const script = [
    "import os, sys",
    "from pathlib import Path",
    "sys.path.insert(0, sys.argv[1])",
    "import _hook_lib as lib",
    "real = os.scandir",
    "def scandir(path='.'):",
    "    if os.path.basename(str(path)) == 'privada':",
    "        raise PermissionError('denegado')",
    "    return real(path)",
    "os.scandir = scandir",
    "try:",
    "    lib.load_tickets(Path(sys.argv[2]))",
    "except lib.GuardBlocked as exc:",
    "    print(exc); sys.exit(7)",
  ].join("\n");
  const res = Bun.spawnSync(["python3", "-B", "-c", script, HOOKS_DIR, tasks]);
  expect(res.exitCode).toBe(7);
});
