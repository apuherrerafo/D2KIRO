#!/usr/bin/env bun
// Gate de calidad del motor para CI: mide el motor ACTUAL (HEAD) y lo compara contra el baseline
// aceptado (`eval/baselines/accepted.s1.json`).
//
// Por qué existe: `gate.ts --enforce` sin `D2K_GATE_CURRENT` compara el baseline contra SÍ MISMO
// (modo 9.x documentado). Eso da PASS siempre, aunque el motor empeore — un gate que no puede
// fallar. Este script cierra ese hueco generando un candidate real del motor del checkout y
// delegando el veredicto a `gate.ts` (la autoridad, sin duplicar umbrales ni lógica de métricas).
//
// Qué NO hace: no promueve baselines (eso es `promote-candidate.ts`, decisión del Product Owner),
// no escribe dentro del repo (todo va a un directorio temporal), no toca pesos, scoring ni datasets.
// La comparabilidad (datasetVersion/protocolo/familia/snapshot) la sigue decidiendo `gate.ts`: si el
// candidate es incomparable, BLOQUEA — nunca pasa en silencio.
//
// Causa del `datasetVersion` que bloqueaba al medir a mano: el candidate se generó con un split
// distinto al congelado. Aquí se usa SIEMPRE `eval/baselines/split.json` + `eval/snapshots/S1.sqlite`
// (mismo entorno que `candidateEnvironment` de Task 19).

import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { candidateEnvironment, comparisonEnvironment, TASK20_ACCEPTED } from "./current-engine-candidate";
import { runnerGitEnvironment, validateFrozenS1 } from "./rebased-reference";

export type Command = (program: string, args: string[], cwd: string, env: NodeJS.ProcessEnv) => number;

const command: Command = (program, args, cwd, env) => {
  const result = spawnSync(program, args, { cwd, env, stdio: "inherit" });
  if (result.error) throw result.error;
  return result.status ?? 1;
};

/** El gate se juzga contra el baseline ACEPTADO, nunca contra el control `reference.s1.json`. */
export function ciComparisonEnvironment(root: string, candidate: string): NodeJS.ProcessEnv {
  return { ...comparisonEnvironment(root, candidate), D2K_BASELINE_OUT: join(resolve(root), TASK20_ACCEPTED) };
}

/** Un candidate que no mide el commit actual es evidencia vieja: se rechaza antes de comparar. */
export function assertCandidateMeasuresCommit(path: string, commit: string): void {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  const provenance = (raw as { provenance?: Record<string, unknown> }).provenance;
  if (provenance?.measuredEngineCommit !== commit) {
    throw new Error("el candidate no identifica el commit actual del motor (evidencia vieja o ajena)");
  }
}

export async function main(root = process.cwd(), runner: Command = command): Promise<number> {
  const resolvedRoot = resolve(root);
  let workDir: string | null = null;
  let reportsDir: string | null = null;
  try {
    if (!existsSync(join(resolvedRoot, TASK20_ACCEPTED))) {
      throw new Error(`falta el baseline aceptado: ${TASK20_ACCEPTED}`);
    }
    validateFrozenS1(join(resolvedRoot, "eval/snapshots/S1.sqlite"), join(resolvedRoot, "eval/snapshots/S1.manifest.json"));

    const commit = execFileSync("git", ["rev-parse", "HEAD"], { cwd: resolvedRoot, env: runnerGitEnvironment(), encoding: "utf8" }).trim();
    workDir = mkdtempSync(join(tmpdir(), "d2k-ci-gate-"));
    const candidate = join(workDir, "candidate.json");
    const env = candidateEnvironment(resolvedRoot, candidate, commit);
    reportsDir = env.D2K_REPORTS_DIR ?? null;

    if (runner(process.execPath, ["run", "scripts/eval/run.ts"], resolvedRoot, env) !== 0) {
      throw new Error("no se pudo medir el motor actual (run.ts falló)");
    }
    assertCandidateMeasuresCommit(candidate, commit);

    return runner(process.execPath, ["run", "scripts/eval/gate.ts", "--enforce"], resolvedRoot, ciComparisonEnvironment(resolvedRoot, candidate));
  } catch (error) {
    process.stderr.write(`ci-gate BLOQUEADO: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  } finally {
    if (workDir !== null) rmSync(workDir, { recursive: true, force: true });
    if (reportsDir !== null && existsSync(reportsDir)) rmSync(reportsDir, { recursive: true, force: true });
  }
}

if (import.meta.main) process.exit(await main());
