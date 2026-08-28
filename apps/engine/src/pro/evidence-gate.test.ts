import { expect, test } from "bun:test";
import { isProfessionalEvidenceEligible } from "./evidence-gate";

test("exige 30 observaciones y confianza estrictamente mayor a 0.6", () => {
  expect(isProfessionalEvidenceEligible(29, .9)).toBe(false);
  expect(isProfessionalEvidenceEligible(30, .6)).toBe(false);
  expect(isProfessionalEvidenceEligible(30, .61)).toBe(true);
});

test("permite ajustar umbrales sin aceptar entradas inválidas", () => {
  expect(isProfessionalEvidenceEligible(10, .8, { minimumSampleSize: 10 })).toBe(true);
  expect(isProfessionalEvidenceEligible(Number.NaN, .8)).toBe(false);
  expect(isProfessionalEvidenceEligible(30, Number.POSITIVE_INFINITY)).toBe(false);
});
