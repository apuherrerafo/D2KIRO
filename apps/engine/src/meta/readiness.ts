import { RANKED_ALL_PICK_IDENTITY } from "../draft-protocol/rulesets/ranked-all-pick";
import type { DraftState } from "../draft/reducer";
import type { MetaSnapshot } from "../signals/types";
import { patchMetaReady } from "../signals/patch-meta";

export type NonVotingReason = "data_not_ready" | "not_structurally_applicable";


// Phase B -- Readiness and Provenance Semantics Contract.
//
// Separates four concepts previously blurred or conflated:
//   1. rulesetTarget: The product/ruleset target patch (e.g. "7.41f").
//   2. empiricalPatchClaim: The patch label carried by empirical rows + verification status.
//      Invariant: empirical OpenDota data is NEVER verified current-patch merely because the ruleset targets it.
//   3. syncFreshness: Retrieval recency (syncedAt, syncAgeMs, isFresh <= 24h, isStale > 24h).
//   4. patchCompatibility & patchMeta: Whether empirical data is compatible with the draft/ruleset patch,
//      and whether patch_meta is ready to vote or non-voting with an explicit nonVotingReason.

export const DEFAULT_RULESET_TARGET_PATCH = RANKED_ALL_PICK_IDENTITY.verifiedThroughPatch; // "7.41f"
export const FRESHNESS_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface EmpiricalPatchClaim {
  /** The patch label carried by empirical rows or ingestion config (e.g. "7.41e", "7.36"), or null if unavailable. */
  patch: string | null;
  /** Whether the empirical data source independently verified this patch attribution. Always false for OpenDota. */
  verified: boolean;
  /** Basis or provenance description of the claim. */
  basis: string;
}

export interface SyncFreshness {
  /** ISO timestamp when the latest successful sync finished, or null if no successful sync exists. */
  syncedAt: string | null;
  /** Age of the sync in milliseconds relative to the evaluation timestamp, or null if never synced. */
  syncAgeMs: number | null;
  /** True when syncedAt exists and syncAgeMs <= FRESHNESS_WINDOW_MS (24 hours). */
  isFresh: boolean;
  /** True when syncedAt is null or syncAgeMs > FRESHNESS_WINDOW_MS. Preserves compatibility with legacy isStale. */
  isStale: boolean;
}

export type PatchCompatibilityStatus =
  | "compatible" // empirical data has coverage for the target/state patch
  | "mismatched" // empirical data has a different patch label and lacks coverage for the target/state patch
  | "unknown";    // state patch or empirical patch is unknown

export interface PatchMetaReadiness {
  /** Whether the patch_meta signal is ready to vote (satisfies structural applicability and data readiness). */
  ready: boolean;
  /** Explicit non-voting reason when ready is false. */
  nonVotingReason: NonVotingReason | null;
  /** Detailed reason when knowable (e.g. "patch_mismatch" | "insufficient_coverage" | "no_data"). */
  detail?: string;
}

export interface MetaReadiness {
  /** The product/ruleset target patch (e.g. "7.41f"). NEVER derived from empirical data. */
  rulesetTarget: string;
  /** The empirical data's claimed patch and verification status. */
  empiricalPatchClaim: EmpiricalPatchClaim;
  /** Synchronization recency and staleness based on retrieval time. */
  syncFreshness: SyncFreshness;
  /** Patch compatibility between ruleset/draft state target patch and empirical patch claim. */
  patchCompatibility: PatchCompatibilityStatus;
  /** Signal readiness and non-voting status for patch_meta. */
  patchMeta: PatchMetaReadiness;
  /**
   * Compatibility alias for legacy callers expecting `metaIsStale`.
   * Preserves exact legacy sync-age behavior (true if syncFreshness.isStale).
   */
  metaIsStale: boolean;
}

export function computeSyncFreshness(
  syncedAt: string | null,
  now: () => number = Date.now,
): SyncFreshness {
  if (!syncedAt) {
    return {
      syncedAt: null,
      syncAgeMs: null,
      isFresh: false,
      isStale: true,
    };
  }
  const timestamp = new Date(syncedAt).getTime();
  if (Number.isNaN(timestamp)) {
    return {
      syncedAt,
      syncAgeMs: null,
      isFresh: false,
      isStale: true,
    };
  }
  const ageMs = Math.max(0, now() - timestamp);
  const isFresh = ageMs <= FRESHNESS_WINDOW_MS;
  return {
    syncedAt,
    syncAgeMs: ageMs,
    isFresh,
    isStale: !isFresh,
  };
}

export function extractEmpiricalPatchLabel(meta?: MetaSnapshot | null): string | null {
  if (!meta?.patchStats) return null;
  const counts: Record<string, number> = {};
  for (const heroStats of Object.values(meta.patchStats)) {
    for (const stat of heroStats) {
      if (stat.patch) {
        counts[stat.patch] = (counts[stat.patch] ?? 0) + 1;
      }
    }
  }
  let dominantPatch: string | null = null;
  let maxCount = 0;
  for (const [patch, count] of Object.entries(counts)) {
    if (count > maxCount) {
      maxCount = count;
      dominantPatch = patch;
    }
  }
  return dominantPatch;
}

export function determinePatchCompatibility(
  targetPatch: string | null | undefined,
  empiricalPatch: string | null | undefined,
  hasTargetCoverage: boolean = false,
): PatchCompatibilityStatus {
  if (!targetPatch || targetPatch === "unknown" || !empiricalPatch || empiricalPatch === "unknown") {
    return "unknown";
  }
  if (empiricalPatch === targetPatch || hasTargetCoverage) {
    return "compatible";
  }
  return "mismatched";
}

export interface ComputeMetaReadinessInput {
  rulesetTarget?: string;
  syncedAt?: string | null;
  now?: () => number;
  empiricalPatch?: string | null;
  /** Explicit empirical verification status. Even when rulesetTarget === "7.41f", empirical data defaults to false. */
  empiricalPatchVerified?: boolean;
  empiricalPatchBasis?: string;
  state?: DraftState | null;
  meta?: MetaSnapshot | null;
}

export function computeMetaReadiness(input: ComputeMetaReadinessInput = {}): MetaReadiness {
  const rulesetTarget = input.rulesetTarget ?? DEFAULT_RULESET_TARGET_PATCH;
  const now = input.now ?? Date.now;
  const syncFreshness = computeSyncFreshness(input.syncedAt ?? null, now);

  const empiricalPatch = input.empiricalPatch ?? extractEmpiricalPatchLabel(input.meta);
  // Empirical OpenDota patch attribution is caller-stamped and unverified by definition.
  // Ruleset target 7.41f NEVER causes empiricalPatchClaim.verified to become true automatically.
  const empiricalPatchClaim: EmpiricalPatchClaim = {
    patch: empiricalPatch,
    verified: input.empiricalPatchVerified === true,
    basis: input.empiricalPatchBasis ?? (
      empiricalPatch
        ? "caller-supplied constant stamped at ingestion (CURRENT_PATCH); source reports no patch"
        : "no empirical patch data available"
    ),
  };

  const effectiveTargetPatch = input.state?.patch && input.state.patch !== "unknown"
    ? input.state.patch
    : rulesetTarget;

  // Check if empirical data has rows for the target patch
  let hasTargetCoverage = false;
  if (input.meta?.patchStats && effectiveTargetPatch) {
    for (const heroRows of Object.values(input.meta.patchStats)) {
      if (heroRows.some((row) => row.patch === effectiveTargetPatch)) {
        hasTargetCoverage = true;
        break;
      }
    }
  }

  const patchCompatibility = determinePatchCompatibility(
    effectiveTargetPatch,
    empiricalPatch,
    hasTargetCoverage,
  );

  let patchMeta: PatchMetaReadiness;
  if (input.state && input.meta) {
    const ready = patchMetaReady(input.state, input.meta);
    if (ready) {
      patchMeta = { ready: true, nonVotingReason: null };
    } else {
      let detail: string;
      if (patchCompatibility === "mismatched") {
        detail = "patch_mismatch";
      } else if (!input.meta.patchStats || Object.keys(input.meta.patchStats).length === 0) {
        detail = "no_data";
      } else {
        detail = "insufficient_coverage";
      }
      patchMeta = {
        ready: false,
        nonVotingReason: "data_not_ready",
        detail,
      };
    }
  } else {
    // State or meta not provided: derive readiness from empirical compatibility and data presence
    if (patchCompatibility === "mismatched") {
      patchMeta = {
        ready: false,
        nonVotingReason: "data_not_ready",
        detail: "patch_mismatch",
      };
    } else if (!empiricalPatch || (input.meta && Object.keys(input.meta.patchStats ?? {}).length === 0)) {
      patchMeta = {
        ready: false,
        nonVotingReason: "data_not_ready",
        detail: "no_data",
      };
    } else {
      // Patch is compatible or unknown, but full draft state was not evaluated
      patchMeta = {
        ready: false,
        nonVotingReason: "data_not_ready",
        detail: "state_not_provided",
      };
    }
  }

  return {
    rulesetTarget,
    empiricalPatchClaim,
    syncFreshness,
    patchCompatibility,
    patchMeta,
    metaIsStale: syncFreshness.isStale,
  };
}
