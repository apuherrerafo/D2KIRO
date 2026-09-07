import { describe, expect, test } from "bun:test";
import {
  canonicalEvaluationIdentity,
  evaluationIdentityEquals,
  extractEvaluationIdentity,
  INCOMPARABLE_REASON,
  isComparable,
  LEGACY_SCORING_MODEL_FAMILY,
  scoringFamiliesComparable,
  type EvaluationIdentity,
} from "./evaluation-identity";

// ─────────────────────────────────────────────────────────────────────────────
// R0.2A — Task 9: `EvaluationIdentity` + `isComparable` (design §4.2, requisito 2A.2, CP8-A).
// Contrato de regresión:
//   1. misma identidad                       -> comparable
//   2. datasetVersion distinto               -> NO comparable
//   3. evaluationProtocolVersion distinto    -> NO comparable
//   4. scoringModelFamily no comparable      -> NO comparable
//   5. distinto commit, MISMA identidad      -> SIGUE comparable (nunca por hash)
//   6. identidad ausente / legacy sin campos -> comportamiento explícito, NUNCA silent PASS
// ─────────────────────────────────────────────────────────────────────────────

const ref: EvaluationIdentity = {
  datasetVersion: "split:02dc8878;golden:30",
  evaluationProtocolVersion: "schema:1;patch:7.41e",
  scoringModelFamily: "SCORING_WEIGHTS_V6",
};

describe("isComparable — dimensiones de la identidad", () => {
  test("1 — misma identidad -> comparable, sin dimensiones en conflicto", () => {
    const d = isComparable({ ...ref }, ref);
    expect(d.comparable).toBe(true);
    expect(d.mismatchedDimensions).toEqual([]);
    expect(d.reason).toBe("");
  });

  test("1b — canonicalización determinista: ignora espacios sobrantes", () => {
    const spaced: EvaluationIdentity = {
      datasetVersion: "  split:02dc8878;golden:30 ",
      evaluationProtocolVersion: " schema:1;patch:7.41e",
      scoringModelFamily: "SCORING_WEIGHTS_V6 ",
    };
    expect(canonicalEvaluationIdentity(spaced)).toBe(canonicalEvaluationIdentity(ref));
    expect(evaluationIdentityEquals(spaced, ref)).toBe(true);
    expect(isComparable(spaced, ref).comparable).toBe(true);
  });

  test("1c — la forma canónica tiene las 3 claves en orden fijo y ningún campo de commit", () => {
    expect(canonicalEvaluationIdentity(ref)).toBe(
      '{"datasetVersion":"split:02dc8878;golden:30","evaluationProtocolVersion":"schema:1;patch:7.41e","scoringModelFamily":"SCORING_WEIGHTS_V6"}',
    );
  });

  test("2 — datasetVersion distinto -> NO comparable, motivo EXACTO del Spec", () => {
    const d = isComparable({ ...ref, datasetVersion: "split:99999999;golden:30" }, ref);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["datasetVersion"]);
    expect(d.reason).toContain(INCOMPARABLE_REASON);
  });

  test("3 — evaluationProtocolVersion distinto -> NO comparable", () => {
    const d = isComparable({ ...ref, evaluationProtocolVersion: "schema:2;patch:7.41e" }, ref);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["evaluationProtocolVersion"]);
  });

  test("3b — patchOverride distinto (mismo schema) -> NO comparable: es parte del protocolo", () => {
    const d = isComparable({ ...ref, evaluationProtocolVersion: "schema:1;patch:null" }, ref);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["evaluationProtocolVersion"]);
  });

  test("4 — scoringModelFamily distinta -> NO comparable (no hay red de compatibilidad)", () => {
    const d = isComparable({ ...ref, scoringModelFamily: "SCORING_WEIGHTS_V7" }, ref);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["scoringModelFamily"]);
    expect(scoringFamiliesComparable("SCORING_WEIGHTS_V6", "SCORING_WEIGHTS_V7")).toBe(false);
    expect(scoringFamiliesComparable("SCORING_WEIGHTS_V6", " SCORING_WEIGHTS_V6 ")).toBe(true);
  });

  test("varias dimensiones difieren -> todas se reportan, en orden canónico", () => {
    const d = isComparable({ datasetVersion: "x", evaluationProtocolVersion: "y", scoringModelFamily: "z" }, ref);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual([
      "datasetVersion",
      "evaluationProtocolVersion",
      "scoringModelFamily",
    ]);
  });
});

describe("extractEvaluationIdentity — explicit / legacy / missing", () => {
  test("bloque `identity` explícito -> source explicit (lo que escribirá la promoción R0.2B)", () => {
    const raw = {
      identity: {
        datasetVersion: "golden:v2",
        evaluationProtocolVersion: "protocol:v3",
        scoringModelFamily: "SCORING_WEIGHTS_V6",
      },
    };
    const e = extractEvaluationIdentity(raw);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.source).toBe("explicit");
    expect(e.identity.datasetVersion).toBe("golden:v2");
  });

  test("bloque `identity` incompleto -> cae a legacy si hay campos, si no { ok:false }", () => {
    const e = extractEvaluationIdentity({ identity: { datasetVersion: "x" } });
    expect(e.ok).toBe(false);
  });

  test("artefacto legacy (v6-measured.json) -> identidad derivada de splitHash + schema + patch", () => {
    const raw = {
      commit: "e0b77d781a664be86258546e906505ad1687c9cf",
      schemaVersion: 1,
      splitHash: "02dc8878",
      patchOverride: "7.41e",
      snapshotSyncedAt: "2026-08-29T17:26:34.894Z",
      corpusSize: { drafts: 2157, tournaments: 29, goldenCases: 30 },
    };
    const e = extractEvaluationIdentity(raw);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.source).toBe("legacy");
    expect(e.identity).toEqual({
      datasetVersion: "split:02dc8878;golden:30",
      evaluationProtocolVersion: "schema:1;patch:7.41e",
      scoringModelFamily: LEGACY_SCORING_MODEL_FAMILY,
    });
    // commit / snapshotSyncedAt: metadata informativa, NUNCA identidad.
    expect(e.metadata.commit).toBe("e0b77d781a664be86258546e906505ad1687c9cf");
    expect(e.metadata.snapshotSyncedAt).toBe("2026-08-29T17:26:34.894Z");
    expect(canonicalEvaluationIdentity(e.identity)).not.toContain("e0b77d");
  });

  test("6 — legacy sin los campos mínimos -> { ok:false }: el gate BLOQUEA, no deriva a ciegas", () => {
    const e = extractEvaluationIdentity({ engineQuality: {}, professionalPickAgreement: {} });
    expect(e.ok).toBe(false);
  });

  test("6b — raíz no-objeto -> { ok:false }", () => {
    expect(extractEvaluationIdentity(null).ok).toBe(false);
    expect(extractEvaluationIdentity("nope").ok).toBe(false);
    expect(extractEvaluationIdentity([1, 2, 3]).ok).toBe(false);
  });

  test("patchOverride AUSENTE de la raíz -> no se deriva (distinto de patchOverride:null)", () => {
    expect(extractEvaluationIdentity({ schemaVersion: 1, splitHash: "abc" }).ok).toBe(false);
  });

  test("patchOverride:null es un protocolo legítimo -> se deriva como patch:null", () => {
    const e = extractEvaluationIdentity({
      schemaVersion: 1,
      splitHash: "abc",
      patchOverride: null,
      corpusSize: { goldenCases: 30 },
    });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.identity.evaluationProtocolVersion).toBe("schema:1;patch:null");
  });

  test("goldenCases ausente -> datasetVersion usa el marcador '?', sigue derivando", () => {
    const e = extractEvaluationIdentity({ schemaVersion: 1, splitHash: "abc", patchOverride: "p" });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.identity.datasetVersion).toBe("split:abc;golden:?");
  });
});

// El candado ARQUITECTÓNICO de Task 9: la comparabilidad describe el PROTOCOLO, no el código.
// Un candidate de código nuevo (otro commit) contra la referencia aceptada anterior SIGUE
// siendo comparable — el binding por `engineSourceHash == HEAD` está retirado y no vuelve.
describe("cambio de código NO invalida un baseline (inconsistencia #4 / regla arquitectónica)", () => {
  const referenceRaw = {
    commit: "e0b77d781a664be86258546e906505ad1687c9cf", // baseline aceptado en un commit viejo
    schemaVersion: 1,
    splitHash: "02dc8878",
    patchOverride: "7.41e",
    corpusSize: { goldenCases: 30 },
  };
  const candidateRaw = {
    commit: "df354b9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", // motor cambiado (TSK-213): código NUEVO
    schemaVersion: 1,
    splitHash: "02dc8878",
    patchOverride: "7.41e",
    corpusSize: { goldenCases: 30 },
  };

  test("5 — distinto commit + MISMA EvaluationIdentity -> comparable", () => {
    const rf = extractEvaluationIdentity(referenceRaw);
    const cf = extractEvaluationIdentity(candidateRaw);
    expect(rf.ok && cf.ok).toBe(true);
    if (!rf.ok || !cf.ok) return;
    expect(isComparable(cf.identity, rf.identity).comparable).toBe(true);
    expect(cf.metadata.commit).not.toBe(rf.metadata.commit); // el commit se guarda como metadata…
    expect(canonicalEvaluationIdentity(cf.identity)).toBe(canonicalEvaluationIdentity(rf.identity)); // …fuera de la identidad
  });

  test("EvaluationIdentity expone EXACTAMENTE las 3 dimensiones — ningún campo de commit/hash", () => {
    const e = extractEvaluationIdentity(referenceRaw);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(Object.keys(e.identity).sort()).toEqual([
      "datasetVersion",
      "evaluationProtocolVersion",
      "scoringModelFamily",
    ]);
  });
});
