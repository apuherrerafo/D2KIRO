#!/usr/bin/env bun
// Certification remediation (Phase A, A3) -- IMMUTABLE EVIDENCE IDENTITY. Binds a Wave 5 packet to the exact code and exact data that
// produced it, so a reviewer can tell whether two packets evaluated the same system.
//
//   (library)   collectEvidenceIdentity({ ... })  -> embedded by scripts/wave5-dota-judge-packet.ts and scripts/wave5-certification.ts
//   bun scripts/wave5/evidence-identity.ts --compare=<packetA.json>,<packetB.json>     (names in docs/diagnostics; prints what differs)
//
// Code identity, two hashes over git blob ids (`git hash-object`, which applies the repo's line-ending filter, so it does not depend on
// the checkout's CRLF/LF):
//   dirtyDiffHash     sha256 of the files that differ from HEAD (status + path + blob id). Empty set => the tree is clean at HEAD.
//   contentStateHash  sha256 of EVERY tracked+untracked-not-ignored file (path + blob id) -- the whole certified state.
// `docs/diagnostics/**` is excluded from both: those are the evidence OUTPUTS, not the system under test.
// Data identity: sha256 of the frozen empirical snapshot (file + logical `meta1:` fingerprint, re-verified against its provenance),
// of the positional dataset (+ its completeness), of the curated/generated data files, and the ruleset target.
// Never imported from apps/. Zero network.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { RANKED_ALL_PICK_IDENTITY } from "../../apps/engine/src/draft-protocol/rulesets/ranked-all-pick";
import { snapshotPaths, verifySnapshot } from "../eval/freeze-empirical-snapshot";
import type { EmpiricalSnapshotProvenance } from "../eval/empirical-provenance";

export const IDENTITY_SCHEMA = "wave5-evidence-identity/v1";
const ROOT = resolve(import.meta.dir, "../..");
/** Evidence outputs -- never part of the state under test. */
const OUTPUT_PREFIXES = ["docs/diagnostics/"];

const sha256 = (data: string | Uint8Array): string => createHash("sha256").update(data).digest("hex");
const fileSha256 = (path: string): string | null => (existsSync(join(ROOT, path)) ? sha256(readFileSync(join(ROOT, path))) : null);
const git = (args: string[], input?: string): string => execFileSync("git", args, { cwd: ROOT, input, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const isOutput = (path: string): boolean => OUTPUT_PREFIXES.some((prefix) => path.startsWith(prefix));

function blobIds(paths: readonly string[]): Map<string, string> {
  if (paths.length === 0) return new Map();
  const ids = git(["hash-object", "--stdin-paths"], `${paths.join("\n")}\n`).trim().split("\n");
  return new Map(paths.map((path, index) => [path, ids[index]!]));
}

export interface DirtyEntry { status: string; path: string; blobId: string }

export function collectCodeIdentity() {
  const head = git(["rev-parse", "HEAD"]).trim();
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]).trim();
  const linkedWorktree = git(["rev-parse", "--git-dir"]).trim() !== git(["rev-parse", "--git-common-dir"]).trim();

  const porcelain = git(["status", "--porcelain=v1", "-z", "--untracked-files=all"]).split("\0").filter((entry) => entry.length > 3);
  const changed = porcelain.map((entry) => ({ status: entry.slice(0, 2).trim() || "?", path: entry.slice(3) })).filter((entry) => !isOutput(entry.path)).sort((a, b) => a.path.localeCompare(b.path));
  const present = changed.filter((entry) => existsSync(join(ROOT, entry.path)));
  const blobs = blobIds(present.map((entry) => entry.path));
  const dirty: DirtyEntry[] = changed.map((entry) => ({ ...entry, blobId: blobs.get(entry.path) ?? "deleted" }));

  const everything = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]).split("\0").filter((path) => path.length > 0 && !isOutput(path) && existsSync(join(ROOT, path))).sort();
  const everythingBlobs = blobIds(everything);

  return {
    head,
    branch,
    isolation: linkedWorktree ? "linked-worktree" : "shared-working-tree",
    cleanAtHead: dirty.length === 0,
    dirtyPathCount: dirty.length,
    dirtyDiffHash: sha256(dirty.map((entry) => `${entry.status} ${entry.path} ${entry.blobId}`).join("\n")),
    dirty,
    trackedAndUntrackedFileCount: everything.length,
    contentStateHash: sha256(everything.map((path) => `${path} ${everythingBlobs.get(path)}`).join("\n")),
    outputsExcluded: OUTPUT_PREFIXES,
  };
}

export interface SnapshotRef { id: string | null; live: boolean }

export function collectDataIdentity(snapshot: SnapshotRef, positionsMode = "as-loaded") {
  const positionsPath = "apps/engine/src/signals/hero-positions.json";
  const positionsRaw = JSON.parse(readFileSync(join(ROOT, positionsPath), "utf8")) as unknown;
  const positionsV2 = !Array.isArray(positionsRaw);
  const generated = ["data/generated/percentiles.json", "data/generated/signal-profile.json", "data/generated/tolerance.json"].map((path) => ({ path, sha256: fileSha256(path) }));

  let empirical: Record<string, unknown>;
  if (snapshot.id === null) {
    empirical = { certifiable: false, reason: "run against the live working database, not a frozen snapshot", id: null };
  } else {
    const paths = snapshotPaths(snapshot.id);
    const provenance = JSON.parse(readFileSync(paths.provenance, "utf8")) as EmpiricalSnapshotProvenance;
    const drift = verifySnapshot(snapshot.id);
    empirical = {
      certifiable: drift.length === 0,
      id: snapshot.id,
      fileSha256: sha256(readFileSync(paths.db)),
      logicalFingerprint: provenance.hashes.logicalFingerprint,
      provenanceSha256: sha256(readFileSync(paths.provenance)),
      verifiedAgainstProvenance: drift.length === 0,
      drift,
      rowCounts: provenance.rowCounts,
      source: provenance.source.name,
      retrievalWindow: provenance.synchronization.retrievalWindow,
      interruptedSyncRunPresent: provenance.synchronization.interruptedRunPresent,
      observationWindow: provenance.observationWindow,
      patchClaim: { label: provenance.patchClaim.label, verified: provenance.patchClaim.verified },
    };
  }

  return {
    empiricalSnapshot: empirical,
    /** Whether anything verifies the patch the rows carry. Plain-language status for a reader who skips the details. */
    empiricalPatchAttribution: "label-only, UNVERIFIED -- the source reports no patch; the label is applied by our ingestion",
    rulesetTarget: RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch,
    positionalDataset: {
      path: positionsPath,
      sha256: fileSha256(positionsPath),
      format: positionsV2 ? "hero-position-observations/v1" : "v1-floor-truncated",
      /** "as-loaded" = the product's own dataset; anything else is a synthetic sensitivity probe and NOT certifiable evidence. */
      mode: positionsMode,
      denominatorCorrected: positionsV2,
      completeness: positionsV2 ? "all observed rows retained (see the file's provenance)" : "INCOMPLETE -- sub-floor rows were discarded at collection; true denominators unknown (bounded, see WAVE5_POSITION_DATA_AUDIT)",
      provenanceTwin: { path: "data/metadata/hero-positions.json", sha256: fileSha256("data/metadata/hero-positions.json") },
    },
    curatedData: ["apps/engine/src/signals/hero-counters.json", "apps/engine/src/draft-paths/capabilities.json"].map((path) => ({ path, sha256: fileSha256(path) })),
    generatedData: generated,
  };
}

export interface IdentityInput {
  certificationId: string;
  snapshot: SnapshotRef;
  positionsMode?: string;
  /** Commands that regenerate the artifact this identity is embedded in, run from the repo root of the certified state. */
  reproduce: string[];
}

export function collectEvidenceIdentity(input: IdentityInput) {
  const code = collectCodeIdentity();
  const data = collectDataIdentity(input.snapshot, input.positionsMode);
  return {
    schema: IDENTITY_SCHEMA,
    certificationId: input.certificationId,
    generatedAt: new Date().toISOString(),
    runtime: { bun: Bun.version },
    code,
    data,
    /** Two artifacts evaluated the same system iff this key is equal. */
    comparableKey: sha256(JSON.stringify([code.contentStateHash, (data.empiricalSnapshot as { logicalFingerprint?: string }).logicalFingerprint ?? null, data.positionalDataset.sha256, data.positionalDataset.mode, data.curatedData, data.generatedData])),
    reproduce: input.reproduce,
  };
}

export type EvidenceIdentity = ReturnType<typeof collectEvidenceIdentity>;

/** What differs between two identities, facet by facet. Empty array => the same code and the same data. */
export function compareIdentities(a: EvidenceIdentity, b: EvidenceIdentity): string[] {
  const facets: [string, unknown, unknown][] = [
    ["git HEAD", a.code.head, b.code.head],
    ["certified code state (contentStateHash)", a.code.contentStateHash, b.code.contentStateHash],
    ["empirical snapshot (logical fingerprint)", (a.data.empiricalSnapshot as Record<string, unknown>).logicalFingerprint, (b.data.empiricalSnapshot as Record<string, unknown>).logicalFingerprint],
    ["empirical snapshot (file sha256)", (a.data.empiricalSnapshot as Record<string, unknown>).fileSha256, (b.data.empiricalSnapshot as Record<string, unknown>).fileSha256],
    ["positional dataset", a.data.positionalDataset.sha256, b.data.positionalDataset.sha256],
    ["positional dataset mode (as-loaded vs synthetic envelope)", a.data.positionalDataset.mode, b.data.positionalDataset.mode],
    ["curated data", JSON.stringify(a.data.curatedData), JSON.stringify(b.data.curatedData)],
    ["generated data", JSON.stringify(a.data.generatedData), JSON.stringify(b.data.generatedData)],
    ["ruleset target", a.data.rulesetTarget, b.data.rulesetTarget],
  ];
  return facets.filter(([, left, right]) => left !== right).map(([name]) => name);
}

if (import.meta.main) {
  const pair = process.argv.find((arg) => arg.startsWith("--compare="))?.slice("--compare=".length).split(",");
  if (!pair || pair.length !== 2) throw new Error("usage: --compare=<packetA.json>,<packetB.json>  (files in docs/diagnostics)");
  const load = (name: string): EvidenceIdentity => (JSON.parse(readFileSync(join(ROOT, "docs/diagnostics", name), "utf8")) as { evidenceIdentity?: EvidenceIdentity }).evidenceIdentity ?? (() => { throw new Error(`${name} carries no evidenceIdentity`); })();
  const [a, b] = pair.map(load) as [EvidenceIdentity, EvidenceIdentity];
  const differences = compareIdentities(a, b);
  console.log(differences.length === 0 ? "SAME code and SAME data" : `DIFFERENT: ${differences.join("; ")}`);
  console.log(`A ${a.certificationId} key ${a.comparableKey.slice(0, 16)} · B ${b.certificationId} key ${b.comparableKey.slice(0, 16)}`);
}
