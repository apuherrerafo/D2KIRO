import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

// AP Ranked Roles V1 / Wave 2 (product review, issue 1) -- transitive import graph of the
// perspective-safe recommendation path.
//
// A per-file grep is not enough: the guarantee is about EVERYTHING the Coach path can reach. Starting from
// its three entry points we follow every VALUE import (type-only imports carry no runtime data and are
// checked by name at their import site), and require that no reached file can name authoritative state,
// the kernel's mutation/legality oracles, the Simulator ledger, the Enemy Bot or the simulator seed --
// and that the legacy authoritative substrate is simply not in the graph. Same discipline as
// architecture-guard.test.ts: mechanical checks against the modules' own source text.

const SRC = resolve(__dirname, "..");
const COACH_DIR = join(SRC, "coach");
const ENTRY_POINTS = ["recommendation/build-from-perspective.ts", "coach/index.ts", "server/routes/coach-recommendations.ts"].map((path) => join(SRC, path));

/** Draft-protocol modules that only DECLARE shapes / re-export: not walked (their names are checked at each import site). */
const NOT_WALKED = new Set([join(SRC, "draft-protocol", "types.ts"), join(SRC, "draft-protocol", "index.ts")]);
/** The only values the perspective path may take from the draft-protocol barrel. */
const BARREL_VALUES_ALLOWED = new Set(["perspectiveStateHash", "rulesHash"]);
const FORBIDDEN_NAMES =
  /DraftProtocolState|EnemyBotInternalState|applyProtocolCommand|legalGameplayActions|\blegalActions\b|isSealedSelectionLegal|authoritativeStateHash|RegistrationRecord|CollisionRegistrationEvidence|createEnemyBotConfig|simulatorSeed|pendingCollision|\.confirmedPicks\b|\.sealed\b|replayProtocolState/;

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function normalize(path: string): string {
  return relative(SRC, path).replaceAll("\\", "/");
}

function resolveRelative(fromFile: string, specifier: string): string | null {
  const base = resolve(dirname(fromFile), specifier);
  for (const candidate of [`${base}.ts`, join(base, "index.ts")]) if (existsSync(candidate)) return candidate;
  return null;
}

interface ImportEdge {
  specifier: string;
  typeOnly: boolean;
  names: string[];
}

function importEdges(content: string): ImportEdge[] {
  const edges: ImportEdge[] = [];
  const pattern = /(?:import|export)\s+(type\s+)?(\{[^}]*\}|\*(?:\s+as\s+\w+)?|\w+)?\s*(?:,\s*(\{[^}]*\}))?\s*from\s+["']([^"']+)["']/g;
  for (const match of content.matchAll(pattern)) {
    const braces = `${match[2] ?? ""}${match[3] ?? ""}`;
    const names = [...braces.matchAll(/([A-Za-z_$][\w$]*)(?:\s+as\s+[\w$]+)?/g)].map((m) => m[1]!).filter((name) => name !== "type");
    edges.push({ specifier: match[4]!, typeOnly: match[1] !== undefined, names });
  }
  return edges;
}

function walk(entries: readonly string[]): Map<string, string> {
  const visited = new Map<string, string>();
  const queue = [...entries];
  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file) || NOT_WALKED.has(file)) continue;
    const content = stripComments(readFileSync(file, "utf8"));
    visited.set(file, content);
    for (const edge of importEdges(content)) {
      if (!edge.specifier.startsWith(".") || edge.typeOnly) continue;
      const target = resolveRelative(file, edge.specifier);
      if (target) queue.push(target);
    }
  }
  return visited;
}

describe("perspective-safe recommendation path -- transitive import graph", () => {
  const graph = walk(ENTRY_POINTS);
  const reached = [...graph.keys()].map(normalize);

  test("el recorrido no es vacío: alcanza el builder seguro, la construcción compartida, el orquestador y la entrada del servidor", () => {
    expect(reached).toEqual(
      expect.arrayContaining([
        "recommendation/build-from-perspective.ts",
        "recommendation/construct.ts",
        "recommendation/perspective-context.ts",
        "recommendation/identity.ts",
        "recommendation/evidence.ts",
        "coach/orchestrator.ts",
        "server/routes/coach-recommendations.ts",
        "draft-protocol/adapters/suggestion-bridge.ts",
      ]),
    );
  });

  test("NINGÚN archivo alcanzable puede nombrar estado autoritativo, el oráculo/mutador del kernel, el ledger del Simulator, el Enemy Bot ni el seed", () => {
    const offenders = [...graph].filter(([, content]) => FORBIDDEN_NAMES.test(content)).map(([file]) => normalize(file));
    expect(offenders).toEqual([]);
  });

  test("el sustrato legacy autoritativo NO está en el grafo (build, legality, decision, lookahead, oponente, kernel, Simulator, ProtocolSessionStore)", () => {
    const legacy = [
      "recommendation/build.ts",
      "recommendation/legality.ts",
      "recommendation/decision.ts",
      "recommendation/lookahead.ts",
      "recommendation/opponent-model.ts",
      "recommendation/observation-point.ts",
      "recommendation/protocol-availability.ts",
      "recommendation/steal.ts",
      "draft-protocol/kernel.ts",
      "server/protocol-session.ts",
    ];
    expect(reached.filter((file) => legacy.includes(file) || file.startsWith("simulator/"))).toEqual([]);
  });

  test("lo único que el grafo seguro toma como VALOR del barril de draft-protocol son las dos funciones de hash de vista", () => {
    const taken = new Set<string>();
    for (const [file, content] of graph) {
      for (const edge of importEdges(content)) {
        if (edge.typeOnly || !edge.specifier.startsWith(".")) continue;
        if (resolveRelative(file, edge.specifier) === join(SRC, "draft-protocol", "index.ts")) edge.names.forEach((name) => taken.add(name));
      }
    }
    expect(taken.size).toBeGreaterThan(0); // non-vacuous
    expect([...taken].filter((name) => !BARREL_VALUES_ALLOWED.has(name))).toEqual([]);
  });

  test("la entrada del Coach en el servidor recibe una fuente ESTRECHA: no nombra el store, ni `.get(`, ni el estado", () => {
    const routeEntry = graph.get(join(SRC, "server", "routes", "coach-recommendations.ts"))!;
    expect(routeEntry).not.toMatch(/ProtocolSessionStore|\.get\(|DraftProtocolState|\bstate\b/);
  });
});

describe("Wave 2 no usa números inventados en su comportamiento", () => {
  const coachSources = readdirSync(COACH_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".fixtures.ts"))
    .map((name) => ({ name, content: stripComments(readFileSync(join(COACH_DIR, name), "utf8")) }));

  test("ni umbrales decimales ni los nombres de los umbrales rechazados en la lógica de decisión del Coach", () => {
    for (const { name, content } of coachSources) {
      expect(content, name).not.toMatch(/\b\d+\.\d+\b|\b1e-\d+|signalDominanceShare|deferMinCoverageGap|MIN_NORMALIZED|UNIFORM_PROBABILITY/);
    }
  });

  test("REVEAL_HERO, DEFER_POSITION y OPPORTUNITY son parte del modelo pero deriveRevealStrategy nunca los produce", () => {
    const strategy = coachSources.find((file) => file.name === "reveal-strategy.ts")!.content;
    // Type-union members use `kind: "X";`; a PRODUCED strategy is an object literal, `kind: "X",`.
    const produced = [...strategy.matchAll(/kind:\s*"([A-Z_]+)",/g)].map((match) => match[1]);
    expect(new Set(produced)).toEqual(new Set(["REVEAL_POSITION", "REVEAL_FLEX"]));
    expect(strategy).toContain('kind: "REVEAL_HERO";'); // still declared in the domain model
  });
});
