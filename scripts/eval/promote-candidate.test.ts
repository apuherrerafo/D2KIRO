import { afterEach, expect, test } from "bun:test";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { extractEvaluationIdentity, type EvaluationIdentity } from "./evaluation-identity";
import {
  AmbiguousPostPublishStateError,
  NO_ACCEPTANCE_REASON,
  canonicalContentHash,
  isWellFormedAcceptance,
  promotionPaths,
  promoteCandidate,
  publishAcceptedArtifact,
  resolvePostPublishFailure,
  sameFile,
  verifyPublishedArtifact,
  type PromotionAcceptance,
  type PromotionFileReader,
} from "./promote-candidate";

const dirs: string[] = [];
function temp(name: string): string {
  const path = mkdtempSync(join(tmpdir(), name));
  dirs.push(path);
  return path;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

/** Copies the REAL Task 19/34/35 evidence into a disposable fixture root. Read-only sources. */
function setupFixture(root: string): void {
  mkdirSync(join(root, "eval/baselines"), { recursive: true });
  mkdirSync(join(root, "eval/snapshots"), { recursive: true });
  copyFileSync("eval/baselines/candidate.s1.json", join(root, "eval/baselines/candidate.s1.json"));
  copyFileSync("eval/baselines/reference.s1.json", join(root, "eval/baselines/reference.s1.json"));
  copyFileSync("eval/baselines/split.json", join(root, "eval/baselines/split.json"));
  copyFileSync("eval/snapshots/S1.sqlite", join(root, "eval/snapshots/S1.sqlite"));
  copyFileSync("eval/snapshots/S1.manifest.json", join(root, "eval/snapshots/S1.manifest.json"));
}

/** A well-formed, hash-bound acceptance derived from whatever bytes the fixture root actually has. */
function validAcceptance(root: string): PromotionAcceptance {
  const candidateBytes = readFileSync(join(root, "eval/baselines/candidate.s1.json"));
  const referenceBytes = readFileSync(join(root, "eval/baselines/reference.s1.json"));
  const extraction = extractEvaluationIdentity(JSON.parse(candidateBytes.toString("utf8")));
  if (!extraction.ok) throw new Error(extraction.reason);
  return {
    approvedCandidateContentHash: canonicalContentHash(candidateBytes),
    approvedReferenceContentHash: canonicalContentHash(referenceBytes),
    approvedIdentity: extraction.identity,
    acceptedAtCommit: "a".repeat(40),
    acceptedBy: "po@example.test",
    acceptedAt: "2026-09-12T00:00:00.000Z",
  };
}

function minimalIdentity(): EvaluationIdentity {
  return { datasetVersion: "x", evaluationProtocolVersion: "y", scoringModelFamily: "z", metaSnapshotVersion: null };
}

function acceptedPathOf(root: string): string {
  return join(root, "eval/baselines/accepted.s1.json");
}

/** Regresses the fixture candidate's NDCG@5 by `delta` and returns a fresh, hash-bound acceptance for it. */
function acceptanceForRegressedCandidate(root: string, delta: number): PromotionAcceptance {
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  const baseNdcg5 = candidate.engineQuality.perRanker.v6Full.overall.ndcg5;
  const regressed = {
    ...candidate,
    engineQuality: {
      ...candidate.engineQuality,
      perRanker: {
        ...candidate.engineQuality.perRanker,
        v6Full: {
          ...candidate.engineQuality.perRanker.v6Full,
          overall: { ...candidate.engineQuality.perRanker.v6Full.overall, ndcg5: baseNdcg5 - delta },
        },
      },
    },
  };
  writeFileSync(candidatePath, JSON.stringify(regressed, null, 2));
  const bytes = readFileSync(candidatePath);
  const extraction = extractEvaluationIdentity(regressed);
  if (!extraction.ok) throw new Error(extraction.reason);
  return {
    approvedCandidateContentHash: canonicalContentHash(bytes),
    approvedReferenceContentHash: canonicalContentHash(readFileSync(join(root, "eval/baselines/reference.s1.json"))),
    approvedIdentity: extraction.identity,
    acceptedAtCommit: "a".repeat(40),
    acceptedBy: "po",
    acceptedAt: "2026-01-01T00:00:00Z",
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Happy path
// ─────────────────────────────────────────────────────────────────────────────

test("a valid, hash-bound acceptance promotes the exact approved candidate", () => {
  const root = temp("d2k-task20a-valid-");
  setupFixture(root);
  const result = promoteCandidate(root, validAcceptance(root));
  expect(result.promoted).toBe(true);
  if (!result.promoted) throw new Error("unreachable");
  expect(result.acceptedPath).toBe(acceptedPathOf(root));
  expect(existsSync(result.acceptedPath)).toBe(true);
});

test("promoted output is the candidate plus ONLY acceptedAtCommit -- nothing else added or removed", () => {
  const root = temp("d2k-task20a-onlyacceptedatcommit-");
  setupFixture(root);
  const before = JSON.parse(readFileSync(join(root, "eval/baselines/candidate.s1.json"), "utf8"));
  const acceptance = validAcceptance(root);
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(true);
  if (!result.promoted) throw new Error("unreachable");
  const accepted = JSON.parse(readFileSync(result.acceptedPath, "utf8"));
  const { acceptedAtCommit, ...rest } = accepted;
  expect(acceptedAtCommit).toBe(acceptance.acceptedAtCommit);
  expect(rest).toEqual(before);
  expect(Object.keys(accepted).sort()).toEqual([...Object.keys(before), "acceptedAtCommit"].sort());
});

test("provenance and EvaluationIdentity are preserved verbatim in the promoted artifact", () => {
  const root = temp("d2k-task20a-provenance-");
  setupFixture(root);
  const before = JSON.parse(readFileSync(join(root, "eval/baselines/candidate.s1.json"), "utf8"));
  const result = promoteCandidate(root, validAcceptance(root));
  expect(result.promoted).toBe(true);
  if (!result.promoted) throw new Error("unreachable");
  const accepted = JSON.parse(readFileSync(result.acceptedPath, "utf8"));
  expect(accepted.provenance).toEqual(before.provenance);
  expect(accepted.identity).toEqual(before.identity);
});

test("candidate, reference, S1, and split are preserved byte-for-byte after a successful promotion", () => {
  const root = temp("d2k-task20a-preserve-");
  setupFixture(root);
  const before = {
    candidate: readFileSync(join(root, "eval/baselines/candidate.s1.json")),
    reference: readFileSync(join(root, "eval/baselines/reference.s1.json")),
    s1: readFileSync(join(root, "eval/snapshots/S1.sqlite")),
    manifest: readFileSync(join(root, "eval/snapshots/S1.manifest.json")),
    split: readFileSync(join(root, "eval/baselines/split.json")),
  };
  const result = promoteCandidate(root, validAcceptance(root));
  expect(result.promoted).toBe(true);
  expect(readFileSync(join(root, "eval/baselines/candidate.s1.json"))).toEqual(before.candidate);
  expect(readFileSync(join(root, "eval/baselines/reference.s1.json"))).toEqual(before.reference);
  expect(readFileSync(join(root, "eval/snapshots/S1.sqlite"))).toEqual(before.s1);
  expect(readFileSync(join(root, "eval/snapshots/S1.manifest.json"))).toEqual(before.manifest);
  expect(readFileSync(join(root, "eval/baselines/split.json"))).toEqual(before.split);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed: no acceptance, malformed acceptance
// ─────────────────────────────────────────────────────────────────────────────

test("no acceptance at all is refused with the exact reason required by requirement 2B.2 c1", () => {
  const root = temp("d2k-task20a-noacc-");
  setupFixture(root);
  expect(promoteCandidate(root, null)).toEqual({ promoted: false, reason: NO_ACCEPTANCE_REASON });
  expect(promoteCandidate(root, undefined)).toEqual({ promoted: false, reason: NO_ACCEPTANCE_REASON });
  expect(existsSync(acceptedPathOf(root))).toBe(false);
});

test("a bare approved=true style boolean flag is not an acceptance and is refused", () => {
  const root = temp("d2k-task20a-boolacc-");
  setupFixture(root);
  const bareBoolean = { approved: true } as unknown as PromotionAcceptance;
  expect(isWellFormedAcceptance(bareBoolean)).toBe(false);
  expect(promoteCandidate(root, bareBoolean)).toEqual({ promoted: false, reason: NO_ACCEPTANCE_REASON });
  expect(existsSync(acceptedPathOf(root))).toBe(false);
});

test("an acceptance missing any required field is refused, never partially trusted", () => {
  const root = temp("d2k-task20a-partialacc-");
  setupFixture(root);
  const full = validAcceptance(root);
  for (const key of Object.keys(full) as (keyof PromotionAcceptance)[]) {
    const partial = { ...full };
    delete (partial as Record<string, unknown>)[key];
    expect(isWellFormedAcceptance(partial)).toBe(false);
    expect(promoteCandidate(root, partial as PromotionAcceptance)).toEqual({ promoted: false, reason: NO_ACCEPTANCE_REASON });
  }
  expect(existsSync(acceptedPathOf(root))).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed: candidate absent / invalid / wrong identity
// ─────────────────────────────────────────────────────────────────────────────

test("missing candidate file is refused", () => {
  const root = temp("d2k-task20a-nocandidate-");
  mkdirSync(join(root, "eval/baselines"), { recursive: true });
  const acceptance: PromotionAcceptance = {
    approvedCandidateContentHash: "a".repeat(64),
    approvedReferenceContentHash: "b".repeat(64),
    approvedIdentity: minimalIdentity(),
    acceptedAtCommit: "a".repeat(40),
    acceptedBy: "po",
    acceptedAt: "2026-01-01T00:00:00Z",
  };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("candidate ausente");
});

test("candidate hash mismatch refuses to promote and does not write anything", () => {
  const root = temp("d2k-task20a-hashmismatch-");
  setupFixture(root);
  const acceptance = { ...validAcceptance(root), approvedCandidateContentHash: "0".repeat(64) };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("candidate hash mismatch");
  expect(existsSync(acceptedPathOf(root))).toBe(false);
});

test("candidate modified after approval (bytes changed since the hash was taken) is detected and refused", () => {
  const root = temp("d2k-task20a-modified-");
  setupFixture(root);
  const acceptance = validAcceptance(root);
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  writeFileSync(candidatePath, `${readFileSync(candidatePath, "utf8")}\n`);
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("candidate hash mismatch");
  expect(existsSync(acceptedPathOf(root))).toBe(false);
});

test("malformed candidate JSON is refused even when its (malformed) bytes match the approved hash", () => {
  const root = temp("d2k-task20a-malformed-");
  mkdirSync(join(root, "eval/baselines"), { recursive: true });
  writeFileSync(join(root, "eval/baselines/candidate.s1.json"), "not-json");
  const bytes = readFileSync(join(root, "eval/baselines/candidate.s1.json"));
  const acceptance: PromotionAcceptance = {
    approvedCandidateContentHash: canonicalContentHash(bytes),
    approvedReferenceContentHash: "b".repeat(64),
    approvedIdentity: minimalIdentity(),
    acceptedAtCommit: "a".repeat(40),
    acceptedBy: "po",
    acceptedAt: "2026-01-01T00:00:00Z",
  };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("candidate inválido");
});

test("candidate JSON without a readable EvaluationIdentity is refused", () => {
  const root = temp("d2k-task20a-noidentity-");
  mkdirSync(join(root, "eval/baselines"), { recursive: true });
  writeFileSync(join(root, "eval/baselines/candidate.s1.json"), JSON.stringify({ foo: "bar" }));
  const bytes = readFileSync(join(root, "eval/baselines/candidate.s1.json"));
  const acceptance: PromotionAcceptance = {
    approvedCandidateContentHash: canonicalContentHash(bytes),
    approvedReferenceContentHash: "b".repeat(64),
    approvedIdentity: minimalIdentity(),
    acceptedAtCommit: "a".repeat(40),
    acceptedBy: "po",
    acceptedAt: "2026-01-01T00:00:00Z",
  };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("EvaluationIdentity");
});

test("a candidate whose metaSnapshotVersion is not the frozen S1 identity is refused", () => {
  const root = temp("d2k-task20a-wrongmeta-");
  setupFixture(root);
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  const original = JSON.parse(readFileSync(candidatePath, "utf8"));
  const tampered = { ...original, identity: { ...original.identity, metaSnapshotVersion: `meta1:${"0".repeat(64)}` } };
  writeFileSync(candidatePath, JSON.stringify(tampered, null, 2));
  const acceptance: PromotionAcceptance = {
    approvedCandidateContentHash: canonicalContentHash(readFileSync(candidatePath)),
    approvedReferenceContentHash: canonicalContentHash(readFileSync(join(root, "eval/baselines/reference.s1.json"))),
    approvedIdentity: tampered.identity,
    acceptedAtCommit: "a".repeat(40),
    acceptedBy: "po",
    acceptedAt: "2026-01-01T00:00:00Z",
  };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("metaSnapshotVersion");
});

test("candidate identity mismatched against the approved identity is refused even if the hash somehow matched", () => {
  const root = temp("d2k-task20a-identitymismatch-");
  setupFixture(root);
  const acceptance = validAcceptance(root);
  acceptance.approvedIdentity = { ...acceptance.approvedIdentity, datasetVersion: "split:deadbeef;golden:1" };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("identity difiere de la identidad aprobada");
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed: reference must remain REBASED_CONTROL and match what was approved
// ─────────────────────────────────────────────────────────────────────────────

test("missing reference (REBASED_CONTROL) is refused", () => {
  const root = temp("d2k-task20a-noreference-");
  setupFixture(root);
  const acceptance = validAcceptance(root);
  rmSync(join(root, "eval/baselines/reference.s1.json"));
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("reference (REBASED_CONTROL) ausente");
});

test("reference hash mismatch (changed since approval) is refused", () => {
  const root = temp("d2k-task20a-refhashmismatch-");
  setupFixture(root);
  const acceptance = { ...validAcceptance(root), approvedReferenceContentHash: "0".repeat(64) };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("reference hash mismatch");
});

test("a reference no longer classified REBASED_CONTROL is refused", () => {
  const root = temp("d2k-task20a-refclass-");
  setupFixture(root);
  const acceptance = validAcceptance(root);
  const referencePath = join(root, "eval/baselines/reference.s1.json");
  const reference = JSON.parse(readFileSync(referencePath, "utf8"));
  writeFileSync(referencePath, JSON.stringify({ ...reference, classification: "ACCEPTED" }));
  acceptance.approvedReferenceContentHash = canonicalContentHash(readFileSync(referencePath));
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("REBASED_CONTROL");
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed: S1 must still be the frozen, accepted snapshot
// ─────────────────────────────────────────────────────────────────────────────

test("a changed S1 snapshot since approval is refused", () => {
  const root = temp("d2k-task20a-s1changed-");
  setupFixture(root);
  const acceptance = validAcceptance(root);
  writeFileSync(join(root, "eval/snapshots/S1.sqlite"), "not-a-real-sqlite-file");
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("S1 congelado");
});

test("a missing S1 manifest since approval is refused", () => {
  const root = temp("d2k-task20a-s1manifestmissing-");
  setupFixture(root);
  const acceptance = validAcceptance(root);
  rmSync(join(root, "eval/snapshots/S1.manifest.json"));
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("S1 congelado");
});

// ─────────────────────────────────────────────────────────────────────────────
// Fail-closed: no free "PASS" boolean -- the verdict is recomputed
// ─────────────────────────────────────────────────────────────────────────────

test("a claimed PASS that the real gate math would not grant is refused (no free boolean)", () => {
  const root = temp("d2k-task20a-fakepass-");
  setupFixture(root);
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  const candidate = JSON.parse(readFileSync(candidatePath, "utf8"));
  // Force a real regression: tank NDCG@5 so evaluateGate() finds it worse than the reference.
  const regressed = {
    ...candidate,
    engineQuality: {
      ...candidate.engineQuality,
      perRanker: {
        ...candidate.engineQuality.perRanker,
        v6Full: {
          ...candidate.engineQuality.perRanker.v6Full,
          overall: { ...candidate.engineQuality.perRanker.v6Full.overall, ndcg5: 0 },
        },
      },
    },
  };
  writeFileSync(candidatePath, JSON.stringify(regressed, null, 2));
  const bytes = readFileSync(candidatePath);
  const extraction = extractEvaluationIdentity(regressed);
  if (!extraction.ok) throw new Error(extraction.reason);
  const acceptance: PromotionAcceptance = {
    approvedCandidateContentHash: canonicalContentHash(bytes),
    approvedReferenceContentHash: canonicalContentHash(readFileSync(join(root, "eval/baselines/reference.s1.json"))),
    approvedIdentity: extraction.identity,
    acceptedAtCommit: "a".repeat(40),
    acceptedBy: "po",
    acceptedAt: "2026-01-01T00:00:00Z",
  };
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("Task 19 no dio PASS");
  expect(existsSync(acceptedPathOf(root))).toBe(false);
});

// ─────────────────────────────────────────────────────────────────────────────
// No-clobber / atomicity / race
// ─────────────────────────────────────────────────────────────────────────────

test("an already-existing accepted baseline is a hard failure and its bytes are never touched", () => {
  const root = temp("d2k-task20a-existing-");
  setupFixture(root);
  writeFileSync(acceptedPathOf(root), "do-not-clobber");
  const result = promoteCandidate(root, validAcceptance(root));
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("ya existe un baseline aceptado");
  expect(readFileSync(acceptedPathOf(root), "utf8")).toBe("do-not-clobber");
});

test("the exclusive publish primitive refuses a competing writer without clobbering it (race simulation)", () => {
  const root = temp("d2k-task20a-race-");
  const stagePath = join(root, "stage.json");
  const finalPath = join(root, "target.json");
  writeFileSync(stagePath, "staged-content");
  writeFileSync(finalPath, "concurrent-writer-won-the-race");
  expect(() => publishAcceptedArtifact(stagePath, finalPath)).toThrow();
  expect(readFileSync(finalPath, "utf8")).toBe("concurrent-writer-won-the-race");
});

test("no staging temp directories survive a successful or a refused promotion", () => {
  const before = new Set(readdirSync(tmpdir()).filter((e) => e.startsWith("d2k-task20a-promote-")));

  const successRoot = temp("d2k-task20a-tempcleanup-ok-");
  setupFixture(successRoot);
  const successResult = promoteCandidate(successRoot, validAcceptance(successRoot));
  expect(successResult.promoted).toBe(true);

  const failRoot = temp("d2k-task20a-tempcleanup-fail-");
  setupFixture(failRoot);
  const failAcceptance = { ...validAcceptance(failRoot), approvedCandidateContentHash: "0".repeat(64) };
  const failResult = promoteCandidate(failRoot, failAcceptance);
  expect(failResult.promoted).toBe(false);

  const after = readdirSync(tmpdir()).filter((e) => e.startsWith("d2k-task20a-promote-") && !before.has(e));
  expect(after).toEqual([]);
});

test("no stray staging artifacts remain in eval/baselines after a successful promotion", () => {
  const root = temp("d2k-task20a-stagingcleanup-");
  setupFixture(root);
  const result = promoteCandidate(root, validAcceptance(root));
  expect(result.promoted).toBe(true);
  const leftovers = readdirSync(join(root, "eval/baselines")).filter((f) => f.startsWith(".accepted.s1.json.stage-"));
  expect(leftovers).toEqual([]);
});

// ─────────────────────────────────────────────────────────────────────────────
// Hostile environment
// ─────────────────────────────────────────────────────────────────────────────

test("the promotion mechanism source never reads process.env for path or approval configuration", () => {
  const source = readFileSync("scripts/eval/promote-candidate.ts", "utf8");
  expect(source).not.toContain("process.env");
});

test("hostile environment variables cannot redirect candidate/reference/accepted/S1/split paths", () => {
  const root = temp("d2k-task20a-hostileenv-");
  const saved = { ...process.env };
  try {
    Object.assign(process.env, {
      D2K_BASELINE_OUT: "evil.json",
      D2K_GATE_CURRENT: "evil-candidate.json",
      D2K_SPLIT_OUT: "evil-split.json",
      D2K_META_SNAPSHOT: "evil.sqlite",
      ENGINE_DB_PATH: "evil.sqlite",
      D2K_PRO_DB: "evil-pro.sqlite",
      D2K_MEASURED_ENGINE_COMMIT: "deadbeef",
      D2K_TOLERANCE_OUT: "evil-tol.json",
      D2K_REPORTS_DIR: "evil-reports",
    });
    const paths = promotionPaths(root);
    expect(paths.candidate).toBe(join(root, "eval/baselines/candidate.s1.json"));
    expect(paths.reference).toBe(join(root, "eval/baselines/reference.s1.json"));
    expect(paths.accepted).toBe(join(root, "eval/baselines/accepted.s1.json"));
    expect(paths.s1Snapshot).toBe(join(root, "eval/snapshots/S1.sqlite"));
    expect(paths.s1Manifest).toBe(join(root, "eval/snapshots/S1.manifest.json"));

    setupFixture(root);
    const result = promoteCandidate(root, validAcceptance(root));
    expect(result.promoted).toBe(true);
    if (!result.promoted) throw new Error("unreachable");
    expect(result.acceptedPath).toBe(join(root, "eval/baselines/accepted.s1.json"));
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Path alias / symlink / case behavior
// ─────────────────────────────────────────────────────────────────────────────

test("equivalent spellings of the same root (trailing separator, forward slashes) resolve to identical paths", () => {
  const root = temp("d2k-task20a-sep-");
  const withTrailingSep = `${root}${root.includes("\\") ? "\\" : "/"}`;
  const posixStyle = root.replace(/\\/g, "/");
  const canonical = promotionPaths(root);
  expect(promotionPaths(withTrailingSep)).toEqual(canonical);
  expect(promotionPaths(posixStyle)).toEqual(canonical);
});

test("no-clobber protection holds even when eval/baselines is reached through a directory alias", () => {
  const root = temp("d2k-task20a-alias-real-");
  const alias = temp("d2k-task20a-alias-link-");
  setupFixture(root);
  mkdirSync(join(alias, "eval"), { recursive: true });
  const linkedBaselines = join(alias, "eval", "baselines");
  try {
    symlinkSync(join(root, "eval", "baselines"), linkedBaselines, process.platform === "win32" ? "junction" : "dir");
  } catch {
    return; // Environment lacks symlink/junction privilege; nothing more to assert here.
  }
  writeFileSync(join(linkedBaselines, "accepted.s1.json"), "already-there-via-alias");
  const result = promoteCandidate(alias, validAcceptance(root));
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("ya existe un baseline aceptado");
  expect(readFileSync(acceptedPathOf(root), "utf8")).toBe("already-there-via-alias");
});

// ─────────────────────────────────────────────────────────────────────────────
// Windows CRLF checkout vs. canonical Git content
// ─────────────────────────────────────────────────────────────────────────────

test("canonicalContentHash is EOL-invariant: it reproduces the LF-measured hash from CRLF-forced bytes", () => {
  const root = temp("d2k-task20a-crlf-hash-");
  setupFixture(root);
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  const original = readFileSync(candidatePath);
  const lf = Buffer.from(original.toString("latin1").replace(/\r\n/g, "\n"), "latin1");
  const crlf = Buffer.from(lf.toString("latin1").replace(/\n/g, "\r\n"), "latin1");
  expect(canonicalContentHash(lf)).toBe(canonicalContentHash(original));
  expect(canonicalContentHash(crlf)).toBe(canonicalContentHash(original));
});

test("a CRLF Windows checkout of the exact approved candidate promotes cleanly, never a false rejection", () => {
  const root = temp("d2k-task20a-crlf-promote-");
  setupFixture(root);
  const acceptance = validAcceptance(root); // hash computed from this checkout's own bytes
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  const original = readFileSync(candidatePath);
  const forcedCrlf = Buffer.from(
    original.toString("latin1").replace(/\r\n/g, "\n").replace(/\n/g, "\r\n"),
    "latin1",
  );
  writeFileSync(candidatePath, forcedCrlf);
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(true);
});

test("a genuinely different candidate (not just a line-ending change) is never accepted by canonicalContentHash", () => {
  const root = temp("d2k-task20a-crlf-negative-");
  setupFixture(root);
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  const original = readFileSync(candidatePath);
  const tampered = JSON.parse(original.toString("utf8"));
  tampered.identity.datasetVersion = "split:tampered;golden:1";
  writeFileSync(candidatePath, JSON.stringify(tampered));
  expect(canonicalContentHash(readFileSync(candidatePath))).not.toBe(canonicalContentHash(original));
});

// ─────────────────────────────────────────────────────────────────────────────
// C-3 regression: hash-verified bytes must be the SAME bytes that feed identity/gate/output --
// never a second, independent re-read of the path. Proven behaviorally (read count), not by
// asserting on the source text: under the prior design `readFileSync(paths.candidate)` (for the
// hash) was followed by a SECOND, independent read via `readJson(paths.candidate, ...)` -- exactly
// the TOCTOU window where the file could change between the two reads without detection. This test
// would have failed under that design (2 reads) and passes under the fixed one (1 read).
// ─────────────────────────────────────────────────────────────────────────────

test("C-3: candidate and reference are each read from disk exactly once per promotion (no second, independent re-read after hash verification)", () => {
  const root = temp("d2k-task20a-c3-singleread-");
  setupFixture(root);
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  const referencePath = join(root, "eval/baselines/reference.s1.json");

  // Counts REAL invocations through the actual `promoteCandidate` execution path -- not a source
  // inspection. Under the prior design (`readFileSync(paths.candidate)` for the hash, then a
  // SECOND independent `readJson(paths.candidate, ...)` for content) this would have counted 2
  // reads per path; the fix reads each path's bytes exactly once and reuses them for both the
  // hash and the parsed JSON.
  const counts = new Map<string, number>();
  const countingReader: PromotionFileReader = {
    read(path) {
      counts.set(path, (counts.get(path) ?? 0) + 1);
      return readFileSync(path);
    },
  };

  const result = promoteCandidate(root, validAcceptance(root), countingReader);

  expect(result.promoted).toBe(true);
  expect(counts.get(candidatePath)).toBe(1);
  expect(counts.get(referencePath)).toBe(1);
});

test("C-3: the parsed candidate JSON fed to identity/gate/output is the exact same buffer that was canonical-hashed against the approval", () => {
  const root = temp("d2k-task20a-c3-samebuffer-");
  setupFixture(root);
  const candidatePath = join(root, "eval/baselines/candidate.s1.json");
  let observedCandidateBytes: Buffer | null = null;
  const observingReader: PromotionFileReader = {
    read(path) {
      const bytes = readFileSync(path);
      if (path === candidatePath) observedCandidateBytes = bytes;
      return bytes;
    },
  };

  const result = promoteCandidate(root, validAcceptance(root), observingReader);
  expect(result.promoted).toBe(true);
  if (!result.promoted) throw new Error("unreachable");

  // The published (candidate + acceptedAtCommit) content, minus the stamped field, must be
  // `JSON.parse` of the EXACT bytes the reader handed back for the hash check -- never a
  // freshly re-read (and potentially different) copy of the file.
  const accepted = JSON.parse(readFileSync(result.acceptedPath, "utf8"));
  const { acceptedAtCommit: _unused, ...rest } = accepted;
  expect(observedCandidateBytes).not.toBeNull();
  expect(rest).toEqual(JSON.parse((observedCandidateBytes as unknown as Buffer).toString("utf8")));
});

// ─────────────────────────────────────────────────────────────────────────────
// C-4 regression: a post-publish verification failure must NEVER return a bare `promoted: false`
// while leaving a residual `accepted.s1.json` on disk (that would silently block a future
// legitimate promotion via the no-clobber guard), and must NEVER blindly delete a path that no
// longer resolves to our own just-published bytes (it might be someone else's real baseline).
// ─────────────────────────────────────────────────────────────────────────────

test("sameFile distinguishes true filesystem identity (a real hard link) from mere content equality", () => {
  const root = temp("d2k-task20a-samefile-");
  const stage = join(root, "stage.json");
  const linked = join(root, "linked.json");
  const independent = join(root, "independent.json");
  writeFileSync(stage, "identical-content");
  writeFileSync(independent, "identical-content");
  publishAcceptedArtifact(stage, linked); // real hard link -> same inode as `stage`

  expect(sameFile(linked, stage)).toBe(true);
  expect(sameFile(independent, stage)).toBe(false); // same bytes, but a genuinely different file
});

test("a post-publish failure on OUR OWN just-published bytes is rolled back safely -- no residual accepted.s1.json, reported as a normal refusal", () => {
  const root = temp("d2k-task20a-postpublish-safe-");
  const stage = join(root, "stage.json");
  const accepted = join(root, "accepted.json");
  writeFileSync(stage, "valid-staged-content");
  publishAcceptedArtifact(stage, accepted); // `accepted` and `stage` now share one inode

  const result = resolvePostPublishFailure(accepted, stage, "simulated post-publish check failure");

  expect(result).toEqual({
    promoted: false,
    reason: "simulated post-publish check failure — accepted.s1.json publicado fue revertido de forma segura (ningún baseline queda)",
  });
  expect(existsSync(accepted)).toBe(false); // no partial/invalid accepted left behind
  expect(readFileSync(stage, "utf8")).toBe("valid-staged-content"); // our own staging copy is untouched
});

test("a post-publish failure when accepted no longer resolves to our own publication fails LOUDLY -- never a quiet promoted:false, never touches the replacement", () => {
  const root = temp("d2k-task20a-postpublish-ambiguous-");
  const stage = join(root, "stage.json");
  const accepted = join(root, "accepted.json");
  writeFileSync(stage, "our-staged-content");
  publishAcceptedArtifact(stage, accepted);
  // Simulate a competing writer that unlinked our publication and recreated `accepted` as an
  // INDEPENDENT file (a legitimate concurrent promotion, or tampering) between our publish and our
  // verification -- a genuinely different inode, not the file we just linked.
  unlinkSync(accepted);
  writeFileSync(accepted, "someone-elses-real-baseline");

  let threw: unknown;
  try {
    resolvePostPublishFailure(accepted, stage, "simulated post-publish check failure");
  } catch (error) {
    threw = error;
  }
  expect(threw).toBeInstanceOf(AmbiguousPostPublishStateError);
  // Never overwritten, never deleted -- the ambiguous replacement is left exactly as found.
  expect(readFileSync(accepted, "utf8")).toBe("someone-elses-real-baseline");
});

test("verifyPublishedArtifact rolls back safely through the real production wiring when the published content fails verification but is still provably ours", () => {
  const root = temp("d2k-task20a-verify-rollback-");
  setupFixture(root);
  const paths = promotionPaths(root);
  const acceptance = validAcceptance(root);
  const candidateBytes = readFileSync(paths.candidate);
  const candidateExtraction = extractEvaluationIdentity(JSON.parse(candidateBytes.toString("utf8")));
  if (!candidateExtraction.ok) throw new Error("fixture broken");

  const stage = join(root, "eval/baselines", ".accepted.s1.json.stage-test");
  // Publish a payload that never stamped `acceptedAtCommit` -- forces the acceptedAtCommit
  // post-publish check to fail, while `accepted` is still 100% our own just-linked bytes.
  writeFileSync(stage, candidateBytes);
  publishAcceptedArtifact(stage, paths.accepted);

  const result = verifyPublishedArtifact(paths, stage, acceptance, candidateExtraction.identity);

  expect(result.promoted).toBe(false);
  expect(existsSync(paths.accepted)).toBe(false); // rolled back, never left as a residual/partial accepted
});

// ─────────────────────────────────────────────────────────────────────────────
// C-2 regression: the recomputed verdict must use the SAME tolerance semantics Task 19's real
// gate run used (the calibrated `data/generated/tolerance.json` when it exists, `DEFAULT_TOL`
// only as `gate.ts` itself falls back to) -- and a hostile environment must never be able to pick
// a different tolerance. Proven by showing the SAME regression gets a DIFFERENT verdict depending
// on which tolerance file is present, not merely that some JSON gets read.
// ─────────────────────────────────────────────────────────────────────────────

test("C-2: without a calibrated tolerance.json, promoteCandidate falls back to DEFAULT_TOL and refuses a regression DEFAULT_TOL does not cover", () => {
  const root = temp("d2k-task20a-tol-default-");
  setupFixture(root);
  const acceptance = acceptanceForRegressedCandidate(root, 0.03); // exceeds DEFAULT_TOL.ndcg5 = 0.02
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(false);
  if (result.promoted) throw new Error("unreachable");
  expect(result.reason).toContain("Task 19 no dio PASS");
});

test("C-2: promoteCandidate uses the SAME calibrated data/generated/tolerance.json Task 19's real gate used -- not DEFAULT_TOL -- flipping the verdict for the identical regression", () => {
  const root = temp("d2k-task20a-tol-calibrated-");
  setupFixture(root);
  const acceptance = acceptanceForRegressedCandidate(root, 0.03); // still a 0.03 NDCG@5 drop
  mkdirSync(join(root, "data/generated"), { recursive: true });
  writeFileSync(
    join(root, "data/generated/tolerance.json"),
    JSON.stringify({
      schemaVersion: 1,
      perturbations: 200,
      swapProbability: 0.15,
      ndcg5: 0.05, // wider than DEFAULT_TOL.ndcg5 (0.02) -- the same 0.03 drop is now within tolerance
      recallAt3: 0.02,
      badPickRate5: 0.035,
      byContextRecallAt3: 0.02,
      note: "calibrado (fixture)",
    }),
  );
  const result = promoteCandidate(root, acceptance);
  expect(result.promoted).toBe(true);
});

test("C-2: a hostile D2K_TOLERANCE_OUT cannot change the recomputed verdict -- only the canonical data/generated/tolerance.json (or DEFAULT_TOL) decides", () => {
  const root = temp("d2k-task20a-tol-hostileenv-");
  setupFixture(root);
  const saved = process.env.D2K_TOLERANCE_OUT;
  try {
    // If this were honored, ANY regression at all would FAIL (ndcg5 tolerance pinned to 0).
    const hostileTolPath = join(root, "evil-tolerance.json");
    writeFileSync(
      hostileTolPath,
      JSON.stringify({ schemaVersion: 1, perturbations: 0, swapProbability: 0, ndcg5: 0, recallAt3: 0, badPickRate5: 0, byContextRecallAt3: 0, note: "hostile" }),
    );
    process.env.D2K_TOLERANCE_OUT = hostileTolPath;

    const acceptance = acceptanceForRegressedCandidate(root, 0.01); // within DEFAULT_TOL.ndcg5 (0.02)
    const result = promoteCandidate(root, acceptance);
    // DEFAULT_TOL tolerates this 0.01 drop -> PASS. If the hostile env tolerance (0) had been
    // honored instead, this would FAIL.
    expect(result.promoted).toBe(true);
  } finally {
    if (saved === undefined) delete process.env.D2K_TOLERANCE_OUT;
    else process.env.D2K_TOLERANCE_OUT = saved;
  }
});
