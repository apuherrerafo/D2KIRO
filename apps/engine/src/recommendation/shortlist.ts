import type { HeroId } from "../draft-protocol/types";
import type { Suggestion, SuggestionSet } from "../signals/mix";

// R1 S5 -- shortlist + bounded compound enumeration. `buildSuggestions` (V6) already returns its
// candidates rank-ordered by score; this module never re-sorts that ordering, it only (a)
// intersects against the kernel's certified legal hero universe (LEGAL ACTION FIRST -- see
// decision.ts) and (b) bounds how many candidates ever reach pairwise compound enumeration, so a
// round with hundreds of legal heroes can never explode into a combinatorial pass. Determinism
// follows directly from V6's own determinism (same state/meta/seed -> same suggestion order) plus
// plain array operations here -- no RNG, no wall clock, anywhere in this file.

/** Bound for compound pairing: `SHORTLIST_SIZE` choose 2 = 28 pairs, each scored by two numbers
 * already computed by the one V6 pass -- negligible against the 300ms budget. Not a tuned
 * business threshold, just the shortlist width; raising it only widens the search, never changes
 * which hero wins a search that already converged. */
export const SHORTLIST_SIZE = 8;

export interface ShortlistEntry {
  hero: HeroId;
  suggestion: Suggestion;
}

/** Pure. `excluded` is a defense-in-depth re-check (banned/picked/ineligible), not the primary
 * filter -- `eligibleHeroIds` (Captain's Mode) and V6's own candidate pool (Ranked All Pick,
 * already banned/picked-aware) do the primary work. */
export function buildShortlist(
  suggestionSet: SuggestionSet,
  eligibleHeroIds: readonly HeroId[] | null,
  excluded: ReadonlySet<HeroId>,
): ShortlistEntry[] {
  const eligible = eligibleHeroIds === null ? null : new Set(eligibleHeroIds);
  const filtered = suggestionSet.suggestions.filter(
    (suggestion) => !excluded.has(suggestion.hero) && (eligible === null || eligible.has(suggestion.hero)),
  );
  return filtered.slice(0, SHORTLIST_SIZE).map((suggestion) => ({ hero: suggestion.hero, suggestion }));
}

export interface CompoundCandidate {
  entries: readonly [ShortlistEntry, ShortlistEntry];
  /** Sum of the two INDEPENDENTLY-computed V6 scores. Deliberately not a synergy-adjusted score --
   * see build.ts's header comment: V6 has no "score these two heroes as a simultaneous pair"
   * primitive, and inventing a bonus weight here would be exactly the kind of business threshold
   * this contract forbids fabricating. */
  score: number;
  confidence: "alta" | "media" | "baja";
}

const CONFIDENCE_RANK: Record<"alta" | "media" | "baja", number> = { alta: 2, media: 1, baja: 0 };

function lowerConfidence(a: "alta" | "media" | "baja", b: "alta" | "media" | "baja"): "alta" | "media" | "baja" {
  return CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b;
}

/**
 * Every distinct unordered pair from the shortlist -- hero uniqueness is structural (i < j over a
 * deduplicated shortlist, so a hero can never pair with itself and never appears twice in one
 * pair). Sorted descending by score, ties broken by shortlist order (stable), so the result is
 * fully deterministic for a given shortlist.
 */
export function buildCompoundCandidates(shortlist: readonly ShortlistEntry[]): CompoundCandidate[] {
  const combos: CompoundCandidate[] = [];
  for (let i = 0; i < shortlist.length; i += 1) {
    for (let j = i + 1; j < shortlist.length; j += 1) {
      const a = shortlist[i]!;
      const b = shortlist[j]!;
      combos.push({
        entries: [a, b],
        score: a.suggestion.score + b.suggestion.score,
        confidence: lowerConfidence(a.suggestion.confidence, b.suggestion.confidence),
      });
    }
  }
  return combos
    .map((combo, index) => ({ combo, index }))
    .sort((x, y) => y.combo.score - x.combo.score || x.index - y.index)
    .map(({ combo }) => combo);
}
