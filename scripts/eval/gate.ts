#!/usr/bin/env bun
// Fase 9.0 — política determinista PASS/FAIL (SPEC.md §15.4.6, R3-11).
//
// UN SCRIPT decide, no el juicio de un agente. Compara la corrida actual contra
// eval/baselines/v6-measured.json y la tolerancia de null-perturbation.
//
// En 9.0 corre en MODO INFORMATIVO: imprime el veredicto y SIEMPRE sale con código 0.
// El flag --enforce (sin usar en 9.0) lo haría bloqueante — pasa a activarse en el gate de 9.1,
// cuando el baseline ya está congelado y validado.
//
// ─────────────────────────────────────────────────────────────────────────────
// R0.2A — Task 8 (spec `.kiro/specs/r0-engineering-baseline-recovery/`):
//   El binario PASS/FAIL de `evaluateGate()` NO alcanza para el gate obligatorio.
//   "No corrió" tiene que ser un estado de primera clase, distinto de "pasó".
//
//   - `GateStatus ∈ {PASS, FAIL, SKIPPED, BLOCKED}` (design §4.2).
//   - Golden Dataset vacío        ⇒ Engine Quality / Benchmark A  = SKIPPED  (nunca PASS).
//   - `pro-drafts.sqlite` ausente ⇒ Pro Agreement  / Benchmark B  = SKIPPED  (nunca PASS).
//   - `ReferenceBaseline` ausente ⇒ gate                          = BLOCKED  (nunca PASS).
//   - Cada sub-check declara su clase `required | optional | informational`; el default
//     NO es "todo required". Benchmark A = `required`; Benchmark B = `informational`
//     por ADR-002 ("el pick pro no es ground truth").
//   - Un sub-check `required` en SKIPPED/BLOCKED BLOQUEA (exit != 0 en enforce). Un sub-check
//     `optional`/`informational` en SKIPPED/BLOCKED se REPORTA sin bloquear (requisito 2A.1 c6).
//
//   `evaluateGate()` (NDCG@5 / BadPickRate / Agreement) NO se toca — se preserva la Fase 9 (§7).
//   Lo nuevo en Task 8 es la ENVOLTURA DE POLÍTICA (`runMandatoryGate`) y la clasificación por
//   sub-check. El cableado de `--enforce` a INTELLIGENCE CI es Task 10.
//
// ─────────────────────────────────────────────────────────────────────────────
// R0.2A — Task 9: modelo de baseline COMPARABLE (`EvaluationIdentity` + `isComparable`).
//   ANTES de juzgar métricas, el gate verifica que el candidate y el reference baseline
//   pertenezcan a la misma familia de evaluación: mismo `datasetVersion`, mismo
//   `evaluationProtocolVersion`, familia de scoring comparable (design §4.2, requisito 2A.2).
//   - `isComparable` es falso        ⇒ gate = BLOCKED "baseline incomparable: dataset/protocol
//                                       mismatch" (NUNCA por diferencia de hash de commit).
//   - identidad ausente / ilegible   ⇒ gate = BLOCKED (legacy sin identidad — nunca PASS).
//   La comparabilidad describe el PROTOCOLO, no el código: un candidate de código nuevo (otro
//   commit) contra una referencia aceptada anterior SIGUE siendo comparable. El detalle vive en
//   `./evaluation-identity.ts`; acá sólo se cablea al veredicto agregado de Task 8.

import type { EngineQualityResult } from "./benchmark-engine-quality";
import type { ProAgreementResult } from "./benchmark-pro-agreement";
import {
  extractEvaluationIdentity,
  isComparable,
  type ComparabilityDecision,
  type EvaluationIdentity,
} from "./evaluation-identity";
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

// ─────────────────────────────────────────────────────────────────────────────
// R0.2A — Task 8: gate obligatorio que falla fuerte cuando no puede correr.
// ─────────────────────────────────────────────────────────────────────────────

/** Cuatro estados de primera clase. "No corrió" ya no se disfraza de "pasó". */
export type GateStatus = "PASS" | "FAIL" | "SKIPPED" | "BLOCKED";

/**
 * Clase de un sub-check. El default NO es "todo required" (requisito 2A.1 c5).
 * - `required`: su SKIPPED/BLOCKED bloquea el gate (exit != 0 en enforce).
 * - `optional` / `informational`: su SKIPPED/BLOCKED se reporta, no bloquea (2A.1 c6).
 */
export type SubCheckClass = "required" | "optional" | "informational";

export interface SubCheckReport {
  name: string;
  klass: SubCheckClass;
  status: GateStatus;
  detail: string;
}

export type GateMode = "informativo" | "enforce";

export interface MandatoryGateInputs {
  /** El último baseline ACEPTADO. `null` ⇒ ausente ⇒ BLOCKED. */
  reference: FrozenBaseline | null;
  /** Lo medido AHORA (HEAD). `null` ⇒ se compara el reference contra sí mismo (comportamiento 9.x). */
  candidate: FrozenBaseline | null;
  /**
   * Task 9 — identidad de comparabilidad del reference baseline (design §4.2). `null` ⇒ el
   * artefacto no declara `identity` explícita NI trae los campos legacy para derivarla ⇒ BLOCKED
   * (legacy sin identidad, nunca PASS).
   */
  referenceIdentity: EvaluationIdentity | null;
  /**
   * Task 9 — identidad del candidate. `null` con `candidate === null` es legítimo (se juzga el
   * reference contra sí mismo, 9.x); `null` con un `candidate` presente ⇒ BLOCKED (identidad
   * ilegible). Si difiere del reference en dataset/protocolo/familia ⇒ BLOCKED "baseline
   * incomparable". NUNCA se compara por hash de commit.
   */
  candidateIdentity: EvaluationIdentity | null;
  tolerance: Tolerance;
  /** Golden Dataset vacío / ausente ⇒ Engine Quality / Benchmark A sin datos. */
  goldenDatasetEmpty: boolean;
  /** `pro-drafts.sqlite` ausente / corpus vacío ⇒ Pro Agreement / Benchmark B sin datos. */
  proCorpusMissing: boolean;
  mode: GateMode;
}

export interface MandatoryGateVerdict {
  status: GateStatus;
  mode: GateMode;
  subChecks: SubCheckReport[];
  /** Motivos que BLOQUEAN (sólo sub-checks `required`). */
  reasons: string[];
  /** Notas que NO bloquean (sub-checks `optional`/`informational` en SKIPPED/BLOCKED/FAIL). */
  reported: string[];
  /** Qué chequeos no corrieron y por qué (cualquier clase). */
  skipped: string[];
  /**
   * Task 9 — resultado de la verificación de comparabilidad. `null` sólo cuando el gate se cortó
   * antes de poder evaluarla (reference baseline ausente). Cuando `comparable` es falso, el gate
   * ya devolvió BLOCKED y NO corrió `evaluateGate()` sobre inputs incompatibles.
   */
  comparability: ComparabilityDecision | null;
  exitCode: number;
}

const BENCHMARK_A = "Engine Quality / Benchmark A";
const BENCHMARK_B = "Professional Pick Agreement / Benchmark B";

/**
 * Reparte los `reasons` de `evaluateGate()` por sub-check SIN tocar `evaluateGate()`.
 * Un motivo desconocido se adjudica al lado `required` (conservador: nunca esconde un fallo).
 */
function classifyReasons(reasons: string[]): { cvr: string[]; benchmarkA: string[]; benchmarkB: string[] } {
  const cvr: string[] = [];
  const benchmarkA: string[] = [];
  const benchmarkB: string[] = [];
  for (const r of reasons) {
    if (r.startsWith("ConstraintViolationRate")) cvr.push(r);
    else if (r.includes("NDCG@5") || r.includes("Bad Pick Rate@5")) benchmarkA.push(r);
    else if (r.includes("Professional Pick Agreement") || r.includes("Agreement@3")) benchmarkB.push(r);
    else benchmarkA.push(r);
  }
  return { cvr, benchmarkA, benchmarkB };
}

const STATUS_RANK: Record<GateStatus, number> = { PASS: 0, SKIPPED: 1, FAIL: 2, BLOCKED: 3 };

/**
 * Envoltura de política obligatoria (design §4.2 `runMandatoryGate`). Función PURA: recibe los
 * datos ya cargados + los hechos de disponibilidad, devuelve el veredicto estructurado y el exit
 * code. El IO (leer JSON, mirar el filesystem, imprimir) vive en `main()`.
 */
export function runMandatoryGate(inp: MandatoryGateInputs): MandatoryGateVerdict {
  const { mode } = inp;
  const enforceExit = (blocked: boolean): number => (mode === "enforce" && blocked ? 1 : 0);

  /** BLOCKED con la misma forma de sub-checks en todos los cortes tempranos (Task 8 + Task 9). */
  const blocked = (detail: string, comparability: ComparabilityDecision | null): MandatoryGateVerdict => ({
    status: "BLOCKED",
    mode,
    subChecks: [
      { name: BENCHMARK_A, klass: "required", status: "BLOCKED", detail },
      { name: BENCHMARK_B, klass: "informational", status: "BLOCKED", detail },
    ],
    reasons: [detail],
    reported: [],
    skipped: [],
    comparability,
    exitCode: enforceExit(true),
  });

  // 1. ReferenceBaseline ausente ⇒ BLOCKED. No hay contra qué juzgar (Task 8).
  if (inp.reference === null) {
    return blocked("reference baseline ausente", null);
  }

  // 2. Task 9 — comparabilidad ANTES de juzgar métricas. Un candidate sólo se compara contra el
  //    reference baseline si pertenecen a la misma familia de evaluación.
  if (inp.referenceIdentity === null) {
    return blocked(
      "baseline incomparable: reference baseline sin EvaluationIdentity (legacy sin identidad)",
      null,
    );
  }
  if (inp.candidate !== null && inp.candidateIdentity === null) {
    return blocked("baseline incomparable: candidate sin EvaluationIdentity legible", null);
  }
  // Sin candidate ⇒ se juzga el reference contra sí mismo (9.x): su identidad es trivialmente
  // comparable consigo misma.
  const candidateIdentity = inp.candidateIdentity ?? inp.referenceIdentity;
  const comparability = isComparable(candidateIdentity, inp.referenceIdentity);
  if (!comparability.comparable) {
    // NUNCA se corre `evaluateGate()` sobre inputs incompatibles (design §4.2).
    return blocked(comparability.reason, comparability);
  }

  const candidate = inp.candidate ?? inp.reference;
  const verdict = evaluateGate(candidate, inp.reference, inp.tolerance);
  const parts = classifyReasons(verdict.reasons);
  const skipped: string[] = [];

  // 2. Engine Quality / Benchmark A — clase `required`.
  let a: SubCheckReport;
  if (inp.goldenDatasetEmpty) {
    const detail = "Golden Dataset vacío";
    a = { name: BENCHMARK_A, klass: "required", status: "SKIPPED", detail };
    skipped.push(`${BENCHMARK_A} — ${detail}`);
  } else if (parts.cvr.length > 0) {
    a = { name: BENCHMARK_A, klass: "required", status: "FAIL", detail: parts.cvr.join("; ") };
  } else if (parts.benchmarkA.length > 0) {
    a = { name: BENCHMARK_A, klass: "required", status: "FAIL", detail: parts.benchmarkA.join("; ") };
  } else {
    a = { name: BENCHMARK_A, klass: "required", status: "PASS", detail: "sin regresión" };
  }

  // 3. Professional Pick Agreement / Benchmark B — clase `informational` (ADR-002).
  let b: SubCheckReport;
  if (inp.proCorpusMissing) {
    const detail = "pro-drafts.sqlite ausente";
    b = { name: BENCHMARK_B, klass: "informational", status: "SKIPPED", detail };
    skipped.push(`${BENCHMARK_B} — ${detail}`);
  } else if (parts.cvr.length > 0) {
    b = { name: BENCHMARK_B, klass: "informational", status: "FAIL", detail: parts.cvr.join("; ") };
  } else if (parts.benchmarkB.length > 0) {
    b = { name: BENCHMARK_B, klass: "informational", status: "FAIL", detail: parts.benchmarkB.join("; ") };
  } else {
    b = { name: BENCHMARK_B, klass: "informational", status: "PASS", detail: "sin regresión" };
  }

  const subChecks = [a, b];

  // 4. Agregado — SÓLO un sub-check `required` en estado != PASS puede bloquear.
  const blockers = subChecks.filter((s) => s.klass === "required" && s.status !== "PASS");
  const status: GateStatus = blockers.reduce<GateStatus>(
    (acc, s) => (STATUS_RANK[s.status] > STATUS_RANK[acc] ? s.status : acc),
    "PASS",
  );

  const reasons = blockers.map((s) => `${s.name}: ${s.status} — ${s.detail}`);
  const reported = subChecks
    .filter((s) => s.klass !== "required" && s.status !== "PASS")
    .map((s) => `${s.name}: ${s.status} — ${s.detail} (${s.klass}, no bloquea)`);

  return {
    status,
    mode,
    subChecks,
    reasons,
    reported,
    skipped,
    comparability,
    exitCode: enforceExit(status !== "PASS"),
  };
}

/** ¿El Golden Dataset del candidate está vacío? (o el archivo real, si no hay candidate). */
function goldenIsEmpty(candidate: FrozenBaseline | null, goldenPathExists: boolean): boolean {
  if (candidate) {
    const q = candidate.engineQuality;
    return !q?.perRanker?.v6Full || (q?.corpus?.cases ?? 0) <= 0;
  }
  return !goldenPathExists;
}

/**
 * ¿Falta el corpus profesional? El archivo `pro-drafts.sqlite` es gitignored y AUSENTE en cualquier
 * checkout limpio / CI (Task 7 discovery §9.3). Si el archivo no está, el sub-check B no puede
 * correr aunque un `candidate` viejo (o el baseline comparado contra sí mismo tras un crash de
 * `run.ts`) traiga números de Benchmark B congelados — ese es justo el falso verde que Task 8 mata.
 */
function proCorpusIsMissing(candidate: FrozenBaseline | null, proDbExists: boolean): boolean {
  if (!proDbExists) return true;
  if (candidate) {
    const p = candidate.professionalPickAgreement;
    return !p?.perBaseline?.v6Full || (p?.corpus?.drafts ?? 0) <= 0;
  }
  return false;
}

function renderVerdict(v: MandatoryGateVerdict): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(`gate [${v.mode === "enforce" ? "ENFORCE" : "INFORMATIVO"}]: ${v.status}`);
  lines.push("  sub-checks:");
  for (const s of v.subChecks) {
    lines.push(`    - ${s.name} [${s.klass}]: ${s.status} — ${s.detail}`);
  }
  if (v.reasons.length > 0) {
    lines.push("  bloqueantes (required):");
    for (const r of v.reasons) lines.push(`    - ${r}`);
  }
  if (v.reported.length > 0) {
    lines.push("  reportado (no bloquea):");
    for (const r of v.reported) lines.push(`    - ${r}`);
  }
  if (v.reasons.length === 0 && v.reported.length === 0) {
    lines.push("  sin regresiones");
  }
  if (v.comparability !== null && !v.comparability.comparable) {
    lines.push(`  comparabilidad: NO — difiere en ${v.comparability.mismatchedDimensions.join(", ")}`);
  } else if (v.comparability !== null) {
    lines.push("  comparabilidad: sí (mismo dataset + protocolo + familia de scoring)");
  }
  lines.push(`  exit: ${v.exitCode}`);
  lines.push("");
  return lines.join("\n");
}

/**
 * Task 20b — ruta por defecto del baseline cuando `D2K_BASELINE_OUT` no está seteado. Pasa de
 * `v6-measured.json` (medido, informativo) a `accepted.s1.json` (aceptado por el PO vía
 * `promote-candidate.ts`) ahora que ese archivo existe. Exportada sólo para que
 * `gate.test.ts` pueda verificar el default sin tocar el filesystem real ni el override de
 * entorno, que sigue intacto (`main()` sigue siendo la única que lo consulta).
 */
export const DEFAULT_BASELINE_PATH = "eval/baselines/accepted.s1.json";

async function main(argv: string[]): Promise<number> {
  const { readFileSync, existsSync } = await import("node:fs");
  const mode: GateMode = argv.includes("--enforce") ? "enforce" : "informativo";
  const BASELINE = process.env.D2K_BASELINE_OUT ?? DEFAULT_BASELINE_PATH;
  const CURRENT = process.env.D2K_GATE_CURRENT ?? BASELINE; // por defecto se compara contra sí mismo
  const TOL = process.env.D2K_TOLERANCE_OUT ?? "data/generated/tolerance.json";
  const PRO_DB = process.env.D2K_PRO_DB ?? "apps/engine/data/pro-drafts.sqlite";
  const GOLDEN = process.env.D2K_GOLDEN ?? "eval/golden/dataset.json";

  // Se parsea a `unknown` una sola vez: la misma raíz alimenta el cast a `FrozenBaseline` (Task 8)
  // y la extracción de `EvaluationIdentity` (Task 9).
  const referenceRaw: unknown = existsSync(BASELINE) ? JSON.parse(readFileSync(BASELINE, "utf-8")) : null;
  const candidateRaw: unknown =
    CURRENT !== BASELINE && existsSync(CURRENT) ? JSON.parse(readFileSync(CURRENT, "utf-8")) : null;
  const tolerance = existsSync(TOL) ? (JSON.parse(readFileSync(TOL, "utf-8")) as Tolerance) : DEFAULT_TOL;

  const reference = referenceRaw === null ? null : (referenceRaw as FrozenBaseline);
  const candidate = candidateRaw === null ? null : (candidateRaw as FrozenBaseline);

  // Task 9 — identidad de comparabilidad. `explicit` (promoción R0.2B) o derivada de los campos
  // legacy de `v6-measured.json`; `null` ⇒ el gate BLOQUEA (nunca PASS).
  const refExtraction = referenceRaw === null ? null : extractEvaluationIdentity(referenceRaw);
  const candExtraction = candidateRaw === null ? null : extractEvaluationIdentity(candidateRaw);
  const referenceIdentity = refExtraction?.ok ? refExtraction.identity : null;
  const candidateIdentity = candExtraction?.ok ? candExtraction.identity : null;

  // El candidate que se juzga: el explícito, o el reference contra sí mismo (comportamiento 9.x).
  const judged = candidate ?? reference;

  const verdict = runMandatoryGate({
    reference,
    candidate,
    referenceIdentity,
    candidateIdentity,
    tolerance,
    goldenDatasetEmpty: goldenIsEmpty(judged, existsSync(GOLDEN)),
    proCorpusMissing: proCorpusIsMissing(judged, existsSync(PRO_DB)),
    mode,
  });

  process.stdout.write(renderVerdict(verdict));
  return verdict.exitCode;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
export { main, DEFAULT_TOL };
