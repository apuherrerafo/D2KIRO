import { describe, expect, test } from "bun:test";
import { DEFAULT_TOL, evaluateGate, main, type FrozenBaseline } from "./gate";
import type { Tolerance } from "./null-perturbation";

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
