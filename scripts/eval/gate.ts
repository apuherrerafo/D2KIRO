#!/usr/bin/env bun
// Fase 9.0 — política determinista PASS/FAIL (SPEC.md §15.4.6, R3-11).
//
// UN SCRIPT decide, no el juicio de un agente. Compara la corrida actual contra
// eval/baselines/v6-measured.json y la tolerancia de null-perturbation.
//
// En 9.0 corre en MODO INFORMATIVO: imprime el veredicto y SIEMPRE sale con código 0.
// El flag --enforce (sin usar en 9.0) lo haría bloqueante — pasa a activarse en el gate de 9.1,
// cuando el baseline ya está congelado y validado.

import type { EngineQualityResult } from "./benchmark-engine-quality";
import type { ProAgreementResult } from "./benchmark-pro-agreement";
import type { Tolerance } from "./null-perturbation";

export interface FrozenBaseline {
  engineQuality: EngineQualityResult;
  professionalPickAgreement: ProAgreementResult;
}

export interface GateVerdict {
  verdict: "PASS" | "FAIL";
  reasons: string[];
  checked: string[];
}

const DEFAULT_TOL: Tolerance = {
  schemaVersion: 1,
  perturbations: 0,
  swapProbability: 0,
  ndcg5: 0.02,
  recallAt3: 0.02,
  badPickRate5: 0.02,
  byContextRecallAt3: 0.05,
  note: "tolerancia por defecto (no se corrió null-perturbation)",
};

export function evaluateGate(current: FrozenBaseline, baseline: FrozenBaseline, tol: Tolerance = DEFAULT_TOL): GateVerdict {
  const reasons: string[] = [];
  const checked: string[] = [];

  // 1. ConstraintViolationRate — gate duro, cualquier violación invalida
  checked.push("ConstraintViolationRate");
  if (current.professionalPickAgreement.constraintViolationRate > 0 || current.engineQuality.constraintViolationRate > 0) {
    reasons.push(
      `ConstraintViolationRate > 0 (A: ${current.engineQuality.constraintViolationRate}, B: ${current.professionalPickAgreement.constraintViolationRate}) — corrida inválida`,
    );
    return { verdict: "FAIL", reasons, checked };
  }

  // 2. Engine Quality — sólo si ambos lados tienen Golden Dataset
  const curQ = current.engineQuality.perRanker?.v6Full;
  const baseQ = baseline.engineQuality.perRanker?.v6Full;
  if (curQ && baseQ && current.engineQuality.corpus.cases > 0 && baseline.engineQuality.corpus.cases > 0) {
    checked.push("NDCG@5", "BadPickRate@5", "NDCG@5 por contexto");
    if (curQ.overall.ndcg5 < baseQ.overall.ndcg5 - tol.ndcg5) {
      reasons.push(`NDCG@5 bajó: ${curQ.overall.ndcg5.toFixed(3)} < ${baseQ.overall.ndcg5.toFixed(3)} − ${tol.ndcg5}`);
    }
    if (curQ.overall.badPickRate5 > baseQ.overall.badPickRate5 + tol.badPickRate5) {
      reasons.push(`Bad Pick Rate@5 subió: ${curQ.overall.badPickRate5.toFixed(3)} > ${baseQ.overall.badPickRate5.toFixed(3)} + ${tol.badPickRate5}`);
    }
    for (const [ctx, s] of Object.entries(curQ.byDecisionContext)) {
      const b = baseQ.byDecisionContext[ctx as keyof typeof baseQ.byDecisionContext];
      if (b && s.n > 0 && b.n > 0 && s.ndcg5 < b.ndcg5 - tol.ndcg5) {
        reasons.push(`NDCG@5 cayó en contexto ${ctx}: ${s.ndcg5.toFixed(3)} < ${b.ndcg5.toFixed(3)} − ${tol.ndcg5}`);
      }
    }
  } else {
    checked.push("(Engine Quality omitido — Golden Dataset vacío)");
  }

  // 3. Professional Pick Agreement — drift de Recall@3 (v6Full), global y por contexto
  const curB = current.professionalPickAgreement.perBaseline?.v6Full;
  const baseB = baseline.professionalPickAgreement.perBaseline?.v6Full;
  if (curB && baseB) {
    checked.push("Professional Pick Agreement @3 (drift)");
    if (curB.overall.recall[3] < baseB.overall.recall[3] - tol.recallAt3) {
      reasons.push(`Professional Pick Agreement @3 bajó: ${curB.overall.recall[3].toFixed(3)} < ${baseB.overall.recall[3].toFixed(3)} − ${tol.recallAt3}`);
    }
    for (const [ctx, s] of Object.entries(curB.byDecisionContext)) {
      const b = baseB.byDecisionContext[ctx as keyof typeof baseB.byDecisionContext];
      if (b && s.n > 0 && b.n > 0 && s.recall[3] < b.recall[3] - tol.byContextRecallAt3) {
        reasons.push(`Agreement@3 cayó en contexto ${ctx}: ${s.recall[3].toFixed(3)} < ${b.recall[3].toFixed(3)} − ${tol.byContextRecallAt3}`);
      }
    }
  }

  return { verdict: reasons.length === 0 ? "PASS" : "FAIL", reasons, checked };
}

async function main(argv: string[]): Promise<number> {
  const { readFileSync, existsSync } = await import("node:fs");
  const enforce = argv.includes("--enforce"); // NO se usa en 9.0
  const BASELINE = process.env.D2K_BASELINE_OUT ?? "eval/baselines/v6-measured.json";
  const CURRENT = process.env.D2K_GATE_CURRENT ?? BASELINE; // por defecto se compara contra sí mismo
  const TOL = process.env.D2K_TOLERANCE_OUT ?? "data/generated/tolerance.json";

  if (!existsSync(BASELINE)) {
    process.stdout.write(`gate: no hay baseline en ${BASELINE} — nada que juzgar (corré 'bun run eval' primero)\n`);
    return 0;
  }
  const baseline = JSON.parse(readFileSync(BASELINE, "utf-8")) as FrozenBaseline;
  const current = JSON.parse(readFileSync(CURRENT, "utf-8")) as FrozenBaseline;
  const tol = existsSync(TOL) ? (JSON.parse(readFileSync(TOL, "utf-8")) as Tolerance) : DEFAULT_TOL;

  const v = evaluateGate(current, baseline, tol);
  process.stdout.write(
    `\ngate [${enforce ? "ENFORCE" : "INFORMATIVO"}]: ${v.verdict}\n` +
      `  chequeado: ${v.checked.join("; ")}\n` +
      (v.reasons.length > 0 ? `  motivos:\n${v.reasons.map((r) => `    - ${r}`).join("\n")}\n` : `  sin regresiones\n`),
  );

  // 9.0: SIEMPRE exit 0. Sólo --enforce (9.1+) traduce FAIL a exit 1.
  return enforce && v.verdict === "FAIL" ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
export { main, DEFAULT_TOL };
