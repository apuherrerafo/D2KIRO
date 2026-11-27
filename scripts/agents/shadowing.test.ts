import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findShadowedSkills, listSkillNames, personalProtections, personalSkillsDir } from "./shadowing";

// Fixtures en directorios temporales: ninguna prueba lee ~/.claude real.
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), "d2k-shadow-"));
  dirs.push(d);
  return d;
};
function skill(root: string, name: string, body: string): void {
  mkdirSync(join(root, name), { recursive: true });
  writeFileSync(join(root, name, "SKILL.md"), body);
}

test("lista sólo directorios con SKILL.md (ignora .trash y archivos sueltos)", () => {
  const r = tmp();
  skill(r, "dispatch", "a");
  mkdirSync(join(r, ".trash", "x"), { recursive: true });
  writeFileSync(join(r, "suelto.md"), "x");
  expect(listSkillNames(r)).toEqual(["dispatch"]);
});

test("detecta el skill del repo sombreado y si la copia personal es otra versión", () => {
  const repo = tmp();
  const personal = tmp();
  skill(repo, "dispatch", "nuevo ciclo");
  skill(repo, "helm", "igual");
  skill(personal, "dispatch", "viejo");
  skill(personal, "helm", "igual");
  skill(personal, "solo-personal", "solo personal");
  expect(findShadowedSkills(repo, personal)).toEqual([
    { name: "dispatch", differs: true },
    { name: "helm", differs: false },
  ]);
});

test("sin colisión: lista vacía; un skill sólo-personal no cuenta; directorio personal ausente no lanza", () => {
  const repo = tmp();
  const personal = tmp();
  skill(repo, "dispatch", "x");
  skill(personal, "solo-personal", "y");
  expect(findShadowedSkills(repo, personal)).toEqual([]);
  expect(findShadowedSkills(repo, join(personal, "no-existe"))).toEqual([]);
});

test("una copia personal enlazada (symlink o junction) también sombrea", () => {
  const repo = tmp();
  const personal = tmp();
  const elsewhere = tmp();
  skill(repo, "dispatch", "nuevo");
  skill(elsewhere, "dispatch", "viejo");
  symlinkSync(join(elsewhere, "dispatch"), join(personal, "dispatch"), "junction"); // en POSIX el tipo se ignora
  expect(findShadowedSkills(repo, personal)).toEqual([{ name: "dispatch", differs: true }]);
});

test("el directorio personal respeta CLAUDE_CONFIG_DIR y nunca es relativo al directorio actual", () => {
  const cfg = resolve("x", "cfg");
  const home = resolve("h");
  expect(personalSkillsDir({ CLAUDE_CONFIG_DIR: cfg }, home)).toBe(join(cfg, "skills"));
  expect(personalSkillsDir({}, home)).toBe(join(home, ".claude", "skills"));
  expect(() => personalSkillsDir({}, "")).toThrow();
  expect(() => personalSkillsDir({ CLAUDE_CONFIG_DIR: "relativo" }, home)).toThrow();
  expect(() => personalSkillsDir({}, "relativo")).toThrow();
});

test("las diferencias de fin de línea (CRLF/LF) no cuentan como versión distinta", () => {
  const repo = tmp();
  const personal = tmp();
  skill(repo, "dispatch", "a\nb\n");
  skill(personal, "dispatch", "a\r\nb\r\n");
  expect(findShadowedSkills(repo, personal)).toEqual([{ name: "dispatch", differs: false }]);
});

const launcher = join(import.meta.dir, "claude-repo-only.sh");
/** Lanza el lanzador con un binario falso y un directorio personal de fixture (nunca el real). */
function launch(configDir: string, ...args: string[]) {
  const fake = join(tmp(), "fake-claude").replaceAll("\\", "/");
  writeFileSync(fake, '#!/usr/bin/env bash\necho "ARGS:$*"\n');
  chmodSync(fake, 0o755);
  return Bun.spawnSync(["bash", launcher, ...args], { env: { ...process.env, CLAUDE_BIN: fake, CLAUDE_CONFIG_DIR: configDir } });
}

test("claude-repo-only.sh antepone --setting-sources project,local y pasa el resto de argumentos", () => {
  const r = launch(tmp(), "-p", "hola");
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString().trim()).toBe("ARGS:--setting-sources project,local -p hola");
});

test("ajustes personales sin protecciones (modelo, tema) no impiden lanzar", () => {
  const cfg = tmp();
  writeFileSync(join(cfg, "settings.json"), JSON.stringify({ model: "x", theme: "dark" }));
  expect(launch(cfg).exitCode).toBe(0);
});

test.each([
  ["permissions", "settings.json", JSON.stringify({ permissions: { deny: ["Read(.env)"] } })],
  ["hooks", "settings.json", JSON.stringify({ hooks: { PreToolUse: [] } })],
  ["clave desconocida", "settings.json", JSON.stringify({ algoNuevo: true })],
  ["settings ilegible", "settings.json", "{ roto"],
  ["settings que no es un objeto", "settings.json", "[]"],
  ["settings.local.json", "settings.local.json", "{}"],
  ["CLAUDE.md personal", "CLAUDE.md", "reglas"],
])("falla sin ejecutar Claude si lo personal que se perdería incluye: %s", (_caso, file, body) => {
  const cfg = tmp();
  writeFileSync(join(cfg, file), body);
  const r = launch(cfg);
  expect(r.exitCode).toBe(3);
  expect(r.stdout.toString()).not.toContain("ARGS:");
});

test("falla si existen reglas personales (rules/)", () => {
  const cfg = tmp();
  mkdirSync(join(cfg, "rules"));
  expect(launch(cfg).exitCode).toBe(3);
});

/** Lanza desde `cwd` sin CLAUDE_CONFIG_DIR: el directorio personal sale de un HOME de fixture con permisos. */
function launchFromProtectedHome(cwd: string) {
  const home = tmp();
  mkdirSync(join(home, ".claude"));
  writeFileSync(join(home, ".claude", "settings.json"), JSON.stringify({ permissions: { deny: ["Read(.env)"] } }));
  const env: Record<string, string | undefined> = { ...process.env, CLAUDE_BIN: "true", HOME: home, USERPROFILE: home };
  delete env.CLAUDE_CONFIG_DIR;
  return Bun.spawnSync(["bash", launcher], { cwd, env });
}

test("un .env del directorio actual no puede desviar la comprobación a otro directorio personal", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, ".env"), `CLAUDE_CONFIG_DIR=${tmp().replaceAll("\\", "/")}\n`);
  expect(launchFromProtectedHome(cwd).exitCode).toBe(3);
});

test("un bunfig.toml del directorio actual no puede ejecutar código que anule la comprobación", () => {
  const cwd = tmp();
  writeFileSync(join(cwd, "pre.ts"), "process.exit(0);\n");
  writeFileSync(join(cwd, "bunfig.toml"), 'preload = ["./pre.ts"]\n');
  expect(launchFromProtectedHome(cwd).exitCode).toBe(3);
});

test("un CDPATH exportado no puede desviar la comprobación a otro árbol (invocación con ruta relativa)", () => {
  const decoy = tmp();
  mkdirSync(join(decoy, "scripts", "agents"), { recursive: true });
  writeFileSync(join(decoy, "scripts", "agents", "shadowing.ts"), "process.exit(0);\n");
  const cfg = tmp();
  writeFileSync(join(cfg, "CLAUDE.md"), "reglas");
  const r = Bun.spawnSync(["bash", "-c", 'CDPATH="$(cygpath -u "$1" 2>/dev/null || echo "$1")" bash scripts/agents/claude-repo-only.sh', "x", decoy], {
    cwd: join(import.meta.dir, "..", ".."),
    env: { ...process.env, CLAUDE_BIN: "true", CLAUDE_CONFIG_DIR: cfg },
  });
  expect(r.exitCode).toBe(3);
});

test("un directorio personal que no se puede inspeccionar (no es directorio) bloquea el lanzamiento", () => {
  const file = join(tmp(), "no-es-directorio");
  writeFileSync(file, "x");
  expect(launch(file).exitCode).toBe(3);
});

test("un error de lectura distinto de «no existe» cuenta como protección; la ausencia no", () => {
  const fail = (code: string) => (): never => {
    throw Object.assign(new Error(code), { code });
  };
  expect(personalProtections(tmp(), fail("EACCES")).length).toBeGreaterThan(0);
  expect(personalProtections(tmp(), fail("ENOENT"))).toEqual([]);
  expect(personalProtections(join(tmp(), "no-existe"))).toEqual([]);
});

test("claude-repo-only.sh rechaza un --setting-sources del invocador (no reabre ~/.claude)", () => {
  expect(launch(tmp(), "--setting-sources", "user").exitCode).toBe(2);
});
