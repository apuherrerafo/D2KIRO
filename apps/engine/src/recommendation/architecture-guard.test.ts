import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// R1 S5 -- architectural invariants that a type system can't enforce and a runtime test can't
// exercise (they're about what the SOURCE does, not what it computes). Same discipline as
// scripts/verify-simplicity.sh's static greps -- these are mechanical checks against the module's
// own source text, not against its behaviour.

const SOURCE_DIR = join(__dirname);

/** Strips `//` and `/* *​/` comments before scanning -- this module's own doc comments
 * deliberately NAME team-opener/Date.now()/Math.random() to explain why they're avoided, and a
 * naive text grep would flag its own explanation as a violation. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sourceFiles(): { path: string; content: string }[] {
  return readdirSync(SOURCE_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ path: name, content: stripComments(readFileSync(join(SOURCE_DIR, name), "utf8")) }));
}

describe("recommendation/** -- Pro-Drafter is never a second recommender", () => {
  test("ningún archivo de recommendation/** importa drafter/team-opener ni pro-drafter", () => {
    const offenders = sourceFiles().filter(({ content }) => /team-opener|pro-drafter/i.test(content));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

describe("recommendation/** -- determinismo: sin reloj de pared ni azar sin semilla", () => {
  test("ningún archivo llama a Date.now() o new Date() sin argumentos", () => {
    const offenders = sourceFiles().filter(({ content }) => /Date\.now\(\)|new Date\(\)/.test(content));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  test("ningún archivo llama a Math.random()", () => {
    const offenders = sourceFiles().filter(({ content }) => /Math\.random\(\)/.test(content));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  test("ningún archivo usa crypto.randomUUID() (identidad debe depender sólo de basedOn)", () => {
    const offenders = sourceFiles().filter(({ content }) => /randomUUID\(\)/.test(content));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});

describe("recommendation/** -- S6 nunca se calcula por accidente", () => {
  test("los 4 campos S6 son literalmente NOT_COMPUTED en su único punto de origen (types.ts)", () => {
    const types = sourceFiles().find((f) => f.path === "types.ts")!;
    expect(types.content).toContain('export const NOT_COMPUTED = "NOT_COMPUTED"');
  });

  test("ningún archivo fuera de types.ts asigna un valor propio a opponentResponse/steal/lookahead/counterfactual", () => {
    const offenders = sourceFiles().filter(
      (f) => f.path !== "types.ts" && /\b(opponentResponse|steal|lookahead|counterfactual)\s*:/.test(f.content),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});
