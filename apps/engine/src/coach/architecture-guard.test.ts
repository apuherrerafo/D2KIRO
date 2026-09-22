import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

// AP Ranked Roles V1 / Wave 2 (task 14) -- the hidden-information boundary, enforced on the SOURCE
// TEXT of coach/** (the same discipline as recommendation/architecture-guard.test.ts and
// scripts/verify-simplicity.sh): a type system cannot stop a future import, a runtime test cannot
// see one. The Coach may know a PerspectiveDraftView and public data -- nothing else.

const COACH_DIR = join(__dirname);
const RECOMMENDATION_DIR = join(__dirname, "..", "recommendation");

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

function sources(dir: string): { path: string; content: string }[] {
  return readdirSync(dir)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts") && !name.endsWith(".fixtures.ts"))
    .map((name) => ({ path: name, content: stripComments(readFileSync(join(dir, name), "utf8")) }));
}

function importSpecifiers(content: string): string[] {
  return [...content.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1]!);
}

describe("coach/** -- boundary: only a PerspectiveDraftView goes in", () => {
  const files = sources(COACH_DIR);

  test("coach/** existe y no está vacío (el guard no puede pasar por no mirar nada)", () => {
    expect(files.map((file) => file.path)).toEqual(
      expect.arrayContaining(["observable-state.ts", "reveal-strategy.ts", "hero-card.ts", "recommendation-output-v3.ts", "orchestrator.ts"]),
    );
  });

  test("ningún archivo nombra DraftProtocolState, EnemyBotInternalState ni un hash del estado autoritativo", () => {
    const offenders = files.filter(({ content }) => /DraftProtocolState|EnemyBotInternalState|authoritativeStateHash/.test(content));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test("ningún archivo importa el kernel, el barril de draft-protocol, el Simulator, el Enemy Bot ni el servidor", () => {
    const forbidden = /(^|\/)(kernel|rulesets\/|simulator\/|enemy-bot|server\/|protocol-session|identity-hash|adapters\/)|^\.\.\/draft-protocol$|^\.\.\/simulator|^\.\.\/server/;
    const offenders = files.flatMap(({ path, content }) => importSpecifiers(content).filter((spec) => forbidden.test(spec)).map((spec) => `${path} -> ${spec}`));
    expect(offenders).toEqual([]);
  });

  test("ningún archivo llama a project(): la proyección la hace el llamador, el Coach sólo la recibe", () => {
    const offenders = files.filter(({ content }) => /\bproject\s*\(/.test(content));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });

  test("lo único que coach/** importa de draft-protocol/ son tipos y roles públicos (RoleBelief, joint-assignment)", () => {
    const specs = files.flatMap(({ content }) => importSpecifiers(content)).filter((spec) => spec.includes("draft-protocol"));
    expect(new Set(specs)).toEqual(new Set(["../draft-protocol/types", "../draft-protocol/roles/role-belief", "../draft-protocol/roles/joint-assignment"]));
  });

  test("Pro-Drafter no es un segundo recomendador: nada de team-opener/pro-drafter", () => {
    expect(files.filter(({ content }) => /team-opener|pro-drafter/i.test(content)).map((file) => file.path)).toEqual([]);
  });

  test("determinismo: sin reloj de pared, sin azar, sin uuid, sin red", () => {
    const offenders = files.filter(({ content }) => /Date\.now\(\)|new Date\(\)|Math\.random\(\)|randomUUID\(\)|\bfetch\s*\(/.test(content));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});

describe("coach/** -- el Coach es neutral en rol y nunca un guion", () => {
  const files = sources(COACH_DIR);

  test("no existe una estrategia específica de soporte (support-first es un prior, no una categoría)", () => {
    expect(files.filter(({ content }) => /REVEAL_SUPPORT|SUPPORT_EARLY/.test(content)).map((file) => file.path)).toEqual([]);
  });

  test("el número de ronda nunca selecciona una posición: ningún archivo de estrategia ramifica sobre PICK_ROUND_n", () => {
    // La única lectura permitida de la fase es `enemyStillHidesPicks` (¿quedan picks rivales por revelar?),
    // que decide si diferir tiene sentido -- nunca qué posición se revela.
    const strategy = files.find((file) => file.path === "reveal-strategy.ts")!;
    const mentions = strategy.content.match(/PICK_ROUND_\d/g) ?? [];
    expect(mentions.length).toBeLessThanOrEqual(2);
    expect(strategy.content).not.toMatch(/round\s*===?\s*\d/i);
  });
});

describe("recommendation/** -- el sustrato V2 es la única capa que ve el estado autoritativo", () => {
  // build.ts y sus auxiliares reciben DraftProtocolState porque calculan legalidad y el lookahead
  // contra el cerrojo real del kernel. Su aislamiento de información oculta NO es disciplina: lo
  // prueban los "hidden twin" de build.test.ts (RecommendationSetV2 byte-idéntico antes del reveal).
  // Esta lista es cerrada a propósito: un archivo NUEVO de recommendation/** no puede unirse a ella
  // sin que alguien lo decida aquí.
  const V2_SUBSTRATE = new Set([
    "build.ts",
    "counterfactual-identity.ts",
    "decision.ts",
    "legality.ts",
    "lookahead.ts",
    "observation-point.ts",
    "opponent-model.ts",
    "opponent-response.ts",
    "protocol-availability.ts",
    "steal.ts",
  ]);

  test("sólo el sustrato V2 conocido nombra DraftProtocolState; ningún archivo nuevo ni Coach", () => {
    const naming = sources(RECOMMENDATION_DIR).filter(({ content }) => /DraftProtocolState|EnemyBotInternalState/.test(content));
    expect(naming.filter((file) => !V2_SUBSTRATE.has(file.path)).map((file) => file.path)).toEqual([]);
  });

  test("ningún archivo de recommendation/** conoce el Enemy Bot ni el Simulator", () => {
    const offenders = sources(RECOMMENDATION_DIR).filter(({ content }) => /EnemyBotInternalState|simulator\/enemy-bot/.test(content));
    expect(offenders.map((file) => file.path)).toEqual([]);
  });
});
