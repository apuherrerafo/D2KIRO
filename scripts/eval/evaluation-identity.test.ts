import { describe, expect, test } from "bun:test";
import {
  ACTIVE_SCORING_MODEL_FAMILY,
  canonicalEvaluationIdentity,
  evaluationIdentityEquals,
  extractEvaluationIdentity,
  HISTORICAL_REFERENCE_S0_REASON,
  IDENTITY_DIMENSIONS,
  INCOMPARABLE_REASON,
  isComparable,
  isMetaSnapshotVersion,
  LEGACY_SCORING_MODEL_FAMILY,
  META_SNAPSHOT_VERSION_PREFIX,
  scoringFamiliesComparable,
  type EvaluationIdentity,
} from "./evaluation-identity";

// ─────────────────────────────────────────────────────────────────────────────
// R0.2A — Task 9 + R0.2B — Task 34: `EvaluationIdentity` + `isComparable`
// (design §4.2, requisitos 2A.2 / 2B.3, CP8).
// Contrato de regresión:
//   1. misma identidad                       -> comparable
//   2. datasetVersion distinto               -> NO comparable
//   3. evaluationProtocolVersion distinto    -> NO comparable
//   4. scoringModelFamily no comparable      -> NO comparable
//   5. distinto commit, MISMA identidad      -> SIGUE comparable (nunca por hash)
//   6. identidad ausente / legacy sin campos -> comportamiento explícito, NUNCA silent PASS
//   Task 34:
//   7. metaSnapshotVersion distinto          -> NO comparable
//   8. legacy S0 sin metaSnapshotVersion vs candidate sobre S1 -> incomparable / BLOCKED
//   8b. metaSnapshotVersion `null` en CUALQUIER lado (incl. `null` vs `null`) -> NO comparable
//       (FAIL CLOSED / C2: identidad de snapshot desconocida nunca prueba igualdad)
//   9. evaluationProtocolVersion ya NO lleva un patch concreto ("7.41e")
// ─────────────────────────────────────────────────────────────────────────────

const META_A = `${META_SNAPSHOT_VERSION_PREFIX}${"a".repeat(64)}`;
const META_B = `${META_SNAPSHOT_VERSION_PREFIX}${"b".repeat(64)}`;

const ref: EvaluationIdentity = {
  datasetVersion: "split:02dc8878;golden:30",
  evaluationProtocolVersion: "schema:1;patchOverride:dominant",
  scoringModelFamily: "SCORING_WEIGHTS_V6",
  metaSnapshotVersion: META_A,
};

describe("isComparable — dimensiones de la identidad", () => {
  test("1 — misma identidad -> comparable, sin dimensiones en conflicto", () => {
    const d = isComparable({ ...ref }, ref);
    expect(d.comparable).toBe(true);
    expect(d.mismatchedDimensions).toEqual([]);
    expect(d.reason).toBe("");
    expect(d.historicalReferenceS0).toBe(false);
  });

  test("1b — canonicalización determinista: ignora espacios sobrantes", () => {
    const spaced: EvaluationIdentity = {
      datasetVersion: "  split:02dc8878;golden:30 ",
      evaluationProtocolVersion: " schema:1;patchOverride:dominant",
      scoringModelFamily: "SCORING_WEIGHTS_V6 ",
      metaSnapshotVersion: ` ${META_A} `,
    };
    expect(canonicalEvaluationIdentity(spaced)).toBe(canonicalEvaluationIdentity(ref));
    expect(evaluationIdentityEquals(spaced, ref)).toBe(true);
    expect(isComparable(spaced, ref).comparable).toBe(true);
  });

  test("1c — la forma canónica tiene las 4 claves en orden fijo, null explícito, ningún campo de commit", () => {
    expect(canonicalEvaluationIdentity(ref)).toBe(
      `{"datasetVersion":"split:02dc8878;golden:30","evaluationProtocolVersion":"schema:1;patchOverride:dominant","scoringModelFamily":"SCORING_WEIGHTS_V6","metaSnapshotVersion":"${META_A}"}`,
    );
    expect(canonicalEvaluationIdentity({ ...ref, metaSnapshotVersion: null })).toContain(
      '"metaSnapshotVersion":null',
    );
  });

  test("2 — datasetVersion distinto -> NO comparable, motivo del Spec", () => {
    const d = isComparable({ ...ref, datasetVersion: "split:99999999;golden:30" }, ref);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["datasetVersion"]);
    expect(d.reason).toContain(INCOMPARABLE_REASON);
  });

  test("3 — evaluationProtocolVersion distinto -> NO comparable", () => {
    const d = isComparable({ ...ref, evaluationProtocolVersion: "schema:2;patchOverride:dominant" }, ref);
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

  test("7 — metaSnapshotVersion distinto (dos S1 concretos) -> NO comparable", () => {
    const d = isComparable({ ...ref, metaSnapshotVersion: META_B }, ref);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["metaSnapshotVersion"]);
    expect(d.historicalReferenceS0).toBe(false);
    expect(d.reason).toContain("metaSnapshotVersion");
  });

  test("8 — HISTORICAL_REFERENCE_S0 (meta null) vs candidate sobre S1 (meta concreto) -> NO comparable / BLOCKED", () => {
    const legacyS0: EvaluationIdentity = { ...ref, metaSnapshotVersion: null };
    const s1Candidate: EvaluationIdentity = { ...ref, metaSnapshotVersion: META_A };
    const d = isComparable(s1Candidate, legacyS0);
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["metaSnapshotVersion"]);
    expect(d.historicalReferenceS0).toBe(true);
    expect(d.reason).toContain(HISTORICAL_REFERENCE_S0_REASON);
    // simétrico
    expect(isComparable(legacyS0, s1Candidate).comparable).toBe(false);
  });

  test("8b — meta null en AMBOS lados (dos artefactos sin huella) -> NO comparable (FAIL CLOSED / C2)", () => {
    const a: EvaluationIdentity = { ...ref, metaSnapshotVersion: null };
    const b: EvaluationIdentity = { ...ref, metaSnapshotVersion: null };
    const d = isComparable(a, b);
    // identidad de snapshot desconocida en ambos: NO se puede afirmar que midieron el mismo meta.
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual(["metaSnapshotVersion"]);
    expect(d.historicalReferenceS0).toBe(true);
    expect(d.reason).toContain(HISTORICAL_REFERENCE_S0_REASON);
  });

  test("8c — meta null vs huella concreta -> NO comparable, en los dos órdenes", () => {
    const nullSide: EvaluationIdentity = { ...ref, metaSnapshotVersion: null };
    const concrete: EvaluationIdentity = { ...ref, metaSnapshotVersion: META_A };
    expect(isComparable(concrete, nullSide).comparable).toBe(false);
    expect(isComparable(nullSide, concrete).comparable).toBe(false);
    expect(isComparable(concrete, nullSide).historicalReferenceS0).toBe(true);
  });

  test("9 — evaluationProtocolVersion codifica la REGLA, no un patch concreto", () => {
    expect(ref.evaluationProtocolVersion).toContain("patchOverride:dominant");
    expect(ref.evaluationProtocolVersion).not.toContain("7.41e");
  });

  test("varias dimensiones difieren -> todas se reportan, en orden canónico", () => {
    const d = isComparable(
      { datasetVersion: "x", evaluationProtocolVersion: "y", scoringModelFamily: "z", metaSnapshotVersion: META_B },
      ref,
    );
    expect(d.comparable).toBe(false);
    expect(d.mismatchedDimensions).toEqual([
      "datasetVersion",
      "evaluationProtocolVersion",
      "scoringModelFamily",
      "metaSnapshotVersion",
    ]);
  });

  test("IDENTITY_DIMENSIONS = las 4 dimensiones, metaSnapshotVersion al final", () => {
    expect([...IDENTITY_DIMENSIONS]).toEqual([
      "datasetVersion",
      "evaluationProtocolVersion",
      "scoringModelFamily",
      "metaSnapshotVersion",
    ]);
  });

  test("isMetaSnapshotVersion — `meta1:` + 64 hex minúsculas", () => {
    expect(isMetaSnapshotVersion(META_A)).toBe(true);
    expect(isMetaSnapshotVersion("meta1:" + "A".repeat(64))).toBe(false);
    expect(isMetaSnapshotVersion("meta1:" + "a".repeat(63))).toBe(false);
    expect(isMetaSnapshotVersion("sha256:" + "a".repeat(64))).toBe(false);
    expect(isMetaSnapshotVersion(null)).toBe(false);
  });
});

describe("extractEvaluationIdentity — explicit / legacy / missing", () => {
  test("bloque `identity` explícito con las 4 claves -> source explicit", () => {
    const raw = {
      identity: {
        datasetVersion: "golden:v2",
        evaluationProtocolVersion: "protocol:v3",
        scoringModelFamily: "SCORING_WEIGHTS_V6",
        metaSnapshotVersion: META_A,
      },
    };
    const e = extractEvaluationIdentity(raw);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.source).toBe("explicit");
    expect(e.identity.datasetVersion).toBe("golden:v2");
    expect(e.identity.metaSnapshotVersion).toBe(META_A);
  });

  test("bloque `identity` explícito SIN metaSnapshotVersion -> tolerante, queda null (HISTORICAL para ese lado)", () => {
    const e = extractEvaluationIdentity({
      identity: {
        datasetVersion: "d",
        evaluationProtocolVersion: "p",
        scoringModelFamily: "SCORING_WEIGHTS_V6",
      },
    });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.identity.metaSnapshotVersion).toBeNull();
  });

  test("bloque `identity` explícito con metaSnapshotVersion: null -> null explícito", () => {
    const e = extractEvaluationIdentity({
      identity: {
        datasetVersion: "d",
        evaluationProtocolVersion: "p",
        scoringModelFamily: "SCORING_WEIGHTS_V6",
        metaSnapshotVersion: null,
      },
    });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.identity.metaSnapshotVersion).toBeNull();
  });

  test("bloque `identity` incompleto -> cae a legacy si hay campos, si no { ok:false }", () => {
    const e = extractEvaluationIdentity({ identity: { datasetVersion: "x" } });
    expect(e.ok).toBe(false);
  });

  test("artefacto legacy (v6-measured.json) -> identidad derivada; metaSnapshotVersion SIEMPRE null (Req 2A.2 c8)", () => {
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
      evaluationProtocolVersion: "schema:1;patchOverride:dominant",
      scoringModelFamily: LEGACY_SCORING_MODEL_FAMILY,
      metaSnapshotVersion: null,
    });
    // el valor concreto de patchOverride del artefacto legacy NO entra en la identidad
    expect(e.identity.evaluationProtocolVersion).not.toContain("7.41e");
    // commit / snapshotSyncedAt: metadata informativa, NUNCA identidad.
    expect(e.metadata.commit).toBe("e0b77d781a664be86258546e906505ad1687c9cf");
    expect(e.metadata.snapshotSyncedAt).toBe("2026-08-29T17:26:34.894Z");
    expect(canonicalEvaluationIdentity(e.identity)).not.toContain("e0b77d");
  });

  test("8b — legacy S0 extraído vs candidate S1 explícito -> isComparable falso / BLOCKED", () => {
    const legacyRaw = { schemaVersion: 1, splitHash: "02dc8878", patchOverride: "7.41e", corpusSize: { goldenCases: 30 } };
    const s1Raw = {
      identity: {
        datasetVersion: "split:02dc8878;golden:30",
        evaluationProtocolVersion: "schema:1;patchOverride:dominant",
        scoringModelFamily: "SCORING_WEIGHTS_V6",
        metaSnapshotVersion: META_A,
      },
    };
    const legacy = extractEvaluationIdentity(legacyRaw);
    const s1 = extractEvaluationIdentity(s1Raw);
    expect(legacy.ok && s1.ok).toBe(true);
    if (!legacy.ok || !s1.ok) return;
    const d = isComparable(s1.identity, legacy.identity);
    expect(d.comparable).toBe(false);
    expect(d.historicalReferenceS0).toBe(true);
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

  test("patchOverride AUSENTE de la raíz -> no se deriva legacy", () => {
    expect(extractEvaluationIdentity({ schemaVersion: 1, splitHash: "abc" }).ok).toBe(false);
  });

  test("patchOverride:null sigue siendo un marcador legítimo -> se deriva (protocolo = regla dominante)", () => {
    const e = extractEvaluationIdentity({
      schemaVersion: 1,
      splitHash: "abc",
      patchOverride: null,
      corpusSize: { goldenCases: 30 },
    });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.identity.evaluationProtocolVersion).toBe("schema:1;patchOverride:dominant");
    expect(e.identity.metaSnapshotVersion).toBeNull();
  });

  test("goldenCases ausente -> datasetVersion usa el marcador '?', sigue derivando", () => {
    const e = extractEvaluationIdentity({ schemaVersion: 1, splitHash: "abc", patchOverride: "p" });
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.identity.datasetVersion).toBe("split:abc;golden:?");
  });

  test("procedencia: measuredEngineCommit y evaluationHarnessCommit se leen como metadata, distintos entre sí", () => {
    const raw = {
      identity: {
        datasetVersion: "d",
        evaluationProtocolVersion: "p",
        scoringModelFamily: "SCORING_WEIGHTS_V6",
        metaSnapshotVersion: META_A,
      },
      provenance: {
        measuredEngineCommit: "df354b9c4ed415b86dba35dc92e2f84e5cb40e5d",
        evaluationHarnessCommit: "6498dea65f95b207d3997249f6fc60c1f1224ed1",
        snapshotFileSha: "f".repeat(64),
      },
    };
    const e = extractEvaluationIdentity(raw);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(e.metadata.measuredEngineCommit).toBe("df354b9c4ed415b86dba35dc92e2f84e5cb40e5d");
    expect(e.metadata.evaluationHarnessCommit).toBe("6498dea65f95b207d3997249f6fc60c1f1224ed1");
    expect(e.metadata.measuredEngineCommit).not.toBe(e.metadata.evaluationHarnessCommit);
    expect(e.metadata.snapshotFileSha).toBe("f".repeat(64));
    // 10 — procedencia NO participa en la identidad
    expect(canonicalEvaluationIdentity(e.identity)).not.toContain("df354b9");
    expect(canonicalEvaluationIdentity(e.identity)).not.toContain("6498dea");
  });

  test("ACTIVE_SCORING_MODEL_FAMILY == LEGACY_SCORING_MODEL_FAMILY (una sola fuente de verdad)", () => {
    expect(ACTIVE_SCORING_MODEL_FAMILY).toBe("SCORING_WEIGHTS_V6");
    expect(LEGACY_SCORING_MODEL_FAMILY).toBe(ACTIVE_SCORING_MODEL_FAMILY);
  });
});

// El candado ARQUITECTÓNICO de Task 9: la comparabilidad describe el PROTOCOLO + el CONTENIDO DE
// META, no el código. Un candidate de código nuevo (otro commit) contra la referencia aceptada
// anterior SOBRE EL MISMO S1 SIGUE siendo comparable — el binding por `engineSourceHash == HEAD`
// está retirado y no vuelve.
describe("cambio de código NO invalida un baseline (inconsistencia #4 / regla arquitectónica)", () => {
  const referenceRaw = {
    identity: {
      datasetVersion: "split:02dc8878;golden:30",
      evaluationProtocolVersion: "schema:1;patchOverride:dominant",
      scoringModelFamily: "SCORING_WEIGHTS_V6",
      metaSnapshotVersion: META_A,
    },
    provenance: { measuredEngineCommit: "e0b77d781a664be86258546e906505ad1687c9cf" },
  };
  const candidateRaw = {
    identity: {
      datasetVersion: "split:02dc8878;golden:30",
      evaluationProtocolVersion: "schema:1;patchOverride:dominant",
      scoringModelFamily: "SCORING_WEIGHTS_V6",
      metaSnapshotVersion: META_A,
    },
    provenance: { measuredEngineCommit: "df354b9aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" },
  };

  test("5 — distinto measuredEngineCommit + MISMA EvaluationIdentity (mismo S1) -> comparable", () => {
    const rf = extractEvaluationIdentity(referenceRaw);
    const cf = extractEvaluationIdentity(candidateRaw);
    expect(rf.ok && cf.ok).toBe(true);
    if (!rf.ok || !cf.ok) return;
    expect(isComparable(cf.identity, rf.identity).comparable).toBe(true);
    expect(cf.metadata.measuredEngineCommit).not.toBe(rf.metadata.measuredEngineCommit);
    expect(canonicalEvaluationIdentity(cf.identity)).toBe(canonicalEvaluationIdentity(rf.identity));
  });

  test("EvaluationIdentity expone EXACTAMENTE 4 dimensiones — ningún campo de commit/hash/fileSha", () => {
    const e = extractEvaluationIdentity(referenceRaw);
    expect(e.ok).toBe(true);
    if (!e.ok) return;
    expect(Object.keys(e.identity).sort()).toEqual([
      "datasetVersion",
      "evaluationProtocolVersion",
      "metaSnapshotVersion",
      "scoringModelFamily",
    ]);
  });
});
