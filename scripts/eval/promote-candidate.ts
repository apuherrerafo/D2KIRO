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
import { constants, copyFileSync, existsSync, linkSync, mkdtempSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { TASK19_CANDIDATE, TASK19_REFERENCE, TASK20_ACCEPTED } from "./current-engine-candidate";
import { evaluationIdentityEquals, extractEvaluationIdentity, type EvaluationIdentity } from "./evaluation-identity";
import { DEFAULT_TOL, runMandatoryGate, type FrozenBaseline } from "./gate";
import type { Tolerance } from "./null-perturbation";
import { EXPECTED_S1_IDENTITY, validateFrozenS1 } from "./rebased-reference";

export const S1_SNAPSHOT = "eval/snapshots/S1.sqlite";
export const S1_MANIFEST = "eval/snapshots/S1.manifest.json";
export const PRO_DRAFTS_DB = "apps/engine/data/pro-drafts.sqlite";
/** Same canonical, fixed, root-relative path `gate.ts`'s `main()` defaults `TOL` to. Never read from `D2K_TOLERANCE_OUT` here -- a hostile parent environment must not be able to steer which tolerance the recomputed verdict uses. */
export const TOLERANCE_PATH = "data/generated/tolerance.json";

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
 * C-2 parity fix: the same fixed, canonical `data/generated/tolerance.json` path -- NEVER the
 * `D2K_TOLERANCE_OUT` environment variable -- with the exact same fallback `gate.ts`'s own
 * `main()` uses (line-for-line: `existsSync(TOL) ? JSON.parse(readFileSync(TOL, "utf-8")) :
 * DEFAULT_TOL`) -- reproduced here rather than imported because `gate.ts` only inlines this
 * inside its own `main()`, not as an exported helper; `evaluateGate`/`runMandatoryGate`
 * themselves (the actual gate semantics) ARE imported, never reimplemented. Task 19's real
 * `comparisonEnvironment` (see `current-engine-candidate.ts`) points that same environment
 * variable at this exact repo-relative file, so this reproduces what Task 19's own gate run
 * actually used, without ever trusting the environment itself.
 */
export function loadTolerance(root: string): Tolerance {
  const path = join(resolve(root), TOLERANCE_PATH);
  if (!existsSync(path)) return DEFAULT_TOL;
  return JSON.parse(readFileSync(path, "utf-8")) as Tolerance;
}

/**
 * C-3 test seam -- same dependency-injection principle `applyDraftEvent` uses for its clock/id
 * (`testing-seams.md` S4) and the account-token verifier uses for its clock/nonce store (S13):
 * the ONE physical read of candidate/reference bytes is injectable so a test can prove, by
 * counting real invocations through the actual `promoteCandidate` execution path, that each path
 * is read from disk exactly once per promotion -- never spying/monkeypatching a shared module.
 * Production never overrides this; it always defaults to the real filesystem.
 */
export interface PromotionFileReader {
  read(path: string): Buffer;
}

const nodeFileReader: PromotionFileReader = { read: (path) => readFileSync(path) };

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
  return parseJsonText(raw, label);
}

/**
 * C-3 TOCTOU fix: parses JSON from bytes the caller ALREADY read (and, for candidate/reference,
 * already hash-verified) -- never re-reads the path. The exact buffer that was canonical-hashed
 * and compared against the approval is the same buffer whose parsed content feeds
 * `EvaluationIdentity`, the recomputed mandatory gate, and the published `accepted.s1.json`.
 */
function parseJsonBytes(bytes: Buffer, label: string): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
  return parseJsonText(bytes.toString("utf8"), label);
}

function parseJsonText(raw: string, label: string): { ok: true; value: Record<string, unknown> } | { ok: false; reason: string } {
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
 * C-4: are `a` and `b` the SAME file (same device + inode), not merely two files whose content
 * happens to match right now? Content equality is not identity -- two independent files can hold
 * identical bytes, and identical bytes at one instant say nothing about whether either was
 * replaced a moment later. Right after `publishAcceptedArtifact` links `stage` -> `accepted`, both
 * names share one inode; this is how we tell "still provably our own just-published link" apart
 * from "something else unlinked and recreated `accepted` since". `{ bigint: true }` avoids the
 * precision loss `Number` can suffer on real NTFS inode numbers.
 */
export function sameFile(a: string, b: string): boolean {
  try {
    const sa = statSync(a, { bigint: true });
    const sb = statSync(b, { bigint: true });
    return sa.dev === sb.dev && sa.ino === sb.ino;
  } catch {
    return false;
  }
}

/**
 * Thrown ONLY when a post-publish verification check fails AND `accepted.s1.json` no longer
 * resolves to the exact file we just linked (see `resolvePostPublishFailure`). This is a
 * deliberately loud failure -- never a `PromotionResult` -- because at that point Task 20a cannot
 * tell whether `accepted.s1.json` is a legitimate concurrent promotion or tampering, and silently
 * returning `{ promoted: false, ... }` would look like an ordinary, harmless refusal while a real,
 * ambiguous artifact sits on disk. Requires human intervention before any further promotion.
 */
export class AmbiguousPostPublishStateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AmbiguousPostPublishStateError";
  }
}

/**
 * C-4 fail-closed decision for "a post-publish check failed after `publishAcceptedArtifact`
 * already succeeded". Never the naive `unlinkSync(accepted)` -- that would risk destroying a
 * different, legitimate `accepted.s1.json` that a competing writer created at that exact path
 * between our publish and our verification.
 *
 * - `sameFile(accepted, stage)` true  -> `accepted` still resolves to the exact bytes we just
 *   staged and linked ourselves; nothing else could have landed a different real baseline there
 *   without changing the inode. Safe, non-destructive rollback: remove it, return a normal
 *   `{ promoted: false }` -- disk ends up exactly as if the publish never happened, so it never
 *   silently blocks a future legitimate promotion via the "ya existe un baseline aceptado" guard.
 * - `sameFile(accepted, stage)` false -> `accepted` was unlinked and recreated by someone else
 *   since our link (a competing legitimate promotion, or tampering) -- Task 20a cannot tell which,
 *   so it never deletes it and never reports a quiet `promoted: false`. It fails loudly instead.
 */
export function resolvePostPublishFailure(acceptedPath: string, stagePath: string, reason: string): PromotionResult {
  if (sameFile(acceptedPath, stagePath)) {
    unlinkSync(acceptedPath);
    return fail(`${reason} — accepted.s1.json publicado fue revertido de forma segura (ningún baseline queda)`);
  }
  throw new AmbiguousPostPublishStateError(
    `ESTADO AMBIGUO tras publicar: ${acceptedPath} fue reemplazado por otro proceso durante la ` +
      "verificación post-publicación -- Task 20a no puede confirmar si es una promoción legítima " +
      "concurrente o manipulación, y se niega a borrarlo o a reportar un `promoted: false` inocente " +
      `que oculte este estado. Motivo original de la falla de verificación: ${reason}. ` +
      "Requiere intervención humana antes de cualquier nuevo intento de promoción.",
  );
}

/**
 * Verifies what ACTUALLY landed at `paths.accepted` after a successful `publishAcceptedArtifact`
 * call -- reads the real bytes now on disk, never trusts the in-memory object that was serialized
 * to `stage`. Any mismatch routes through `resolvePostPublishFailure` so a failure here can never
 * silently leave a bad/partial `accepted.s1.json` reported as an ordinary, harmless refusal (C-4).
 */
export function verifyPublishedArtifact(
  paths: PromotionPaths,
  stage: string,
  acceptance: PromotionAcceptance,
  candidateIdentity: EvaluationIdentity,
): PromotionResult {
  const published = readJson(paths.accepted, "accepted publicado");
  if (!published.ok) {
    return resolvePostPublishFailure(paths.accepted, stage, `verificación post-publicación falló: ${published.reason}`);
  }
  if (!readFileSync(paths.accepted).equals(readFileSync(stage))) {
    return resolvePostPublishFailure(
      paths.accepted,
      stage,
      "verificación post-publicación falló: bytes publicados difieren de los validados en staging",
    );
  }
  const publishedExtraction = extractEvaluationIdentity(published.value);
  if (!publishedExtraction.ok || !evaluationIdentityEquals(publishedExtraction.identity, candidateIdentity)) {
    return resolvePostPublishFailure(
      paths.accepted,
      stage,
      "verificación post-publicación falló: identity publicada no coincide con el candidate validado",
    );
  }
  if (published.value.acceptedAtCommit !== acceptance.acceptedAtCommit) {
    return resolvePostPublishFailure(
      paths.accepted,
      stage,
      "verificación post-publicación falló: acceptedAtCommit publicado no coincide",
    );
  }
  return { promoted: true, acceptedPath: paths.accepted };
}

/**
 * The MECHANISM (requirement 2B.2, design §4.2). Never promotes without a structurally valid,
 * hash-bound, freshly-reverified-PASS acceptance; never overwrites an existing accepted baseline;
 * never reads path configuration from the environment. Pure with respect to environment variables.
 */
export function promoteCandidate(
  root: string,
  acceptance: PromotionAcceptance | null | undefined,
  reader: PromotionFileReader = nodeFileReader,
): PromotionResult {
  if (acceptance === null || acceptance === undefined) return fail(NO_ACCEPTANCE_REASON);
  if (!isWellFormedAcceptance(acceptance)) return fail(NO_ACCEPTANCE_REASON);

  const paths = promotionPaths(root);
  assertPromotionPathsDistinct(paths);

  if (existsSync(paths.accepted)) {
    return fail(`ya existe un baseline aceptado: ${paths.accepted} — Task 20a nunca sobrescribe`);
  }

  if (!existsSync(paths.candidate)) return fail(`candidate ausente: ${paths.candidate}`);
  const candidateBytes = reader.read(paths.candidate);
  const candidateHash = canonicalContentHash(candidateBytes);
  if (candidateHash !== acceptance.approvedCandidateContentHash) {
    return fail(
      "candidate hash mismatch: el candidate en disco no es el que recibió aprobación " +
        "(cambió después de aprobarse, o la aprobación corresponde a otro candidate)",
    );
  }

  // C-3 fix: parse the SAME bytes that were just canonical-hashed and compared against the
  // approval -- never re-read `paths.candidate` from disk here. That earlier re-read was exactly
  // the TOCTOU window: the approved hash could match bytes that no longer exist by the time a
  // second `readFileSync` ran.
  const candidateJson = parseJsonBytes(candidateBytes, "candidate");
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
  const referenceBytes = reader.read(paths.reference);
  const referenceHash = canonicalContentHash(referenceBytes);
  if (referenceHash !== acceptance.approvedReferenceContentHash) {
    return fail("reference hash mismatch: reference.s1.json cambió desde la aprobación");
  }

  // C-3 fix: same principle as candidate above -- parse the exact hash-verified bytes, never a
  // fresh re-read of `paths.reference`.
  const referenceJson = parseJsonBytes(referenceBytes, "reference");
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

  // C-2 fix: same tolerance semantics Task 19's real gate run used -- the calibrated
  // `data/generated/tolerance.json` when it exists, `DEFAULT_TOL` only as `gate.ts` itself falls
  // back to. Never the environment variable `gate.ts` reads for this -- a hostile environment
  // must not be able to steer which tolerance decides the recomputed verdict.
  const verdict = runMandatoryGate({
    reference: referenceBaseline,
    candidate: candidateBaseline,
    referenceIdentity: referenceExtraction.identity,
    candidateIdentity,
    tolerance: loadTolerance(root),
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

    // C-4 fix: verify what actually landed, not what we intended to write. A failure here NEVER
    // returns a bare `promoted: false` while leaving a bad/partial `accepted.s1.json` behind --
    // `verifyPublishedArtifact` either safely rolls it back (still provably our own bytes) or
    // fails loudly with `AmbiguousPostPublishStateError` (it no longer resolves to what we
    // published, so it might be someone else's real baseline -- never touched).
    return verifyPublishedArtifact(paths, stage, acceptance, candidateIdentity);
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
  // C-4: `promoteCandidate` can throw `AmbiguousPostPublishStateError` in the narrow window where
  // `accepted.s1.json` was replaced by something else between our publish and our verification.
  // That is deliberately NOT a `PromotionResult` -- it must never look like an ordinary,
  // harmless refusal. Surface it as an explicit STOP with a distinct exit code.
  let result: PromotionResult;
  try {
    result = promoteCandidate(root, isWellFormedAcceptance(acceptance) ? acceptance : null);
  } catch (error) {
    if (error instanceof AmbiguousPostPublishStateError) {
      process.stderr.write(`STOP -- Task 20 promotion left an ambiguous state, human intervention required: ${error.message}\n`);
      return 3;
    }
    throw error;
  }
  if (!result.promoted) {
    process.stderr.write(`Task 20 promotion blocked: ${result.reason}\n`);
    return 1;
  }
  process.stdout.write(`Task 20 promotion complete: ${result.acceptedPath}\n`);
  return 0;
}

if (import.meta.main) process.exit(await main());
