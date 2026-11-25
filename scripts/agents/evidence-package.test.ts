import { afterAll, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// TSK-265 — el paquete de evidencia de `/dispatch` debe llevar el CONTENIDO del cambio, también cuando son sólo
// archivos sin seguimiento. Se ejecutan los comandos tal como están escritos en el skill, en un repo desechable.
// Que un modelo obedezca el texto de los revisores no se puede probar aquí: sólo que el texto lo pide.

const REPO = join(import.meta.dir, "..", "..");
const DIFF_LOGS = ["diff", "diff-local", "diff-nuevos"];
const bases: string[] = [];

afterAll(() => {
  for (const dir of bases) rmSync(dir, { recursive: true, force: true });
});

const read = (path: string): string => readFileSync(join(REPO, path), "utf8").replace(/\r\n/g, "\n");

/** Sólo la preparación y los comandos de captura del bloque (no la suite ni los linters). */
function evidenceScript(): string {
  const block = /## PAQUETE DE EVIDENCIA[\s\S]*?```bash\n([\s\S]*?)```/.exec(read(".claude/skills/dispatch/SKILL.md"))?.[1];
  if (block === undefined) throw new Error("no se encontró el bloque bash del paquete de evidencia");
  return block
    .split("\n")
    .filter((line) => /^(E=|BASE=|NUEVOS=|gate\(\)|gate (sha|status|diff\S*) )/.test(line))
    .join("\n")
    .replace(/^BASE=\S+.*$/m, "BASE=base");
}

function run(cmd: string[], cwd: string): void {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  const res = Bun.spawnSync(cmd, { cwd, env, stdout: "pipe", stderr: "pipe" });
  if (res.exitCode !== 0) throw new Error(`${cmd.join(" ")}: ${res.stderr.toString()}`);
}

/** Repo con un commit base, aplica `change`, ejecuta la captura y devuelve cada log. */
function capture(change: (dir: string) => void, nuevos: string[] = []): Record<string, string> {
  const dir = mkdtempSync(join(tmpdir(), "d2k-evid-"));
  bases.push(dir);
  run(["git", "init", "-q", "-b", "main"], dir);
  writeFileSync(join(dir, ".gitignore"), ".local/\n.env\n");
  run(["git", "add", ".gitignore"], dir);
  run(["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "-m", "base"], dir);
  run(["git", "branch", "base"], dir);
  change(dir);
  const declared = `NUEVOS=(${nuevos.map((f) => `'${f}'`).join(" ")})`;
  run(["bash", "-c", evidenceScript().replace(/^NUEVOS=.*$/m, () => declared)], dir);
  const logs: Record<string, string> = {};
  for (const path of new Bun.Glob("*.log").scanSync({ cwd: join(dir, ".local", "evidencia", "TSK-XXX") })) {
    logs[path.replace(/\.log$/, "")] = readFileSync(join(dir, ".local", "evidencia", "TSK-XXX", path), "utf8");
  }
  return logs;
}

/** Salida de un log sin las líneas de cabecera (`cwd:`, `$ ...`) ni `exit=`. */
function body(log: string): string {
  const at = log.search(/^(diff --git|exit=)/m);
  return at === -1 ? "" : log.slice(at).replace(/^exit=\d+\n?/gm, "").trim();
}

const changeBody = (logs: Record<string, string>): string => DIFF_LOGS.map((n) => body(logs[n] ?? "")).join("");

test("sólo archivos nuevos declarados: el paquete lleva su contenido y todas las capturas salen con exit=0", () => {
  const logs = capture((dir) => {
    mkdirSync(join(dir, "sub dir"), { recursive: true });
    writeFileSync(join(dir, "nuevo.ts"), "export const NUEVO_UNO = 1;\n");
    writeFileSync(join(dir, "sub dir", "año nuevo.ts"), "export const NUEVO_DOS = 2;\n");
    writeFileSync(join(dir, ".env"), "NO_DEBE_SALIR=1\n");
  }, ["nuevo.ts", "sub dir/año nuevo.ts"]);
  const change = changeBody(logs);
  expect(change).toContain("+export const NUEVO_UNO = 1;");
  expect(change).toContain("+export const NUEVO_DOS = 2;");
  expect(change).not.toContain("NO_DEBE_SALIR");
  for (const log of Object.values(logs)) expect(log.trimEnd().endsWith("exit=0")).toBe(true);
  expect(logs.status).toContain("sub dir/");
});

test("sin cambios: las tres capturas de contenido quedan vacías (no hay nada aprobable)", () => {
  const logs = capture(() => {});
  expect(DIFF_LOGS.filter((n) => n in logs)).toEqual(DIFF_LOGS);
  expect(changeBody(logs)).toBe("");
});

test("cambios rastreados y nuevos a la vez: salen ambos", () => {
  const logs = capture((dir) => {
    writeFileSync(join(dir, ".gitignore"), ".local/\n.env\nRASTREADO\n");
    writeFileSync(join(dir, "otro.ts"), "export const OTRO = 3;\n");
  }, ["otro.ts"]);
  expect(changeBody(logs)).toContain("+RASTREADO");
  expect(changeBody(logs)).toContain("+export const OTRO = 3;");
});

// TSK-268 — ningún archivo sin seguimiento entra al paquete si no se declara; `.gitignore` no es el único filtro.
test("por defecto no se vuelca ningún archivo sin seguimiento, esté o no ignorado", () => {
  const logs = capture((dir) => {
    writeFileSync(join(dir, "notas-privadas.txt"), "PRIVADO_UNO\n");
    writeFileSync(join(dir, "nuevo.ts"), "export const NUEVO = 1;\n");
  });
  expect(Object.values(logs).join("")).not.toContain("PRIVADO_UNO");
  expect(changeBody(logs)).toBe("");
  expect(logs.status).toContain("nuevo.ts");
});

test("declarar uno no arrastra a los demás", () => {
  const logs = capture((dir) => {
    writeFileSync(join(dir, "notas-privadas.txt"), "PRIVADO_UNO\n");
    writeFileSync(join(dir, "nuevo.ts"), "export const NUEVO = 1;\n");
  }, ["nuevo.ts"]);
  expect(changeBody(logs)).toContain("+export const NUEVO = 1;");
  expect(Object.values(logs).join("")).not.toContain("PRIVADO_UNO");
});

const REFUSED: Array<[string, string, string]> = [
  ["un secreto no ignorado", "config/clave.pem", "config/clave.pem"],
  ["un entorno en mayúsculas", ".ENV.PROD", ".ENV.PROD"],
  ["algo bajo private/", "private/notas.md", "private/notas.md"],
  ["una base de datos", "data/x.sqlite", "data/x.sqlite"],
  ["un archivo ignorado", ".local/oculto.txt", ".local/oculto.txt"],
  ["una carpeta entera", "sub/oculto.txt", "sub"],
  ["un comodín", "oculto.txt", "*.txt"],
];

for (const [label, file, declared] of REFUSED) {
  test(`declarar ${label} se rechaza sin volcar su contenido`, () => {
    const logs = capture((dir) => {
      mkdirSync(join(dir, file, ".."), { recursive: true });
      writeFileSync(join(dir, file), "NO_DEBE_SALIR\n");
    }, [declared]);
    expect(logs["diff-nuevos"]).toContain("rechazado");
    expect(logs["diff-nuevos"]?.trimEnd().endsWith("exit=0")).toBe(false);
    expect(Object.values(logs).join("")).not.toContain("NO_DEBE_SALIR");
  });
}

test(".env.example declarado sí sale", () => {
  const logs = capture((dir) => writeFileSync(join(dir, ".env.example"), "EJEMPLO=1\n"), [".env.example"]);
  expect(changeBody(logs)).toContain("+EJEMPLO=1");
});

for (const path of [".claude/agents/warden.md", ".claude/agents/sentinel.md", ".claude/skills/redteam/SKILL.md", ".claude/skills/dispatch/SKILL.md"]) {
  test(`${path}: cuenta diff-nuevos como cambio y no aprueba vacío ni sin contenido`, () => {
    const rule = read(path).split("\n").find((line) => line.startsWith("**Qué es el cambio:**")) ?? "";
    expect(rule).toContain("`diff`, `diff-local` y `diff-nuevos`");
    expect(rule).toMatch(/basta con que uno traiga contenido/i);
    expect(rule).toMatch(/los tres vac[ií]os[^.]*`BLOCKED`/i);
    expect(rule).toMatch(/archivo nuevo[^.]*sin su contenido[^.]*`BLOCKED`/i);
  });
}

test("ningún revisor sigue exigiendo que `diff` por sí solo no esté vacío", () => {
  for (const path of [".claude/agents/warden.md", ".claude/agents/sentinel.md"]) {
    expect(read(path)).not.toMatch(/diff no vacío(?! \()/);
  }
});
