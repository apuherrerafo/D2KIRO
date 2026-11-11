import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, normalize, relative, resolve, dirname } from "node:path";

// Auditoría mecánica de Legacy (MVP final). Canonical Light V1.1 es la ÚNICA autoridad visual: este archivo hace que "cero
// dependencias visuales Legacy en el bundle de producción" sea una propiedad comprobada en cada corrida, no una declaración.

const WEB = resolve(import.meta.dir, "..");
const PRODUCTION_DIRS = ["app", "components", "features", "lib", "server"];

function walk(dir: string): string[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const isTestLike = (file: string) => /\.(test|stories|pw)\.[tj]sx?$/.test(file) || file.includes("__tests__");
const productionFiles = PRODUCTION_DIRS.flatMap((dir) => walk(join(WEB, dir))).filter((file) => !isTestLike(file));
const sourceFiles = productionFiles.filter((file) => /\.tsx?$/.test(file));
const cssFiles = [...productionFiles, ...walk(join(WEB, "design/canonical")), ...walk(join(WEB, "design/tokens")).filter((file) => !file.endsWith("workshop.css"))].filter((file) => file.endsWith(".css"));
const text = (file: string) => readFileSync(file, "utf8");
const rel = (file: string) => relative(WEB, file).split("\\").join("/");

// Paleta del producto anterior (neutros azul-negro, dorado "D2KIRO Gold", verde/rojo/ámbar propios).
const LEGACY_HEX = ["0f1115", "171a21", "1f232c", "2a2f3a", "f5f6f8", "a8adba", "d4af37", "e6c250", "3fb950", "f85149", "d29922"];

describe("Legacy: paleta y temas", () => {
  it("ninguna hoja de producción ni de tokens contiene un color de la paleta anterior", () => {
    for (const file of cssFiles) {
      const css = text(file).toLowerCase();
      for (const hex of LEGACY_HEX) expect(css.includes(hex), `${rel(file)} contiene #${hex}`).toBe(false);
    }
  });

  it("ninguna pantalla de producción declara el tema oscuro", () => {
    for (const file of sourceFiles) expect(/data-theme=["']dark["']/.test(text(file)), rel(file)).toBe(false);
  });

  it("las pantallas ya no apuntan a los nombres/tokens del tema anterior (--primitive-color-*, gold)", () => {
    for (const file of [...sourceFiles, ...cssFiles]) {
      const source = text(file);
      expect(/--primitive-color-/.test(source), rel(file)).toBe(false);
    }
  });

  it("el layout raíz monta el shell Canonical Light y no carga las fuentes del producto anterior", () => {
    const layout = text(join(WEB, "app/layout.tsx"));
    expect(layout).toContain("<AppShell");
    expect(layout).not.toMatch(/Geist/);
    expect(text(join(WEB, "app/globals.css"))).not.toMatch(/geist/i);
  });

  it("no existe ya el marco Light exclusivo de /live-draft ni el puente de alcance por pantalla", () => {
    expect(existsSync(join(WEB, "features/live-light/components/LiveNavFrame.tsx"))).toBe(false);
    expect(/--surface-base:\s*var\(--r3-bg\)/.test(text(join(WEB, "features/simulator-light/light.css")))).toBe(false);
  });

  it("el nombre del producto anterior no aparece en ningún texto visible", () => {
    // Comentarios y la clave de localStorage (interna, no visible) quedan fuera: se mira solo lo que acaba en pantalla.
    for (const file of sourceFiles) {
      const stripped = text(file).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      const hits = [...stripped.matchAll(/(["'`>])([^"'`<\n]*dota2coach[^"'`<\n]*)/gi)].map((match) => match[2]).filter((hit) => !/STORAGE_KEY|\.random-draft\.config/.test(hit) && !/^dota2coach\.random-draft/.test(hit));
      expect(hits, rel(file)).toEqual([]);
    }
  });
});

describe("Legacy: la hoja del shell cumple el contrato del Design System", () => {
  const css = text(join(WEB, "components/app-shell/app-shell.css")).replace(/\/\*[\s\S]*?\*\//g, "");

  it("cero literales de color", () => {
    expect(css.match(/#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/)).toBeNull();
  });

  it("no declara ninguna propiedad custom: solo lee tokens canónicos", () => {
    expect([...css.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((match) => match[1])).toEqual([]);
    for (const used of new Set([...css.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1]))) {
      expect(/^--(r3|cx|f|m)-/.test(used), `token no canónico: ${used}`).toBe(true);
    }
  });

  it("las duraciones solo pasan por var(--m-*) y cada transición tiene su sustituto de movimiento reducido", () => {
    expect(css.match(/\b\d+(\.\d+)?m?s\b/g)?.filter((value) => value !== "0ms") ?? []).toEqual([]);
    expect(css).toContain("prefers-reduced-motion: reduce");
  });
});

// Alcanzabilidad: todo archivo de producción debe colgar de una ruta (page/layout/route/error/…) o del proxy. Un módulo de
// interfaz sin ningún consumidor es código muerto que, además, arrastra estilos del producto anterior.
describe("Legacy: no queda interfaz muerta", () => {
  const IMPORT = /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)/g;
  const EXTENSIONS = ["", ".ts", ".tsx", ".css", ".json", "/index.ts", "/index.tsx"];

  function resolveImport(from: string, specifier: string): string | null {
    let base: string;
    if (specifier.startsWith("@/")) base = join(WEB, specifier.slice(2));
    else if (specifier.startsWith(".")) base = resolve(dirname(from), specifier);
    else return null;
    for (const extension of EXTENSIONS) {
      const candidate = normalize(base + extension);
      if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
    }
    return null;
  }

  const entries = walk(join(WEB, "app")).filter((file) => /(page|layout|error|global-error|not-found|loading|route)\.tsx?$/.test(file)).concat(join(WEB, "proxy.ts"));
  const seen = new Set<string>();
  const stack = entries.map((file) => normalize(file));
  while (stack.length > 0) {
    const file = stack.pop() as string;
    if (seen.has(file)) continue;
    seen.add(file);
    if (!/\.tsx?$/.test(file)) continue;
    for (const match of text(file).matchAll(IMPORT)) {
      const target = resolveImport(file, match[1] ?? match[2] ?? match[3]);
      if (target !== null && !seen.has(target)) stack.push(target);
    }
  }

  // Costuras de prueba declaradas (testing-seams.md S5) y barriles sin consumidor que no traen interfaz.
  const SEAMS = new Set(["features/draft/fake-socket.ts", "features/pro-drafter/index.ts", "features/landing/counterfactual/index.ts"]);

  it("todo módulo de components/ y features/ tiene al menos un consumidor desde una ruta", () => {
    const dead = productionFiles
      .filter((file) => /\.(tsx?|css)$/.test(file) && /^(components|features)\//.test(rel(file)))
      .filter((file) => !seen.has(normalize(file)) && !SEAMS.has(rel(file)))
      .map(rel);
    expect(dead).toEqual([]);
  });
});
