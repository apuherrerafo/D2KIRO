import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

// Todo texto que lee el jugador está en español latinoamericano neutro (tuteo), nunca voseo
// rioplatense. Escanea el código de producción de los dos procesos; los comentarios se ignoran.
const VOSEO_WORDS = [
  "podés", "tenés", "querés", "sabés", "ganás", "controlás", "llenás", "reportás", "elegís", "vos",
  "elegí", "probá", "volvé", "esperá", "revisá", "intentá", "reintentá", "reiniciá", "cerrá", "añadí", "ingresá",
  "calculá", "refrescá", "nominá", "seleccioná", "verificá", "completá", "escribí", "confirmá", "presioná",
  "descargá", "agregá", "abrí", "mirá", "usá", "buscá", "tocá", "dejá", "decí", "pedí", "pegá", "copiá", "cargá",
  "guardá", "activá", "configurá", "andá", "poné", "tené", "hacé", "fijate", "corregilas", "reportalo", "abrilo", "cerralo", "pegalo", "volvelo",
];
const VOSEO = new RegExp(String.raw`(?<![\p{L}])(` + VOSEO_WORDS.join("|") + String.raw`)(?![\p{L}])`, "iu");

const ROOT = resolve(import.meta.dir, "..", "..");
const SCAN_DIRS = ["web/app", "web/components", "web/features", "web/lib", "web/server", "engine/src"];

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(path);
  }
  return out;
}

function isCommentLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*");
}

describe("Español neutro (tuteo) en el texto visible", () => {
  test("el detector reconoce voseo y deja pasar el tuteo", () => {
    expect(VOSEO.exec("Elegí un héroe")?.[0]).toBe("Elegí");
    expect(VOSEO.exec("Le ganás a Axe")?.[0]).toBe("ganás");
    expect(VOSEO.exec("Elige un héroe. Le ganas a Axe. Puedes seguir. Vuelve a intentarlo.")).toBeNull();
  });

  test("ningún archivo de producción de apps/web ni apps/engine usa voseo fuera de comentarios", () => {
    const hits: string[] = [];
    for (const dir of SCAN_DIRS) {
      for (const file of sourceFiles(join(ROOT, dir))) {
        readFileSync(file, "utf8").split(/\r?\n/).forEach((line, index) => {
          const match = isCommentLine(line) ? null : VOSEO.exec(line);
          if (match) hits.push(`${file.slice(ROOT.length + 1)}:${index + 1} «${match[0]}»`);
        });
      }
    }
    expect(hits).toEqual([]);
  });
});
