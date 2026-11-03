import { describe, expect, test } from "bun:test";
import { createIdleDraftState, type DraftState } from "../draft/reducer";
import {
  computeMetaReadiness,
  computeSyncFreshness,
  determinePatchCompatibility,
  extractEmpiricalPatchLabel,
  FRESHNESS_WINDOW_MS,
  type MetaReadiness,
} from "./readiness";
import type { HeroPatchBracketStat, MetaHeroInfo, MetaSnapshot } from "../signals/types";
import { buildSuggestions, structurallyApplicableSignals, votingSignals } from "../signals/mix";
import { patchMetaReady } from "../signals/patch-meta";

function createMockDraftState(overrides: Partial<DraftState> = {}): DraftState {
  return {
    sessionId: "readiness-session",
    schema: "draft-state/v1",
    format: "all_pick",
    patch: "7.41e",
    localSide: "radiant",
    phase: "active",
    banned: [],
    picks: { radiant: [], dire: [] },
    lastSeq: 1,
    appliedEventIds: [],
    quality: { unconfirmed: [], captureStatus: "ok" },
    updatedAt: "2026-09-21T00:00:00Z",
    firstPickSide: null,
    turnStartedAt: null,
    reserveRemainingMs: null,
    ...overrides,
  };
}

function createMockMeta(
  heroIds: number[],
  patch: string,
  picksPerHero: number = 600,
  overrides: Partial<MetaSnapshot> = {},
): MetaSnapshot {
  const heroes: Record<number, MetaHeroInfo> = {};
  const patchStats: Record<number, HeroPatchBracketStat[]> = {};
  for (const id of heroIds) {
    heroes[id] = { id, localizedName: `Hero ${id}` };
    patchStats[id] = [
      { patch, bracket: "crusader", picks: picksPerHero, wins: Math.floor(picksPerHero * 0.52) },
    ];
  }
  return { heroes, matchups: {}, patchStats, ...overrides };
}

describe("Phase B Readiness and Provenance Semantics", () => {
  const NOW = 1774000000000;
  const now = () => NOW;

  describe("computeSyncFreshness", () => {
    test("null syncedAt -> isStale true, isFresh false, syncAgeMs null", () => {
      const freshness = computeSyncFreshness(null, now);
      expect(freshness.syncedAt).toBeNull();
      expect(freshness.syncAgeMs).toBeNull();
      expect(freshness.isFresh).toBe(false);
      expect(freshness.isStale).toBe(true);
    });

    test("syncedAt 2 hours ago (< 24h) -> isFresh true, isStale false", () => {
      const twoHoursAgo = new Date(NOW - 2 * 60 * 60 * 1000).toISOString();
      const freshness = computeSyncFreshness(twoHoursAgo, now);
      expect(freshness.isFresh).toBe(true);
      expect(freshness.isStale).toBe(false);
      expect(freshness.syncAgeMs).toBe(2 * 60 * 60 * 1000);
    });

    test("syncedAt 25 hours ago (> 24h) -> isFresh false, isStale true", () => {
      const twentyFiveHoursAgo = new Date(NOW - 25 * 60 * 60 * 1000).toISOString();
      const freshness = computeSyncFreshness(twentyFiveHoursAgo, now);
      expect(freshness.isFresh).toBe(false);
      expect(freshness.isStale).toBe(true);
      expect(freshness.syncAgeMs).toBe(25 * 60 * 60 * 1000);
    });

    test("invalid date string -> isStale true, isFresh false", () => {
      const freshness = computeSyncFreshness("not-a-valid-date", now);
      expect(freshness.isFresh).toBe(false);
      expect(freshness.isStale).toBe(true);
      expect(freshness.syncAgeMs).toBeNull();
    });
  });

  describe("determinePatchCompatibility and extractEmpiricalPatchLabel", () => {
    test("extracts dominant patch from patchStats", () => {
      const meta = createMockMeta([1, 2, 3], "7.41e");
      expect(extractEmpiricalPatchLabel(meta)).toBe("7.41e");
    });

    test("returns null for empty patchStats", () => {
      expect(extractEmpiricalPatchLabel({ heroes: {}, matchups: {} })).toBeNull();
      expect(extractEmpiricalPatchLabel(null)).toBeNull();
    });

    test("compatible when target matches empirical patch", () => {
      expect(determinePatchCompatibility("7.41e", "7.41e")).toBe("compatible");
    });

    test("compatible when target patch has coverage even if dominant patch differs", () => {
      expect(determinePatchCompatibility("7.41f", "7.41e", true)).toBe("compatible");
    });

    test("mismatched when target differs and lacks coverage", () => {
      expect(determinePatchCompatibility("7.41f", "7.41e", false)).toBe("mismatched");
    });

    test("unknown when either target or empirical is unknown/null", () => {
      expect(determinePatchCompatibility(null, "7.41e")).toBe("unknown");
      expect(determinePatchCompatibility("7.41e", null)).toBe("unknown");
      expect(determinePatchCompatibility("unknown", "7.41e")).toBe("unknown");
    });
  });

  describe("Case 1: Old-but-compatible data (syncAge > 24h, patch matches)", () => {
    test("sync age staleness does not distort patch compatibility", () => {
      const fortyEightHoursAgo = new Date(NOW - 48 * 60 * 60 * 1000).toISOString();
      const meta = createMockMeta([1, 2, 3], "7.41e");
      const state = createMockDraftState({ patch: "7.41e" });

      const readiness = computeMetaReadiness({
        rulesetTarget: "7.41f",
        syncedAt: fortyEightHoursAgo,
        now,
        state,
        meta,
      });

      // Synchronization freshness is stale (> 24h)
      expect(readiness.syncFreshness.isStale).toBe(true);
      expect(readiness.syncFreshness.isFresh).toBe(false);
      expect(readiness.syncFreshness.syncAgeMs).toBe(48 * 60 * 60 * 1000);
      expect(readiness.metaIsStale).toBe(true);

      // But patch compatibility is compatible because state.patch ("7.41e") matches empirical data
      expect(readiness.patchCompatibility).toBe("compatible");
      expect(readiness.empiricalPatchClaim.patch).toBe("7.41e");
    });
  });

  describe("Case 2: Fresh-but-patch-mismatched data (syncAge < 24h, patch differs)", () => {
    test("fresh synchronization does not mask patch mismatch", () => {
      const oneHourAgo = new Date(NOW - 1 * 60 * 60 * 1000).toISOString();
      const meta = createMockMeta([1, 2, 3], "7.41e");
      // State is on 7.41f, but empirical data is only 7.41e
      const state = createMockDraftState({ patch: "7.41f" });

      const readiness = computeMetaReadiness({
        rulesetTarget: "7.41f",
        syncedAt: oneHourAgo,
        now,
        state,
        meta,
      });

      // Retrieval is fresh
      expect(readiness.syncFreshness.isFresh).toBe(true);
      expect(readiness.syncFreshness.isStale).toBe(false);
      expect(readiness.metaIsStale).toBe(false);

      // But patch compatibility is mismatched
      expect(readiness.patchCompatibility).toBe("mismatched");
      expect(readiness.patchMeta.ready).toBe(false);
      expect(readiness.patchMeta.nonVotingReason).toBe("data_not_ready");
      expect(readiness.patchMeta.detail).toBe("patch_mismatch");
    });
  });

  describe("Case 3: Unverified patch attribution", () => {
    test("OpenDota patch attribution remains unverified by definition", () => {
      const meta = createMockMeta([1, 2, 3], "7.41e");
      const readiness = computeMetaReadiness({
        syncedAt: new Date(NOW).toISOString(),
        now,
        meta,
      });

      expect(readiness.empiricalPatchClaim.verified).toBe(false);
      expect(readiness.empiricalPatchClaim.basis).toContain("CURRENT_PATCH");
      expect(readiness.empiricalPatchClaim.basis).toContain("source reports no patch");
    });
  });

  describe("Case 4: patch_meta data_not_ready degradation flag and renormalization", () => {
    test("when patchMeta is not ready, degraded flag is emitted and weights renormalize", () => {
      // 25 heroes, but all on 7.41e, while draft state is on 7.41f
      const heroIds = Array.from({ length: 25 }, (_, i) => i + 1);
      const meta = createMockMeta(heroIds, "7.41e", 1000);
      const state = createMockDraftState({ patch: "7.41f" });

      expect(patchMetaReady(state, meta)).toBe(false);

      const applicable = structurallyApplicableSignals(state, meta);
      const voting = votingSignals(state, meta);

      expect(applicable.has("patch_meta")).toBe(true);
      expect(voting.has("patch_meta")).toBe(false);

      const suggestions = buildSuggestions(state, meta, { now });
      expect(suggestions.degraded).toContain("patch_meta_data_not_ready");

      // Verify each suggestion has patch_meta with raw: null, weighted: 0, and non-voting status
      for (const suggestion of suggestions.suggestions) {
        const patchSignal = suggestion.signals.find((s) => s.signal === "patch_meta");
        expect(patchSignal).toBeDefined();
        expect(patchSignal?.raw).toBeNull();
        expect(patchSignal?.weighted).toBe(0);
      }
    });

    test("when coverage is below MIN_PATCH_META_COVERAGE_HEROES (e.g. only 5 heroes), patchMetaReady is false", () => {
      const heroIds = [1, 2, 3, 4, 5];
      const meta = createMockMeta(heroIds, "7.41e", 1000);
      const state = createMockDraftState({ patch: "7.41e" });

      expect(patchMetaReady(state, meta)).toBe(false);

      const suggestions = buildSuggestions(state, meta, { now });
      expect(suggestions.degraded).toContain("patch_meta_data_not_ready");
    });
  });

  describe("Case 5: Successful / ready state", () => {
    test("when fresh and with adequate coverage for target patch, patch_meta votes and no degradation flag", () => {
      const heroIds = Array.from({ length: 25 }, (_, i) => i + 1);
      const meta = createMockMeta(heroIds, "7.41e", 1000);
      const state = createMockDraftState({ patch: "7.41e" });

      expect(patchMetaReady(state, meta)).toBe(true);

      const recentSync = new Date(NOW - 1000).toISOString();
      const readiness = computeMetaReadiness({
        rulesetTarget: "7.41f",
        syncedAt: recentSync,
        now,
        state,
        meta,
      });

      expect(readiness.syncFreshness.isFresh).toBe(true);
      expect(readiness.patchCompatibility).toBe("compatible");
      expect(readiness.patchMeta.ready).toBe(true);
      expect(readiness.patchMeta.nonVotingReason).toBeNull();

      const suggestions = buildSuggestions(state, meta, { metaReadiness: readiness, now });
      expect(suggestions.degraded).not.toContain("patch_meta_data_not_ready");
      expect(suggestions.degraded).not.toContain("stale_meta");

      const voting = votingSignals(state, meta);
      expect(voting.has("patch_meta")).toBe(true);
    });
  });

  describe("Case 6: Ruleset target 7.41f does NOT cause empiricalPatchClaim.verified to become true automatically", () => {
    test("rulesetTarget 7.41f with empirical patch 7.41f still leaves verified=false", () => {
      const meta = createMockMeta([1, 2, 3], "7.41f");
      const state = createMockDraftState({ patch: "7.41f" });

      const readiness = computeMetaReadiness({
        rulesetTarget: "7.41f",
        syncedAt: new Date(NOW).toISOString(),
        now,
        state,
        meta,
        // empiricalPatchVerified is omitted or false
      });

      expect(readiness.rulesetTarget).toBe("7.41f");
      expect(readiness.empiricalPatchClaim.patch).toBe("7.41f");
      expect(readiness.empiricalPatchClaim.verified).toBe(false);
      expect(readiness.patchCompatibility).toBe("compatible");
    });
  });

  describe("Case 7: Recommendation order invariance", () => {
    test("recommendation order is completely unchanged when only readiness metadata is attached", () => {
      const heroIds = Array.from({ length: 25 }, (_, i) => i + 1);
      const meta = createMockMeta(heroIds, "7.41e", 1000);
      const state = createMockDraftState({ patch: "7.41e" });

      const recentSync = new Date(NOW - 1000).toISOString();
      const readiness = computeMetaReadiness({
        rulesetTarget: "7.41f",
        syncedAt: recentSync,
        now,
        state,
        meta,
      });

      const baselineSuggestions = buildSuggestions(state, meta, { now });
      const readinessSuggestions = buildSuggestions(state, meta, { metaReadiness: readiness, now });

      expect(readinessSuggestions.suggestions.length).toBe(baselineSuggestions.suggestions.length);
      for (let i = 0; i < baselineSuggestions.suggestions.length; i++) {
        const baseline = baselineSuggestions.suggestions[i]!;
        const withReadiness = readinessSuggestions.suggestions[i]!;
        expect(withReadiness.hero).toBe(baseline.hero);
        expect(withReadiness.rank).toBe(baseline.rank);
        expect(withReadiness.score).toBe(baseline.score);
      }
    });
  });
});
