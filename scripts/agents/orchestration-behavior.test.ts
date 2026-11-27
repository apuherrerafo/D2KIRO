import { afterAll, afterEach, beforeAll, describe, expect, test as bunTest } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  clearTickets,
  bodyEditPayload,
  makeRepoFamily,
  removeRepoFamily,
  runHook,
  ticket,
  type HookOptions,
  type RepoFamily,
} from "../hooks/hook-test-utils";

// Comportamiento REAL del ciclo de coordinación (dispatch + helm + compass). A diferencia de
// contracts.test.ts (texto), aquí se EJECUTA lo que hace cumplir el ciclo: el hook de escritura,
// el tablero (hub.ts) y el gate verify-simplicity.sh, sobre fixtures en directorios temporales.
// No prueba el juicio de un modelo (clasificar una petición ambigua, invocar a Tracer): eso es
// NOT_TESTED y se declara así en docs/agents/orchestration-behavior-eval.md.

// Cada prueba de este archivo arranca procesos externos (bash, git, bun, python): en Windows una sola
// cuesta 3-4,3 s aisladas y los 5 s por defecto de Bun no dejan margen bajo la carga del pre-push.
// El timeout se fija por prueba, sólo aquí; no se toca el timeout global de Bun.
const EXTERNAL_PROCESS_TIMEOUT_MS = 30_000;
const test = (name: string, fn: () => void | Promise<void>): void => bunTest(name, fn, EXTERNAL_PROCESS_TIMEOUT_MS);

const REPO = join(import.meta.dir, "..", "..");
const GUARD = "pretooluse-edit-guard.sh";
let fam: RepoFamily;

const session = (cwd: string): HookOptions => ({ cwd, projectDir: fam.main, fam });
const edit = async (file: string): Promise<{ code: number; stderr: string }> =>
  runHook(GUARD, bodyEditPayload(file, fam.main), session(fam.main));

beforeAll(() => {
  fam = makeRepoFamily();
});
afterAll(() => removeRepoFamily(fam));
afterEach(() => clearTickets(fam.main));

const doing = (tool: string, scope = '["apps/web/**"]'): Record<string, string> => ({
  state: "doing",
  assigned_tool: tool,
  write_scope: scope,
});

// ---------- OB-1: tarea válida ----------

test("OB-1 válida: escribe dentro del write_scope, en su propio ticket y con un ticket de otra herramienta en doing", async () => {
  ticket(fam.main, "TSK-901.md", doing("claude-code"));
  ticket(fam.main, "TSK-902.md", doing("codex", '["apps/engine/**"]'));
  expect((await edit(join(fam.main, "apps", "web", "x.ts"))).code).toBe(0);
  expect((await edit(join(fam.main, "docs", "agents", "tasks", "TSK-901.md"))).code).toBe(0);
});

// ---------- OB-2: tarea ambigua (no se sabe qué ticket autoriza) ----------

test("OB-2 ambigua: dos tickets de claude-code en doing con write_scope -> bloquea y nombra a ambos", async () => {
  ticket(fam.main, "TSK-901.md", doing("claude-code"));
  ticket(fam.main, "TSK-902.md", doing("claude-code", '["apps/engine/**"]'));
  const r = await edit(join(fam.main, "apps", "web", "x.ts"));
  expect(r.code).toBe(2);
  expect(r.stderr).toContain("TSK-901");
  expect(r.stderr).toContain("TSK-902");
});

// ---------- OB-3: acción prohibida ----------

test("OB-3 prohibida: fuera del write_scope y fuera del worktree se bloquean; el motor no se escribe con scope web", async () => {
  ticket(fam.main, "TSK-901.md", doing("claude-code"));
  const outScope = await edit(join(fam.main, "apps", "engine", "src", "signals", "mix.ts"));
  expect(outScope.code).toBe(2);
  expect(outScope.stderr).toContain("fuera del write_scope");
  expect((await edit(join(fam.outside, "x.ts"))).code).toBe(2);
});

// ---------- OB-4: fallo de un gate ----------

// Dentro de un hook de git (pre-commit) rige GIT_INDEX_FILE/GIT_DIR: sin limpiarlos, los git de los
// fixtures escribirían en el índice del repo real. Mismo criterio que cleanEnv de hook-test-utils.
const cleanEnv = (): Record<string, string> =>
  Object.fromEntries(Object.entries(process.env).filter(([k, v]) => v !== undefined && !k.startsWith("GIT_"))) as Record<string, string>;

function fixtureRepo(tickets: Record<string, Record<string, string> | string>): string {
  const dir = realpathSync.native(mkdtempSync(join(tmpdir(), "d2k-orch-")));
  const bunVersion = Bun.spawnSync(["bun", "--version"]).stdout.toString().trim();
  writeFileSync(join(dir, "package.json"), JSON.stringify({ packageManager: `bun@${bunVersion}` }));
  for (const [name, fm] of Object.entries(tickets)) {
    mkdirSync(dirname(join(dir, "docs", "agents", "tasks", name)), { recursive: true });
    // Un string se escribe CRUDO (claves duplicadas, CRLF, claves en el cuerpo: no representables con un Record).
    const body = typeof fm === "string" ? fm : `---\n${Object.entries(fm).map(([k, v]) => `${k}: ${v}`).join("\n")}\n---\n`;
    writeFileSync(join(dir, "docs", "agents", "tasks", name), body);
  }
  const git = (...a: string[]) => Bun.spawnSync(["git", "-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: dir, env: cleanEnv() });
  git("init", "-q", "-b", "main");
  git("add", "-A");
  git("commit", "-q", "-m", "base");
  return dir;
}

function runGate(dir: string): { code: number; out: string } {
  const r = Bun.spawnSync(["bash", join(REPO, "scripts", "verify-simplicity.sh")], { cwd: dir, env: cleanEnv() });
  return { code: r.exitCode ?? -1, out: r.stdout.toString() + r.stderr.toString() };
}

function runHub(dir: string): string {
  const r = Bun.spawnSync(["bun", join(REPO, "scripts", "hub.ts")], { cwd: dir, env: cleanEnv() });
  if (r.exitCode !== 0) throw new Error(r.stderr.toString());
  return readFileSync(join(dir, "docs", "agents", "hub.html"), "utf8");
}

const tmpDirs: string[] = [];
afterAll(() => tmpDirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const fixture = (t: Record<string, Record<string, string> | string>): string => {
  const d = fixtureRepo(t);
  tmpDirs.push(d);
  return d;
};

test("OB-4a gate en rojo: dos claude-code en doing -> verify-simplicity sale 1 y nombra la herramienta", () => {
  const dir = fixture({
    "TSK-901.md": doing("claude-code"),
    "TSK-902.md": doing("claude-code"),
  });
  const g = runGate(dir);
  expect(g.code).toBe(1);
  expect(g.out).toContain("'claude-code'");
});

test("OB-4b gate en verde sólo con una tarea por herramienta (no se declara rojo de más)", () => {
  const dir = fixture({
    "TSK-901.md": doing("claude-code"),
    "TSK-902.md": doing("codex"),
  });
  const g = runGate(dir);
  expect(g.code).toBe(0);
});

test("OB-6 gate: dos tickets doing SIN assigned_tool cuentan como claude-code (igual que hook y tablero) -> rojo", () => {
  const dir = fixture({
    "TSK-901.md": { state: "doing", preferred_tool: "codex" },
    "TSK-902.md": { state: "doing", preferred_tool: "kiro-nativo" },
  });
  const g = runGate(dir);
  expect(g.code).toBe(1);
  expect(g.out).toContain("'claude-code'");
});

test("OB-6 gate: un doing sin assigned_tool + uno de codex -> verde (sin falso positivo)", () => {
  const dir = fixture({
    "TSK-901.md": { state: "doing", preferred_tool: "codex" },
    "TSK-902.md": doing("codex"),
  });
  expect(runGate(dir).code).toBe(0);
});

test("OB-6 gate: un doing sin assigned_tool + uno de claude-code explícito -> rojo (se suman)", () => {
  const dir = fixture({
    "TSK-901.md": { state: "doing" },
    "TSK-902.md": doing("claude-code"),
  });
  expect(runGate(dir).code).toBe(1);
});

test("OB-4c un ticket blocked o con attempts 3 llega al tablero marcado para decisión humana", () => {
  const dir = fixture({
    "TSK-901.md": { state: "blocked", attempts: "3", assigned_tool: "claude-code", moscow: "must" },
  });
  const html = runHub(dir);
  // Se miran textos del marcado de la tarjeta: los nombres de clase CSS salen siempre en <style>.
  expect(html).toContain("🟡 necesita tu decisión");
  expect(html).toContain('class="card card-warn card-needs-human"');
  expect(html).toContain("intentos: 3");
});

test("OB-4c control negativo: una tarea sana en doing no se marca para decisión humana", () => {
  const html = runHub(fixture({ "TSK-901.md": doing("claude-code") }));
  expect(html).not.toContain("🟡 necesita tu decisión");
  expect(html).not.toContain('class="card card-warn');
});

// ---------- OB-5: defecto del tablero (WIP global vs WIP por herramienta) ----------

test("OB-5 el tablero no alerta WIP con claude-code y codex en doing (WIP=1 es POR herramienta)", () => {
  const dir = fixture({
    "TSK-901.md": doing("claude-code"),
    "TSK-902.md": doing("codex"),
  });
  expect(runHub(dir)).not.toContain("wip-alert\">");
});

test("OB-5 el tablero sí alerta con dos tareas de la misma herramienta y nombra cuál", () => {
  const dir = fixture({
    "TSK-901.md": doing("claude-code"),
    "TSK-902.md": doing("claude-code"),
  });
  const html = runHub(dir);
  expect(html).toContain("WIP=2 en claude-code");
});

test("OB-5 sin assigned_tool el ticket cuenta como claude-code (igual que el hook), aunque preferred_tool difiera", () => {
  const dir = fixture({
    "TSK-901.md": { state: "doing", preferred_tool: "codex" },
    "TSK-902.md": { state: "doing", preferred_tool: "kiro-nativo" },
  });
  expect(runHub(dir)).toContain("WIP=2 en claude-code");
});


// ---------- TSK-256: el mismo criterio de assigned_tool en hook, gate y tablero ----------
// Sólo codex / kiro-nativo / hermes-vps exactos son "otra herramienta". Lo demás (null, ~, vacío,
// desconocido, malformado) cuenta como claude-code: un valor no reconocido nunca esconde un doing.

const UNRECOGNIZED = ["null", '"null"', "~", "gemini", "Codex", "codex # temporal", '"codex', "[codex]"];

for (const value of UNRECOGNIZED) {
  test(`TSK-256 gate: dos doing con assigned_tool ${value} cuentan como claude-code -> rojo`, () => {
    const dir = fixture({
      "TSK-901.md": { state: "doing", assigned_tool: value },
      "TSK-902.md": { state: "doing", assigned_tool: value },
    });
    const g = runGate(dir);
    expect(g.code).toBe(1);
    expect(g.out).toContain("'claude-code'");
  });

  test(`TSK-256 tablero: dos doing con assigned_tool ${value} alertan WIP en claude-code`, () => {
    const dir = fixture({
      "TSK-901.md": { state: "doing", assigned_tool: value },
      "TSK-902.md": { state: "doing", assigned_tool: value },
    });
    const html = runHub(dir);
    expect(html).toContain("WIP=2 en claude-code");
  });
}

test("TSK-256 gate: assigned_tool entre comillas dobles de codex sigue siendo codex (control negativo)", () => {
  const dir = fixture({
    "TSK-901.md": { state: "doing", assigned_tool: '"codex"' },
    "TSK-902.md": { state: "doing", assigned_tool: "claude-code" },
  });
  expect(runGate(dir).code).toBe(0);
});

// Dos tickets que el hook considera de claude-code deben sumar 2 también en el gate y en el tablero.
const CLAUDE_B = "---\nstate: doing\nassigned_tool: claude-code\n---\n";
const RAW_AS_CLAUDE: Array<[string, string]> = [
  ["clave duplicada (codex primero)", "---\nstate: doing\nassigned_tool: codex\nassigned_tool: claude-code\n---\n"],
  ["clave duplicada (claude-code primero)", "---\nstate: doing\nassigned_tool: claude-code\nassigned_tool: codex\n---\n"],
  ["assigned_tool sólo en el cuerpo", "---\nstate: doing\n---\nassigned_tool: codex\n"],
];

for (const [label, ticketA] of RAW_AS_CLAUDE) {
  test(`TSK-256 gate (crudo): ${label} + claude-code explícito -> rojo`, () => {
    const g = runGate(fixture({ "TSK-901.md": ticketA, "TSK-902.md": CLAUDE_B }));
    expect(g.code).toBe(1);
    expect(g.out).toContain("'claude-code'");
  });

  test(`TSK-256 tablero (crudo): ${label} + claude-code explícito -> WIP=2 en claude-code`, () => {
    expect(runHub(fixture({ "TSK-901.md": ticketA, "TSK-902.md": CLAUDE_B }))).toContain("WIP=2 en claude-code");
  });
}

test("TSK-256 CRLF: un doing de codex con CRLF no cuenta como claude-code ni en el gate ni en el tablero", () => {
  const crlf = "---\r\nstate: doing\r\nassigned_tool: codex\r\n---\r\n";
  const dir = fixture({ "TSK-901.md": crlf, "TSK-902.md": CLAUDE_B });
  expect(runGate(dir).code).toBe(0);
  expect(runHub(dir)).not.toContain('wip-alert">');
});

// BOM inicial y espacios tras `---`: el hook, el gate y el tablero deben leer lo mismo (codex = otra herramienta).
const EDGE_CODEX: Array<[string, string]> = [
  ["BOM inicial", "\uFEFF---\nstate: doing\nassigned_tool: codex\n---\n"],
  ["espacios tras el --- inicial", "---   \nstate: doing\nassigned_tool: codex\n---\n"],
  ["espacios tras el --- de cierre", "---\nstate: doing\nassigned_tool: codex\n---   \n"],
];

for (const [label, codexTicket] of EDGE_CODEX) {
  test(`TSK-256 borde (${label}): un doing de codex + uno de claude-code -> gate verde y tablero sin alerta`, () => {
    const dir = fixture({ "TSK-901.md": codexTicket, "TSK-902.md": CLAUDE_B });
    expect(runGate(dir).code).toBe(0);
    expect(runHub(dir)).not.toContain('wip-alert">');
  });

  test(`TSK-256 borde (${label}): control: el mismo borde con assigned_tool null suma como claude-code -> rojo`, () => {
    // Control: el mismo ticket con assigned_tool: null SÍ cuenta como claude-code, así que con otro claude-code da rojo.
    const asNull = codexTicket.replace("assigned_tool: codex", "assigned_tool: null");
    const dir = fixture({ "TSK-901.md": asNull, "TSK-902.md": CLAUDE_B });
    expect(runGate(dir).code).toBe(1);
    expect(runHub(dir)).toContain("WIP=2 en claude-code");
  });
}

test("TSK-256 CRLF: dos doing con CRLF y assigned_tool null cuentan como claude-code en gate y tablero", () => {
  const crlfNull = "---\r\nstate: doing\r\nassigned_tool: null\r\n---\r\n";
  const dir = fixture({ "TSK-901.md": crlfNull, "TSK-902.md": crlfNull });
  expect(runGate(dir).code).toBe(1);
  expect(runHub(dir)).toContain("WIP=2 en claude-code");
});

// ---------- TSK-263: contrato único de ficha (hook, gate y tablero) ----------

// `state` sólo se lee de un frontmatter válido. Una ficha malformada o ambigua no se interpreta: el gate la
// rechaza, el hook no deja escribir (salvo para repararla) y el tablero la señala. Nunca esconde un `doing`.
const BOM = String.fromCharCode(0xfeff);
const fm = (...lines: string[]): string => ["---", ...lines, "---", ""].join("\n");
const CODEX_B = fm("state: doing", "assigned_tool: codex");

const VALID_DOING: Array<[string, string]> = [
  ["simple", fm("state: doing")],
  ["comillas dobles", fm('state: "doing"')],
  ["comillas simples", fm("state: 'doing'")],
  ["con comentario", fm("state: doing # en curso")],
  ["comillas y comentario", fm('state: "doing" # en curso')],
  ["tabulador", fm("state:\tdoing")],
  ["sin espacio", fm("state:doing")],
  ["espacios sobrantes", fm("state:   doing   ")],
  ["CRLF", fm("state: doing").replaceAll("\n", "\r\n")],
  ["BOM", BOM + fm("state: doing")],
  ["cuerpo contradictorio", fm("state: doing") + "state: done\n"],
];

const VALID_NOT_DOING: Array<[string, string]> = [
  ...["backlog", "ready", "review", "blocked", "done"].map((s): [string, string] => [s, fm(`state: ${s}`)]),
  ["state: doing en el cuerpo", fm("state: done") + "state: doing\n"],
  ["state: doing con texto en el cuerpo", fm("state: done") + "state: doing es lo que se escribe\n"],
  ["mención en prosa", fm("state: done") + "el ticket usaba state: doing\n"],
  ["bloque de ejemplo en el cuerpo", fm("state: blocked") + "```\n---\nstate: doing\n---\n```\n"],
];

const INVALID: Array<[string, string]> = [
  ["archivo vacío", ""],
  ["sin frontmatter", "state: doing\n"],
  ["sin frontmatter, con BOM", `${BOM}state: doing\n`],
  ["línea en blanco antes de la cabecera", `\n${fm("state: doing")}`],
  ["sin cierre", "---\nstate: doing\nassigned_tool: codex\n"],
  ["sin cierre, CRLF", "---\r\nstate: doing\r\nassigned_tool: codex\r\n"],
  ["cierre mal escrito", "---\nstate: doing\nassigned_tool: codex\n--\n"],
  ["cierre indentado", "---\nstate: doing\nassigned_tool: codex\n  ---\n"],
  // Sin cierre, pero con una raya `---` en el cuerpo: las claves del cuerpo no pueden pasar por cabecera.
  ["sin cierre y raya en el cuerpo tras línea en blanco", "---\nstate: doing\n\nassigned_tool: codex\n---\n"],
  ["sin cierre y raya en el cuerpo tras texto", "---\nstate: doing\nNotas\nassigned_tool: codex\n---\n"],
  ["sin cierre y raya en el cuerpo tras un título", "---\nstate: doing\n## Notas\nassigned_tool: codex\n---\n"],
  ["línea suelta en columna 0", fm("state: done", "doing")],
  ["primera línea indentada", fm("  nota", "state: done")],
  ["cabecera vacía", "---\n---\n"],
  ["cabecera vacía y un segundo bloque", "---\n---\nstate: doing\nassigned_tool: codex\n---\n"],
  ["sin state", fm("id: TSK-901")],
  ["state indentado", fm("meta:", "  state: doing")],
  ["state duplicado, doing primero", fm("state: doing", "state: done")],
  ["state duplicado, doing al final", fm("state: done", "state: doing")],
  ["state duplicado, mismo valor", fm("state: done", "state: done")],
  ["state duplicado, clave entre comillas", fm("state: done", '"state": doing')],
  ["state duplicado, espacio antes de ':'", fm("state: done", "state : doing")],
  ["valor en la línea siguiente", fm("state:", "  doing")],
  ["valor en la línea siguiente sin sangría", fm("state:", "doing")],
  ["valor que continúa", fm("state: done", "  doing")],
  ["bloque plegado", fm("state: >", "  doing")],
  ["valor vacío", fm("state:")],
  ["valor desconocido", fm("state: doingX")],
  ["capitalización distinta", fm("state: Doing")],
  ["lista", fm("state: [doing]")],
  ["comilla sin cerrar", fm('state: "doing')],
  // TSK-268: una línea indentada suelta tras un valor en línea ya no se tolera.
  ["assigned_tool en dos líneas", fm("state: doing", "assigned_tool: codex", "  y algo más")],
];

async function hookOn(tickets: Record<string, string>, file: string): Promise<{ code: number; stderr: string }> {
  for (const [name, text] of Object.entries(tickets)) {
    const path = join(fam.main, "docs", "agents", "tasks", name);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, text);
  }
  return edit(join(fam.main, file));
}
const OUTSIDE = join("apps", "web", "x.ts");
const SCOPED_B = fm("state: doing", "assigned_tool: claude-code", 'write_scope: ["apps/web/**"]');

describe("TSK-263 ficha válida en doing: los tres la cuentan como claude-code", () => {
  for (const [label, text] of VALID_DOING) {
    test(label, async () => {
      const dir = fixture({ "TSK-901.md": text, "TSK-902.md": CLAUDE_B });
      const g = runGate(dir);
      expect(g.code).toBe(1);
      expect(g.out).toContain("'claude-code'");
      const html = runHub(dir);
      expect(html).toContain("WIP=2 en claude-code");
      expect(html).not.toContain('class="ficha-alert"');
      const r = await hookOn({ "TSK-901.md": text, "TSK-902.md": SCOPED_B }, OUTSIDE);
      expect(r.code).toBe(2);
      expect(r.stderr).toContain("TSK-901");
    });
  }
});

describe("TSK-263 ficha válida fuera de doing: ninguno la cuenta", () => {
  for (const [label, text] of VALID_NOT_DOING) {
    test(label, async () => {
      const dir = fixture({ "TSK-901.md": text, "TSK-902.md": CLAUDE_B });
      expect(runGate(dir).code).toBe(0);
      const html = runHub(dir);
      expect(html).not.toContain('class="wip-alert"');
      expect(html).not.toContain('class="ficha-alert"');
      // SCOPED_B es el único doing: autoriza apps/web y la otra ficha no se suma.
      expect((await hookOn({ "TSK-901.md": text, "TSK-902.md": SCOPED_B }, OUTSIDE)).code).toBe(0);
    });
  }
});

describe("TSK-263 ficha malformada o ambigua: los tres la rechazan y no permite saltarse WIP=1", () => {
  for (const [label, text] of INVALID) {
    test(label, async () => {
      // Sola: ya es rojo. No hace falta una segunda ficha para que el gate la vea.
      const alone = runGate(fixture({ "TSK-901.md": text }));
      expect(alone.code).toBe(1);
      expect(alone.out).toContain("TSK-901.md: ficha inválida");
      // Junto a un doing válido de cada herramienta.
      expect(runGate(fixture({ "TSK-901.md": text, "TSK-902.md": CLAUDE_B })).code).toBe(1);
      expect(runGate(fixture({ "TSK-901.md": text, "TSK-902.md": CODEX_B })).code).toBe(1);
      const html = runHub(fixture({ "TSK-901.md": text, "TSK-902.md": CLAUDE_B }));
      expect(html).toContain('class="ficha-alert"');
      expect(html).toContain("TSK-901.md");
      const blocked = await hookOn({ "TSK-901.md": text }, OUTSIDE);
      expect(blocked.code).toBe(2);
      expect(blocked.stderr).toContain("TSK-901.md");
      // Repararla sigue siendo posible.
      expect((await hookOn({ "TSK-901.md": text }, join("docs", "agents", "tasks", "TSK-901.md"))).code).toBe(0);
    });
  }
});

describe("TSK-263 descubrimiento: los tres miran los mismos archivos", () => {
  for (const name of ["sub/TSK-901.md", "notas.md"]) {
    test(`doing en ${name}`, async () => {
      const text = fm("state: doing");
      const dir = fixture({ [name]: text, "TSK-902.md": CLAUDE_B });
      expect(runGate(dir).code).toBe(1);
      expect(runHub(dir)).toContain("WIP=2 en claude-code");
      expect((await hookOn({ [name]: text, "TSK-902.md": SCOPED_B }, OUTSIDE)).code).toBe(2);
    });
  }
});

test("TSK-263 el gate falla cerrado si no puede ejecutar el contrato de fichas", () => {
  const dir = fixture({ "TSK-901.md": fm("state: done") });
  const copy = realpathSync.native(mkdtempSync(join(tmpdir(), "d2k-nocontract-")));
  tmpDirs.push(copy);
  writeFileSync(join(copy, "verify-simplicity.sh"), readFileSync(join(REPO, "scripts", "verify-simplicity.sh"), "utf8"));
  const r = Bun.spawnSync(["bash", join(copy, "verify-simplicity.sh")], { cwd: dir, env: cleanEnv() });
  expect(r.exitCode).toBe(1);
  expect(r.stdout.toString()).toContain("fichas");
});

test("TSK-263 las fichas reales del repo cumplen el contrato", () => {
  const r = Bun.spawnSync(["python3", "-B", join(REPO, "scripts", "hooks", "ticket_contract.py"), "check", join(REPO, "docs", "agents", "tasks")], { env: cleanEnv() });
  expect(r.stdout.toString()).toBe("");
  expect(r.exitCode).toBe(0);
});
