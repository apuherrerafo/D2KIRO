// Decisión de entrega de /castoff: ¿READY o NOT_READY?
//
// READY significa sólo esto: en esta máquina, sobre este HEAD exacto, limpio y al día con la rama de entrega publicada,
// las comprobaciones corrieron ahora y salieron en verde. NO autoriza merge ni deploy: eso lo deciden CI y la revisión
// independiente que exige la rama base en GitHub.
//
// El decisor no lee logs ni veredictos: ejecuta él mismo las comprobaciones. La base se consulta en vivo al remoto. Un
// cambio que toca la definición de las comprobaciones no se puede juzgar desde aquí: NOT_READY.
//
// Límite: corre en la máquina y sobre el árbol de quien entrega. Quien controle eso (este archivo, las dependencias
// instaladas, la configuración de git y del remoto) controla el resultado; y qué prueban las pruebas lo decide el cambio.
//
// Uso:  bun scripts/agents/delivery-verdict.ts <HEAD> [raíz]     exit 0 READY, 1 NOT_READY, 2 uso incorrecto.

import { join } from "node:path";

/** La rama que GitHub protege con `independent-review` (.github/workflows/release-gate.yml). */
export const DELIVERY_BRANCH = "release/mvp-beta";

export interface Gate {
  name: string;
  cwd: string; // relativo a la raíz del repo; "" = la raíz
  command: string[];
  baseEnv?: string; // variable por la que la comprobación recibe el commit base publicado
}

// `bun x` y no `bunx`: en Windows `bunx` puede ser un script de shell que no se puede lanzar como proceso.
export const GATES: readonly Gate[] = [
  { name: "test", cwd: "", command: ["bun", "run", "test"] },
  { name: "tsc-engine", cwd: "apps/engine", command: ["bun", "x", "tsc", "--noEmit"] },
  { name: "tsc-web", cwd: "apps/web", command: ["bun", "x", "tsc", "--noEmit"] },
  { name: "lint", cwd: "apps/web", command: ["bun", "run", "lint"] },
  // Sin la base, sobre un árbol limpio su diff local sale vacío: secretos, dependencias y journal no se mirarían.
  { name: "simplicity", cwd: "", command: ["bash", "scripts/verify-simplicity.sh"], baseEnv: "VERIFY_DIFF_BASE" },
];

/** Archivos que deciden QUÉ ejecutan esas comprobaciones: este decisor, el gate de simplicidad y su configuración. */
const DEFINITIONS = [
  /^scripts\/agents\/delivery-verdict[^/]*$/i,
  /^scripts\/verify-[^/]*\.sh$/i,
  /^scripts\/hooks\//i, // el gate de simplicidad ejecuta Python de esa carpeta
  /(^|\/)\.gitattributes$/i, // puede volver binario un archivo y esconderlo de `git diff`
  /(^|\/)(package\.json|bunfig\.toml|tsconfig[^/]*\.json|eslint\.config\.[^/]+|\.eslintrc[^/]*)$/i,
];

export const isGateDefinition = (path: string): boolean => DEFINITIONS.some((re) => re.test(path));

export interface Decision {
  resultado: "READY" | "NOT_READY";
  alcance: string;
  head: string;
  base: string | null;
  gates: Record<string, "PASS" | "FAIL" | "NOT_RUN">;
  reasons: string[];
}

const SCOPE = "comprobación local de este HEAD; no autoriza merge ni deploy (eso lo deciden CI y la revisión independiente)";

// Sin las variables GIT_* que exporta un hook (mandarían sobre `cwd`) y sin refs de reemplazo.
function environment(): Record<string, string | undefined> {
  const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
  // VERIFY_DIFF_BASE heredada no vale: la base la fija este decisor, y sólo para quien la declara en `baseEnv`.
  return { ...env, GIT_NO_REPLACE_OBJECTS: "1", VERIFY_DIFF_BASE: undefined };
}

function git(root: string, ...args: string[]): string | null {
  const r = Bun.spawnSync(["git", ...args], { cwd: root, env: environment(), stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? r.stdout.toString() : null;
}

/** ¿El árbol es exactamente `head`, y `head` es un cambio juzgable sobre la base publicada ahora mismo? */
function inspect(root: string, head: string): { base: string | null; problem: string | null } {
  const no = (problem: string, base: string | null = null) => ({ base, problem });
  if (!/^[0-9a-f]{40}$/.test(head)) return no("HEAD no es un SHA completo");
  if (git(root, "rev-parse", "HEAD")?.trim() !== head) return no("el HEAD del repo no es el HEAD pedido");
  const status = git(root, "status", "--porcelain", "--untracked-files=all");
  if (status !== "") return no(`árbol sucio, lo que se probaría no es el HEAD:\n${status?.trimEnd() ?? "(git status falló)"}`);
  // `assume-unchanged` (letra minúscula) y `skip-worktree` (S) esconden cambios a `git status`.
  const index = git(root, "ls-files", "-v");
  if (index === null || /^(?:[a-z]|S) /m.test(index)) return no("hay archivos ocultos a git status (assume-unchanged o skip-worktree)");

  const ref = `refs/heads/${DELIVERY_BRANCH}`;
  const remote = git(root, "ls-remote", "origin", ref);
  const base = remote?.split("\n").map((line) => line.split("\t")).find((parts) => parts[1] === ref)?.[0];
  if (!base) return no(`no se pudo consultar ${DELIVERY_BRANCH} en el remoto origin`);
  if (git(root, "cat-file", "-e", `${base}^{commit}`) === null) return no(`falta el commit publicado de ${DELIVERY_BRANCH} (haz git fetch)`, base);
  if (git(root, "merge-base", "--is-ancestor", base, head) === null) {
    return no(`el HEAD no contiene la punta publicada de ${DELIVERY_BRANCH} (${base}): actualiza la rama`, base);
  }
  const names = git(root, "diff", "--name-only", "--no-renames", "-z", base, head)?.split("\0").filter(Boolean);
  if (!names) return no("git no pudo comparar la base con el HEAD", base);
  if (names.length === 0) return no(`no hay cambio que entregar sobre ${DELIVERY_BRANCH}`, base);
  const touched = names.filter(isGateDefinition);
  if (touched.length > 0) {
    return no(`el cambio toca la definición de las comprobaciones y no se puede juzgar localmente: ${touched.join(", ")}`, base);
  }
  return { base, problem: null };
}

function passes(root: string, gate: Gate, base: string): boolean {
  try {
    const env = gate.baseEnv ? { ...environment(), [gate.baseEnv]: base } : environment();
    const r = Bun.spawnSync(gate.command, { cwd: join(root, gate.cwd), env, stdout: "pipe", stderr: "pipe" });
    if (r.exitCode === 0) return true;
    const tail = `${r.stdout.toString()}${r.stderr.toString()}`.trimEnd().split("\n").slice(-30).join("\n");
    console.error(`--- ${gate.name}: exit=${r.exitCode}\n${tail}`);
  } catch (error) {
    console.error(`--- ${gate.name}: no se pudo ejecutar (${String(error)})`);
  }
  return false;
}

/** `gates` sólo se sustituye en pruebas; la línea de comandos usa siempre `GATES`. */
export function decideDelivery(root: string, head: string, gates: readonly Gate[] = GATES): Decision {
  const before = inspect(root, head);
  const results: Decision["gates"] = Object.fromEntries(gates.map((gate) => [gate.name, "NOT_RUN"]));
  const reasons: string[] = [];
  if (before.problem !== null) reasons.push(before.problem);
  else if (gates.length === 0) reasons.push("no hay comprobaciones que ejecutar");
  else {
    for (const gate of gates) {
      results[gate.name] = passes(root, gate, before.base!) ? "PASS" : "FAIL";
      if (results[gate.name] === "FAIL") reasons.push(`${gate.name}: falló`);
    }
    // Justo antes de responder: ni el árbol ni la base pueden haberse movido mientras corrían.
    const after = inspect(root, head);
    if (after.problem !== null) reasons.push(`tras las comprobaciones: ${after.problem}`);
    else if (after.base !== before.base) reasons.push("la base publicada cambió mientras corrían las comprobaciones");
  }
  return { resultado: reasons.length === 0 ? "READY" : "NOT_READY", alcance: SCOPE, head, base: before.base, gates: results, reasons };
}

if (import.meta.main) {
  const [head, rootArg, ...extra] = process.argv.slice(2);
  const root = rootArg ?? git(process.cwd(), "rev-parse", "--show-toplevel")?.trim();
  if (!head || !root || extra.length > 0) {
    console.error("uso: bun scripts/agents/delivery-verdict.ts <HEAD> [raíz]");
    process.exit(2);
  }
  const decision = decideDelivery(root, head);
  console.log(JSON.stringify(decision, null, 2));
  process.exit(decision.resultado === "READY" ? 0 : 1);
}
