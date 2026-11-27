import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HOOKS_DIR } from "./hook-test-utils";

// Las skills que crean fichas deben pedir sólo claves del contrato (TICKET_KEYS): una clave de más invalida la ficha
// y bloquea las escrituras de la sesión. Se leen las instrucciones reales; no mide que un modelo las obedezca.

const REPO = join(import.meta.dir, "..", "..");
const skill = (name: string): string => readFileSync(join(REPO, ".claude", "skills", name, "SKILL.md"), "utf8");

let dir: string;
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "d2k-skill-tickets-"));
});
afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function problemsOf(header: string[]): string[] {
  writeFileSync(join(dir, "TSK-1.md"), ["---", ...header, "---", "", "## Contexto", ""].join("\n"));
  const run = Bun.spawnSync(["python3", "-B", join(HOOKS_DIR, "ticket_contract.py"), "list", dir]);
  expect(run.exitCode).toBe(0);
  return (JSON.parse(run.stdout.toString()) as Array<{ problem: string }>).map((t) => t.problem).filter(Boolean);
}

// Los campos que una skill enumera como código en línea: `id`, `state: backlog`, ...
function listedFields(name: string, marker: RegExp): string[] {
  const line = skill(name).split("\n").find((l) => marker.test(l)) ?? "";
  const list = /\(((?:`[^`]+`(?:, )?)+)\)|campos ((?:`[^`]+`(?:, )?)+)/.exec(line);
  return [...(list?.[1] ?? list?.[2] ?? "").matchAll(/`([^`]+)`/g)].map((m) => m[1]);
}

const SAMPLE: Record<string, string> = { id: "TSK-1", title: "t", state: "backlog", moscow: "must", attempts: "0" };

for (const [name, marker] of [
  ["rulebook", /frontmatter estándar/],
  ["grill-me", /tickets YAML/],
] as Array<[string, RegExp]>) {
  test(`${name}: una ficha con los campos que pide es válida`, () => {
    const fields = listedFields(name, marker);
    expect(fields).toContain("id");
    expect(fields).toContain("state: backlog");
    const header = fields.map((f) => (f.includes(":") ? f : `${f}: ${SAMPLE[f] ?? "claude-code"}`));
    expect(problemsOf(header)).toEqual([]);
  });
}

test("rulebook: no pide asignar la clave `tool`", () => {
  expect(skill("rulebook")).not.toMatch(/`tool`/);
});

test("onboarding: el ID externo va en el cuerpo, nunca como clave nueva de la cabecera", () => {
  const rule = skill("onboarding").split("\n").find((l) => /ID externo/.test(l)) ?? "";
  expect(rule).toContain("`## Contexto`");
  expect(rule).not.toMatch(/ID externo en el frontmatter/);
});

test("control: una clave fuera del contrato sí invalida la ficha", () => {
  expect(problemsOf(["id: TSK-1", "state: backlog", "tool: codex"])).toHaveLength(1);
  expect(problemsOf(["id: TSK-1", "state: backlog", "external_id: GH-12"])).toHaveLength(1);
});
