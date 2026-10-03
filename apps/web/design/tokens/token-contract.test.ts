import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

describe("UX-0 Token Architecture Contract", () => {
  const primitivesPath = resolve(import.meta.dir, "primitives.css");
  const semanticPath = resolve(import.meta.dir, "semantic.css");

  const primitivesContent = readFileSync(primitivesPath, "utf-8");
  const semanticContent = readFileSync(semanticPath, "utf-8");

  function extractRootDeclarations(css: string): Record<string, string> {
    const rootBlockMatch = css.match(/:root\s*\{([^}]+)\}/);
    if (!rootBlockMatch) return {};
    const rootContent = rootBlockMatch[1];
    const declarations: Record<string, string> = {};
    const regex = /(--[\w-]+)\s*:\s*([^;]+);/g;
    let match;
    while ((match = regex.exec(rootContent)) !== null) {
      declarations[match[1]] = match[2].trim();
    }
    return declarations;
  }

  const primitives = extractRootDeclarations(primitivesContent);
  const semantics = extractRootDeclarations(semanticContent);

  it("primitives.css defines literal values only (no var(...) calls)", () => {
    for (const [, value] of Object.entries(primitives)) {
      expect(value).not.toContain("var(");
    }
  });

  it("semantic.css maps all tokens to primitive variables via var(--primitive-*)", () => {
    const semanticVars = Object.entries(semantics).filter(([key]) => !key.startsWith("--color-") && !key.startsWith("--spacing-") && !key.startsWith("--radius-") && !key.startsWith("--text-"));
    expect(semanticVars.length).toBeGreaterThan(10);

    for (const [, value] of semanticVars) {
      expect(value).toMatch(/^var\(--primitive-[\w-]+\)$/);
      const referencedPrimitive = value.replace(/^var\(/, "").replace(/\)$/, "");
      expect(primitives[referencedPrimitive]).toBeDefined();
    }
  });

  it("semantic.css does not contain any raw hex or rgb colors directly", () => {
    // Check that hex colors are not hardcoded in semantic.css
    expect(semanticContent).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    expect(semanticContent).not.toMatch(/rgb\(/);
  });

  it("preserves exact baseline surface colors", () => {
    expect(primitives["--primitive-color-neutral-950"]).toBe("#0f1115");
    expect(primitives["--primitive-color-neutral-900"]).toBe("#171a21");
    expect(primitives["--primitive-color-neutral-850"]).toBe("#1f232c");
    expect(primitives["--primitive-color-neutral-800"]).toBe("#2a2f3a");
  });

  it("preserves exact baseline content colors", () => {
    expect(primitives["--primitive-color-neutral-50"]).toBe("#f5f6f8");
    expect(primitives["--primitive-color-neutral-300"]).toBe("#a8adba");
    expect(primitives["--primitive-color-neutral-500"]).toBe("#6b7280");
  });

  it("preserves exact baseline accent colors", () => {
    expect(primitives["--primitive-color-gold-500"]).toBe("#d4af37");
    expect(primitives["--primitive-color-gold-400"]).toBe("#e6c250");
  });

  it("preserves exact baseline signal colors", () => {
    expect(primitives["--primitive-color-green-500"]).toBe("#3fb950");
    expect(primitives["--primitive-color-red-500"]).toBe("#f85149");
    expect(primitives["--primitive-color-amber-500"]).toBe("#d29922");
  });

  it("preserves exact 4px spacing scale from space-1 to space-12", () => {
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

  it("defines focus, radius, and motion tokens required by initial primitives", () => {
    expect(semantics["--focus-ring"]).toBe("var(--primitive-color-gold-500)");
    expect(semantics["--radius-control"]).toBe("var(--primitive-radius-md)");
    expect(semantics["--radius-container"]).toBe("var(--primitive-radius-lg)");
    expect(semantics["--motion-duration-fast"]).toBe("var(--primitive-duration-fast)");
  });
});
