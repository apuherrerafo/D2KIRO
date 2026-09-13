#!/usr/bin/env bun
// R0.2B -- Task 20a (spec `.kiro/specs/r0-engineering-baseline-recovery/`): promotion MECHANISM
// only. This file NEVER runs the real promotion -- it exists so that a future, separately
// approved Task 20b can call `promoteCandidate` with a real, explicit acceptance and know it is
// fail-closed, non-clobbering, and bound to the exact candidate that was reviewed.
//
// Design note -- why the LLD's `promoteCandidate(candidate, accepted: boolean)` is refined here:
// design.md 4.2 sketches promotion as gated by a bare `accepted` boolean. Requirement 2B.2 c2 only
// asks for "aceptación explícita (criterio explícito + acción deliberada)" and does not prescribe
// the exact shape of that acceptance -- there is (by design, per the Task 20 preflight) no single
// existing "Task 19 PASS" file to point at. Rather than inventing a new governance authority or
// accepting a free `approved = true` flag, this mechanism:
//   1. requires the caller to supply a `PromotionAcceptance` whose `approvedCandidateContentHash`
//      / `approvedReferenceContentHash` are canonical content hashes of the EXACT candidate and
//      REBASED_CONTROL reference bytes that were reviewed (never trusted by name/path alone);
//   2. independently RECOMPUTES the Task 19 gate verdict from the actual files on disk via the
//      same `runMandatoryGate` the real gate uses (imported, never re-implemented) -- so a
//      fabricated "PASS" claim in the acceptance object cannot promote a candidate that does not
//      really pass;
//   3. never derives any of candidate/reference/accepted/S1/split paths from an environment
//      variable -- they are fixed, root-relative constants, so a hostile parent environment has
//      nothing to redirect.
// This is strictly more conservative than the LLD sketch, never less -- it still refuses to
// promote automatically by being on HEAD or by `reference.s1.json` merely existing (requirement
// 2B.2 c3), and still requires an explicit, deliberate acceptance object (c1/c2).
//
// Canonical content hashing: this worktree's own `eval/baselines/candidate.s1.json` demonstrates
// the real hazard -- a Windows checkout can materialize the identical, byte-for-byte-identical
// Git blob with CRLF line endings, producing a DIFFERENT raw SHA-256 than the one measured on the
// LF checkout that produced the evidence. `canonicalContentHash` normalizes CRLF -> LF on the raw
// bytes (never via a string/encoding round-trip, so multi-byte UTF-8 content is untouched) before
// hashing, so approval bound to the canonical Git content survives either checkout's line endings
// without ever accepting a genuinely different artifact.

import { randomUUID, createHash } from "node:crypto";
import { constants, copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TASK19_CANDIDATE, TASK19_REFERENCE, TASK20_ACCEPTED } from "./current-engine-candidate";
import { evaluationIdentityEquals, extractEvaluationIdentity, type EvaluationIdentity } from "./evaluation-identity";
import { DEFAULT_TOL, runMandatoryGate, type FrozenBaseline } from "./gate";
import { EXPECTED_S1_IDENTITY, validateFrozenS1 } from "./rebased-reference";

export const S1_SNAPSHOT = "eval/snapshots/S1.sqlite";
export const S1_MANIFEST = "eval/snapshots/S1.manifest.json";
export const PRO_DRAFTS_DB = "apps/engine/data/pro-drafts.sqlite";

/** The literal reason required by requirement 2B.2 c1 when there is no explicit acceptance at all. */
export const NO_ACCEPTANCE_REASON = "sin aceptación explícita";

/**
 * What a deliberate, explicit promotion decision must carry. Every field is checked against the
 * real files on disk -- none of them is trusted by itself, and none of them is a bare boolean.
 */
export interface PromotionAcceptance {
  /** Canonical (CRLF-normalized) SHA-256 of the exact `candidate.s1.json` bytes that were reviewed. */
  approvedCandidateContentHash: string;
  /** Canonical SHA-256 of the exact `reference.s1.json` (REBASED_CONTROL) bytes measured against. */
  approvedReferenceContentHash: string;
  /** The `EvaluationIdentity` the approver reviewed -- cross-checked, never trusted in isolation. */
  approvedIdentity: EvaluationIdentity;
  /** Commit the PO is promoting at. Stamped into `accepted.s1.json.acceptedAtCommit` (req 2B.2/design §4.2). */
  acceptedAtCommit: string;
  /** Human identifier of who accepted. Audit-only: never used to decide whether to promote. */
  acceptedBy: string;
  /** ISO-8601 timestamp of the acceptance action. Audit-only. */
  acceptedAt: string;
}

export type PromotionResult =
  | { promoted: false; reason: string }
  | { promoted: true; acceptedPath: string };

interface PromotionPaths {
  candidate: string;
  reference: string;
  accepted: string;
  s1Snapshot: string;
  s1Manifest: string;
  proDraftsDb: string;
}

/** Fixed, root-relative paths only. Never derived from an environment variable -- nothing here is redirectable. */
export function promotionPaths(root: string): PromotionPaths {
  const resolvedRoot = resolve(root);
  return {
    candidate: join(resolvedRoot, TASK19_CANDIDATE),
    reference: join(resolvedRoot, TASK19_REFERENCE),
    accepted: join(resolvedRoot, TASK20_ACCEPTED),
    s1Snapshot: join(resolvedRoot, S1_SNAPSHOT),
    s1Manifest: join(resolvedRoot, S1_MANIFEST),
    proDraftsDb: join(resolvedRoot, PRO_DRAFTS_DB),
  };
}

/** Defense in depth: the four artifact paths must never collide with one another. */
export function assertPromotionPathsDistinct(paths: PromotionPaths): void {
  const distinct = new Set([paths.candidate, paths.reference, paths.accepted, paths.s1Snapshot, paths.s1Manifest]);
  if (distinct.size !== 5) throw new Error("Task 20a refuses ambiguous promotion paths (candidate/reference/accepted/S1 must all differ)");
}

/**
 * SHA-256 over the raw bytes with every `\r\n` collapsed to `\n`. Operates on the byte buffer
 * directly (never a string/encoding round-trip): ASCII CR/LF bytes never occur as part of a
 * multi-byte UTF-8 sequence, so this is safe for JSON containing non-ASCII text and never touches
 * a lone `\r` not immediately followed by `\n`.
 */
export function canonicalContentHash(bytes: Buffer): string {
  const normalized = Buffer.alloc(bytes.length);
  let o = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (bytes[i] === 0x0d && bytes[i + 1] === 0x0a) continue;
    normalized[o++] = bytes[i];
  }
  return createHash("sha256").update(normalized.subarray(0, o)).digest("hex");
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isEvaluationIdentity(value: unknown): value is EvaluationIdentity {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v.datasetVersion) &&
    isNonEmptyString(v.evaluationProtocolVersion) &&
    isNonEmptyString(v.scoringModelFamily) &&
    (v.metaSnapshotVersion === null || isNonEmptyString(v.metaSnapshotVersion))
  );
}

/** A structurally well-formed acceptance -- necessary, never sufficient, to promote. */
export function isWellFormedAcceptance(value: unknown): value is PromotionAcceptance {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    isNonEmptyString(v.approvedCandidateContentHash) &&
    isNonEmptyString(v.approvedReferenceContentHash) &&
    isEvaluationIdentity(v.approvedIdentity) &&
    isNonEmptyString(v.acceptedAtCommit) &&
    isNonEmptyString(v.acceptedBy) &&
    isNonEmptyString(v.acceptedAt)
  );
}

function fail(reason: string): PromotionResult {
  return { promoted: false, reason };
}

function readJson(path: string, label: string): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return { ok: false, reason: `${label} ausente: ${path}` };
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return { ok: false, reason: `${label} inválido: no es un objeto JSON` };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, reason: `${label} inválido: JSON malformado` };
  }
}

function stagingAcceptedPath(root: string): string {
  return join(resolve(root), "eval/baselines", `.accepted.s1.json.stage-${randomUUID()}`);
}

/**
 * Exclusive, no-clobber publish primitive. A hard link creation is atomic at the filesystem level
 * (NTFS and POSIX both): if `finalPath` already exists -- created by a competing writer between an
 * earlier `existsSync` check and this call -- this throws EEXIST and never overwrites it. This is
 * the actual safety mechanism; the earlier `existsSync` check in `promoteCandidate` is only a fast,
 * clear-message short-circuit for the common case.
 */
export function publishAcceptedArtifact(stagePath: string, finalPath: string): void {
  linkSync(stagePath, finalPath);
}

/**
 * The MECHANISM (requirement 2B.2, design §4.2). Never promotes without a structurally valid,
 * hash-bound, freshly-reverified-PASS acceptance; never overwrites an existing accepted baseline;
 * never reads path configuration from the environment. Pure with respect to environment variables.
 */
export function promoteCandidate(root: string, acceptance: PromotionAcceptance | null | undefined): PromotionResult {
  if (acceptance === null || acceptance === undefined) return fail(NO_ACCEPTANCE_REASON);
  if (!isWellFormedAcceptance(acceptance)) return fail(NO_ACCEPTANCE_REASON);

  const paths = promotionPaths(root);
  assertPromotionPathsDistinct(paths);

  if (existsSync(paths.accepted)) {
    return fail(`ya existe un baseline aceptado: ${paths.accepted} — Task 20a nunca sobrescribe`);
  }

  if (!existsSync(paths.candidate)) return fail(`candidate ausente: ${paths.candidate}`);
  const candidateBytes = readFileSync(paths.candidate);
  const candidateHash = canonicalContentHash(candidateBytes);
  if (candidateHash !== acceptance.approvedCandidateContentHash) {
    return fail(
      "candidate hash mismatch: el candidate en disco no es el que recibió aprobación " +
        "(cambió después de aprobarse, o la aprobación corresponde a otro candidate)",
    );
  }

  const candidateJson = readJson(paths.candidate, "candidate");
  if (!candidateJson.ok) return fail(candidateJson.reason);
  const candidateExtraction = extractEvaluationIdentity(candidateJson.value);
  if (!candidateExtraction.ok) return fail(`candidate sin EvaluationIdentity legible: ${candidateExtraction.reason}`);
  const candidateIdentity = candidateExtraction.identity;

  if (candidateIdentity.metaSnapshotVersion !== EXPECTED_S1_IDENTITY) {
    return fail("candidate metaSnapshotVersion no corresponde al S1 congelado aceptado");
  }
  if (!evaluationIdentityEquals(candidateIdentity, acceptance.approvedIdentity)) {
    return fail("candidate identity difiere de la identidad aprobada");
  }

  if (!existsSync(paths.reference)) return fail(`reference (REBASED_CONTROL) ausente: ${paths.reference}`);
  const referenceBytes = readFileSync(paths.reference);
  const referenceHash = canonicalContentHash(referenceBytes);
  if (referenceHash !== acceptance.approvedReferenceContentHash) {
    return fail("reference hash mismatch: reference.s1.json cambió desde la aprobación");
  }

  const referenceJson = readJson(paths.reference, "reference");
  if (!referenceJson.ok) return fail(referenceJson.reason);
  if (referenceJson.value.classification !== "REBASED_CONTROL") {
    return fail("reference ya no está clasificada como REBASED_CONTROL — no es un baseline aceptado ni una referencia válida");
  }
  const referenceExtraction = extractEvaluationIdentity(referenceJson.value);
  if (!referenceExtraction.ok) return fail(`reference sin EvaluationIdentity legible: ${referenceExtraction.reason}`);

  try {
    validateFrozenS1(paths.s1Snapshot, paths.s1Manifest);
  } catch (error) {
    return fail(`S1 congelado cambió o está ausente desde la aprobación: ${error instanceof Error ? error.message : String(error)}`);
  }

  // Independently RECOMPUTE the Task 19 verdict from the hash-verified files. The acceptance
  // object never asserts "PASS" itself -- that would be exactly the free boolean this mechanism
  // is designed to refuse.
  const candidateBaseline = candidateJson.value as unknown as FrozenBaseline;
  const referenceBaseline = referenceJson.value as unknown as FrozenBaseline;
  const goldenDatasetEmpty = ((candidateBaseline.engineQuality as { corpus?: { cases?: number } } | undefined)?.corpus?.cases ?? 0) <= 0;
  const proCorpusMissing =
    !existsSync(paths.proDraftsDb) ||
    ((candidateBaseline.professionalPickAgreement as { corpus?: { drafts?: number } } | undefined)?.corpus?.drafts ?? 0) <= 0;

  const verdict = runMandatoryGate({
    reference: referenceBaseline,
    candidate: candidateBaseline,
    referenceIdentity: referenceExtraction.identity,
    candidateIdentity,
    tolerance: DEFAULT_TOL,
    goldenDatasetEmpty,
    proCorpusMissing,
    mode: "enforce",
  });

  if (verdict.status !== "PASS") {
    return fail(`Task 19 no dio PASS: ${verdict.status} — ${verdict.reasons.join("; ") || "sin detalle"}`);
  }

  // Only now: stage -> validate staged -> exclusive publish -> verify -> clean own staging.
  const output = { ...candidateJson.value, acceptedAtCommit: acceptance.acceptedAtCommit };
  const serialized = `${JSON.stringify(output, null, 2)}\n`;

  const tempDir = mkdtempSync(join(tmpdir(), "d2k-task20a-promote-"));
  const draft = join(tempDir, "accepted.s1.json");
  let stage: string | null = null;
  try {
    writeFileSync(draft, serialized);

    // Validate the staged output BEFORE it ever touches the real baselines directory.
    const staged = readJson(draft, "staged accepted");
    if (!staged.ok) return fail(`staging inválido antes de publicar: ${staged.reason}`);
    if (staged.value.acceptedAtCommit !== acceptance.acceptedAtCommit) {
      return fail("staging inválido antes de publicar: acceptedAtCommit no coincide");
    }
    const stagedExtraction = extractEvaluationIdentity(staged.value);
    if (!stagedExtraction.ok || !evaluationIdentityEquals(stagedExtraction.identity, candidateIdentity)) {
      return fail("staging inválido antes de publicar: identity no coincide con el candidate validado");
    }

    stage = stagingAcceptedPath(root);
    copyFileSync(draft, stage, constants.COPYFILE_EXCL);

    // Exclusive/no-clobber publish: a hard link fails with EEXIST if another process created
    // `accepted.s1.json` between the earlier existsSync check and this point (race simulation).
    try {
      publishAcceptedArtifact(stage, paths.accepted);
    } catch (error) {
      return fail(
        `accepted.s1.json fue creado por otro proceso durante la publicación (carrera) — promoción abortada: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    // Verify what actually landed, not what we intended to write.
    const published = readJson(paths.accepted, "accepted publicado");
    if (!published.ok) return fail(`verificación post-publicación falló: ${published.reason}`);
    if (!readFileSync(paths.accepted).equals(readFileSync(stage))) {
      return fail("verificación post-publicación falló: bytes publicados difieren de los validados en staging");
    }
    const publishedExtraction = extractEvaluationIdentity(published.value);
    if (!publishedExtraction.ok || !evaluationIdentityEquals(publishedExtraction.identity, candidateIdentity)) {
      return fail("verificación post-publicación falló: identity publicada no coincide con el candidate validado");
    }
    if (published.value.acceptedAtCommit !== acceptance.acceptedAtCommit) {
      return fail("verificación post-publicación falló: acceptedAtCommit publicado no coincide");
    }

    return { promoted: true, acceptedPath: paths.accepted };
  } finally {
    if (stage !== null && existsSync(stage)) rmSync(stage, { force: true });
    rmSync(tempDir, { recursive: true, force: true });
  }
}

/**
 * CLI entry point. Intentionally strict: no default acceptance file, no default root beyond the
 * working directory, no environment-variable configuration. Never invoked by this task's tests or
 * verification -- Task 20a ships the mechanism, never a real promotion.
 */
export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  const [root, acceptancePath] = argv;
  if (!root || !acceptancePath) {
    process.stderr.write("usage: bun run scripts/eval/promote-candidate.ts <root> <acceptance.json>\n");
    return 2;
  }
  let acceptance: unknown;
  try {
    acceptance = JSON.parse(readFileSync(acceptancePath, "utf8"));
  } catch (error) {
    process.stderr.write(`cannot read acceptance file: ${error instanceof Error ? error.message : String(error)}\n`);
    return 2;
  }
  const result = promoteCandidate(root, isWellFormedAcceptance(acceptance) ? acceptance : null);
  if (!result.promoted) {
    process.stderr.write(`Task 20 promotion blocked: ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(`Task 20 promotion complete: ${result.acceptedPath}\n`);
  return 0;
}

if (import.meta.main) process.exit(await main());
