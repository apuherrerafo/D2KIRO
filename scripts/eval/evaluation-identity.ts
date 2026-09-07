// R0.2A — Task 9 (spec `.kiro/specs/r0-engineering-baseline-recovery/`):
//   Modelo de baseline COMPARABLE. Hoy dos resultados numéricos (`v6-measured.json` y un
//   candidate) traen las mismas métricas (NDCG@5, Bad Pick Rate@5, Recall@k, MRR…) y el gate
//   los compara punto por punto SIN preguntarse si fueron producidos bajo las mismas
//   condiciones. "Los dos tienen NDCG@5" ≠ "los dos son legítimamente comparables".
//
//   `EvaluationIdentity` describe el PROTOCOLO DE EVALUACIÓN, no el código evaluado:
//     - datasetVersion            — identidad del Golden Dataset + split congelado usado.
//     - evaluationProtocolVersion — versión del protocolo: schema de métricas, tolerancias,
//                                   bootstrap, patchOverride del reconstructor de replay.
//     - scoringModelFamily        — familia de pesos ACTIVA (p.ej. "SCORING_WEIGHTS_V6").
//                                   Es una constante versionada por nombre, NUNCA un hash de HEAD.
//
//   `isComparable(candidate, reference)` decide si el gate puede juzgar regresión/mejora:
//   sólo cuando dataset + protocolo coinciden y la familia de scoring es comparable. La
//   comparabilidad NO se decide por diferencia de hash de commit — eso destruiría la utilidad
//   de un baseline (queremos comparar código NUEVO contra una referencia ACEPTADA anterior).
//
//   Diseño §4.2 LLD (`EvaluationIdentity`, `ReferenceBaseline`, `Candidate`, `isComparable`,
//   inconsistencia #4); requisito 2A.2; CP8 parte A. Módulo puro: sin I/O, sin reloj, sin red.

/** Identidad de comparabilidad de una corrida de evaluación (design §4.2). */
export interface EvaluationIdentity {
  /** Identidad del Golden Dataset + split congelado (NO el conteo de filas — eso es metadata). */
  datasetVersion: string;
  /** Versión del protocolo: métricas, tolerancias, bootstrap, patchOverride del replay. */
  evaluationProtocolVersion: string;
  /** Familia de pesos activa, p.ej. "SCORING_WEIGHTS_V6". Constante por nombre, NO un hash. */
  scoringModelFamily: string;
}

/** Las tres dimensiones que forman la identidad — el orden es el canónico de serialización. */
export const IDENTITY_DIMENSIONS = [
  "datasetVersion",
  "evaluationProtocolVersion",
  "scoringModelFamily",
] as const;

export type IdentityDimension = (typeof IDENTITY_DIMENSIONS)[number];

/**
 * Metadata informativa de una corrida — útil para auditoría, NUNCA parte de `isComparable()`.
 * `commit` / `acceptedAtCommit` / `headCommit` describen el CÓDIGO evaluado; `snapshotSyncedAt`
 * y `generatedAt` son efímeros. Ninguno decide si dos resultados son comparables.
 */
export interface EvaluationMetadata {
  /** `ReferenceBaseline.acceptedAtCommit` — commit en que se aceptó/promovió el baseline. */
  acceptedAtCommit?: string;
  /** `Candidate.headCommit` — commit HEAD que produjo el candidate. */
  headCommit?: string;
  /** Commit crudo del artefacto legacy (`v6-measured.json.commit`). */
  commit?: string;
  /** Timestamp del último sync de meta (efímero). */
  snapshotSyncedAt?: string | null;
  /** Conteos del corpus — informativos; la IDENTIDAD del dataset es `datasetVersion`. */
  corpusSize?: Record<string, number>;
}

/**
 * Decisión estructurada de comparabilidad. `comparable` es el booleano del pseudocódigo del
 * diseño; `mismatchedDimensions` dice QUÉ dimensión difiere (auditoría); `reason` lleva el
 * motivo exacto del Spec cuando no son comparables.
 */
export interface ComparabilityDecision {
  comparable: boolean;
  mismatchedDimensions: IdentityDimension[];
  /** "" cuando `comparable`; contiene el motivo exacto del Spec cuando no. */
  reason: string;
}

/** Motivo exacto del Spec (requisito 2A.2 c3 / design §4.2) cuando `isComparable` es falso. */
export const INCOMPARABLE_REASON = "baseline incomparable: dataset/protocol mismatch";

/**
 * Familia de scoring asumida para un artefacto LEGACY que no la declara. Derivada, no leída:
 * `invariantes.md` fija `SCORING_WEIGHTS_V6` como la versión activa y el baseline se llama
 * `v6-measured.json`. Un candidate producido por el mismo `run.ts` (que tampoco la emite) recibe
 * la misma constante ⇒ siguen siendo comparables. Cuando un `run.ts` futuro emita un bloque
 * `identity.scoringModelFamily` explícito, `extractEvaluationIdentity` lo prefiere sobre esto.
 */
export const LEGACY_SCORING_MODEL_FAMILY = "SCORING_WEIGHTS_V6";

function norm(value: string): string {
  return value.trim();
}

/**
 * Forma canónica, determinista y serializable de una identidad: JSON con las claves en el orden
 * fijo de `IDENTITY_DIMENSIONS` y los valores recortados. Sin timestamps ni valores efímeros —
 * dos identidades equivalentes producen el MISMO string, apto para almacenar/loguear/comparar.
 */
export function canonicalEvaluationIdentity(identity: EvaluationIdentity): string {
  return JSON.stringify({
    datasetVersion: norm(identity.datasetVersion),
    evaluationProtocolVersion: norm(identity.evaluationProtocolVersion),
    scoringModelFamily: norm(identity.scoringModelFamily),
  });
}

export function evaluationIdentityEquals(a: EvaluationIdentity, b: EvaluationIdentity): boolean {
  return canonicalEvaluationIdentity(a) === canonicalEvaluationIdentity(b);
}

/**
 * ¿Son comparables dos familias de scoring? Hoy: igualdad exacta por nombre. El Spec NO define
 * una red de compatibilidad entre familias ("NO debe cambiar: la familia de scoring es una
 * constante de pesos activa"), así que no se inventa una. Función nombrada para que un futuro
 * conjunto de compatibilidad sea un cambio de una línea, con evidencia, fuera de R0.
 */
export function scoringFamiliesComparable(a: string, b: string): boolean {
  return norm(a) === norm(b);
}

/**
 * ¿Puede el gate juzgar regresión/mejora entre `candidate` y `reference`? (design §4.2)
 *
 * Comparable ⇔ mismo `datasetVersion` + mismo `evaluationProtocolVersion` + familia de scoring
 * comparable. NUNCA se decide por diferencia de hash de commit: un candidate de código nuevo
 * (otro commit) contra una referencia aceptada anterior DEBE seguir siendo comparable.
 *
 * Orden de argumentos igual que el pseudocódigo del diseño: `isComparable(candidate, reference)`.
 */
export function isComparable(
  candidate: EvaluationIdentity,
  reference: EvaluationIdentity,
): ComparabilityDecision {
  const mismatchedDimensions: IdentityDimension[] = [];

  if (norm(candidate.datasetVersion) !== norm(reference.datasetVersion)) {
    mismatchedDimensions.push("datasetVersion");
  }
  if (norm(candidate.evaluationProtocolVersion) !== norm(reference.evaluationProtocolVersion)) {
    mismatchedDimensions.push("evaluationProtocolVersion");
  }
  if (!scoringFamiliesComparable(candidate.scoringModelFamily, reference.scoringModelFamily)) {
    mismatchedDimensions.push("scoringModelFamily");
  }

  if (mismatchedDimensions.length === 0) {
    return { comparable: true, mismatchedDimensions, reason: "" };
  }
  return {
    comparable: false,
    mismatchedDimensions,
    reason: `${INCOMPARABLE_REASON} (${mismatchedDimensions.join(", ")})`,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Extracción / legacy handling
// ─────────────────────────────────────────────────────────────────────────────

/** Resultado de intentar establecer la identidad de un artefacto de baseline. */
export type IdentityExtraction =
  | { ok: true; identity: EvaluationIdentity; source: "explicit" | "legacy"; metadata: EvaluationMetadata }
  | { ok: false; reason: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function readExplicitIdentity(raw: Record<string, unknown>): EvaluationIdentity | null {
  const block = raw.identity;
  if (!isRecord(block)) return null;
  const datasetVersion = nonEmptyString(block.datasetVersion);
  const evaluationProtocolVersion = nonEmptyString(block.evaluationProtocolVersion);
  const scoringModelFamily = nonEmptyString(block.scoringModelFamily);
  if (!datasetVersion || !evaluationProtocolVersion || !scoringModelFamily) return null;
  return { datasetVersion, evaluationProtocolVersion, scoringModelFamily };
}

/**
 * Deriva la identidad de un artefacto LEGACY (`v6-measured.json` de Fase 9.0/9.1, sin bloque
 * `identity`) a partir de los campos históricos que sí describen el protocolo:
 *   - datasetVersion            ← `splitHash` + `corpusSize.goldenCases`
 *   - evaluationProtocolVersion ← `schemaVersion` + `patchOverride`
 *   - scoringModelFamily        ← constante `LEGACY_SCORING_MODEL_FAMILY` (documentada)
 *
 * NO reescribe el archivo (regla (a): baselines aceptados no se editan). Es un adaptador de
 * lectura — "fallback explícito". Devuelve `null` si falta un campo histórico obligatorio: el
 * llamador BLOQUEA (nunca PASS silencioso).
 */
function deriveLegacyIdentity(raw: Record<string, unknown>): EvaluationIdentity | null {
  const splitHash = nonEmptyString(raw.splitHash);
  const schemaVersion = raw.schemaVersion;
  // `patchOverride` puede ser un string ("7.41e") o `null` (dominantPatch no resolvió) — ambos
  // son parte legítima del protocolo y deben distinguirse.
  const hasPatchOverride = "patchOverride" in raw;
  if (!splitHash || typeof schemaVersion !== "number" || !hasPatchOverride) return null;

  const goldenCases =
    isRecord(raw.corpusSize) && typeof raw.corpusSize.goldenCases === "number"
      ? raw.corpusSize.goldenCases
      : null;
  const patchOverride = raw.patchOverride === null ? "null" : nonEmptyString(raw.patchOverride);
  if (patchOverride === null) return null;

  return {
    datasetVersion: `split:${splitHash};golden:${goldenCases ?? "?"}`,
    evaluationProtocolVersion: `schema:${schemaVersion};patch:${patchOverride}`,
    scoringModelFamily: LEGACY_SCORING_MODEL_FAMILY,
  };
}

function readMetadata(raw: Record<string, unknown>): EvaluationMetadata {
  const md: EvaluationMetadata = {};
  const identityBlock = isRecord(raw.identity) ? raw.identity : undefined;
  const acceptedAtCommit = nonEmptyString(identityBlock?.acceptedAtCommit) ?? nonEmptyString(raw.acceptedAtCommit);
  const headCommit = nonEmptyString(identityBlock?.headCommit) ?? nonEmptyString(raw.headCommit);
  const commit = nonEmptyString(raw.commit);
  if (acceptedAtCommit) md.acceptedAtCommit = acceptedAtCommit;
  if (headCommit) md.headCommit = headCommit;
  if (commit) md.commit = commit;
  if (raw.snapshotSyncedAt === null || typeof raw.snapshotSyncedAt === "string") {
    md.snapshotSyncedAt = raw.snapshotSyncedAt;
  }
  if (isRecord(raw.corpusSize)) {
    const counts: Record<string, number> = {};
    for (const [k, v] of Object.entries(raw.corpusSize)) if (typeof v === "number") counts[k] = v;
    md.corpusSize = counts;
  }
  return md;
}

/**
 * Establece la `EvaluationIdentity` de un artefacto de baseline ya parseado (`JSON.parse`).
 * Prefiere un bloque `identity` explícito (lo que escribirá la promoción de R0.2B / Task 19-20);
 * si no existe, deriva la identidad legacy de los campos históricos. `null` de entrada, forma
 * inesperada, o falta de un campo legacy obligatorio ⇒ `{ ok: false }` — el gate BLOQUEA.
 */
export function extractEvaluationIdentity(raw: unknown): IdentityExtraction {
  if (!isRecord(raw)) {
    return { ok: false, reason: "artefacto de baseline ilegible (no es un objeto JSON)" };
  }
  const metadata = readMetadata(raw);

  const explicit = readExplicitIdentity(raw);
  if (explicit) return { ok: true, identity: explicit, source: "explicit", metadata };

  const legacy = deriveLegacyIdentity(raw);
  if (legacy) return { ok: true, identity: legacy, source: "legacy", metadata };

  return {
    ok: false,
    reason:
      "baseline sin EvaluationIdentity: no hay bloque `identity` explícito y faltan campos legacy " +
      "(`splitHash`, `schemaVersion`, `patchOverride`) para derivarla",
  };
}
