import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { assertCandidateMeasuresCommit, ciComparisonEnvironment, main, type Command } from "./ci-gate";

const ACCEPTED = "eval/baselines/accepted.s1.json";
const accepted = JSON.parse(readFileSync(ACCEPTED, "utf8")) as {
  engineQuality: { perRanker: { v6Full: { overall: { ndcg5: number; badPickRate5: number } } } };
};

function withTemp<T>(fn: (dir: string) => T): T {
  const dir = mkdtempSync(join(tmpdir(), "d2k-ci-gate-test-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function runGate(candidate: unknown): { status: number | null; out: string } {
  return withTemp((dir) => {
    const path = join(dir, "candidate.json");
    writeFileSync(path, JSON.stringify(candidate));
    const result = spawnSync(process.execPath, ["run", "scripts/eval/gate.ts", "--enforce"], {
      cwd: process.cwd(),
      env: ciComparisonEnvironment(process.cwd(), path),
      encoding: "utf8",
    });
    return { status: result.status, out: result.stdout };
  });
}

function clone(): typeof accepted {
  return JSON.parse(JSON.stringify(accepted)) as typeof accepted;
}

test("ci-gate: el veredicto se emite contra el baseline ACEPTADO, nunca contra reference.s1.json ni contra sí mismo", () => {
  const env = ciComparisonEnvironment("/repo", "/tmp/cand.json");
  expect(env.D2K_BASELINE_OUT).toBe(resolve("/repo", ACCEPTED));
  expect(env.D2K_GATE_CURRENT).toBe("/tmp/cand.json");
  expect(env.D2K_GATE_CURRENT).not.toBe(env.D2K_BASELINE_OUT);
});

test("ci-gate: un candidate que no mide el commit actual se rechaza", () => {
  withTemp((dir) => {
    const path = join(dir, "c.json");
    writeFileSync(path, JSON.stringify({ provenance: { measuredEngineCommit: "a".repeat(40) } }));
    expect(() => assertCandidateMeasuresCommit(path, "a".repeat(40))).not.toThrow();
    expect(() => assertCandidateMeasuresCommit(path, "b".repeat(40))).toThrow("commit actual");
  });
});

test("ci-gate: si no se puede medir el motor, BLOQUEA (exit 2), nunca pasa en silencio", async () => {
  const failing: Command = () => 1;
  expect(await main(process.cwd(), failing)).toBe(2);
});

test("ci-gate: mide primero (run.ts) y luego juzga (gate.ts --enforce) con candidate ≠ baseline", async () => {
  const calls: Array<{ args: string[]; env: NodeJS.ProcessEnv }> = [];
  const fake: Command = (_program, args, _cwd, env) => {
    calls.push({ args, env });
    if (args[1] === "scripts/eval/run.ts") {
      const commit = env.D2K_MEASURED_ENGINE_COMMIT;
      writeFileSync(env.D2K_BASELINE_OUT as string, JSON.stringify({ provenance: { measuredEngineCommit: commit } }));
    }
    return 0;
  };
  expect(await main(process.cwd(), fake)).toBe(0);
  expect(calls.map((c) => c.args[1])).toEqual(["scripts/eval/run.ts", "scripts/eval/gate.ts"]);
  // El split congelado y el snapshot S1 son los de siempre: así el datasetVersion es comparable.
  expect(String(calls[0]!.env.D2K_SPLIT_OUT).replace(/\\/g, "/")).toEndWith("eval/baselines/split.json");
  expect(String(calls[0]!.env.D2K_META_SNAPSHOT).replace(/\\/g, "/")).toEndWith("eval/snapshots/S1.sqlite");
  expect(calls[1]!.env.D2K_GATE_CURRENT).not.toBe(calls[1]!.env.D2K_BASELINE_OUT);
});

// --- Prueba de regresión intencional: el gate real, con un candidate real distinto del baseline ---

test("regresión: un candidate idéntico al aceptado PASA (el gate no bloquea por otros motivos)", () => {
  const r = runGate(clone());
  expect(r.out).toContain("Engine Quality / Benchmark A [required]: PASS");
  expect(r.status).toBe(0);
});

test("regresión: NDCG@5 baja más que la tolerancia → BLOQUEA (exit 1). Candado en rojo: con el self-compare viejo esto pasaba", () => {
  const worse = clone();
  worse.engineQuality.perRanker.v6Full.overall.ndcg5 -= 0.2;
  const r = runGate(worse);
  expect(r.out).toContain("NDCG@5 bajó");
  expect(r.status).toBe(1);
});

test("regresión: Bad Pick Rate@5 sube más que la tolerancia → BLOQUEA (exit 1)", () => {
  const worse = clone();
  worse.engineQuality.perRanker.v6Full.overall.badPickRate5 += 0.2;
  const r = runGate(worse);
  expect(r.out).toContain("Bad Pick");
  expect(r.status).toBe(1);
});

test("regresión: un candidate de otro dataset es incomparable → BLOQUEA, nunca PASS", () => {
  const other = clone() as unknown as { identity: { datasetVersion: string } };
  other.identity.datasetVersion = "split:ffffffff;golden:99";
  const r = runGate(other);
  expect(r.out).toContain("incomparable");
  expect(r.status).toBe(1);
});
