import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Contrato de tokens del producto: Canonical Light V1.1 es la única paleta. Los primitivos no tienen color; los
// roles semánticos son alias de los tokens canónicos (--r3-*) y existen solo dentro del alcance Light.
describe("Token Architecture Contract — Canonical Light único", () => {
  const primitivesContent = readFileSync(resolve(import.meta.dir, "primitives.css"), "utf-8");
  const semanticContent = readFileSync(resolve(import.meta.dir, "semantic.css"), "utf-8");

  function declarationsOf(css: string, selectorPattern: RegExp): Record<string, string> {
    const block = css.match(selectorPattern);
    if (!block) return {};
    const declarations: Record<string, string> = {};
    const regex = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let match;
    while ((match = regex.exec(block[1])) !== null) declarations[match[1]] = match[2].trim();
    return declarations;
  }

  const primitives = declarationsOf(primitivesContent, /:root\s*\{([^}]+)\}/);
  const lightRoles = declarationsOf(semanticContent, /\.r3-page \[data-theme="light"\]\s*\{([^}]+)\}/);
  const rootRoles = declarationsOf(semanticContent, /:root\s*\{([^}]+)\}/);

  it("los primitivos definen valores literales y ninguno es un color", () => {
    for (const [name, value] of Object.entries(primitives)) {
      expect(value).not.toContain("var(");
      expect(name).not.toContain("color");
      expect(value).not.toMatch(/#[0-9a-fA-F]{3,8}|rgb\(|hsl\(/);
    }
  });

  it("no queda ningún color de la paleta anterior (neutros oscuros, dorado, verde/rojo/ámbar propios)", () => {
    for (const legacy of ["0f1115", "171a21", "1f232c", "2a2f3a", "d4af37", "e6c250", "3fb950", "f85149", "d29922"]) {
      expect(primitivesContent.toLowerCase()).not.toContain(legacy);
      expect(semanticContent.toLowerCase()).not.toContain(legacy);
    }
  });

  it("los roles semánticos de color son alias exactos de tokens canónicos --r3-* y solo existen en el alcance Light", () => {
    const roles = Object.entries(lightRoles);
    expect(roles.length).toBeGreaterThanOrEqual(13);
    for (const [, value] of roles) expect(value).toMatch(/^var\(--r3-[\w-]+\)$/);
    expect(Object.keys(rootRoles).filter((name) => /^--(surface|content|accent|signal)-/.test(name))).toEqual([]);
  });

  it("semantic.css no contiene hex ni rgb directos", () => {
    expect(semanticContent).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(semanticContent).not.toMatch(/rgb\(/);
  });

  it("conserva la escala de 4 px de espaciado de space-1 a space-12", () => {
    expect(primitives["--primitive-space-1"]).toBe("4px");
    expect(primitives["--primitive-space-2"]).toBe("8px");
    expect(primitives["--primitive-space-3"]).toBe("12px");
    expect(primitives["--primitive-space-4"]).toBe("16px");
    expect(primitives["--primitive-space-5"]).toBe("20px");
    expect(primitives["--primitive-space-6"]).toBe("24px");
    expect(primitives["--primitive-space-8"]).toBe("32px");
    expect(primitives["--primitive-space-10"]).toBe("40px");
    expect(primitives["--primitive-space-12"]).toBe("48px");
  });

  it("el foco, los radios y el movimiento siguen definidos", () => {
    expect(lightRoles["--focus-ring"]).toBe("var(--r3-focus)");
    expect(rootRoles["--radius-control"]).toBe("var(--primitive-radius-md)");
    expect(rootRoles["--radius-container"]).toBe("var(--primitive-radius-lg)");
    expect(rootRoles["--motion-duration-fast"]).toBe("var(--primitive-duration-fast)");
  });
});
