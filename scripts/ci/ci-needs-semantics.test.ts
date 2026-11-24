import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// TSK-259 — un job requerido que queda `skipped` NO bloquea la fusión en GitHub (documentado: "a job that is skipped
// will report its status as Success"). `r1-certification` depende (`needs`) de `test` (matriz: engine/web/root/qa),
// `verify-simplicity` e `intelligence-ci`: si cualquiera falla, GitHub lo OMITE en vez de fallarlo. Como `test (qa)`
// no es un contexto requerido, un `test (qa)` en rojo dejaría pasar la política. Aquí se simula esa semántica sobre el
// ci.yml REAL y se ejecuta de verdad el paso-guardia que impide el falso verde.

const CI = readFileSync(join(import.meta.dir, "..", "..", ".github", "workflows", "ci.yml"), "utf8");

type Result = "success" | "failure" | "skipped" | "cancelled";

/** Bloque de un job (indentación de 2 espacios bajo `jobs:`). */
function jobBlock(name: string): string {
  const m = new RegExp(`^  ${name}:\n((?:    .*\n|\s*\n|  #.*\n)*)`, "m").exec(CI);
  if (!m) throw new Error(`job ${name} no encontrado en ci.yml`);
  return m[1];
}
const needsOf = (block: string): string[] => {
  const m = /^    needs:\s*\[([^\]]*)\]/m.exec(block);
  return m ? m[1].split(",").map((s) => s.trim()).filter(Boolean) : [];
};
// `always()` o `!cancelled()` hacen que el job corra aunque un need falle; `!cancelled()` además respeta la cancelación del workflow.
const runsAlways = (block: string): boolean => /^    if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/m.test(block);

/** Semántica de GitHub Actions: sin `always()`, un need que no es success => el job se OMITE. */
function simulate(job: string, results: Record<string, Result>, guardPasses?: (needs: Record<string, Result>) => boolean): Result {
  const block = jobBlock(job);
  const needs = Object.fromEntries(needsOf(block).map((n) => [n, results[n] ?? "success"]));
  const allOk = Object.values(needs).every((r) => r === "success");
  if (allOk) return "success";
  if (!runsAlways(block)) return "skipped";
  return guardPasses && guardPasses(needs) ? "success" : "failure";
}
/** GitHub: un check requerido en `skipped` cuenta como satisfecho. */
const satisfiesRequiredCheck = (r: Result): boolean => r === "success" || r === "skipped";

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

  test("FALLO SILENCIOSO: con test (qa) en FAIL, r1-certification debe FALLAR, no quedar omitido", () => {
    const r1 = simulate("r1-certification", { test: "failure" }, guardPasses);
    expect(r1).toBe("failure");
    expect(satisfiesRequiredCheck(r1)).toBe(false);
  });

  test.each(["failure", "skipped", "cancelled"] as const)("cualquier need en %s hace fallar r1-certification", (state) => {
    for (const need of ["test", "verify-simplicity", "intelligence-ci"]) {
      const r1 = simulate("r1-certification", { [need]: state }, guardPasses);
      expect(satisfiesRequiredCheck(r1)).toBe(false);
    }
  });

  test("el job usa `!cancelled()`, no `always()` (always() ignora la cancelación del workflow)", () => {
    const block = jobBlock("r1-certification");
    expect(block).toMatch(/^    if:\s*\$\{\{\s*!cancelled\(\)\s*\}\}/m);
    expect(block).not.toMatch(/^    if:.*always\(\)/m);
  });

  test("el paso guardia es el PRIMERO (antes de Checkout/instalaciones: tras un need roto no se corre código del PR) y no tiene `if:` propio", () => {
    const block = jobBlock("r1-certification");
    const steps = [...block.matchAll(/^ {6}- name: ([^\n]+)\n/gm)].map((m) => m[1]);
    expect(steps[0]).toStartWith("Refuse to certify");
    expect(steps.indexOf("Checkout")).toBeGreaterThan(0);
    const guard = /- name: Refuse to certify[^\n]*\n((?: {8}.*\n)+)/.exec(block)?.[1] ?? "";
    expect(guard).not.toMatch(/^ {8}if:/m);
  });

  test("todo en PASS: r1-certification sigue su camino normal (sin falso positivo)", () => {
    expect(simulate("r1-certification", {}, guardPasses)).toBe("success");
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
  const base = { T: "success", V: "success", I: "success" };
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
    void base;
  });
});
