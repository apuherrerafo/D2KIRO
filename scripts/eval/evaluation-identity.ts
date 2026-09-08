// R0.2A — Task 9 + R0.2B — Task 34 (spec `.kiro/specs/r0-engineering-baseline-recovery/`):
//   Modelo de baseline COMPARABLE. Hoy dos resultados numéricos (`v6-measured.json` y un
//   candidate) traen las mismas métricas (NDCG@5, Bad Pick Rate@5, Recall@k, MRR…) y el gate
//   los compara punto por punto SIN preguntarse si fueron producidos bajo las mismas
//   condiciones. "Los dos tienen NDCG@5" ≠ "los dos son legítimamente comparables".
//
//   `EvaluationIdentity` describe el PROTOCOLO DE EVALUACIÓN + el CONTENIDO DE META, no el
//   código evaluado:
//     - datasetVersion            — identidad del Golden Dataset + split congelado usado.
//     - evaluationProtocolVersion — versión del protocolo: schema de métricas, tolerancias,
//                                   bootstrap. Codifica la REGLA `patchOverride:dominant`
//                                   (Task 34, Req 2A.2 c9), NUNCA un patch concreto como "7.41e".
//     - scoringModelFamily        — familia de pesos ACTIVA (p.ej. "SCORING_WEIGHTS_V6").
//                                   Es una constante versionada por nombre, NUNCA un hash de HEAD.
//     - metaSnapshotVersion       — huella de CONTENIDO LÓGICO de los inputs de `loadMeta`
//                                   (`meta1:<sha256 completo>`; ver `snapshot.ts`). `null` ⇒ el
//                                   artefacto es `HISTORICAL_REFERENCE_S0` (el snapshot de meta
//                                   de S0 está perdido) y NO tiene identidad de meta legítima.
//                                   NUNCA se fabrica: un artefacto legacy sin huella se queda con
//                                   `null` (Task 34, Req 2A.2 c8).
//
//   `isComparable(candidate, reference)` decide si el gate puede juzgar regresión/mejora:
//   sólo cuando dataset + protocolo + `metaSnapshotVersion` coinciden y la familia de scoring es
//   comparable. La comparabilidad NO se decide por diferencia de hash de commit
//   (`measuredEngineCommit` / `evaluationHarnessCommit`) ni por `snapshotFileSha` (SHA CRUDO del
//   archivo SQLite) — eso destruiría la utilidad de un baseline (queremos comparar código NUEVO
//   contra una referencia ACEPTADA anterior sobre el MISMO S1).
//
//   Diseño §4.2 LLD (`EvaluationIdentity`, `EvaluationMetadata`, `ReferenceBaseline`,
//   `Candidate`, `isComparable`, inconsistencias #4/#7/#8/#9); requisitos 2A.2 / 2B.3; CP8.
//   Módulo puro: sin I/O, sin reloj, sin red.

/** Identidad de comparabilidad de una corrida de evaluación (design §4.2). */
export interface EvaluationIdentity {
  /** Identidad del Golden Dataset + split congelado (NO el conteo de filas — eso es metadata). */
  datasetVersion: string;
  /**
   * Versión del protocolo: métricas, tolerancias, bootstrap. Codifica la REGLA
   * `patchOverride:dominant` (Task 34, Req 2A.2 c9), NUNCA un valor de patch concreto — el
   * contenido concreto de meta lo guarda `metaSnapshotVersion`.
   */
  evaluationProtocolVersion: string;
  /** Familia de pesos activa, p.ej. "SCORING_WEIGHTS_V6". Constante por nombre, NO un hash. */
  scoringModelFamily: string;
  /**
   * Huella de contenido lógico del snapshot de meta (`meta1:<sha256 completo>`; ver
   * `snapshot.ts`). `null` ⇒ `HISTORICAL_REFERENCE_S0` (snapshot de meta de S0 perdido): sin
   * identidad de meta legítima, NO comparable contra un candidate sobre S1. NUNCA se fabrica.
   */
  metaSnapshotVersion: string | null;
}

/** Prefijo obligatorio de una huella lógica de meta. SHA-256 COMPLETO (64 hex), nunca truncado. */
export const META_SNAPSHOT_VERSION_PREFIX = "meta1:";

/** ¿`value` es una huella lógica de meta bien formada (`meta1:` + 64 hex minúsculas)? */
export function isMetaSnapshotVersion(value: unknown): value is string {
  return typeof value === "string" && /^meta1:[0-9a-f]{64}$/.test(value);
}

/**
 * Las dimensiones que forman la identidad — el orden es el canónico de serialización.
 * `metaSnapshotVersion` (Task 34) va al final: se agregó después de las otras tres.
 */
export const IDENTITY_DIMENSIONS = [
  "datasetVersion",
  "evaluationProtocolVersion",
  "scoringModelFamily",
  "metaSnapshotVersion",
] as const;

export type IdentityDimension = (typeof IDENTITY_DIMENSIONS)[number];

/**
 * Metadata / PROCEDENCIA de una corrida — útil para auditoría, NUNCA parte de `isComparable()`.
 * `measuredEngineCommit` / `evaluationHarnessCommit` / `snapshotFileSha` describen QUÉ motor,
 * QUÉ harness y QUÉ archivo produjeron la corrida; `commit` / `acceptedAtCommit` / `headCommit`
 * son campos históricos del mismo espíritu; `snapshotSyncedAt` / `generatedAt` son efímeros.
 * Ninguno decide si dos resultados son comparables (Task 34, Req 2A.2 c6/c7).
 */
export interface EvaluationMetadata {
  /**
   * Commit fuente de `apps/engine/src/**` REALMENTE medido. NO se infiere de `git rev-parse HEAD`
   * (Req 2A.2 c7): para `REBASED_REFERENCE(S1)` es `df354b9…` (overlay), para
   * `CURRENT_CANDIDATE(S1)` normalmente el HEAD limpio. Procedencia, NO identidad.
   */
  measuredEngineCommit?: string;
  /** Commit del harness de evaluación (`scripts/eval/**`) que corrió. Procedencia, NO identidad. */
  evaluationHarnessCommit?: string;
  /** SHA-256 CRUDO de `S1.sqlite` — tamper/procedencia. NUNCA participa en `isComparable()`. */
  snapshotFileSha?: string;
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
 * motivo exacto del Spec cuando no son comparables; `historicalReferenceS0` marca el caso
 * de una identidad de snapshot DESCONOCIDA (Task 34, Req 2A.2 c8).
 */
export interface ComparabilityDecision {
  comparable: boolean;
  mismatchedDimensions: IdentityDimension[];
  /** "" cuando `comparable`; contiene el motivo exacto del Spec cuando no. */
  reason: string;
  /**
   * `true` ⇔ AL MENOS un lado carece de `metaSnapshotVersion` concreto — incluido `null` en
   * AMBOS lados. Una identidad de snapshot desconocida NUNCA es prueba de igualdad (Task 34,
   * fail-closed / C2): `null` vs `null` es tan incomparable como `null` vs `meta1:…`.
   */
  historicalReferenceS0: boolean;
}

/**
 * Motivo base del Spec (requisito 2A.2 c3 / design §4.2) cuando `isComparable` es falso. El
 * literal se mantiene ESTABLE (el gate y sus pruebas lo consumen por prefijo); las dimensiones
 * en conflicto — incluida `metaSnapshotVersion` — se anexan entre paréntesis, y el caso
 * `HISTORICAL_REFERENCE_S0` agrega su propia cláusula explicativa (ver `HISTORICAL_REFERENCE_S0_REASON`).
 */
export const INCOMPARABLE_REASON = "baseline incomparable: dataset/protocol mismatch";

/**
 * Cláusula que se anexa a `reason` cuando exactamente un lado no tiene `metaSnapshotVersion`
 * (artefacto `HISTORICAL_REFERENCE_S0`): el snapshot de meta de S0 está perdido, así que sus
 * métricas numéricas no son directamente comparables con las de un candidate sobre S1. La
 * regresión de motor SÍ se recupera re-corriendo el motor VIEJO y el ACTUAL sobre el mismo S1.
 */
export const HISTORICAL_REFERENCE_S0_REASON =
  "HISTORICAL_REFERENCE_S0: el snapshot de meta de S0 está perdido; las métricas numéricas de S0 " +
  "no son comparables con un candidate sobre S1 — la regresión de motor se recupera re-corriendo " +
  "el motor VIEJO y el ACTUAL sobre el MISMO S1";

/**
 * Familia de pesos ACTIVA del motor (`invariantes.md`: "La activa hoy es `SCORING_WEIGHTS_V6`").
 * Constante versionada por nombre, NUNCA un hash de HEAD. `run.ts` la emite en su bloque
 * `identity` explícito.
 */
export const ACTIVE_SCORING_MODEL_FAMILY = "SCORING_WEIGHTS_V6";

/**
 * Familia de scoring asumida para un artefacto LEGACY que no la declara. Derivada, no leída:
 * `invariantes.md` fija `SCORING_WEIGHTS_V6` como la versión activa y el baseline se llama
 * `v6-measured.json`. Un candidate producido por el mismo `run.ts` (que ahora SÍ emite un bloque
 * `identity` explícito) recibe la misma constante ⇒ siguen siendo comparables en esa dimensión.
 */
export const LEGACY_SCORING_MODEL_FAMILY = ACTIVE_SCORING_MODEL_FAMILY;

/**
 * `evaluationProtocolVersion` que se deriva para un artefacto legacy. Task 34 / Req 2A.2 c9: el
 * protocolo codifica la REGLA `patchOverride:dominant`, NO el valor concreto de patch que el
 * artefacto legacy guardó en `patchOverride` (p.ej. "7.41e"). Ese valor pasa a ser procedencia
 * del snapshot (`patchLabel` en el manifiesto de S1), nunca identidad.
 */
export const LEGACY_PROTOCOL_PATCH_RULE = "patchOverride:dominant";

function norm(value: string): string {
  return value.trim();
}

function normMeta(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const t = value.trim();
  return t.length > 0 ? t : null;
}

/**
 * Forma canónica, determinista y serializable de una identidad: JSON con las claves en el orden
 * fijo de `IDENTITY_DIMENSIONS` y los valores recortados. `metaSnapshotVersion` se serializa con
 * manejo EXPLÍCITO de `null` (no se omite la clave). Sin timestamps ni valores efímeros — dos
 * identidades equivalentes producen el MISMO string, apto para almacenar/loguear/comparar.
 */
export function canonicalEvaluationIdentity(identity: EvaluationIdentity): string {
  return JSON.stringify({
    datasetVersion: norm(identity.datasetVersion),
    evaluationProtocolVersion: norm(identity.evaluationProtocolVersion),
    scoringModelFamily: norm(identity.scoringModelFamily),
    metaSnapshotVersion: normMeta(identity.metaSnapshotVersion),
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
 * Comparable ⇔ mismo `datasetVersion` + mismo `evaluationProtocolVersion` + mismo
 * `metaSnapshotVersion` + familia de scoring comparable. NUNCA se decide por diferencia de hash
 * de commit ni por `snapshotFileSha`: un candidate de código nuevo (otro commit) contra una
 * referencia aceptada anterior sobre el MISMO S1 DEBE seguir siendo comparable.
 *
 * `metaSnapshotVersion` (Task 34 — FAIL CLOSED / C2): una identidad de snapshot DESCONOCIDA
 * nunca es prueba de igualdad.
 *   - CUALQUIER lado `null` ⇒ NO comparable (`historicalReferenceS0`), incluido `null` vs `null`.
 *     No hay ningún camino en el que `null` "coincida": dos artefactos pre-S1 sin huella tampoco
 *     se pueden comparar entre sí — no sabemos si midieron sobre el mismo meta.
 *   - ambos con huella concreta e IGUAL ⇒ la dimensión de snapshot coincide.
 *   - ambos con huella concreta y DISTINTA ⇒ NO comparable.
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

  const candMeta = normMeta(candidate.metaSnapshotVersion);
  const refMeta = normMeta(reference.metaSnapshotVersion);
  // FAIL CLOSED (Task 34 / C2): identidad de snapshot desconocida NUNCA prueba igualdad. Si
  // cualquiera de los dos lados no trae una huella `meta1:…` concreta — `null` vs `null` incluido —
  // la dimensión de snapshot NO puede darse por coincidente.
  const eitherSideMissingMeta = candMeta === null || refMeta === null;
  const bothConcreteButDiffer = candMeta !== null && refMeta !== null && candMeta !== refMeta;
  if (eitherSideMissingMeta || bothConcreteButDiffer) {
    mismatchedDimensions.push("metaSnapshotVersion");
  }

  if (mismatchedDimensions.length === 0) {
    return { comparable: true, mismatchedDimensions, reason: "", historicalReferenceS0: false };
  }
  let reason = `${INCOMPARABLE_REASON} (${mismatchedDimensions.join(", ")})`;
  if (eitherSideMissingMeta) reason += ` — ${HISTORICAL_REFERENCE_S0_REASON}`;
  return {
    comparable: false,
    mismatchedDimensions,
    reason,
    historicalReferenceS0: eitherSideMissingMeta,
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
  // `metaSnapshotVersion` es parte del contrato explícito (Task 34). Tolerante: la clave ausente
  // o `null` ⇒ `null` (HISTORICAL_REFERENCE_S0 para ese lado), nunca se fabrica una huella.
  const rawMeta = block.metaSnapshotVersion;
  const metaSnapshotVersion = rawMeta === null || rawMeta === undefined ? null : nonEmptyString(rawMeta);
  return { datasetVersion, evaluationProtocolVersion, scoringModelFamily, metaSnapshotVersion };
}

/**
 * Deriva la identidad de un artefacto LEGACY (`v6-measured.json` de Fase 9.0/9.1, sin bloque
 * `identity`) a partir de los campos históricos que sí describen el protocolo:
 *   - datasetVersion            ← `splitHash` + `corpusSize.goldenCases`
 *   - evaluationProtocolVersion ← `schemaVersion` + la REGLA `patchOverride:dominant`
 *                                 (Task 34 / Req 2A.2 c9: NUNCA el valor concreto de `patchOverride`)
 *   - scoringModelFamily        ← constante `LEGACY_SCORING_MODEL_FAMILY` (documentada)
 *   - metaSnapshotVersion       ← `null` SIEMPRE (Task 34 / Req 2A.2 c8: el snapshot de meta de S0
 *                                 está perdido y NO se fabrica una huella para él ⇒
 *                                 `HISTORICAL_REFERENCE_S0`, incomparable contra un candidate sobre S1)
 *
 * NO reescribe el archivo (regla (a): baselines aceptados no se editan). Es un adaptador de
 * lectura — "fallback explícito". Devuelve `null` si falta un campo histórico obligatorio: el
 * llamador BLOQUEA (nunca PASS silencioso).
 */
function deriveLegacyIdentity(raw: Record<string, unknown>): EvaluationIdentity | null {
  const splitHash = nonEmptyString(raw.splitHash);
  const schemaVersion = raw.schemaVersion;
  // `patchOverride` (string "7.41e" o `null`) es un marcador de "esto salió del pipeline de eval";
  // su VALOR ya no entra en la identidad (Req 2A.2 c9), pero su presencia se sigue exigiendo para
  // no derivar identidad de un JSON cualquiera.
  const hasPatchOverride = "patchOverride" in raw;
  if (!splitHash || typeof schemaVersion !== "number" || !hasPatchOverride) return null;

  const goldenCases =
    isRecord(raw.corpusSize) && typeof raw.corpusSize.goldenCases === "number"
      ? raw.corpusSize.goldenCases
      : null;

  return {
    datasetVersion: `split:${splitHash};golden:${goldenCases ?? "?"}`,
    evaluationProtocolVersion: `schema:${schemaVersion};${LEGACY_PROTOCOL_PATCH_RULE}`,
    scoringModelFamily: LEGACY_SCORING_MODEL_FAMILY,
    metaSnapshotVersion: null,
  };
}

function readMetadata(raw: Record<string, unknown>): EvaluationMetadata {
  const md: EvaluationMetadata = {};
  const identityBlock = isRecord(raw.identity) ? raw.identity : undefined;
  const provenanceBlock = isRecord(raw.provenance) ? raw.provenance : undefined;

  const pick = (key: string): string | null =>
    nonEmptyString(provenanceBlock?.[key]) ??
    nonEmptyString(identityBlock?.[key]) ??
    nonEmptyString(raw[key]);

  const measuredEngineCommit = pick("measuredEngineCommit");
  const evaluationHarnessCommit = pick("evaluationHarnessCommit");
  const snapshotFileSha = pick("snapshotFileSha");
  const acceptedAtCommit = pick("acceptedAtCommit");
  const headCommit = pick("headCommit");
  const commit = nonEmptyString(raw.commit);

  if (measuredEngineCommit) md.measuredEngineCommit = measuredEngineCommit;
  if (evaluationHarnessCommit) md.evaluationHarnessCommit = evaluationHarnessCommit;
  if (snapshotFileSha) md.snapshotFileSha = snapshotFileSha;
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
 * Prefiere un bloque `identity` explícito (lo que escribe `run.ts` a partir de Task 34 y la
 * promoción de R0.2B / Task 19-20); si no existe, deriva la identidad legacy de los campos
 * históricos. `null` de entrada, forma inesperada, o falta de un campo legacy obligatorio ⇒
 * `{ ok: false }` — el gate BLOQUEA.
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
