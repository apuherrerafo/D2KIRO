import { expect, test } from "bun:test";
import { buildEmpiricalProvenance, EMPIRICAL_PROVENANCE_SCHEMA, validateEmpiricalProvenance, type EmpiricalProvenanceInput } from "./empirical-provenance";

// Inline fixture (no SQLite, no network).
const table = (rows: number) => ({ rows, retrievedFrom: "2026-09-18T01:07:38.500Z", retrievedTo: "2026-09-19T20:49:59.597Z" });
const input = (over: Partial<EmpiricalProvenanceInput> = {}): EmpiricalProvenanceInput => ({
  snapshotId: "TEST-1",
  frozenAt: "2026-09-20T00:00:00.000Z",
  rulesetTarget: "7.41f",
  patchLabelOnRows: "7.41e",
  patchLabelDistinct: ["7.41e"],
  syncRuns: [
    { id: 2, source: "opendota", startedAt: "2026-09-18T01:07:38.493Z", finishedAt: "2026-09-18T01:11:52.461Z", status: "ok", rowsWritten: 100 },
    { id: 3, source: "opendota", startedAt: "2026-09-19T20:45:06.790Z", finishedAt: null, status: "running", rowsWritten: 0 },
  ],
  tables: { heroes: table(3), hero_patch_stats: table(24), hero_matchups: table(9) },
  matchupRetrievalGroups: [
    { syncId: 2, heroes: 2, retrievedFrom: "2026-09-18T01:07:40.000Z", retrievedTo: "2026-09-18T01:11:38.894Z" },
    { syncId: 3, heroes: 1, retrievedFrom: "2026-09-19T20:49:59.597Z", retrievedTo: "2026-09-19T20:49:59.597Z" },
  ],
  matchupHeroesDistinct: 3,
  brackets: [{ bracket: "herald", totalPicks: 10, totalWins: 5 }, { bracket: "immortal", totalPicks: 0, totalWins: 0 }],
  hashes: { logicalFingerprint: `meta1:${"a".repeat(64)}`, fileSha256: "b".repeat(64), sourceFileSha256: "c".repeat(64) },
  ...over,
});

test("el parche de las filas es una ETIQUETA no verificada, separada del ruleset objetivo", () => {
  const doc = buildEmpiricalProvenance(input());

  expect(doc.patchClaim.label).toBe("7.41e");
  expect(doc.patchClaim.verified).toBe(false);
  expect(doc.rulesetTarget.patch).toBe("7.41f");
  expect(doc.observationWindow).toBeNull();
  expect(doc.limitations.join(" ")).toContain("UNVERIFIED");
});

test("un sync interrumpido y una recuperación en varios grupos quedan declarados como limitaciones, no ocultos", () => {
  const doc = buildEmpiricalProvenance(input());

  expect(doc.synchronization.interruptedRunPresent).toBe(true);
  expect(doc.limitations.some((line) => line.includes("not finished"))).toBe(true);
  expect(doc.limitations.some((line) => line.includes("2 separate groups"))).toBe(true);
  expect(doc.limitations.some((line) => line.includes("immortal"))).toBe(true);
  expect(doc.synchronization.retrievalWindow).toEqual({ from: "2026-09-18T01:07:38.500Z", to: "2026-09-19T20:49:59.597Z" });
});

test("sin sync interrumpido ni grupos múltiples esas limitaciones no aparecen (no se inventan)", () => {
  const doc = buildEmpiricalProvenance(input({ syncRuns: [{ id: 2, source: "opendota", startedAt: "a", finishedAt: "b", status: "ok", rowsWritten: 1 }], matchupRetrievalGroups: [], brackets: [{ bracket: "herald", totalPicks: 1, totalWins: 1 }] }));

  expect(doc.synchronization.interruptedRunPresent).toBe(false);
  expect(doc.limitations.some((line) => line.includes("not finished") || line.includes("separate groups") || line.includes("zero recorded picks"))).toBe(false);
});

test("validateEmpiricalProvenance acepta el documento construido y rechaza los que afirman lo no verificable", () => {
  const doc = buildEmpiricalProvenance(input());

  expect(doc.schema).toBe(EMPIRICAL_PROVENANCE_SCHEMA);
  expect(validateEmpiricalProvenance(doc)).toEqual([]);
  expect(validateEmpiricalProvenance({ ...doc, patchClaim: { ...doc.patchClaim, verified: true } })).toContain("patchClaim.verified must be explicitly false (nothing verifies the label)");
  expect(validateEmpiricalProvenance({ ...doc, observationWindow: { from: "x", to: "y" } })).toContain("observationWindow must be null unless the source reports it");
  expect(validateEmpiricalProvenance({ ...doc, hashes: { ...doc.hashes, logicalFingerprint: "meta1:short" } })).toContain("hashes.logicalFingerprint is not meta1:<sha256>");
  expect(validateEmpiricalProvenance(null)).toEqual(["not an object"]);
});
