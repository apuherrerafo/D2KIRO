import { describe, expect, test } from "bun:test";
import { DEFAULT_TOL, evaluateGate, main, runMandatoryGate, type FrozenBaseline, type GateStatus } from "./gate";
import type { EvaluationIdentity } from "./evaluation-identity";
import type { Tolerance } from "./null-perturbation";

// Identidad de comparabilidad compartida por los tests de Task 8: mientras candidate y reference
// declaren la MISMA, la verificación de Task 9 es un no-op y el comportamiento de Task 8 no cambia.
const IDENT: EvaluationIdentity = {
  datasetVersion: "split:02dc8878;golden:30",
  evaluationProtocolVersion: "schema:1;patch:7.41e",
  scoringModelFamily: "SCORING_WEIGHTS_V6",
};

// baseline mínimo con las formas que evaluateGate lee.
function baseline(over: Partial<{ ndcg5: number; badPickRate5: number; recall3: number; goldenCases: number; cvrA: number; cvrB: number }> = {}): FrozenBaseline {
  const ndcg5 = over.ndcg5 ?? 0.6;
  const badPickRate5 = over.badPickRate5 ?? 0.1;
  const recall3 = over.recall3 ?? 0.05;
  const seg = <T>(v: T) => ({ overall: v, byDecisionContext: {}, byTier: {}, byStratum: {} }) as never;
  return {
    engineQuality: {
      valid: true,
      constraintViolationRate: over.cvrA ?? 0,
      corpus: { cases: over.goldenCases ?? 30 },
      perRanker: { v6Full: { overall: { n: 30, ndcg5, badPickRate5, pairwiseAccuracy: 0.7 }, byDecisionContext: {}, byStratum: {} } },
    } as never,
    professionalPickAgreement: {
      valid: true,
      constraintViolationRate: over.cvrB ?? 0,
      perBaseline: { v6Full: { overall: { n: 100, recall: { 1: 0.02, 3: recall3, 5: 0.08, 6: 0.1 }, mrr: 0.04 }, byDecisionContext: {}, byTier: {} } },
    } as never,
  };
}

describe("evaluateGate — política determinista (R3-11)", () => {
  test("corrida idéntica al baseline -> PASS", () => {
    const b = baseline();
    const v = evaluateGate(b, b, DEFAULT_TOL);
    expect(v.verdict).toBe("PASS");
    expect(v.reasons).toHaveLength(0);
  });

  test("ConstraintViolationRate > 0 -> FAIL inmediato, no chequea nada más", () => {
    const cur = baseline({ cvrB: 0.01 });
    const v = evaluateGate(cur, baseline(), DEFAULT_TOL);
    expect(v.verdict).toBe("FAIL");
    expect(v.reasons[0]).toContain("ConstraintViolationRate > 0");
    expect(v.checked).toEqual(["ConstraintViolationRate"]);
  });

  test("NDCG@5 baja más que la tolerancia -> FAIL", () => {
    const base = baseline({ ndcg5: 0.6 });
    const cur = baseline({ ndcg5: 0.5 });
    const v = evaluateGate(cur, base, { ...DEFAULT_TOL, ndcg5: 0.02 });
    expect(v.verdict).toBe("FAIL");
    expect(v.reasons.some((r) => r.includes("NDCG@5 bajó"))).toBe(true);
  });

  test("Bad Pick Rate@5 sube más que la tolerancia -> FAIL", () => {
    const v = evaluateGate(baseline({ badPickRate5: 0.2 }), baseline({ badPickRate5: 0.1 }), { ...DEFAULT_TOL, badPickRate5: 0.02 });
    expect(v.verdict).toBe("FAIL");
    expect(v.reasons.some((r) => r.includes("Bad Pick Rate@5 subió"))).toBe(true);
  });

  test("Engine Quality se omite si el Golden está vacío; sólo se chequea CVR + drift de agreement", () => {
    const v = evaluateGate(baseline({ goldenCases: 0 }), baseline({ goldenCases: 0 }), DEFAULT_TOL);
    expect(v.verdict).toBe("PASS");
    expect(v.checked.some((c) => c.includes("Engine Quality omitido"))).toBe(true);
  });

  test("drift de Professional Pick Agreement @3 -> FAIL", () => {
    const v = evaluateGate(baseline({ recall3: 0.02 }), baseline({ recall3: 0.05 }), { ...DEFAULT_TOL, recallAt3: 0.01 });
    expect(v.verdict).toBe("FAIL");
    expect(v.reasons.some((r) => r.includes("Professional Pick Agreement @3 bajó"))).toBe(true);
  });
});

describe("gate CLI — modo informativo en 9.0", () => {
  test("main() sale 0 aunque el veredicto sea FAIL (sin --enforce)", async () => {
    // sin baseline en el path por defecto -> mensaje y exit 0
    const prev = process.env.D2K_BASELINE_OUT;
    process.env.D2K_BASELINE_OUT = "/tmp/no-such-baseline-xyz.json";
    const code = await main([]);
    expect(code).toBe(0);
    if (prev === undefined) delete process.env.D2K_BASELINE_OUT;
    else process.env.D2K_BASELINE_OUT = prev;
  });
});

// TSK-212 (Fase 9.1, SPEC.md §16.10): --enforce traduce FAIL -> exit 1. Es el gate que corre
// verify-simplicity.sh en el camino de commit.
describe("gate CLI — --enforce (9.1)", () => {
  const { mkdtempSync, rmSync, writeFileSync } = require("node:fs") as typeof import("node:fs");
  const { tmpdir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");

  async function runGate(args: string[], baselineObj: FrozenBaseline, currentObj: FrozenBaseline, tol?: Partial<Tolerance>): Promise<number> {
    const dir = mkdtempSync(join(tmpdir(), "d2k-gate-"));
    const prev = { b: process.env.D2K_BASELINE_OUT, c: process.env.D2K_GATE_CURRENT, t: process.env.D2K_TOLERANCE_OUT };
    try {
      const bPath = join(dir, "baseline.json");
      const cPath = join(dir, "current.json");
      // Task 9: los artefactos reales de `run.ts` traen los campos legacy que derivan la
      // EvaluationIdentity. Sin ellos el gate BLOQUEA por "legacy sin identidad" (correcto, pero
      // no es lo que estos tests de 9.1 miden). Se comparten idénticos ⇒ comparables.
      const legacyIdentity = { schemaVersion: 1, splitHash: "02dc8878", patchOverride: "7.41e", corpusSize: { goldenCases: 30 } };
      writeFileSync(bPath, JSON.stringify({ ...legacyIdentity, ...baselineObj }));
      writeFileSync(cPath, JSON.stringify({ ...legacyIdentity, ...currentObj }));
      process.env.D2K_BASELINE_OUT = bPath;
      process.env.D2K_GATE_CURRENT = cPath;
      if (tol) {
        const tPath = join(dir, "tol.json");
        writeFileSync(tPath, JSON.stringify({ ...DEFAULT_TOL, ...tol }));
        process.env.D2K_TOLERANCE_OUT = tPath;
      }
      return await main(args);
    } finally {
      for (const [k, v] of [["D2K_BASELINE_OUT", prev.b], ["D2K_GATE_CURRENT", prev.c], ["D2K_TOLERANCE_OUT", prev.t]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
      rmSync(dir, { recursive: true, force: true });
    }
  }

  test("--enforce + corrida que FALLA (NDCG@5 desplomado) -> exit 1", async () => {
    const code = await runGate(["--enforce"], baseline({ ndcg5: 0.6 }), baseline({ ndcg5: 0.4 }), { ndcg5: 0.02 });
    expect(code).toBe(1);
  });

  test("--enforce + corrida que PASA (dentro de tolerancia) -> exit 0", async () => {
    const code = await runGate(["--enforce"], baseline({ ndcg5: 0.6 }), baseline({ ndcg5: 0.595 }), { ndcg5: 0.02 });
    expect(code).toBe(0);
  });

  test("sin --enforce, la misma corrida que FALLA -> exit 0 (comportamiento 9.0 preservado)", async () => {
    const code = await runGate([], baseline({ ndcg5: 0.6 }), baseline({ ndcg5: 0.4 }), { ndcg5: 0.02 });
    expect(code).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R0.2A — Task 8: gate obligatorio de 4 estados + clase por sub-check (CP1 / Property 1).
// Candado de regresión: "no corrió" nunca vuelve a contar como "pasó". El falso verde de
// `pro-drafts.sqlite` ausente NO reaparece como silent PASS.
// ─────────────────────────────────────────────────────────────────────────────
describe("runMandatoryGate — GateStatus {PASS,FAIL,SKIPPED,BLOCKED} + clase por sub-check (CP1)", () => {
  // baseline con corpus en AMBOS sub-checks, para poder simular "corpus presente".
  function full(over: Parameters<typeof baseline>[0] & { proDrafts?: number } = {}): FrozenBaseline {
    const b = baseline(over);
    (b.professionalPickAgreement as unknown as { corpus: unknown }).corpus = {
      cases: 100,
      drafts: over.proDrafts ?? 2157,
      tournaments: 29,
    };
    return b;
  }

  const base = full();

  function run(
    over: Partial<{
      reference: FrozenBaseline | null;
      candidate: FrozenBaseline | null;
      referenceIdentity: EvaluationIdentity | null;
      candidateIdentity: EvaluationIdentity | null;
      goldenDatasetEmpty: boolean;
      proCorpusMissing: boolean;
      mode: "informativo" | "enforce";
      tolerance: Tolerance;
    }>,
  ) {
    return runMandatoryGate({
      reference: over.reference === undefined ? base : over.reference,
      candidate: over.candidate === undefined ? base : over.candidate,
      // Task 9: por defecto candidate y reference comparten identidad ⇒ la verificación de
      // comparabilidad no altera ningún caso de Task 8.
      referenceIdentity: over.referenceIdentity === undefined ? IDENT : over.referenceIdentity,
      candidateIdentity: over.candidateIdentity === undefined ? IDENT : over.candidateIdentity,
      tolerance: over.tolerance ?? DEFAULT_TOL,
      goldenDatasetEmpty: over.goldenDatasetEmpty ?? false,
      proCorpusMissing: over.proCorpusMissing ?? false,
      mode: over.mode ?? "enforce",
    });
  }

  const A = "Engine Quality / Benchmark A";
  const B = "Professional Pick Agreement / Benchmark B";
  const sub = (v: ReturnType<typeof run>, name: string) => v.subChecks.find((s) => s.name === name)!;

  // 1 — required check PASS.
  test("Benchmark A required + datos presentes + sin regresión -> PASS, exit 0", () => {
    const v = run({ candidate: full({ ndcg5: 0.6 }), reference: full({ ndcg5: 0.6 }) });
    expect(v.status).toBe<GateStatus>("PASS");
    expect(sub(v, A).klass).toBe("required");
    expect(sub(v, A).status).toBe("PASS");
    expect(v.exitCode).toBe(0);
  });

  // 2 — required check FAIL.
  test("Benchmark A required + NDCG@5 desplomado -> FAIL, exit 1 en enforce", () => {
    const v = run({ candidate: full({ ndcg5: 0.4 }), reference: full({ ndcg5: 0.6 }), tolerance: { ...DEFAULT_TOL, ndcg5: 0.02 } });
    expect(v.status).toBe<GateStatus>("FAIL");
    expect(sub(v, A).status).toBe("FAIL");
    expect(v.exitCode).toBe(1);
  });
  test("mismo FAIL en modo informativo -> status FAIL pero exit 0 (9.x preservado)", () => {
    const v = run({ candidate: full({ ndcg5: 0.4 }), reference: full({ ndcg5: 0.6 }), mode: "informativo", tolerance: { ...DEFAULT_TOL, ndcg5: 0.02 } });
    expect(v.status).toBe<GateStatus>("FAIL");
    expect(v.exitCode).toBe(0);
  });

  // 3 — optional/informational check unavailable -> SKIPPED, visible, NO bloquea, NO es PASS.
  test("pro-drafts.sqlite ausente -> Benchmark B SKIPPED informational, NO bloquea a Benchmark A GREEN", () => {
    const v = run({ proCorpusMissing: true });
    expect(sub(v, B).klass).toBe("informational");
    expect(sub(v, B).status).toBe<GateStatus>("SKIPPED");
    expect(sub(v, B).status).not.toBe("PASS");
    // el sub-check A sigue evaluándose y pasa; el agregado NO se degrada por B.
    expect(sub(v, A).status).toBe("PASS");
    expect(v.status).toBe<GateStatus>("PASS");
    expect(v.exitCode).toBe(0);
    // visible: aparece en `skipped` y en `reported`, nunca escondido.
    expect(v.skipped.some((s) => s.includes(B) && s.includes("pro-drafts.sqlite ausente"))).toBe(true);
    expect(v.reported.some((s) => s.includes(B) && s.includes("no bloquea"))).toBe(true);
  });

  test("pro-drafts.sqlite ausente NUNCA se reporta como PASS del sub-check B", () => {
    const v = run({ proCorpusMissing: true, mode: "enforce" });
    expect(sub(v, B).status).not.toBe("PASS");
    expect(v.subChecks.every((s) => !(s.status === "PASS" && s.detail.includes("ausente")))).toBe(true);
  });

  // 3b — required check unavailable -> SKIPPED bloquea (SKIPPED != PASS).
  test("Golden Dataset vacío -> Benchmark A required SKIPPED -> bloquea, exit 1 en enforce", () => {
    const v = run({ goldenDatasetEmpty: true });
    expect(sub(v, A).klass).toBe("required");
    expect(sub(v, A).status).toBe<GateStatus>("SKIPPED");
    expect(v.status).toBe<GateStatus>("SKIPPED");
    expect(v.exitCode).toBe(1);
    expect(v.reasons.some((r) => r.includes(A) && r.includes("SKIPPED"))).toBe(true);
  });
  test("Golden Dataset vacío en informativo -> SKIPPED, exit 0", () => {
    const v = run({ goldenDatasetEmpty: true, mode: "informativo" });
    expect(v.status).toBe<GateStatus>("SKIPPED");
    expect(v.exitCode).toBe(0);
  });

  // 4 — infrastructure/error state: ReferenceBaseline ausente -> BLOCKED (nunca PASS).
  test("ReferenceBaseline ausente -> BLOCKED, exit 1 en enforce, nunca PASS", () => {
    const v = run({ reference: null });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.status).not.toBe("PASS");
    expect(v.exitCode).toBe(1);
    expect(v.reasons).toContain("reference baseline ausente");
  });
  test("ReferenceBaseline ausente en informativo -> BLOCKED, exit 0", () => {
    const v = run({ reference: null, mode: "informativo" });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.exitCode).toBe(0);
  });

  // 5 — aggregate gate result correcto: required manda, informational sólo reporta.
  test("agregado: Benchmark A FAIL + Benchmark B ausente -> FAIL (manda el required)", () => {
    const v = run({ candidate: full({ ndcg5: 0.4 }), reference: full({ ndcg5: 0.6 }), proCorpusMissing: true, tolerance: { ...DEFAULT_TOL, ndcg5: 0.02 } });
    expect(v.status).toBe<GateStatus>("FAIL");
    expect(v.exitCode).toBe(1);
  });
  test("agregado: Benchmark A PASS + drift SÓLO de Benchmark B -> PASS (informational no bloquea)", () => {
    const v = run({ candidate: full({ recall3: 0.02 }), reference: full({ recall3: 0.05 }), tolerance: { ...DEFAULT_TOL, recallAt3: 0.01 } });
    expect(sub(v, B).status).toBe("FAIL");
    expect(sub(v, A).status).toBe("PASS");
    expect(v.status).toBe<GateStatus>("PASS");
    expect(v.exitCode).toBe(0);
    expect(v.reported.some((r) => r.includes(B))).toBe(true);
  });
  test("agregado: ConstraintViolationRate > 0 -> FAIL duro, bloquea (exit 1 enforce)", () => {
    const v = run({ candidate: full({ cvrB: 0.01 }), reference: full() });
    expect(v.status).toBe<GateStatus>("FAIL");
    expect(sub(v, A).status).toBe("FAIL");
    expect(v.exitCode).toBe(1);
  });

  // candado explícito del falso verde histórico (reproducción B1): baseline comparado contra sí
  // mismo + corpus pro ausente ya NO produce "PASS / sin regresiones" a secas.
  test("baseline vs sí mismo + pro corpus ausente -> B SKIPPED visible, no silent PASS global-ciego", () => {
    const v = run({ candidate: null, reference: base, proCorpusMissing: true });
    expect(v.status).toBe<GateStatus>("PASS"); // A required sí pasó
    expect(sub(v, B).status).toBe<GateStatus>("SKIPPED"); // pero B quedó explícitamente sin correr
    expect(v.skipped.length).toBeGreaterThan(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// R0.2A — Task 9: modelo de baseline COMPARABLE (`EvaluationIdentity` + `isComparable`).
// Las pruebas dirigidas del MÓDULO puro (isComparable, extractEvaluationIdentity,
// canonicalización, caso engineSourceHash) viven en `evaluation-identity.test.ts`.
// Acá, sólo la INTEGRACIÓN con el veredicto agregado de Task 8 (`runMandatoryGate`):
//   1. candidate comparable      -> se evalúa contra el reference baseline aceptado
//   2/3/4. dataset/protocol/family distinto de un `required` -> BLOCKED, exit != 0 en enforce
//   5. incomparable no se disfraza de FAIL/PASS por métricas
//   6. identidad ausente / ilegible -> BLOCKED explícito, NUNCA silent PASS
//   7. el estado agregado es el BLOCKED de 4 estados de Task 8
// ─────────────────────────────────────────────────────────────────────────────
describe("runMandatoryGate — integración de comparabilidad (CP8 parte A) con el agregado de Task 8", () => {
  function full(over: Parameters<typeof baseline>[0] & { proDrafts?: number } = {}): FrozenBaseline {
    const b = baseline(over);
    (b.professionalPickAgreement as unknown as { corpus: unknown }).corpus = { cases: 100, drafts: over.proDrafts ?? 2157, tournaments: 29 };
    return b;
  }
  const base = full();

  const otherDataset: EvaluationIdentity = { ...IDENT, datasetVersion: "split:99999999;golden:30" };
  const otherProtocol: EvaluationIdentity = { ...IDENT, evaluationProtocolVersion: "schema:2;patch:7.41e" };
  const otherFamily: EvaluationIdentity = { ...IDENT, scoringModelFamily: "SCORING_WEIGHTS_V7" };

  function run(over: Partial<Parameters<typeof runMandatoryGate>[0]>) {
    return runMandatoryGate({
      reference: base,
      candidate: base,
      referenceIdentity: IDENT,
      candidateIdentity: IDENT,
      tolerance: DEFAULT_TOL,
      goldenDatasetEmpty: false,
      proCorpusMissing: false,
      mode: "enforce",
      ...over,
    });
  }

  test("1 — candidate comparable -> el gate evalúa contra el reference baseline aceptado (PASS)", () => {
    const v = run({ candidateIdentity: { ...IDENT } });
    expect(v.status).toBe<GateStatus>("PASS");
    expect(v.comparability?.comparable).toBe(true);
    expect(v.exitCode).toBe(0);
  });

  test("2 — datasetVersion distinto -> BLOCKED 'baseline incomparable', exit 1 en enforce", () => {
    const v = run({ candidateIdentity: otherDataset });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.reasons.join(" ")).toContain("baseline incomparable: dataset/protocol mismatch");
    expect(v.comparability?.mismatchedDimensions).toEqual(["datasetVersion"]);
    expect(v.exitCode).toBe(1);
  });

  test("2b — mismo BLOCKED en informativo -> exit 0 (política de Task 8 preservada)", () => {
    const v = run({ candidateIdentity: otherDataset, mode: "informativo" });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.exitCode).toBe(0);
  });

  test("3 — evaluationProtocolVersion distinto -> BLOCKED", () => {
    const v = run({ candidateIdentity: otherProtocol });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.comparability?.mismatchedDimensions).toEqual(["evaluationProtocolVersion"]);
  });

  test("4 — scoringModelFamily no comparable -> BLOCKED", () => {
    const v = run({ candidateIdentity: otherFamily });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.comparability?.mismatchedDimensions).toEqual(["scoringModelFamily"]);
  });

  test("5 — un candidate incomparable NO se juzga como FAIL/PASS por métricas: es BLOCKED", () => {
    // NDCG@5 desplomado ADEMÁS de dataset distinto: el motivo agregado es la incomparabilidad,
    // nunca "NDCG@5 bajó" — no se corre evaluateGate() sobre inputs incompatibles.
    const v = run({
      candidate: full({ ndcg5: 0.1 }),
      candidateIdentity: otherDataset,
      tolerance: { ...DEFAULT_TOL, ndcg5: 0.02 },
    });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.reasons.join(" ")).not.toContain("NDCG@5 bajó");
  });

  test("6 — reference sin EvaluationIdentity (legacy sin identidad) -> BLOCKED, nunca PASS", () => {
    const v = run({ referenceIdentity: null });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.status).not.toBe("PASS");
    expect(v.reasons.join(" ")).toContain("sin EvaluationIdentity");
    expect(v.exitCode).toBe(1);
  });

  test("6b — candidate presente pero con identidad ilegible -> BLOCKED", () => {
    const v = run({ candidate: full(), candidateIdentity: null });
    expect(v.status).toBe<GateStatus>("BLOCKED");
    expect(v.reasons.join(" ")).toContain("candidate sin EvaluationIdentity");
  });

  test("sin candidate (reference vs sí mismo, 9.x) + identidad legacy presente -> comparable, no BLOCKED", () => {
    const v = run({ candidate: null, candidateIdentity: null });
    expect(v.comparability?.comparable).toBe(true);
    expect(v.status).toBe<GateStatus>("PASS");
  });

  test("7 — cambio de código (otro commit) con MISMA identidad -> el gate compara igual, no BLOQUEA", () => {
    // La identidad describe el protocolo, no el código: un candidate HEAD nuevo contra la
    // referencia aceptada anterior SIGUE siendo comparable (inconsistencia #4 del diseño).
    const v = run({ candidateIdentity: { ...IDENT } });
    expect(v.status).toBe<GateStatus>("PASS");
    expect(v.comparability?.comparable).toBe(true);
  });
});
