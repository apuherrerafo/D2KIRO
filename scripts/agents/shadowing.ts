// Detecta skills del repo que una copia PERSONAL (~/.claude/skills) sombrea. Claude Code resuelve
// skills con `enterprise > personal > project` (code.claude.com/docs/en/skills), así que una copia
// vieja en el directorio de usuario le gana al skill del repo con el mismo nombre.
// Sólo lee; nunca escribe ni borra nada global. Uso: `bun scripts/agents/shadowing.ts`
// (sale 1 si hay algún skill del repo sombreado).
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

const norm = (s: string): string => s.replace(/\r\n/g, "\n");

/** Un skill es un directorio (o enlace/junction a uno) con SKILL.md; ignora `.trash`, archivos sueltos, etc. */
export function listSkillNames(dir: string): string[] {
  if (!existsSync(dir)) return [];
  // `existsSync` sigue enlaces; `Dirent.isDirectory()` daría false en un symlink/junction y ocultaría la copia.
  return readdirSync(dir)
    .filter((name) => existsSync(join(dir, name, "SKILL.md")))
    .sort();
}

/** `CLAUDE_CONFIG_DIR` sustituye a `~/.claude`. Vacío o relativo se lanza: daría un "OK" falso. */
export function personalSkillsDir(env: Record<string, string | undefined> = process.env, home: string = homedir()): string {
  const root = env.CLAUDE_CONFIG_DIR || home;
  if (!isAbsolute(root)) throw new Error("no se pudo resolver el directorio personal (ruta vacía o relativa)");
  return env.CLAUDE_CONFIG_DIR ? join(root, "skills") : join(root, ".claude", "skills");
}

/** Claves de `settings.json` personal que no restringen nada. Lista cerrada: lo desconocido cuenta como protección. */
const INERT_SETTINGS = new Set(["$schema", "model", "modelSettings", "theme", "autoUpdatesChannel"]);

type Inspect = (path: string) => { isDirectory(): boolean };

/** `null` SÓLO si no existe; cualquier otro error de lectura es "unknown" (`existsSync` lo confundiría con ausente). */
function look(path: string, inspect: Inspect): ReturnType<Inspect> | "unknown" | null {
  try {
    return inspect(path);
  } catch (error) {
    return (error as { code?: string }).code === "ENOENT" ? null : "unknown";
  }
}

/** Lo que se dejaría de aplicar al excluir la configuración personal. Vacío = excluirla no debilita nada. */
export function personalProtections(configDir: string, inspect: Inspect = statSync): string[] {
  const root = look(configDir, inspect);
  if (root === null) return [];
  if (root === "unknown" || !root.isDirectory()) return ["directorio personal (no se puede inspeccionar)"];
  const found = ["settings.local.json", "CLAUDE.md", "rules"].filter((name) => look(join(configDir, name), inspect) !== null);
  const settings = join(configDir, "settings.json");
  if (look(settings, inspect) === null) return found;
  try {
    const raw: unknown = JSON.parse(readFileSync(settings, "utf8"));
    if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return [...found, "settings.json (forma inesperada)"];
    return [...found, ...Object.keys(raw).filter((key) => !INERT_SETTINGS.has(key)).map((key) => `settings.json: ${key}`)];
  } catch {
    return [...found, "settings.json (ilegible)"];
  }
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

if (import.meta.main && process.argv.includes("--protections")) {
  const found = personalProtections(dirname(personalSkillsDir()));
  if (found.length > 0) {
    console.error(`No se puede aislar sin desactivar configuración personal: ${found.join(", ")}.`);
    process.exit(3);
  }
} else if (import.meta.main) {
  const repo = join(import.meta.dir, "..", "..", ".claude", "skills");
  const shadowed = findShadowedSkills(repo, personalSkillsDir());
  if (shadowed.length === 0) {
    console.log("OK: ningún skill del repo está sombreado por ~/.claude/skills.");
  } else {
    const stale = shadowed.filter((s) => s.differs).map((s) => s.name);
    console.log(`SOMBREADOS: ${shadowed.length} skills del repo los gana la copia personal (~/.claude/skills).`);
    console.log(`  con contenido DISTINTO (versión vieja gana): ${stale.join(", ") || "ninguno"}`);
    console.log(`  todos: ${shadowed.map((s) => s.name).join(", ")}`);
    console.log("  CLI: arranca con scripts/agents/claude-repo-only.sh. Extensión de VS Code: sólo se aísla retirando esas copias de ~/.claude/skills (acción del propietario).");
    process.exit(1);
  }
}
