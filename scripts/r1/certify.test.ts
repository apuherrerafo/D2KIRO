import { describe, expect, test } from "bun:test";
import {
  blockersOf,
  computeFunctionalHash,
  computeMachineCertification,
  type FunctionalCertificationInputs,
  type GateResult,
} from "./certify";

// R1 S7 (final blocker repair, Blocker 2 + Blocker 3) -- these tests exercise the PURE decision
// functions certify.ts's `main()` calls, with fabricated inputs. None of them shell out, run the
// real test suite, or touch docs/r1/golden/*.json -- that's the whole point (the mandate is
// explicit: "Do not alter the real manifest merely to run the test if this can be unit-tested
// through injected fixture/status data").

function passingGates(ids: string[]): GateResult[] {
  return ids.map((id) => ({ id, klass: "required", command: "noop", status: "PASS", summary: "" }));
}

describe("computeMachineCertification -- Blocker 2: deterministicGolden y productE2E son precondiciones reales", () => {
  test("todos los gates PASS + productE2E PASS + deterministicGolden PASS -> PASS", () => {
    const gates = passingGates(["root_tests", "engine_typecheck", "ap_gate"]);
    expect(computeMachineCertification(gates, "PASS", "PASS")).toBe("PASS");
  });

  // El regression test obligatorio del mandato: un manifiesto 27/28 (deterministicGolden: FAIL,
  // computado por golden-status.ts a partir de datos inyectados, ver golden-status.test.ts) NUNCA
  // debe permitir machineCertification: PASS, ni siquiera con todos los demás gates en verde.
  test("27/28 deterministic fixtures (deterministicGolden: FAIL) -> machineCertification FAIL, aunque todo lo demás esté en PASS", () => {
    const gates = passingGates(["root_tests", "engine_typecheck", "ap_gate", "cm_gate"]);
    expect(computeMachineCertification(gates, "PASS", "FAIL")).toBe("FAIL");
  });

  test("28/28 (deterministicGolden: PASS) restaura machineCertification: PASS", () => {
    const gates = passingGates(["root_tests", "engine_typecheck", "ap_gate", "cm_gate"]);
    expect(computeMachineCertification(gates, "PASS", "PASS")).toBe("PASS");
  });

  test("productE2E FAIL con deterministicGolden PASS -> machineCertification FAIL igual", () => {
    const gates = passingGates(["root_tests"]);
    expect(computeMachineCertification(gates, "FAIL", "PASS")).toBe("FAIL");
  });

  test("un gate técnico roto (klass required, status FAIL) -> machineCertification FAIL, aunque productE2E y deterministicGolden estén PASS", () => {
    const gates: GateResult[] = [
      { id: "root_tests", klass: "required", command: "noop", status: "PASS", summary: "" },
      { id: "verify_simplicity", klass: "required", command: "noop", status: "FAIL", summary: "roto" },
    ];
    expect(computeMachineCertification(gates, "PASS", "PASS")).toBe("FAIL");
    expect(blockersOf(gates)).toHaveLength(1);
  });
});

function baseInputs(overrides: Partial<FunctionalCertificationInputs> = {}): FunctionalCertificationInputs {
  return {
    commit: "abc123",
    branch: "r1/product-certification",
    gates: [{ id: "root_tests", klass: "required", status: "PASS" }],
    machineCertification: "PASS",
    productE2E: "PASS",
    qualityGolden: "HUMAN_GATE",
    deterministicGolden: "PASS",
    overallR1: "HUMAN_GATE",
    r1Golden: {
      deterministicFixtures: { found: true, totalSlots: 28, existingEquivalent: 28, missing: 0, unresolved: 0, completeCount: true },
      qualityCases: { found: true, totalSlots: 32, reviewedCount: 0, llmLabelCount: 0, status: "HUMAN_GATE" },
      overall: "HUMAN_GATE",
    },
    r1GoldenManifestHash: "hash-a",
    ...overrides,
  };
}

describe("computeFunctionalHash -- Blocker 3: identidad reproducible, cubre r1GoldenManifestHash, excluye dirty/generatedAt/duration", () => {
  test("mismo commit, mismos manifiestos, mismos datasets, mismos seeds, mismos resultados de máquina -> mismo hash funcional", () => {
    const run1 = computeFunctionalHash(baseInputs());
    const run2 = computeFunctionalHash(baseInputs());
    expect(run1).toBe(run2);
    // Reproducibilidad real: dirty/generatedAt/durationMs NI SIQUIERA son parámetros de esta
    // función -- no hay forma de que un archivo generado no funcional (o el reloj) mueva el hash.
  });

  test("cambiar r1GoldenManifestHash cambia el hash funcional", () => {
    const withHashA = computeFunctionalHash(baseInputs({ r1GoldenManifestHash: "hash-a" }));
    const withHashB = computeFunctionalHash(baseInputs({ r1GoldenManifestHash: "hash-b" }));
    expect(withHashA).not.toBe(withHashB);
  });

  test("cambiar deterministicGolden (PASS -> FAIL) cambia el hash funcional", () => {
    const passHash = computeFunctionalHash(baseInputs({ deterministicGolden: "PASS", machineCertification: "PASS" }));
    const failHash = computeFunctionalHash(baseInputs({ deterministicGolden: "FAIL", machineCertification: "FAIL" }));
    expect(passHash).not.toBe(failHash);
  });

  test("la función no acepta dirty/generatedAt/durationMs -- no pueden participar en el hash por construcción", () => {
    const inputs = baseInputs();
    // TypeScript ya lo impide en tiempo de compilación (FunctionalCertificationInputs no declara
    // esos campos); esta aserción en runtime documenta la garantía para quien lea sólo el test.
    expect(Object.keys(inputs)).not.toContain("dirty");
    expect(Object.keys(inputs)).not.toContain("generatedAt");
    expect(Object.keys(inputs)).not.toContain("durationMs");
  });
});
