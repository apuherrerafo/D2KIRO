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
  test("NOT_COMPUTED sigue siendo un literal real en su único punto de origen (types.ts) -- sigue en uso para 'sin recommendations[0]'", () => {
    const types = sourceFiles().find((f) => f.path === "types.ts")!;
    expect(types.content).toContain('export const NOT_COMPUTED = "NOT_COMPUTED"');
  });

  // R1 S6: opponentResponse/steal/lookahead/counterfactual ahora SÍ se calculan -- la regla ya no
  // puede ser "nadie fuera de types.ts los asigna" (eso era el candado de la Fase pre-S6, cuando
  // el único valor legal era NOT_COMPUTED). La regla real ahora: SÓLO el orquestador (lookahead.ts)
  // y su único llamador (build.ts, que adjunta el resultado a `deferred` verbatim) pueden asignar
  // estos 4 campos -- ningún otro archivo (una señal, un scorer, un adaptador de transporte) puede
  // reintroducir un segundo punto de cómputo disperso.
  const S6_ASSIGNMENT_ALLOWLIST = new Set(["types.ts", "build.ts", "lookahead.ts"]);

  test("sólo build.ts y lookahead.ts (además de types.ts) asignan opponentResponse/steal/lookahead/counterfactual", () => {
    const offenders = sourceFiles().filter(
      (f) => !S6_ASSIGNMENT_ALLOWLIST.has(f.path) && /\b(opponentResponse|steal|lookahead|counterfactual)\s*:/.test(f.content),
    );
    expect(offenders.map((f) => f.path)).toEqual([]);
  });

  test("PROBABILITY CLAIMS: NONE -- ningún archivo de recommendation/** menciona probabilidad/probability en su código real", () => {
    const offenders = sourceFiles().filter(({ content }) => /probab/i.test(content));
    expect(offenders.map((f) => f.path)).toEqual([]);
  });
});
