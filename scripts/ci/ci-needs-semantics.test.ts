import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TSK-259 — un job requerido que queda `skipped` cuenta como satisfecho en GitHub. Invariante que se protege aquí:
// `r1-certification` sólo puede terminar en `success` si sus `needs` y `verify:r1` terminaron en `success`, también cuando
// se cancela el workflow. Se simula la semántica documentada sobre el ci.yml REAL y se ejecutan de verdad los pasos-guardia.

const CI = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8");

type Result = "success" | "failure" | "skipped" | "cancelled";

/** Bloque de un job (indentación de 2 espacios bajo `jobs:`). */
function jobBlock(name: string, ci: string = CI): string {
  const m = new RegExp(`^  ${name}:\n((?:    .*\n|[ \t]*\n|  #.*\n)*)`, "m").exec(ci);
  if (!m) throw new Error(`job ${name} no encontrado en ci.yml`);
  return m[1];
}
const needsOf = (block: string): string[] => {
  const m = /^    needs:\s*\[([^\]]*)\]/m.exec(block);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};
/** Un elemento por paso del job (el nombre si lo tiene; un `- uses:`/`- run:` sin nombre también cuenta). */
const stepsOf = (block: string): string[] => [...block.matchAll(/^ {6}- (?:name: )?([^\n]+)\n/gm)].map((m) => m[1]);
type Job = Record<string, unknown> & { steps?: Record<string, unknown>[] };
/** Jobs del camino de certificación que declaran `continue-on-error`. Sobre el YAML parseado: cubre comillas y estilo de flujo. */
function jobsToleratingFailure(ci: string): string[] {
  const jobs = (Bun.YAML.parse(ci) as { jobs: Record<string, Job> }).jobs;
  const path = [...needsOf(jobBlock("r1-certification", ci)), "r1-certification"];
  return path.filter((name) => [jobs[name], ...(jobs[name].steps ?? [])].some((node) => "continue-on-error" in node));
}
const runsAlways =(block: string): boolean => /^    if:\s*\$\{\{\s*always\(\)\s*\}\}/m.test(block);

interface Run {
  cancelled?: boolean;
  /** `steps.r1.outcome` cuando `verify:r1` llega a ejecutarse. */
  r1Outcome?: Result;
}
/**
 * Semántica documentada: sin función de estado, un job con un need roto (o un workflow cancelado) se OMITE. Con `always()`
 * corre. Peor caso al cancelar: los pasos sin `if:` se saltan sin fallar; sólo un paso con `always()` puede hacerlo fallar.
 */
function simulate(job: string, results: Record<string, Result>, run: Run = {}): Result {
  const block = jobBlock(job);
  const needs = Object.fromEntries(needsOf(block).map((n) => [n, results[n] ?? "success"]));
  const allOk = Object.values(needs).every((r) => r === "success");
  if (!runsAlways(block)) return allOk && !run.cancelled ? "success" : "skipped";
  const guardFailed = !run.cancelled && !guardPasses(needs);
  const outcome: Result = run.cancelled || guardFailed ? "skipped" : (run.r1Outcome ?? "success");
  return guardFailed || finalStepFails(block, outcome) ? "failure" : "success";
}
/** GitHub: un check requerido en `skipped` cuenta como satisfecho. */
const satisfiesRequiredCheck = (r: Result): boolean => r === "success" || r === "skipped";

const stepBody = (block: string, name: string): string => new RegExp(`- name: ${name}[^\n]*\n((?: {8}.*\n)+)`).exec(block)?.[1] ?? "";

function finalStepFails(block: string, outcome: Result): boolean {
  const body = stepBody(block, "Require R1 execution");
  if (!/^ {8}if: \$\{\{ always\(\) \}\}$/m.test(body)) return false;
  const env = /^ {10}(\w+): \$\{\{ steps\.r1\.outcome \}\}$/m.exec(body)?.[1];
  const script = /^ {8}run: \|\n {10}(.+)$/m.exec(body)?.[1];
  if (!env || !script) return false;
  return Bun.spawnSync(["bash", "-c", script], { env: { ...process.env, [env]: outcome } }).exitCode !== 0;
}

function guardStep(): { env: Record<string, string>; run: string } {
  const block = jobBlock("r1-certification");
  const step = /- name: Refuse to certify[^\n]*\n((?:        .*\n)+)/.exec(block);
  if (!step) throw new Error("falta el paso guardia 'Refuse to certify' en r1-certification");
  const run = /run: \|\n((?:          .*\n)+)/.exec(step[1])?.[1].replace(/^ {10}/gm, "") ?? "";
  const env: Record<string, string> = {};
  for (const m of step[1].matchAll(/^ {10}(\w+): \$\{\{ needs\.([\w-]+)\.result \}\}/gm)) env[m[1]] = m[2];
  return { env, run };
}

describe("semántica de `needs` en el ci.yml real", () => {
  test("r1-certification depende de la matriz test (que incluye qa), verify-simplicity e intelligence-ci", () => {
    expect(needsOf(jobBlock("r1-certification"))).toEqual(["test", "verify-simplicity", "intelligence-ci"]);
    expect(CI).toContain("- target: qa");
  });

  test("el job `test` no depende de nada: test (qa) no crea dependencia circular con r1-certification", () => {
    expect(needsOf(jobBlock("test"))).toEqual([]);
  });

  test("con test (qa) en FAIL, r1-certification debe FALLAR, no quedar omitido", () => {
    const r1 = simulate("r1-certification", { test: "failure" });
    expect(r1).toBe("failure");
    expect(satisfiesRequiredCheck(r1)).toBe(false);
  });

  test.each(["failure", "skipped", "cancelled"] as const)("cualquier need en %s hace fallar r1-certification", (state) => {
    for (const need of ["test", "verify-simplicity", "intelligence-ci"]) {
      expect(satisfiesRequiredCheck(simulate("r1-certification", { [need]: state }))).toBe(false);
    }
  });

  test("workflow cancelado antes de que arranque el job: nunca queda satisfecho, aunque los needs estén en success", () => {
    expect(satisfiesRequiredCheck(simulate("r1-certification", {}, { cancelled: true }))).toBe(false);
    expect(satisfiesRequiredCheck(simulate("r1-certification", { test: "cancelled" }, { cancelled: true }))).toBe(false);
  });

  test.each(["failure", "skipped", "cancelled", ""] as const)("verify:r1 en '%s' nunca satisface el check", (outcome) => {
    expect(satisfiesRequiredCheck(simulate("r1-certification", {}, { r1Outcome: outcome as Result }))).toBe(false);
  });

  test("el paso final lee el resultado del paso que ejecuta verify:r1", () => {
    const verify = stepBody(jobBlock("r1-certification"), "R1 certification -- verify:r1");
    expect(verify).toMatch(/^ {8}id: r1$/m);
    expect(verify).toContain("bun run verify:r1");
    expect(verify).not.toMatch(/^ {8}if:/m);
  });

  test("el paso guardia es el PRIMERO (antes de Checkout/instalaciones: tras un need roto no se corre código del PR) y no tiene `if:` propio", () => {
    const block = jobBlock("r1-certification");
    const steps = stepsOf(block);
    expect(steps[0]).toStartWith("Refuse to certify");
    expect(steps.indexOf("Checkout")).toBeGreaterThan(0);
    const guard = /- name: Refuse to certify[^\n]*\n((?: {8}.*\n)+)/.exec(block)?.[1] ?? "";
    expect(guard).not.toMatch(/^ {8}if:/m);
  });

  // En una dependencia, un fallo tolerado deja `needs.*.result == success` y `--reuse-foundation` certificaría en falso.
  test("ni r1-certification ni sus dependencias toleran fallos (`continue-on-error`, en job o en paso)", () => {
    expect(jobsToleratingFailure(CI)).toEqual([]);
  });

  describe.each(["test", "verify-simplicity", "intelligence-ci", "r1-certification"])("fallo tolerado en %s", (job) => {
    const header = new RegExp(`\n  ${job}:\n`);
    test.each([
      ["en el job", `\n  ${job}:\n    continue-on-error: true\n`],
      ["con la clave entre comillas", `\n  ${job}:\n    "continue-on-error": true\n`],
    ])("se detecta %s", (_forma, replacement) => {
      const mutated = CI.replace(header, replacement);
      expect(mutated).not.toBe(CI);
      expect(jobsToleratingFailure(mutated)).toEqual([job]);
    });

    test("se detecta en un paso", () => {
      const mutated = CI.replace(new RegExp(`(\n  ${job}:\n[\\s\\S]*?\n    steps:\n)`), "$1      - run: exit 1\n        continue-on-error: true\n");
      expect(mutated).not.toBe(CI);
      expect(jobsToleratingFailure(mutated)).toEqual([job]);
    });
  });

  test("un paso sin `name:` colocado antes del guardia no pasa desapercibido", () => {
    const mutated = CI.replace("      - name: Refuse to certify", "      - run: echo antes\n      - name: Refuse to certify");
    expect(mutated).not.toBe(CI);
    expect(stepsOf(jobBlock("r1-certification", mutated))[0]).not.toStartWith("Refuse to certify");
  });

  test("una línea en blanco con espacios no recorta el bloque del job", () => {
    const mutated = CI.replace(/(\n  r1-certification:\n[\s\S]*?)(\n      - name: Checkout)/, "$1\n  \n        continue-on-error: true$2");
    expect(mutated).not.toBe(CI);
    expect(jobBlock("r1-certification", mutated)).toContain("continue-on-error: true");
    expect(jobBlock("r1-certification", mutated)).toContain("- name: Checkout");
  });

  test("todo en PASS: r1-certification sigue su camino normal (sin falso positivo)", () => {
    expect(simulate("r1-certification", {})).toBe("success");
  });
});

function guardPasses(needs: Record<string, Result>): boolean {
  const { env, run } = guardStep();
  const mapped: Record<string, string> = {};
  for (const [varName, jobName] of Object.entries(env)) mapped[varName] = needs[jobName] ?? "success";
  const res = Bun.spawnSync(["bash", "-c", run], { env: { ...process.env, ...mapped }, stdout: "pipe", stderr: "pipe" });
  return res.exitCode === 0;
}

describe("el paso guardia, ejecutado de verdad", () => {
  test("existe y lee el resultado de los tres needs", () => {
    expect(Object.values(guardStep().env).sort()).toEqual(["intelligence-ci", "test", "verify-simplicity"]);
  });
  test("sólo con los tres en success sale 0", () => {
    const { env, run } = guardStep();
    const run1 = (over: Record<string, string>) => {
      const e = Object.fromEntries(Object.keys(env).map((k) => [k, "success"]));
      return Bun.spawnSync(["bash", "-c", run], { env: { ...process.env, ...e, ...over }, stdout: "pipe", stderr: "pipe" }).exitCode;
    };
    expect(run1({})).toBe(0);
    for (const k of Object.keys(env)) for (const bad of ["failure", "skipped", "cancelled", ""]) expect(run1({ [k]: bad })).not.toBe(0);
  });
});
