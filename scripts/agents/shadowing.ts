// Detecta skills del repo que una copia PERSONAL (~/.claude/skills) sombrea. Claude Code resuelve
// skills con `enterprise > personal > project` (code.claude.com/docs/en/skills), así que una copia
// vieja en el directorio de usuario le gana al skill del repo con el mismo nombre.
// Sólo lee; nunca escribe ni borra nada global. Uso: `bun scripts/agents/shadowing.ts`
// (sale 1 si hay algún skill del repo sombreado).
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const norm = (s: string): string => s.replace(/\r\n/g, "\n");

/** Un skill es un directorio con SKILL.md (ignora `.trash`, archivos sueltos, etc.). */
export function listSkillNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && existsSync(join(dir, e.name, "SKILL.md")))
    .map((e) => e.name)
    .sort();
}

export interface Shadowed {
  name: string;
  /** true si el contenido de SKILL.md difiere (la copia personal es otra versión). */
  differs: boolean;
}

export function findShadowedSkills(repoSkillsDir: string, personalSkillsDir: string): Shadowed[] {
  const personal = new Set(listSkillNames(personalSkillsDir));
  return listSkillNames(repoSkillsDir)
    .filter((n) => personal.has(n))
    .map((name) => ({
      name,
      differs:
        norm(readFileSync(join(repoSkillsDir, name, "SKILL.md"), "utf8")) !==
        norm(readFileSync(join(personalSkillsDir, name, "SKILL.md"), "utf8")),
    }));
}

if (import.meta.main) {
  const home = process.env.USERPROFILE ?? process.env.HOME ?? "";
  const repo = join(import.meta.dir, "..", "..", ".claude", "skills");
  const shadowed = findShadowedSkills(repo, join(home, ".claude", "skills"));
  if (shadowed.length === 0) {
    console.log("OK: ningún skill del repo está sombreado por ~/.claude/skills.");
  } else {
    const stale = shadowed.filter((s) => s.differs).map((s) => s.name);
    console.log(`SOMBREADOS: ${shadowed.length} skills del repo los gana la copia personal (~/.claude/skills).`);
    console.log(`  con contenido DISTINTO (versión vieja gana): ${stale.join(", ") || "ninguno"}`);
    console.log("  Arranca Claude Code con scripts/agents/claude-repo-only.sh para que cargue sólo los del repo.");
    process.exit(1);
  }
}
