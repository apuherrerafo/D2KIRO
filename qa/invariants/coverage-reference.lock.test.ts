/**
 * R3.2 -- candado de la CONFIGURACION y la PROCEDENCIA de la referencia de cobertura. No mide el Coach: impide que alguien debilite el guard
 * (tolerancias) o reemplace la referencia (numeros) sin que quede a la vista. Toda constante de aqui se actualiza a mano, junto con
 * `coverage-reference.md`, en el mismo cambio y con revision humana.
 *
 * No lee `hero-counters.json` ni la matriz real (eso lo hace `ownership.test.ts`): solo el JSON de la referencia, que es un artefacto de QA.
 */
import { describe, expect, test } from "bun:test";
import referenceJson from "./coverage-reference.json";
import { COVERAGE_TOLERANCE, referenceIntegrityHash, referenceTrustProblems, type CoverageReference } from "./matrix-coverage";

const reference = referenceJson as unknown as CoverageReference;

// Pin de la referencia vigente (commit 6fbd8bd2, 134/652/410/194). Cambiarla exige cambiar este valor a proposito.
const PINNED_REFERENCE_SHA256 = "26e6d5ab109d0619889655771e9f9908f82b2062fd55861a36ef18c4031eeeaa";
// Pin de las tolerancias provisionales. Subirlas o bajarlas es una decision a revisar, nunca un ajuste para conseguir PASS.
const PINNED_TOLERANCE: Record<string, number> = { rateFloor: 0.5, minSegmentAnswered: 5 };

describe("candado de la referencia de cobertura", () => {
  test("las tolerancias estan fijas en codigo y congeladas (provisionales)", () => {
    expect({ ...COVERAGE_TOLERANCE } as Record<string, number>).toEqual(PINNED_TOLERANCE);
    expect(Object.isFrozen(COVERAGE_TOLERANCE)).toBe(true);
  });

  test("el JSON de la referencia solo trae provenance, profile e integrity (nunca una tolerancia propia)", () => {
    expect(Object.keys(reference).sort()).toEqual(["integrity", "profile", "provenance"]);
  });

  test("la huella interna coincide con el contenido y con el pin de esta prueba (una edicion a mano no pasa)", () => {
    expect(referenceTrustProblems(reference)).toEqual([]);
    expect(referenceIntegrityHash(reference)).toBe(PINNED_REFERENCE_SHA256);
    expect(reference.integrity.sha256).toBe(PINNED_REFERENCE_SHA256);
  });

  test("la procedencia es auditable: commit, fecha y sha256 de hero-counters.json", () => {
    expect(reference.provenance.commit).toMatch(/^[0-9a-f]{7,40}$/);
    expect(reference.provenance.measuredOn).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(Object.keys(reference.provenance.curatedInputs)).toEqual(["hero-counters.json"]);
    expect(reference.provenance.curatedInputs["hero-counters.json"]).toMatch(/^[0-9a-f]{64}$/);
  });

  test("candado en rojo: cambiar un numero de la referencia sin regenerar la huella se detecta", () => {
    const edited = structuredClone(reference);
    edited.profile.withCards += 1;
    expect(referenceTrustProblems(edited).length).toBeGreaterThan(0);
    expect(referenceIntegrityHash(edited)).not.toBe(PINNED_REFERENCE_SHA256);
  });
});
