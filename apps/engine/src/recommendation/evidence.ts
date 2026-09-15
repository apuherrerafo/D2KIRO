import { rulesHash } from "../draft-protocol";
import type { RoleBeliefEvidence } from "../draft-protocol/roles/role-belief";
import type { HeroId, RulesetIdentity } from "../draft-protocol/types";
import type { SuggestionSet } from "../signals/mix";
import type { SignalContribution } from "../signals/types";
import type { EvidenceItem, RecommendationRisk, RecommendationRoleImpact } from "./types";

// R1 S5 -- structured, sourced evidence. Every item traces back to a real, already-computed value
// (a V6 SignalContribution, a RoleBeliefEvidence entry, a RulesetIdentity/eligibility hash) --
// never a freestanding string invented at this layer, and never an LLM-authored explanation.

const EVIDENCE_VERSION_V6_SIGNAL = "v6-signals/v6";
const EVIDENCE_VERSION_ROLE_BELIEF = "role-belief/v1";
const EVIDENCE_VERSION_PROTOCOL = "draft-protocol/v1";

export function evidenceFromSignals(hero: HeroId, signals: readonly SignalContribution[]): EvidenceItem[] {
  return signals.map((signal) => ({
    source: "v6-signal",
    version: EVIDENCE_VERSION_V6_SIGNAL,
    subject: hero,
    signal: signal.signal,
    value: signal.raw ?? signal.normalized ?? null,
    contribution: signal.weighted,
    reason: signal.explanation,
  }));
}

export function evidenceFromRoleBelief(hero: HeroId, entries: readonly RoleBeliefEvidence[]): EvidenceItem[] {
  return entries.map((entry) => ({
    source: "role-belief",
    version: EVIDENCE_VERSION_ROLE_BELIEF,
    subject: hero,
    signal: "role_belief",
    value: entry.kind,
    contribution: null,
    reason: entry.detail,
  }));
}

export function evidenceFromRuleset(ruleset: RulesetIdentity): EvidenceItem {
  return {
    source: "protocol-ruleset",
    version: EVIDENCE_VERSION_PROTOCOL,
    subject: null,
    signal: "ruleset_identity",
    value: ruleset.rulesHash,
    contribution: null,
    reason: `${ruleset.id}@${ruleset.version} (patches ${ruleset.applicableFromPatch}..${ruleset.verifiedThroughPatch})`,
  };
}

export function evidenceFromEligibility(contentHash: string, heroCount: number): EvidenceItem {
  return {
    source: "cm-eligibility",
    version: "cm-hero-eligibility/v1",
    subject: null,
    signal: "eligibility",
    value: contentHash,
    contribution: null,
    reason: `snapshot certificado con ${heroCount} héroes elegibles`,
  };
}

// Blocker 7 (independent architecture review) -- evidenceVersion previously named only the
// SCORING MECHANISM (a static string constant), never the concrete meta/curated-data evidence V6
// actually used -- two calls with identical state/patch/party/seed but different meta data (a
// hero-positions.json regeneration, a fresh matchup sync) would hash identically even when the
// resulting recommendation genuinely changed. No existing content-hash/version primitive covers
// `MetaSnapshot` or the curated JSON files it's built from (checked: signals/*.ts, db/*.ts,
// drafter/*.ts, draft-paths/*.ts -- none exists), and `recommendation/**` never receives the raw
// MetaSnapshot anyway (only the already-scored SuggestionSet, via computeSuggestions) -- so this
// hashes exactly the FUNCTIONAL evidence that reached this decision: per hero, per signal,
// `raw`/`normalized`/`evidenceConfidence` (`candidates`, sorted by hero then signal name so V6's
// own diversitySeed-driven reordering -- mix.ts's diversifyEquivalentCandidates -- can never move
// THIS part on its own), plus `sequence` (below).
//
// Final evidence-identity repair (independent review, follow-up to blocker 7) -- `candidates`
// alone is not enough. `build.ts` is `evidenceIdentityHash`'s ONLY caller, and it ALWAYS requests
// `computeSuggestions(..., { teamOpening: true, ... })` (see build.ts's own `suggestionSet =
// await computeSuggestions(...)`), so every `SuggestionSet` reaching this function went through
// mix.ts's `recommendTeamOpeners` branch, never `diversifyEquivalentCandidates` (mix.ts only takes
// that branch when `teamOpening` is falsy). `recommendTeamOpeners` (drafter/team-opener.ts)
// consumes `HeroCapabilities`-derived `strategy` (via `openingStrategy`) and curated/statistical
// ban relief that never produce a `SignalContribution` at all -- they only ever surface as (a) the
// ORDER `suggestionSet.suggestions` comes back in (shortlist.ts and buildCompoundCandidates take
// that order as given, never re-sort it) and (b) each hero's `score` (`reconcileWeightedToScore`
// rescales `contributions[].weighted` to match the ban-relief-adjusted score, but the score number
// itself -- what `Recommendation.score` is literally built from in build.ts -- is team-opener's,
// not a pure function of `raw`/`normalized`). Two capability sets that assign different `strategy`
// labels to the same candidates can reorder/rescore an identical `candidates` block through the
// repeat-strategy diversity penalty alone, with `raw`/`normalized`/`evidenceConfidence` never
// moving -- exactly the reproduction this hash must catch. `sequence` closes that gap by hashing
// `{hero, score}` in the EXACT order `suggestionSet.suggestions` provides, unsorted: any reorder or
// rescale changes it, whatever HeroCapabilities/curated-counter input caused it, without this
// module ever importing `drafter/team-opener.ts` (architecture-guard.test.ts) -- `suggestionSet`
// is signals/mix.ts's own sanctioned output, the same boundary `candidates` already crosses.
//
// Still deliberately excludes `weighted`/`rank`/`confidence`/`reason`/`explanation`/
// `evidenceCoverage`/`guessingIndex`: `reconcileWeightedToScore` only uniformly rescales
// `contributions[].weighted` to keep `Σweighted == score` (so `weighted` carries no information
// `score` doesn't already have); `evidenceCoverage`/`guessingIndex`/`confidence` are copied
// verbatim from the pre-team-opening `ScoredCandidate` (mix.ts's `{ ...base, score, contributions
// }` spread) and so remain a pure derivation of `raw`/`normalized`, already covered by
// `candidates`; `rank` is index-in-`sequence`, redundant with `sequence`'s own order; `reason`/
// `explanation` are human text built from the same evidence, never a second source of it.
// `computedInMs` is excluded because it is exactly the runtime-timing noise the contract says must
// never move identity. Only the heroes actually returned by V6 (already bounded to TOP_N / the
// certified legal universe) are hashed: a change to evidence for a hero that never reached this
// SuggestionSet could not have changed this recommendation, so it must not change this
// recommendation's identity either.
export function evidenceIdentityHash(suggestionSet: SuggestionSet): string {
  const candidates = [...suggestionSet.suggestions]
    .map((suggestion) => ({
      hero: suggestion.hero,
      signals: [...suggestion.signals]
        .map((signal) => ({
          signal: signal.signal as string,
          raw: signal.raw,
          normalized: signal.normalized ?? null,
          evidenceConfidence: signal.evidenceConfidence ?? null,
        }))
        .sort((a, b) => (a.signal < b.signal ? -1 : a.signal > b.signal ? 1 : 0)),
    }))
    .sort((a, b) => a.hero - b.hero);
  const sequence = suggestionSet.suggestions.map((suggestion) => ({ hero: suggestion.hero, score: suggestion.score }));
  return rulesHash({ decisionContext: suggestionSet.decisionContext, candidates, sequence });
}

/** Reuses V6's OWN already-frozen confidence tiers (mix.ts / SPEC.md §16.7-4: alta >= 0.75,
 * media >= 0.5, baja < 0.5 de evidenceCoverage) -- "baja" IS the low-evidence signal; this
 * function names that fact as a risk instead of re-deriving a second cutoff. */
export function deriveRisks(
  confidence: "alta" | "media" | "baja",
  roleImpacts: readonly RecommendationRoleImpact[],
  metaIsStale: boolean,
): RecommendationRisk[] {
  const risks: RecommendationRisk[] = [];
  if (confidence === "baja") risks.push({ kind: "low_evidence", detail: "evidenceCoverage baja en la señal V6 subyacente" });
  if (roleImpacts.some((impact) => impact.status === "UNRESOLVED")) {
    risks.push({ kind: "unresolved_role", detail: "sin evidencia de posición para al menos un héroe de la acción" });
  }
  if (metaIsStale) risks.push({ kind: "degraded_meta", detail: "meta snapshot stale (stale_meta)" });
  return risks;
}
