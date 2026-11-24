import { afterAll, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findShadowedSkills, listSkillNames } from "./shadowing";

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
  skill(personal, "adhd-mode", "solo personal");
  expect(findShadowedSkills(repo, personal)).toEqual([
    { name: "dispatch", differs: true },
    { name: "helm", differs: false },
  ]);
});

test("sin colisión: lista vacía; un skill sólo-personal no cuenta; directorio personal ausente no lanza", () => {
  const repo = tmp();
  const personal = tmp();
  skill(repo, "dispatch", "x");
  skill(personal, "adhd-mode", "y");
  expect(findShadowedSkills(repo, personal)).toEqual([]);
  expect(findShadowedSkills(repo, join(personal, "no-existe"))).toEqual([]);
});

test("las diferencias de fin de línea (CRLF/LF) no cuentan como versión distinta", () => {
  const repo = tmp();
  const personal = tmp();
  skill(repo, "dispatch", "a\nb\n");
  skill(personal, "dispatch", "a\r\nb\r\n");
  expect(findShadowedSkills(repo, personal)).toEqual([{ name: "dispatch", differs: false }]);
});

test("claude-repo-only.sh antepone --setting-sources project,local y pasa el resto de argumentos", () => {
  const d = tmp();
  const fake = join(d, "fake-claude").replaceAll("\\", "/");
  writeFileSync(fake, '#!/usr/bin/env bash\necho "ARGS:$*"\n');
  chmodSync(fake, 0o755);
  const script = join(import.meta.dir, "claude-repo-only.sh");
  const r = Bun.spawnSync(["bash", script, "-p", "hola"], { env: { ...process.env, CLAUDE_BIN: fake } });
  expect(r.exitCode).toBe(0);
  expect(r.stdout.toString().trim()).toBe("ARGS:--setting-sources project,local -p hola");
});
