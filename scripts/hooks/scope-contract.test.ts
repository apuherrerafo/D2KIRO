import { afterAll, beforeAll, beforeEach, expect, test } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HOOKS_DIR, type RepoFamily, clearTickets, editPayload, makeRepoFamily, removeRepoFamily, runHook } from "./hook-test-utils";

// TSK-268 — contrato de alcance: claves cerradas, `write_scope` sólo en la cabecera y la ficha en doing no puede
// cambiar su propio gobierno. Control preventivo contra errores, NO frontera frente a un proceso malicioso.

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
  clearTickets(fam.main);
});

const OWN = "TSK-1.md";
const SCOPED = '---\nid: TSK-1\nstate: doing\nassigned_tool: claude-code\nwrite_scope: ["eval/**"]\n---\n\n## Estado\n\npendiente\n';
const UNSCOPED = "---\nid: TSK-1\nstate: doing\nassigned_tool: claude-code\n---\n\n## Estado\n\npendiente\n";

function put(content: string, name = OWN): void {
  writeFileSync(join(tasks, name), content);
}

async function guard(tool: string, rel: string, input: Record<string, unknown> = {}): Promise<number> {
  const payload = editPayload(join(fam.main, ...rel.split("/")), fam.main, tool);
  Object.assign(payload.tool_input as Record<string, unknown>, input);
  return (await runHook("pretooluse-edit-guard.sh", payload, { cwd: fam.main, projectDir: fam.main, fam })).code;
}

const outside = (): Promise<number> => guard("Edit", "apps/x.ts");
const own = (input: Record<string, unknown>, tool = "Edit"): Promise<number> => guard(tool, `docs/agents/tasks/${OWN}`, input);
const swap = (old_string: string, new_string: string) => ({ old_string, new_string });

function check(): number {
  return Bun.spawnSync(["python3", "-B", join(HOOKS_DIR, "ticket_contract.py"), "check", tasks]).exitCode;
}

// ---------- claves de la cabecera ----------

const BAD_HEADERS: Array<[string, string]> = [
  ...["wrtie_scope", "scope", "writ_scope", "write__scope", "allowed_paths", '"wrtie_scope"', "State"].map(
    (key): [string, string] => [`clave desconocida ${key}`, `${key}: ["eval/**"]`],
  ),
  ["clave indentada bajo un valor en línea", 'title: x\n  wrtie_scope: ["eval/**"]'],
  ["clave indentada bajo una lista", 'blocked_by:\n  wrtie_scope: ["eval/**"]'],
  ["clave dentro de un elemento de lista", 'blocked_by:\n  - wrtie_scope: ["eval/**"]'],
];

for (const [label, extra] of BAD_HEADERS) {
  test(`${label}: el hook y el gate bloquean`, async () => {
    put(`---\nid: TSK-1\nstate: doing\n${extra}\n---\n`);
    expect(await outside()).toBe(2);
    expect(check()).toBe(1);
  });
}

test("las 16 claves en uso, entrecomilladas o con bloques, siguen siendo válidas", async () => {
  put(
    [
      "---",
      "id: TSK-1",
      'title: "t: con dos puntos"',
      '"state": doing',
      "preferred_tool: claude-code",
      "assigned_tool: claude-code",
      "moscow: must",
      "attempts: 0",
      "created_at: 2026-11-25",
      "simplicity_exception: true",
      "exception_reason: >",
      "  texto libre: con dos puntos",
      "  segunda línea",
      "blocked_by:",
      "  - TSK-0",
      'implements: ["R1-2"]',
      "spec: docs/specs/SPEC.md",
      'spec_section: "15"',
      'write_scope: ["apps/**"]',
      "---",
      "",
    ].join("\n"),
  );
  expect(check()).toBe(0);
  expect(await outside()).toBe(0);
});

// ---------- write_scope en el cuerpo ----------

for (const line of ['write_scope: ["eval/**"]', 'Write-Scope: ["**"]', '"write_scope": ["eval/**"]']) {
  test(`declaración en el cuerpo (${line}): ficha inválida, nunca permiso`, async () => {
    put(`---\nid: TSK-1\nstate: doing\n---\n\n${line}\n`);
    expect(await outside()).toBe(2);
    expect(await guard("Edit", "eval/x.json")).toBe(2);
    expect(check()).toBe(1);
  });
}

test("mencionar write_scope en la prosa, en una lista o indentado en el cuerpo sigue permitido", async () => {
  put('---\nid: TSK-1\nstate: doing\n---\n\nEl `write_scope` se declara arriba.\n- write_scope: ver cabecera\n    write_scope: ["x"]\n');
  expect(check()).toBe(0);
  expect(await outside()).toBe(0);
});

// ---------- la ficha en doing no cambia su gobierno ----------

const WIDENINGS: Array<[string, string, Record<string, unknown>]> = [
  ["Edit amplía write_scope", "Edit", swap('["eval/**"]', '["**"]')],
  ["Edit borra write_scope", "Edit", swap('write_scope: ["eval/**"]\n', "")],
  ["Edit saca la ficha de doing", "Edit", swap("state: doing", "state: review")],
  ["Edit la pasa a otra herramienta", "Edit", swap("assigned_tool: claude-code", "assigned_tool: codex")],
  ["Edit la invalida (abriría la vía de reparación)", "Edit", swap("state: doing", "state: doingX")],
  ["Edit mete write_scope en el cuerpo", "Edit", swap("pendiente", 'write_scope: ["**"]')],
  ["Edit con texto que no está", "Edit", swap("no existe", "x")],
  ["Edit sin old_string/new_string", "Edit", {}],
  ["Write amplía", "Write", { content: SCOPED.replace('["eval/**"]', '["**"]') }],
  ["Write sin content", "Write", {}],
  ["MultiEdit amplía en el segundo paso", "MultiEdit", { edits: [swap("pendiente", "listo"), swap('["eval/**"]', '["**"]')] }],
  ["MultiEdit sin edits", "MultiEdit", {}],
  ["NotebookEdit sobre la ficha", "NotebookEdit", {}],
];

for (const [label, tool, input] of WIDENINGS) {
  test(`ficha propia: ${label} -> bloquea`, async () => {
    put(SCOPED);
    expect(await own(input, tool)).toBe(2);
  });
}

test("borrar un comentario final no puede tragarse la línea siguiente", async () => {
  put('---\nid: TSK-1\nwrite_scope: ["eval/**"] #x\nstate: doing\n---\n');
  expect(await own(swap("x", ""))).toBe(2);
});

test("un write_scope que cubre tasks/** no abre la autoampliación", async () => {
  put(SCOPED.replace('["eval/**"]', '["docs/agents/tasks/**"]'));
  expect(await own(swap('["docs/agents/tasks/**"]', '["**"]'))).toBe(2);
});

test.skipIf(process.platform !== "win32")("la ficha propia se reconoce aunque cambien las mayúsculas (Windows)", async () => {
  put(SCOPED.replace('["eval/**"]', '["docs/**"]'));
  expect(await guard("Edit", "docs/agents/tasks/tsk-1.MD", swap('["docs/**"]', '["**"]'))).toBe(2);
});

test("ficha propia: el cuerpo y las claves sin gobierno se siguen editando", async () => {
  put(SCOPED);
  expect(await own(swap("pendiente", "Implementado: x"))).toBe(0);
  expect(await own(swap("id: TSK-1", "id: TSK-1\nattempts: 1"))).toBe(0);
  expect(await own({ content: SCOPED.replace("pendiente", "hecho") }, "Write")).toBe(0);
  expect(await own({ edits: [swap("pendiente", "a"), swap("## Estado", "## Estado final")] }, "MultiEdit")).toBe(0);
  put(SCOPED.replaceAll("\n", "\r\n"));
  expect(await own(swap("## Estado\n\npendiente", "## Estado\n\nhecho"))).toBe(0);
  expect(readFileSync(join(tasks, OWN), "utf8")).toContain("\r\n"); // el hook no escribe
});

test("ficha sin write_scope: no puede darse uno (autorizaría data/curated/), pero sí cambiar de estado", async () => {
  put(UNSCOPED);
  expect(await own(swap("state: doing", 'state: doing\nwrite_scope: ["data/curated/**"]'))).toBe(2);
  expect(await own(swap("state: doing", "state: review"))).toBe(0);
  expect(await own(swap("pendiente", "hecho"))).toBe(0);
});

// ---------- finales de línea: el guard debe leer el resultado igual que se leerá del disco (CR aislado) ----------

const EOLS: Array<[string, string]> = [
  ["LF", "\n"],
  ["CRLF", "\r\n"],
  ["CR aislado", "\r"],
  ["CR + CRLF", "\r\r\n"],
];
const NO_OWNER = SCOPED.replace("assigned_tool: claude-code\n", "");
const CURATED = 'write_scope: ["data/curated/**"]';

for (const [label, eol] of EOLS) {
  // [caso, ficha en disco, texto a sustituir, texto nuevo]
  const forbidden: Array<[string, string, string, string]> = [
    ["añade otro propietario", NO_OWNER, "id: TSK-1", `id: TSK-1${eol}title: x${eol}assigned_tool: codex`],
    ["cambia el propietario", SCOPED, "assigned_tool: claude-code", `title: x${eol}assigned_tool: codex`],
    ["saca la ficha de doing", SCOPED, "state: doing", `title: x${eol}state: review`],
    ["repite write_scope (abriría la reparación)", SCOPED, "id: TSK-1", `id: TSK-1${eol}title: x${eol}write_scope: ["**"]`],
    ["se da data/curated sin tener alcance", UNSCOPED, "id: TSK-1", `id: TSK-1${eol}title: x${eol}${CURATED}`],
    ["declara alcance en el cuerpo", SCOPED, "pendiente", `x${eol}write_scope: ["**"]`],
  ];
  for (const [what, disk, from, to] of forbidden) {
    for (const [tool, input] of [
      ["Write", { content: disk.replace(from, to) }],
      ["Edit", swap(from, to)],
      ["MultiEdit", { edits: [swap("## Estado", "## Estado final"), swap(from, to)] }],
    ] as Array<[string, Record<string, unknown>]>) {
      test(`${label}, ${tool}: ${what} -> bloquea`, async () => {
        put(disk);
        expect(await own(input, tool)).toBe(2);
      });
    }
  }

  test(`${label}: ficha en disco se lee igual (dentro pasa, fuera se bloquea, gate verde)`, async () => {
    put(SCOPED.replaceAll("\n", eol === "\r\r\n" ? "\r\n" : eol));
    expect(check()).toBe(0);
    expect(await outside()).toBe(2);
    expect(await guard("Edit", "eval/x.json")).toBe(0);
  });

  test(`${label}: editar el cuerpo sigue permitido`, async () => {
    const disk = SCOPED.replaceAll("\n", eol === "\r\r\n" ? "\r\n" : eol);
    // Con CR suelto en disco, `Edit` no se puede predecir (ver abajo): esa ficha se reescribe con `Write`.
    put(eol === "\r" ? SCOPED : disk);
    expect(await own(swap("pendiente", `hecho${eol}segunda línea`))).toBe(0);
    put(disk);
    expect(await own({ content: SCOPED.replace("pendiente", "hecho").replaceAll("\n", eol === "\r\r\n" ? "\r\n" : eol) }, "Write")).toBe(0);
  });

  test(`${label}: sin alcance, cambiar de propietario sigue permitido`, async () => {
    put(UNSCOPED);
    expect(await own(swap("assigned_tool: claude-code", `title: x${eol === "\r\r\n" ? "\r\n" : eol}assigned_tool: codex`))).toBe(0);
  });
}

// `Edit` conserva un CR suelto que ya está en el texto y el parser lo lee como salto: con `replace_all` el guard
// sustituiría en más sitios que la herramienta y validaría un contenido que no es el que se escribe.
const SEEDED = SCOPED.replace("assigned_tool: claude-code\n", "title: x\nspec: s\rspec: s\n");
const TAKEOVER = { ...swap("\nspec: s", "\nassigned_tool: codex"), replace_all: true };

const UNPREDICTABLE: Array<[string, string, string, Record<string, unknown>]> = [
  ["Edit replace_all sobre CR suelto en disco", SEEDED, "Edit", TAKEOVER],
  ["MultiEdit replace_all sobre CR suelto en disco", SEEDED, "MultiEdit", { edits: [TAKEOVER] }],
  [
    "MultiEdit que siembra el CR y luego sustituye",
    SCOPED.replace("assigned_tool: claude-code\n", "title: x\nspec: s\n"),
    "MultiEdit",
    { edits: [swap("spec: s", "spec: s\rspec: s"), TAKEOVER] },
  ],
  ["Edit del cuerpo con la ficha en CR", SCOPED.replaceAll("\n", "\r"), "Edit", swap("pendiente", "hecho")],
];

for (const [label, disk, tool, input] of UNPREDICTABLE) {
  test(`resultado impredecible: ${label} -> bloquea`, async () => {
    put(disk);
    expect(await own(input, tool)).toBe(2);
  });
}

test("una ficha con CR suelto en disco se puede reescribir entera con Write", async () => {
  put(SEEDED);
  expect(await own({ content: SCOPED.replace("pendiente", "hecho") }, "Write")).toBe(0);
});

test("MultiEdit legítimo en una ficha CRLF sigue permitido", async () => {
  put(SCOPED.replaceAll("\n", "\r\n"));
  expect(await own({ edits: [swap("pendiente", "a\r\nb"), swap("## Estado", "## Estado final")] }, "MultiEdit")).toBe(0);
});

test("sin ficha en doing, las fichas se editan libremente", async () => {
  put(SCOPED.replace("state: doing", "state: ready"));
  expect(await own(swap("state: ready", "state: doing"))).toBe(0);
});
